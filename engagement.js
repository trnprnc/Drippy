// L0 engagement sensor — "the user is present in / actively working in a
// Claude surface".
//
// Two permissionless signals, polled together in one tiny shell call:
//   - frontmost app name (lsappinfo)
//   - seconds since the last keyboard/mouse input (IOHIDSystem HIDIdleTime)
// We never see keystrokes — only the fact that input occurred.
//
// Two levels of engagement, emitted together as one 'state' event:
//   present — a Claude surface is frontmost (eyes open)
//   typing  — and input happened in the last few seconds (eyes gaze at work)
//
// Prototype polls at 1.2s (a single ~10ms subprocess). The native port
// replaces this with push-based NSWorkspace activation notifications and
// only samples idle time while a Claude surface is frontmost.

const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const POLL_MS = 1200;
const TYPING_IDLE_S = 4;
const PRESENCE_IDLE_S = 90; // frontmost but untouched this long → doze off
// Fast to open, slow to close: pausing to think mid-message must not make
// the gaze flicker. Losing focus to another app closes the eyes after 2
// polls (tolerates menu/Spotlight blips).
const TYPING_QUIET_POLLS = 5;
const FRONT_LOSS_POLLS = 2;

const FRONT_APPS = new Set(['Claude']); // Claude Desktop; browsers come with the extension

const SCRIPT =
  'lsappinfo info -only name "$(lsappinfo front)"; ' +
  "ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF; exit}'";

class EngagementSensor extends EventEmitter {
  constructor() {
    super();
    this.present = false;
    this.typing = false;
    this.lastTypingAt = 0; // for attributing requests to the user
    this.typingQuietPolls = 0;
    this.frontLossPolls = 0;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  poll() {
    execFile('sh', ['-c', SCRIPT], { timeout: 3000 }, (err, stdout) => {
      if (err) return;
      const lines = stdout.trim().split('\n');
      const nameMatch = (lines[0] || '').match(/"LSDisplayName"="(.+)"/);
      const front = nameMatch ? nameMatch[1] : null;
      const idleSec = Number(lines[1]) / 1e9;
      const frontOk = FRONT_APPS.has(front);

      this.frontLossPolls = frontOk ? 0 : this.frontLossPolls + 1;
      const frontLost = this.frontLossPolls >= FRONT_LOSS_POLLS;

      const present = frontOk ? idleSec < PRESENCE_IDLE_S : this.present && !frontLost;

      let typing = this.typing;
      if (frontOk && idleSec < TYPING_IDLE_S) {
        typing = true;
        this.typingQuietPolls = 0;
        this.lastTypingAt = Date.now();
      } else if (this.typing) {
        this.typingQuietPolls += 1;
        if (this.typingQuietPolls >= TYPING_QUIET_POLLS || frontLost) {
          typing = false;
          this.typingQuietPolls = 0;
        }
      }

      if (present !== this.present || typing !== this.typing) {
        this.present = present;
        this.typing = typing && present;
        this.emit('state', { present: this.present, typing: this.typing, app: front });
      }
    });
  }
}

module.exports = EngagementSensor;
