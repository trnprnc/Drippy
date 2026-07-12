// L2 privacy sensor — watches for sensitive data at the two riskiest
// moments: pasting (clipboard) and typing into the Claude composer.
//
// Trust rules, enforced structurally:
//   - all scanning happens in-memory on this device; text is discarded
//     immediately after scanText() returns
//   - events carry only category names ("api key", "email address"),
//     never the content itself
//   - sensors only run while the user is present in a Claude surface
//
// Composer scanning reads the focused text field through the Accessibility
// API (via System Events), which requires the user to grant Drippy
// Accessibility + Automation permissions once. Until granted, only the
// clipboard sentinel runs.

const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { clipboard } = require('electron');
const { scanText } = require('./pii');

const CLIPBOARD_POLL_MS = 2000; // while present
const COMPOSER_POLL_MS = 2500; // while typing
const AX_RETRY_MS = 20 * 1000; // cheap probe — notice a fresh grant quickly

const COMPOSER_SCRIPT =
  'tell application "System Events" to tell (first process whose name is "Claude") to ' +
  'get value of attribute "AXValue" of (get value of attribute "AXFocusedUIElement")';

// The composer query returns a generic -1728 when Accessibility permission
// is missing, hiding the real cause. This probe is cheap and errors with an
// explicit "not allowed assistive access" message when the grant is absent.
const PROBE_SCRIPT = 'tell application "System Events" to tell process "Claude" to get name of windows';

const PERMISSION_ERR = /not allowed|not authorized|assistive|1002|-1743|-25211/i;

class PrivacySensor extends EventEmitter {
  constructor() {
    super();
    this.present = false;
    this.typing = false;
    this.clipTimer = null;
    this.axTimer = null;
    this.lastClipHash = null;
    this.lastComposerCategories = new Set();
    this.axAvailable = null; // null = unknown, false = permission missing
    this.axPermissionReported = false;
    this.axRetryAt = 0;
  }

  setContext({ present, typing }) {
    this.present = present;
    this.typing = typing;

    if (present && !this.clipTimer) {
      this.clipTimer = setInterval(() => this.pollClipboard(), CLIPBOARD_POLL_MS);
      this.pollClipboard();
    } else if (!present && this.clipTimer) {
      clearInterval(this.clipTimer);
      this.clipTimer = null;
    }

    if (typing && !this.axTimer) {
      this.axTimer = setInterval(() => this.pollComposer(), COMPOSER_POLL_MS);
    } else if (!typing && this.axTimer) {
      clearInterval(this.axTimer);
      this.axTimer = null;
      this.lastComposerCategories = new Set();
    }
  }

  pollClipboard() {
    let text = '';
    try {
      text = clipboard.readText() || '';
    } catch {
      return;
    }
    if (!text) return;
    const hash = crypto.createHash('sha1').update(text).digest('hex');
    if (hash === this.lastClipHash) return; // unchanged since last scan
    this.lastClipHash = hash;
    const concerns = scanText(text);
    text = ''; // discard content; only concern descriptors survive
    if (concerns.length) {
      this.emit('detected', { source: 'clipboard', concerns });
    }
  }

  pollComposer() {
    if (this.axAvailable === false && Date.now() < this.axRetryAt) return;
    if (this.axAvailable !== true) {
      this.probeAx((ok) => ok && this.readComposer());
      return;
    }
    this.readComposer();
  }

  probeAx(done) {
    execFile('osascript', ['-e', PROBE_SCRIPT], { timeout: 2000 }, (err, _stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message || '');
        this.axAvailable = false;
        this.axRetryAt = Date.now() + AX_RETRY_MS;
        if (PERMISSION_ERR.test(msg) && !this.axPermissionReported) {
          this.axPermissionReported = true;
          this.emit('ax-permission-needed');
        }
        return done(false);
      }
      this.axAvailable = true;
      this.axPermissionReported = false; // granted — report again if revoked
      this.emit('ax-ready');
      done(true);
    });
  }

  readComposer() {
    execFile('osascript', ['-e', COMPOSER_SCRIPT], { timeout: 2000 }, (err, stdout) => {
      if (err) {
        return; // no focused text field / transient AX miss — fine
      }
      let text = stdout || '';
      if (text.trim() === 'missing value') return;
      const concerns = scanText(text);
      text = ''; // discard content

      // Rising edge only: fire when a concern appears that wasn't already
      // in the composer, so one typed email = one event, not one per poll.
      const fresh = concerns.filter((c) => !this.lastComposerCategories.has(c.id));
      this.lastComposerCategories = new Set(concerns.map((c) => c.id));
      if (fresh.length) {
        this.emit('detected', { source: 'typing', concerns: fresh });
      }
    });
  }
}

module.exports = PrivacySensor;
