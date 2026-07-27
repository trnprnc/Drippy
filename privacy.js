// L2 privacy sensor — watches for sensitive data at the riskiest moment:
// pasting into Claude.
//
// Real workflow: people copy a secret from a browser, a .env file or a
// password manager, THEN paste it into Claude. So the clipboard is scanned
// throughout an active Claude session — frontmost now, or within a few
// minutes of using Claude — not only while Claude is the frontmost app. A
// secret copied elsewhere is caught the moment it hits the clipboard, and
// the menu-bar eyes go wide even before you switch back to paste.
//
// Trust rules, enforced structurally:
//   - all scanning happens in-memory on this device; text is discarded
//     immediately after scanText() returns
//   - events carry only category names ("api key", "email address"),
//     never the content itself
//   - scanning is bounded to an active Claude session; when you have not
//     touched Claude for a few minutes it stops
//
// Typed-text (composer) scanning was removed deliberately: it read the
// focused text field through the macOS Accessibility API, which cost every
// user a permission grant and put Drippy inside the app's own text as it was
// written. Drippy is the transparency layer for AI impact first, so that
// reach is no longer justified. The clipboard sentinel needs no permission.

const { EventEmitter } = require('events');
const crypto = require('crypto');
const { clipboard } = require('electron');
const { scanText } = require('./pii');

const CLIPBOARD_POLL_MS = 1000; // while a Claude session is active
const SESSION_LINGER_MS = 3 * 60 * 1000; // keep scanning this long after leaving Claude

class PrivacySensor extends EventEmitter {
  constructor() {
    super();
    this.present = false;
    this.clipTimer = null;
    this.sessionStopTimer = null;
    this.lastScanHash = null; // last clipboard content we scanned
    this.warnedHash = null; // last clipboard content we warned about (dedupe)
  }

  setContext({ present }) {
    this.present = present;

    // Clipboard scanning follows the Claude *session*, not just frontmost.
    if (present) {
      clearTimeout(this.sessionStopTimer);
      this.startClipboard();
    } else if (this.clipTimer) {
      // Keep scanning through the linger so a quick tab-away to grab a secret
      // is still covered, then stop.
      clearTimeout(this.sessionStopTimer);
      this.sessionStopTimer = setTimeout(() => this.stopClipboard(), SESSION_LINGER_MS);
    }
  }

  startClipboard() {
    if (!this.clipTimer) this.clipTimer = setInterval(() => this.pollClipboard(), CLIPBOARD_POLL_MS);
    this.pollClipboard(); // immediate scan (e.g. just switched back to Claude)
  }

  stopClipboard() {
    if (this.clipTimer) {
      clearInterval(this.clipTimer);
      this.clipTimer = null;
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
    if (hash === this.lastScanHash) return; // unchanged since last scan
    this.lastScanHash = hash;
    const concerns = scanText(text);
    text = ''; // discard content; only descriptors survive
    // Warn as soon as a secret is on the clipboard during an active Claude
    // session, so you are caught before you paste, even if you copied it
    // elsewhere. Deduped so one copied secret warns once.
    if (concerns.length && hash !== this.warnedHash) {
      this.warnedHash = hash;
      this.emit('detected', { source: 'clipboard', concerns });
    }
  }
}

module.exports = PrivacySensor;
