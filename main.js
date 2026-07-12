const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AnthropicMonitor = require('./monitor');
const EngagementSensor = require('./engagement');
const PrivacySensor = require('./privacy');
const impact = require('./impact');
const history = require('./history');

// Drippy may run detached from any terminal (launched via `open` so macOS
// attributes permissions to Electron.app itself) — mirror logs to a file.
const LOG_FILE = path.join(os.homedir(), 'Library', 'Logs', 'Drippy.log');
{
  const origLog = console.log;
  try {
    fs.writeFileSync(LOG_FILE, `--- Drippy start ${new Date().toISOString()} ---\n`);
  } catch {}
  console.log = (...args) => {
    origLog(...args);
    try {
      fs.appendFileSync(LOG_FILE, `${new Date().toISOString().slice(11, 19)} ${args.join(' ')}\n`);
    } catch {}
  };
}

// A companion must not die silently — log and keep running.
process.on('uncaughtException', (err) => {
  console.log(`[drippy] uncaught exception: ${err.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
  console.log(`[drippy] unhandled rejection: ${reason}`);
});

// Window is larger than the 56x52 blob so glow, drop shadow and the
// 64px footprint ring render without clipping.
const WIN_W = 140;
const WIN_H = 150;

let win = null;
let tray = null;

// ---------------------------------------------------------------------------
// Position persistence
// ---------------------------------------------------------------------------

const positionFile = () => path.join(app.getPath('userData'), 'position.json');

function loadPosition() {
  try {
    const { x, y } = JSON.parse(fs.readFileSync(positionFile(), 'utf8'));
    // Only restore if still on a connected display.
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.bounds;
      return x + WIN_W > b.x && x < b.x + b.width && y + WIN_H > b.y && y < b.y + b.height;
    });
    if (visible) return { x, y };
  } catch {}
  return null;
}

function savePosition() {
  if (!win) return;
  const [x, y] = win.getPosition();
  try {
    fs.writeFileSync(positionFile(), JSON.stringify({ x, y }));
  } catch {}
}

// ---------------------------------------------------------------------------
// State machine
//   mode: resting | aiActive | privacyEvent | footprint
//   - aiActive while >=1 monitored request is in flight; back to resting ~2s
//     after the last one completes.
//   - privacyEvent overrides aiActive; lasts min ~4s or until acknowledged.
//   - footprint shown on user request (tray) — daily accumulators drive arcs.
// ---------------------------------------------------------------------------

const daily = {
  aiSeconds: 0,
  requests: 0,
  fgRequests: 0,
  privacyEvents: 0,
  privacyByCat: {},
  wh: 0,
  gco2: 0,
  waterMl: 0,
  tokensOut: 0,
  tokensIn: 0,
  apps: {},
};
let lastPrivacy = null; // { source, categories, at }
let axPermissionNeeded = false;
// Rough daily reference budgets, used only to proportion the footprint arcs.
const BUDGET = { gco2: 20, wh: 50, privacy: 3 };

// Requests are split by attribution: foreground (started while the user was
// engaged with a Claude surface — "yours") vs background (agents, other
// processes). Each side gets a 2s linger so the visuals don't stutter
// between back-to-back requests.
let inFlightFg = 0;
let inFlightBg = 0;
let fgLinger = false;
let bgLinger = false;
let fgLingerTimer = null;
let bgLingerTimer = null;
let privacyActive = false;
let privacyStartedAt = 0;
let privacyClearTimer = null;
let footprintShown = false;
let aiSecondsTimer = null;

let userPresent = false; // a Claude surface is frontmost
let userTyping = false; // and input is happening right now

function totalInFlight() {
  return inFlightFg + inFlightBg;
}

// Signal vocabulary — each visual element has exactly one meaning:
//   eyes = about YOU (Claude is open in front of you, or your request runs)
//   gaze = eyes look toward the work (you're typing, or your request runs)
//   glow = AI energy flowing on this machine (any request, yours or not)
//   lean = your request specifically (body tips toward the work)
function visualFlags() {
  if (privacyActive) return { eyes: false, gaze: false, glow: false, lean: false };
  const fg = inFlightFg > 0 || fgLinger;
  return {
    eyes: userPresent || fg,
    gaze: userTyping || fg,
    glow: fg || inFlightBg > 0 || bgLinger,
    lean: fg,
  };
}

function currentMode() {
  if (privacyActive) return 'privacyEvent';
  const f = visualFlags();
  if (f.eyes || f.glow) return 'live'; // flags drive the visuals
  if (footprintShown) return 'footprint';
  return 'resting';
}

function trayStateLabel() {
  if (privacyActive) return 'privacy event';
  const f = visualFlags();
  if (f.lean) return 'your request is running';
  if (f.glow && f.eyes) return 'attentive · background AI activity';
  if (f.glow) return 'background AI activity';
  if (f.gaze) return 'watching you work';
  if (f.eyes) return 'attentive';
  if (footprintShown) return "day's footprint";
  return 'resting';
}

function footprintArcs() {
  // Each dimension relative to a reference budget, then normalised into ring
  // shares. Equal thirds on an empty day. (env vs energy will differentiate
  // once the factor table becomes region-aware.)
  const env = daily.gco2 / BUDGET.gco2;
  const energy = daily.wh / BUDGET.wh;
  const privacy = daily.privacyEvents / BUDGET.privacy;
  const total = env + energy + privacy;
  if (total === 0) return { env: 1 / 3, energy: 1 / 3, privacy: 1 / 3 };
  return { env: env / total, energy: energy / total, privacy: privacy / total };
}

function leanDirection() {
  // Eyes look toward the work. Without a real window monitor we assume the
  // active window sits toward the centre of the current display.
  if (!win) return -1;
  const [x] = win.getPosition();
  const display = screen.getDisplayMatching({ x, y: win.getPosition()[1], width: WIN_W, height: WIN_H });
  const winCenter = x + WIN_W / 2;
  const screenCenter = display.bounds.x + display.bounds.width / 2;
  return winCenter > screenCenter ? -1 : 1; // -1 = lean left, 1 = lean right
}

function pushState() {
  if (!win || win.isDestroyed()) return;
  const mode = currentMode();
  const flags =
    mode === 'footprint' ? { eyes: false, gaze: false, glow: false, lean: false } : visualFlags();
  win.webContents.send('drippy:update', {
    mode,
    ...flags,
    leanDir: leanDirection(),
    arcs: footprintArcs(),
  });
  updateTrayMenu();
}

function requestStarted(fg) {
  if (fg) {
    inFlightFg += 1;
    fgLinger = false;
    clearTimeout(fgLingerTimer);
  } else {
    inFlightBg += 1;
    bgLinger = false;
    clearTimeout(bgLingerTimer);
  }
  daily.requests += 1;
  if (!aiSecondsTimer) {
    aiSecondsTimer = setInterval(() => {
      daily.aiSeconds += 1;
    }, 1000);
  }
  pushState();
}

function requestEnded(fg) {
  if (fg) {
    inFlightFg = Math.max(0, inFlightFg - 1);
    if (inFlightFg === 0) {
      fgLinger = true;
      clearTimeout(fgLingerTimer);
      fgLingerTimer = setTimeout(() => {
        fgLinger = false;
        pushState();
      }, 2000);
    }
  } else {
    inFlightBg = Math.max(0, inFlightBg - 1);
    if (inFlightBg === 0) {
      bgLinger = true;
      clearTimeout(bgLingerTimer);
      bgLingerTimer = setTimeout(() => {
        bgLinger = false;
        pushState();
      }, 2000);
    }
  }
  if (totalInFlight() === 0) {
    clearInterval(aiSecondsTimer);
    aiSecondsTimer = null;
  }
  pushState();
}

function privacyEvent() {
  daily.privacyEvents += 1;
  saveState();
  privacyActive = true;
  privacyStartedAt = Date.now();
  clearTimeout(privacyClearTimer);
  // Auto-clear if never acknowledged.
  privacyClearTimer = setTimeout(clearPrivacy, 8000);
  pushState();
}

function clearPrivacy() {
  privacyActive = false;
  clearTimeout(privacyClearTimer);
  pushState();
}

function acknowledgePrivacy() {
  // Minimum ~4s on screen even when acknowledged early.
  const elapsed = Date.now() - privacyStartedAt;
  if (elapsed >= 4000) {
    clearPrivacy();
  } else {
    clearTimeout(privacyClearTimer);
    privacyClearTimer = setTimeout(clearPrivacy, 4000 - elapsed);
  }
}

function toggleFootprint() {
  footprintShown = !footprintShown;
  pushState();
}

function resetDay() {
  daily.aiSeconds = 0;
  daily.requests = 0;
  daily.privacyEvents = 0;
  daily.wh = 0;
  daily.gco2 = 0;
  daily.waterMl = 0;
  daily.tokensOut = 0;
  daily.tokensIn = 0;
  daily.fgRequests = 0;
  daily.privacyByCat = {};
  daily.apps = {};
  lastPrivacy = null;
  saveState();
  pushState();
}

function recordUsage(est) {
  daily.wh += est.wh;
  daily.gco2 += est.gco2;
  daily.waterMl += est.waterMl;
  daily.tokensOut += est.outputTokens;
  daily.tokensIn += est.inputTokens || 0;
  saveState();
}

// ---------------------------------------------------------------------------
// Persistence & day rollover — accumulators survive restarts and reset at
// midnight so "today" always means today.
// ---------------------------------------------------------------------------

const stateFile = () => path.join(app.getPath('userData'), 'state.json');
let currentDay = new Date().toDateString();
let saveTimer = null;

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (s.date === currentDay && s.daily) {
      Object.assign(daily, s.daily);
      if (s.lastPrivacy) lastPrivacy = { ...s.lastPrivacy, at: new Date(s.lastPrivacy.at) };
    } else if (s.date && s.daily) {
      // Drippy was off over midnight — roll the stale day into history.
      history.finalizeDay({ date: s.date, ...s.daily });
    }
  } catch {}
}

function saveState(immediate = false) {
  const write = () => {
    try {
      fs.writeFileSync(stateFile(), JSON.stringify({ date: currentDay, daily, lastPrivacy }));
    } catch {}
  };
  if (immediate) return write();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 3000);
}

setInterval(() => {
  const today = new Date().toDateString();
  if (today !== currentDay) {
    console.log(
      `[drippy] day summary — ${daily.requests} requests · ≈${Math.round(daily.tokensIn)} in / ${Math.round(daily.tokensOut)} out tokens · ` +
        `${daily.wh.toFixed(1)} Wh · ${daily.waterMl.toFixed(0)} mL · ${daily.gco2.toFixed(1)} gCO₂e · ${daily.privacyEvents} privacy`
    );
    history.finalizeDay({ date: currentDay, ...daily });
    currentDay = today;
    resetDay();
    saveState(true);
  }
}, 60 * 1000).unref();

// Drippy measures itself with the same yardstick — CPU across all its
// processes, sampled every 30s, shown in the tray.
let selfCpuPercent = 0;
setInterval(() => {
  try {
    selfCpuPercent = app.getAppMetrics().reduce((s, p) => s + ((p.cpu && p.cpu.percentCPUUsage) || 0), 0);
  } catch {}
}, 30 * 1000).unref();

// ---------------------------------------------------------------------------
// Live monitor — L1 flow metadata (see monitor.js). Same event interface the
// future NEFilterDataProvider system extension will emit.
// ---------------------------------------------------------------------------

const monitor = new AnthropicMonitor();
let monitorStatus = { watching: false, apps: [] };

monitor.on('watch', (s) => {
  const changed = s.watching !== monitorStatus.watching || s.apps.join() !== monitorStatus.apps.join();
  monitorStatus = s;
  if (changed) updateTrayMenu();
});
// A request is "yours" if it starts while (or just after) you were engaged
// with a Claude surface; everything else is background (agents, telemetry).
// Proper per-surface attribution arrives with the L2 adapters.
const FG_ATTRIBUTION_MS = 8000;
const fgFlows = new Map(); // pid -> attributed foreground?

monitor.on('request-start', ({ app: appName, pid }) => {
  const fg = engagement.typing || Date.now() - engagement.lastTypingAt < FG_ATTRIBUTION_MS;
  fgFlows.set(pid, fg);
  console.log(`[drippy] request start — ${appName} (${fg ? 'yours' : 'background'})`);
  requestStarted(fg);
});
monitor.on('request-end', ({ app: appName, pid, bytesIn, bytesOut, durationMs }) => {
  const fg = fgFlows.get(pid) ?? false;
  fgFlows.delete(pid);
  const est = impact.fromBytes(bytesIn, bytesOut);
  recordUsage(est);
  if (fg) daily.fgRequests += 1;
  const a = (daily.apps[appName] = daily.apps[appName] || { requests: 0, wh: 0, tokensIn: 0, tokensOut: 0 });
  a.requests += 1;
  a.wh += est.wh;
  a.tokensIn += est.inputTokens;
  a.tokensOut += est.outputTokens;
  history.appendRequest({
    ts: new Date().toISOString(),
    app: appName,
    fg,
    ms: durationMs,
    in: est.inputTokens,
    out: est.outputTokens,
    wh: +est.wh.toFixed(3),
  });
  console.log(
    `[drippy] request end — ${appName} (${fg ? 'yours' : 'background'}) · ${Math.round(durationMs / 1000)}s · ` +
      `≈${est.inputTokens} in / ${est.outputTokens} out tokens ≈ ${est.wh.toFixed(2)} Wh`
  );
  requestEnded(fg);
});

// Eyes open the moment the user starts working in Claude — quiet
// acknowledgment that Drippy sees the activity. Glow stays reserved for an
// actual request in flight.
const privacy = new PrivacySensor();

const engagement = new EngagementSensor();
engagement.on('state', ({ present, typing, app: appName }) => {
  const typingStarted = typing && !userTyping;
  userPresent = present;
  userTyping = typing;
  console.log(`[drippy] engagement — present:${present} typing:${typing}${present ? ` (${appName})` : ''}`);
  monitor.setHot(present); // react in ~1s while you're actually there
  if (typingStarted) monitor.poke(); // a send is probably imminent
  privacy.setContext({ present, typing });
  pushState();
});

privacy.on('detected', ({ source, categories }) => {
  lastPrivacy = { source, categories, at: new Date() };
  for (const c of categories) daily.privacyByCat[c] = (daily.privacyByCat[c] || 0) + 1;
  history.appendPrivacy({ ts: new Date().toISOString(), source, cats: categories });
  console.log(`[drippy] privacy event — ${categories.join(', ')} (${source})`);
  privacyEvent();
});
privacy.on('ax-permission-needed', () => {
  axPermissionNeeded = true;
  console.log(
    '[drippy] typed-text privacy scan needs permissions: System Settings → Privacy & Security → Accessibility (and Automation) → allow Drippy/Electron'
  );
  updateTrayMenu();
});
privacy.on('ax-ready', () => {
  axPermissionNeeded = false;
  console.log('[drippy] typed-text privacy scan active');
  updateTrayMenu();
});

// ---------------------------------------------------------------------------
// Demo mode — stands in for the real activity monitor until one exists.
// ---------------------------------------------------------------------------

let demoEnabled = false;
let demoTimer = null;

function demoTick() {
  if (!demoEnabled) return;
  if (Math.random() < 0.18) {
    privacyEvent();
  } else {
    const fg = Math.random() < 0.5;
    requestStarted(fg);
    setTimeout(() => {
      recordUsage(impact.fromBytes(20000 + Math.random() * 80000));
      requestEnded(fg);
    }, 3000 + Math.random() * 5000);
  }
  demoTimer = setTimeout(demoTick, 7000 + Math.random() * 8000);
}

function setDemo(enabled) {
  demoEnabled = enabled;
  clearTimeout(demoTimer);
  if (enabled) demoTimer = setTimeout(demoTick, 1500);
  updateTrayMenu();
}

// ---------------------------------------------------------------------------
// Dragging — main process polls the cursor so the blob tracks smoothly even
// when the pointer leaves the tiny window mid-drag.
// ---------------------------------------------------------------------------

let dragPoll = null;

function startDrag() {
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  const offX = cursor.x - wx;
  const offY = cursor.y - wy;
  clearInterval(dragPoll);
  dragPoll = setInterval(() => {
    const c = screen.getCursorScreenPoint();
    win.setPosition(Math.round(c.x - offX), Math.round(c.y - offY));
  }, 16);
}

function endDrag() {
  clearInterval(dragPoll);
  dragPoll = null;
  savePosition();
  pushState(); // refresh lean for the new position
}

// ---------------------------------------------------------------------------
// Window & tray
// ---------------------------------------------------------------------------

function createWindow() {
  const pos = loadPosition();
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    ...(pos || {}),
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', pushState);

  if (!pos) {
    // First launch: bottom-right of the primary display.
    const { workArea } = screen.getPrimaryDisplay();
    win.setPosition(workArea.x + workArea.width - WIN_W - 40, workArea.y + workArea.height - WIN_H - 40);
  }
}

function simulateRequest() {
  requestStarted(true);
  setTimeout(() => {
    recordUsage(impact.fromBytes(55000)); // a typical ~500-token response
    requestEnded(true);
  }, 5000);
}

function updateTrayMenu() {
  if (!tray) return;
  const watchLabel = monitorStatus.watching
    ? `Watching: ${monitorStatus.apps.join(', ') || 'Anthropic traffic'}`
    : 'No Anthropic traffic';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Drippy v${app.getVersion()} — ${trayStateLabel()}`, enabled: false },
      { label: watchLabel, enabled: false },
      { label: `Drippy itself: ~${selfCpuPercent.toFixed(1)}% CPU`, enabled: false },
      { type: 'separator' },
      {
        label: `Today: ${daily.requests} requests · ~${Math.round(daily.tokensIn)} in / ${Math.round(daily.tokensOut)} out tokens`,
        enabled: false,
      },
      {
        label: `≈ ${daily.wh.toFixed(1)} Wh · ${daily.waterMl.toFixed(0)} mL water · ${daily.gco2.toFixed(1)} g CO₂e`,
        enabled: false,
      },
      { label: `Estimates ±3× · factors v${impact.version}`, enabled: false },
      ...(lastPrivacy
        ? [
            {
              label: `Privacy: ${lastPrivacy.categories.join(', ')} via ${lastPrivacy.source} · ${lastPrivacy.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
              enabled: false,
            },
          ]
        : []),
      ...(axPermissionNeeded
        ? [
            {
              label: 'Enable typed-text privacy scan (grant Accessibility)…',
              click: () =>
                require('electron').shell.openExternal(
                  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
                ),
            },
          ]
        : []),
      { type: 'separator' },
      { label: "Show day's footprint", type: 'checkbox', checked: footprintShown, click: toggleFootprint },
      { label: 'Simulate AI request (5s)', click: simulateRequest },
      { label: 'Simulate privacy event', click: privacyEvent },
      { label: 'Demo mode', type: 'checkbox', checked: demoEnabled, click: () => setDemo(!demoEnabled) },
      { type: 'separator' },
      { label: 'Usage trends…', click: showTrends },
      { label: 'About Drippy — what it can see…', click: showWelcome },
      { label: 'Reset day', click: resetDay },
      { label: 'Quit Drippy', click: () => app.quit() },
    ])
  );
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('💧');
  tray.setToolTip('Drippy — AI transparency companion');
  updateTrayMenu();
}

// ---------------------------------------------------------------------------
// Welcome / About window — shown on first run and from the tray. This is the
// trust moment: what Drippy can see, what it can't, and the one optional
// permission.
// ---------------------------------------------------------------------------

let welcomeWin = null;

function showWelcome() {
  if (welcomeWin) {
    welcomeWin.focus();
    return;
  }
  welcomeWin = new BrowserWindow({
    width: 560,
    height: 720,
    title: 'Drippy',
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'welcome-preload.js'),
      contextIsolation: true,
    },
  });
  welcomeWin.loadFile(path.join(__dirname, 'renderer', 'welcome.html'));
  welcomeWin.on('closed', () => {
    welcomeWin = null;
  });
}

let trendsWin = null;

function showTrends() {
  if (trendsWin) {
    trendsWin.focus();
    return;
  }
  trendsWin = new BrowserWindow({
    width: 660,
    height: 700,
    title: 'Drippy — usage trends',
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'trends-preload.js'),
      contextIsolation: true,
    },
  });
  trendsWin.loadFile(path.join(__dirname, 'renderer', 'trends.html'));
  trendsWin.on('closed', () => {
    trendsWin = null;
  });
}

function maybeShowWelcome() {
  const flag = path.join(app.getPath('userData'), 'welcomed');
  if (fs.existsSync(flag)) return;
  try {
    fs.writeFileSync(flag, new Date().toISOString());
  } catch {}
  showWelcome();
}

// ---------------------------------------------------------------------------

ipcMain.handle('drippy:history', () => ({
  days: history.readDays(60),
  today: { date: currentDay, ...daily },
}));

ipcMain.on('drippy:open-accessibility', () => {
  require('electron').shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  );
});

ipcMain.on('drippy:drag-start', startDrag);
ipcMain.on('drippy:drag-end', endDrag);
ipcMain.on('drippy:click', () => {
  if (privacyActive) acknowledgePrivacy();
  else if (footprintShown) toggleFootprint();
});

app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // menu-bar accessory, no Dock icon
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  history.init(app.getPath('userData'));
  loadState();
  createWindow();
  createTray();
  monitor.start();
  engagement.start();
  maybeShowWelcome();
});

app.on('before-quit', () => saveState(true));
// The blob window never closes in normal use; the welcome window may.
app.on('window-all-closed', () => {});
