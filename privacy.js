// L2 privacy sensor — watches for sensitive data at the two riskiest
// moments: pasting (clipboard) and typing into the Claude composer.
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
// Composer scanning reads the focused text field through the Accessibility
// API (via System Events), which requires the user to grant Drippy
// Accessibility + Automation permissions once. Until granted, only the
// clipboard sentinel runs.

const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { clipboard } = require('electron');
const { scanText } = require('./pii');

const CLIPBOARD_POLL_MS = 1000; // while a Claude session is active
const SESSION_LINGER_MS = 3 * 60 * 1000; // keep scanning this long after leaving Claude
const COMPOSER_POLL_MS = 2500; // while typing
const AX_RETRY_MS = 20 * 1000; // cheap probe — notice a fresh grant quickly

// Claude is a Chromium/Electron app: by default it does NOT expose its
// web-content accessibility tree (including the focused composer) to the
// macOS AX API, so AXFocusedUIElement fails with -1728 and the scan reads
// nothing. Setting AXManualAccessibility forces Chromium to build the tree,
// after which the composer is a readable AXTextArea. It is idempotent and
// wrapped in try so a failure to set it never blocks the read.
const COMPOSER_SCRIPT =
  'tell application "System Events" to tell (first process whose name is "Claude")\n' +
  '  try\n' +
  '    set value of attribute "AXManualAccessibility" to true\n' +
  '  end try\n' +
  '  get value of attribute "AXValue" of (value of attribute "AXFocusedUIElement")\n' +
  'end tell';

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
    this.sessionStopTimer = null;
    this.axTimer = null;
    this.lastScanHash = null; // last clipboard content we scanned
    this.warnedHash = null; // last clipboard content we warned about (dedupe)
    this.lastComposerCategories = new Set();
    this.axAvailable = null; // null = unknown, false = permission missing
    this.axPermissionReported = false;
    this.axRetryAt = 0;
  }

  setContext({ present, typing }) {
    this.present = present;
    this.typing = typing;

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

    if (typing && !this.axTimer) {
      this.axTimer = setInterval(() => this.pollComposer(), COMPOSER_POLL_MS);
    } else if (!typing && this.axTimer) {
      clearInterval(this.axTimer);
      this.axTimer = null;
      this.lastComposerCategories = new Set();
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
