const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AnthropicMonitor = require('./monitor');
const EngagementSensor = require('./engagement');
const PrivacySensor = require('./privacy');
const ClaudeCodeMonitor = require('./claude-code');
const impact = require('./impact');
const history = require('./history');
const sync = require('./sync');
const { SuggestionEngine } = require('./suggestions');

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

// Drippy lives as a small dark pill in the menu bar strip: the Mac cousin
// of the iPhone island widget. The window envelope holds the fully expanded
// pill plus its glow halo, and is click-through except over the pill
// itself, so the extra size costs nothing.
const WIN_W = 400;
const WIN_H = 120;

// The menu bar strip height on this display: ~25pt on plain Macs, ~33-37pt
// on notched ones. Falls back to 24 if the bar is hidden or auto-hiding.
function menuBarHeightFor(display) {
  const h = display.workArea.y - display.bounds.y;
  return h > 0 ? h : 24;
}

let win = null;

// ---------------------------------------------------------------------------
// Position persistence
// ---------------------------------------------------------------------------

const positionFile = () => path.join(app.getPath('userData'), 'position.json');

function loadPosition() {
  try {
    const s = JSON.parse(fs.readFileSync(positionFile(), 'utf8'));
    if (!s.pill) return null;
    const { x, y } = s.pill;
    // Only restore if still on a connected display.
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.bounds;
      return x + WIN_W > b.x && x < b.x + b.width && y + WIN_H > b.y && y < b.y + b.height;
    });
    if (!visible) return null;
    // The pill is pinned to the menu bar strip: only its x roams.
    return { x, y: screen.getDisplayMatching({ x, y, width: WIN_W, height: WIN_H }).bounds.y };
  } catch {}
  return null;
}

function savePosition() {
  if (!win) return;
  const [x, y] = win.getPosition();
  try {
    fs.writeFileSync(positionFile(), JSON.stringify({ pill: { x, y } }));
  } catch {}
}

// ---------------------------------------------------------------------------
// State machine
//   mode: ambient | privacyEvent
//   - ambient: the droplet; glow while >=1 monitored request is in flight
//     (with a ~2s linger so back-to-back requests don't stutter).
//   - privacyEvent overrides; lasts min ~4s or until acknowledged.
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
  usd: 0, // API-rate value of measured (exact) usage only
  tokensOut: 0,
  tokensIn: 0,
  apps: {},
  // Drivers, kept alongside the derived figures so stored history can be
  // restated when factor tables improve (DATA-STORAGE.md): per-model token
  // classes ('estimated' bucket for network-observed traffic) and the raw
  // bytes behind the estimates.
  models: {},
  bytesEstIn: 0,
  bytesEstOut: 0,
};
let lastPrivacy = null; // { source, categories, at }
let axPermissionNeeded = false;

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
let privacyLevel = 0; // 0 = none, 1 = critical (badge), 2 = caution (violet tint)
let privacyStartedAt = 0;
let privacyClearTimer = null;
let aiSecondsTimer = null;

// The privacy incident being warned about right now. It is written to
// history when the warning resolves, so one append-only line carries the
// full anatomy of the near-miss: categories, tier, resolution and
// time-to-clear (DATA-STORAGE.md). Buffered in memory for the warning's
// lifetime only (15s at most).
let pendingIncident = null;

function flushIncident(resolution) {
  if (!pendingIncident) return;
  history.appendPrivacy({
    ts: pendingIncident.ts,
    source: pendingIncident.source,
    cats: pendingIncident.cats,
    topTier: pendingIncident.topTier,
    resolution: pendingIncident.resolution || resolution,
    msToClear: Date.now() - pendingIncident.at,
  });
  pendingIncident = null;
}

let userPresent = false; // a Claude surface is frontmost
let userTyping = false; // and input is happening right now

function totalInFlight() {
  return inFlightFg + inFlightBg;
}

// The whole visual language, deliberately small:
//   glow — AI energy flowing on this machine (any request, yours or not)
//   violet droplet — caution-level privacy event
//   full size + wide eyes + badge — critical privacy event, the only state
//   in which Drippy takes up space uninvited
function visualFlags() {
  if (privacyLevel > 0) return { glow: false, privacyLevel };
  return { glow: totalInFlight() > 0 || fgLinger || bgLinger, privacyLevel: 0 };
}

function currentMode() {
  return privacyLevel > 0 ? 'privacyEvent' : 'ambient';
}

function stateLabel() {
  if (privacyLevel === 1) return 'privacy warning';
  if (privacyLevel === 2) return 'privacy heads-up';
  if (inFlightFg > 0 || fgLinger) return 'your request is running';
  if (visualFlags().glow) return 'background AI activity';
  return 'quiet';
}

// Today's numbers ride along in every update so the expanded bar shows them
// live. Measured spend (daily.usd) is exact-usage only.
function statsPayload() {
  return {
    wh: daily.wh,
    waterMl: daily.waterMl,
    gco2: daily.gco2,
    usd: daily.usd,
    requests: daily.requests,
    privacyEvents: daily.privacyEvents,
  };
}

function sendUpdate() {
  if (!win || win.isDestroyed() || tourActive) return;
  win.webContents.send('drippy:update', { mode: currentMode(), ...visualFlags(), stats: statsPayload() });
}

function pushState() {
  if (!win || win.isDestroyed()) return;
  // While the tour is puppeting the pill, real state stays out of the way.
  if (!tourActive) sendUpdate();
}

// Keep the bar's readout current even when only the accumulators move.
setInterval(sendUpdate, 4000).unref();

function requestStarted(fg) {
  const now = Date.now();
  if (fg) {
    sig.fgReqTimes.push(now);
    sig.rapidStreak = now - sig.lastReqStartAt < 25000 ? sig.rapidStreak + 1 : 1;
    sig.lastReqStartAt = now;
    if (!sig.streamingSince) sig.streamingSince = now;
  } else if (inFlightFg === 0 && !sig.bgSoloSince) {
    sig.bgSoloSince = now;
  }
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
    sig.streamingSince = 0;
    sig.bgSoloSince = 0;
  }
  pushState();
}

// level 1 = critical (full alarm + badge), 2 = caution (a violet droplet).
function privacyEvent(level = 1) {
  daily.privacyEvents += 1;
  saveState();
  privacyLevel = level;
  privacyStartedAt = Date.now();
  clearTimeout(privacyClearTimer);
  // Auto-clear if never acknowledged — long enough to notice and hover.
  // A caution clears a little sooner than a critical warning.
  privacyClearTimer = setTimeout(clearPrivacy, level === 1 ? 15000 : 10000);
  pushState();
  updateBubble(); // refresh payload if the user is already hovering
}

function clearPrivacy(resolution = 'auto-cleared') {
  const wasCritical = privacyLevel === 1;
  flushIncident(typeof resolution === 'string' ? resolution : 'auto-cleared');
  privacyLevel = 0;
  clearTimeout(privacyClearTimer);
  updateBubble();
  pushState();
  suggestions.evaluate({ type: 'warning-cleared', wasCritical });
}

function acknowledgePrivacy() {
  // The click is the resolution even when the visual lingers to its 4s
  // minimum; record it on the incident now.
  if (pendingIncident) pendingIncident.resolution = 'acknowledged';
  const elapsed = Date.now() - privacyStartedAt;
  if (elapsed >= 4000) {
    clearPrivacy('acknowledged');
  } else {
    clearTimeout(privacyClearTimer);
    privacyClearTimer = setTimeout(clearPrivacy, 4000 - elapsed);
  }
}

function resetDay() {
  daily.aiSeconds = 0;
  daily.requests = 0;
  daily.privacyEvents = 0;
  daily.wh = 0;
  daily.gco2 = 0;
  daily.waterMl = 0;
  daily.usd = 0;
  daily.tokensOut = 0;
  daily.tokensIn = 0;
  daily.fgRequests = 0;
  daily.privacyByCat = {};
  daily.apps = {};
  daily.models = {};
  daily.bytesEstIn = 0;
  daily.bytesEstOut = 0;
  lastPrivacy = null;
  saveState();
  pushState();
}

function recordUsage(est) {
  daily.wh += est.wh;
  daily.gco2 += est.gco2;
  daily.waterMl += est.waterMl;
  daily.usd += est.usd || 0; // exact usage only; estimates carry no price
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
      if (s.lastPrivacy && Array.isArray(s.lastPrivacy.concerns)) {
        lastPrivacy = { ...s.lastPrivacy, at: new Date(s.lastPrivacy.at) };
      }
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
    sync.poke('day-close');
  }
}, 60 * 1000).unref();

// ---------------------------------------------------------------------------
// Live monitor — L1 flow metadata (see monitor.js). Same event interface the
// future NEFilterDataProvider system extension will emit.
// ---------------------------------------------------------------------------

const monitor = new AnthropicMonitor();
let monitorStatus = { watching: false, apps: [] };

monitor.on('watch', (s) => {
  monitorStatus = s;
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
// Records one request's impact into today's totals, per-app and per-model
// breakdowns and history. `est` comes either from byte estimation (network
// monitor, pass `bytes`) or from exact provider usage (Claude Code
// transcripts, pass `usage`). Events carry the drivers (token classes,
// bytes, model, factor version), not just the derived figures, so history
// can be restated when factor tables improve (DATA-STORAGE.md).
function recordRequest({ app: appName, fg, ms, est, usage, bytes }) {
  recordUsage(est);
  if (fg) daily.fgRequests += 1;
  const a = (daily.apps[appName] = daily.apps[appName] || { requests: 0, wh: 0, tokensIn: 0, tokensOut: 0 });
  a.requests += 1;
  a.wh += est.wh;
  a.tokensIn += est.inputTokens;
  a.tokensOut += est.outputTokens;
  const m = (daily.models[usage ? est.model : 'estimated'] =
    daily.models[usage ? est.model : 'estimated'] || { requests: 0, in: 0, cw: 0, cr: 0, out: 0, wh: 0 });
  m.requests += 1;
  m.in += usage ? usage.inputTokens : est.inputTokens;
  m.cw += usage ? usage.cacheCreationTokens : 0;
  m.cr += usage ? usage.cacheReadTokens : 0;
  m.out += est.outputTokens;
  m.wh += est.wh;
  if (bytes) {
    daily.bytesEstIn += bytes.in;
    daily.bytesEstOut += bytes.out;
  }
  history.appendRequest({
    ts: new Date().toISOString(),
    app: appName,
    fg,
    ms,
    basis: usage ? 'measured' : 'estimated',
    ...(usage
      ? {
          model: est.model,
          tier: est.tier,
          tk: { in: usage.inputTokens, cw: usage.cacheCreationTokens, cr: usage.cacheReadTokens, out: usage.outputTokens },
        }
      : {}),
    ...(bytes ? { bytes } : {}),
    in: est.inputTokens,
    out: est.outputTokens,
    wh: +est.wh.toFixed(3),
    fv: impact.version,
  });
}

// The Claude Code CLI process reports EXACT usage via its transcripts, so we
// let claudeCode be the authoritative impact source for it and avoid
// double-counting its bytes here. The network flow still drives the creature.
const CLI_APP = 'claude';

monitor.on('request-end', ({ app: appName, pid, bytesIn, bytesOut, durationMs }) => {
  const fg = fgFlows.get(pid) ?? false;
  fgFlows.delete(pid);
  if (appName !== CLI_APP) {
    const est = impact.fromBytes(bytesIn, bytesOut);
    recordRequest({ app: appName, fg, ms: durationMs, est, bytes: { in: bytesIn, out: bytesOut } });
    console.log(
      `[drippy] request end — ${appName} (${fg ? 'yours' : 'background'}) · ${Math.round(durationMs / 1000)}s · ` +
        `≈${est.inputTokens} in / ${est.outputTokens} out tokens ≈ ${est.wh.toFixed(2)} Wh`
    );
  }
  requestEnded(fg);
});

// Exact accounting for Claude Code, straight from session transcripts.
const claudeCode = new ClaudeCodeMonitor();
claudeCode.on('usage', (u) => {
  const est = impact.fromUsage(u);
  recordRequest({ app: 'Claude Code', fg: true, ms: 0, est, usage: u });
  sig.ccInputEvents.push({ t: Date.now(), tokens: u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens });
  sig.lastModel = est.model;
  sig.lastCacheRead = u.cacheReadTokens;
  sig.smallOutputStreak = u.outputTokens < 150 ? sig.smallOutputStreak + 1 : 0;
  console.log(
    `[drippy] claude code — ${est.model} ×${est.tier} · exact ${u.inputTokens}+${u.cacheCreationTokens} fresh / ` +
      `${u.cacheReadTokens} cached in / ${u.outputTokens} out ≈ ${est.wh.toFixed(3)} Wh`
  );
});

// ---------------------------------------------------------------------------
// Signals for the suggestion engine — cheap rolling facts about how you're
// working, assembled on demand. No content, just rhythm and counts.
// ---------------------------------------------------------------------------

const sig = {
  fgReqTimes: [],
  ccInputEvents: [], // { t, tokens }
  presentSince: 0,
  lastPresentTrueAt: 0,
  lastReqStartAt: 0,
  rapidStreak: 0,
  smallOutputStreak: 0,
  lastModel: '',
  lastCacheRead: 0,
  streamingSince: 0,
  bgSoloSince: 0,
  criticalTimes: [],
};

function prune() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  sig.fgReqTimes = sig.fgReqTimes.filter((t) => t > cutoff - 60 * 60 * 1000);
  sig.ccInputEvents = sig.ccInputEvents.filter((e) => e.t > cutoff);
}

function signals() {
  const now = Date.now();
  const within = (arr, ms) => arr.filter((t) => now - t < ms).length;
  const lastCritical = sig.criticalTimes[sig.criticalTimes.length - 1] || 0;
  return {
    hour: new Date().getHours(),
    daily,
    daysOfHistory: history.readDays(90).length,
    fgReq30m: within(sig.fgReqTimes, 30 * 60000),
    fgReq20m: within(sig.fgReqTimes, 20 * 60000),
    exactInput1h: sig.ccInputEvents.filter((e) => now - e.t < 3600000).reduce((a, e) => a + e.tokens, 0),
    presentContinuousMin: userPresent && sig.presentSince ? (now - sig.presentSince) / 60000 : 0,
    minSincePrivacy: lastPrivacy ? (now - lastPrivacy.at.getTime()) / 60000 : 1e9,
    criticalsThisWeek: sig.criticalTimes.filter((t) => now - t < 7 * 24 * 3600000).length,
    hoursSinceCritical: lastCritical ? (now - lastCritical) / 3600000 : 1e9,
    bgSoloMin: inFlightBg > 0 && inFlightFg === 0 && sig.bgSoloSince ? (now - sig.bgSoloSince) / 60000 : 0,
    fgStreamingSec: inFlightFg > 0 && sig.streamingSince ? (now - sig.streamingSince) / 1000 : 0,
    rapidStreak: sig.rapidStreak,
    smallOutputStreak: sig.smallOutputStreak,
    lastModel: sig.lastModel,
    lastCacheRead: sig.lastCacheRead,
    avgOutTokens: daily.requests ? daily.tokensOut / daily.requests : 0,
  };
}

const suggestions = new SuggestionEngine({ stateDir: app.getPath('userData'), signals });
suggestions.on('suggest', (sg) => {
  if (tourActive) return; // the tour has the floor; the engine can speak later
  history.appendSuggestion({ ts: new Date().toISOString(), id: sg.id, family: sg.family });
  console.log(`[drippy] notices — [${sg.family}] ${sg.text}`);
  showSuggestion(sg);
});
setInterval(() => {
  prune();
  suggestions.evaluate();
}, 30 * 1000).unref();

const privacy = new PrivacySensor();

const engagement = new EngagementSensor();
engagement.on('state', ({ present, typing, app: appName }) => {
  const typingStarted = typing && !userTyping;
  const wasPresent = userPresent;
  userPresent = present;
  userTyping = typing;
  if (present && !wasPresent) {
    const now = Date.now();
    sig.presentSince = now;
    // A fresh working session if it's been a while since you were here.
    if (now - sig.lastPresentTrueAt > 15 * 60 * 1000) suggestions.evaluate({ type: 'session-start' });
    sig.lastPresentTrueAt = now;
  } else if (!present) {
    sig.presentSince = 0;
  }
  console.log(`[drippy] engagement — present:${present} typing:${typing}${present ? ` (${appName})` : ''}`);
  monitor.setHot(present); // react in ~1s while you're actually there
  if (typingStarted) monitor.poke(); // a send is probably imminent
  privacy.setContext({ present, typing });
  pushState();
});

privacy.on('detected', ({ source, concerns }) => {
  // Count every detection so trends stay honest, including low-risk ones.
  for (const c of concerns) daily.privacyByCat[c.label] = (daily.privacyByCat[c.label] || 0) + 1;

  const topTier = Math.min(...concerns.map((c) => c.tier)); // 1 = most serious
  if (topTier >= 3) {
    // Low risk (e.g. your own email): recorded, never warned about.
    history.appendPrivacy({
      ts: new Date().toISOString(),
      source,
      cats: concerns.map((c) => ({ id: c.id, tier: c.tier })),
      topTier,
      resolution: 'noted',
      msToClear: 0,
    });
    console.log(`[drippy] noted (low risk) — ${concerns.map((c) => c.label).join(', ')} (${source})`);
    return;
  }

  // Show the warning built around the concerns that actually warrant it.
  // A new detection mid-warning supersedes the pending incident record.
  flushIncident('superseded');
  const warned = concerns.filter((c) => c.tier <= 2);
  pendingIncident = {
    ts: new Date().toISOString(),
    source,
    cats: warned.map((c) => ({ id: c.id, tier: c.tier })),
    topTier,
    at: Date.now(),
  };
  lastPrivacy = { source, concerns: warned, at: new Date() };
  const level = topTier === 1 ? 1 : 2;
  if (level === 1) sig.criticalTimes.push(Date.now());
  console.log(
    `[drippy] ${level === 1 ? 'WARNING' : 'heads-up'} — ${warned.map((c) => `${c.label} [tier ${c.tier}]`).join(', ')} (${source})`
  );
  privacyEvent(level);
});
privacy.on('ax-permission-needed', () => {
  axPermissionNeeded = true;
  console.log(
    '[drippy] typed-text privacy scan needs permissions: System Settings → Privacy & Security → Accessibility (and Automation) → allow Drippy/Electron'
  );
});
privacy.on('ax-ready', () => {
  axPermissionNeeded = false;
  console.log('[drippy] typed-text privacy scan active');
});

// ---------------------------------------------------------------------------
// Dragging — main process polls the cursor so the blob tracks smoothly even
// when the pointer leaves the tiny window mid-drag.
// ---------------------------------------------------------------------------

let dragPoll = null;

function startDrag() {
  if (bubbleWin) bubbleWin.hide();
  hideSuggestion(); // popups don't trail along mid-drag
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  const offX = cursor.x - wx;
  // The pill lives in the menu bar strip: it slides along it, never off it.
  clearInterval(dragPoll);
  dragPoll = setInterval(() => {
    const c = screen.getCursorScreenPoint();
    win.setPosition(Math.round(c.x - offX), wy);
  }, 16);
}

function endDrag() {
  clearInterval(dragPoll);
  dragPoll = null;
  savePosition(); // wherever you put it becomes home
  pushState(); // refresh lean for the new position
}

// ---------------------------------------------------------------------------
// Window
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
    // macOS otherwise constrains the frame out of the menu bar strip,
    // which is exactly where the pill lives.
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });

  // 'status' level renders above the menu bar itself, yet below open
  // dropdown menus. Level is set after setVisibleOnAllWorkspaces, which
  // quietly resets it on macOS.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'status');
  // Never in the way: the window ignores the mouse entirely except when the
  // renderer's hit-test says the cursor is over Drippy himself. Forwarded
  // mouse moves keep the hit-test running while ignoring.
  win.setIgnoreMouseEvents(true, { forward: true });
  const primary = screen.getPrimaryDisplay();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: { mbh: String(menuBarHeightFor(primary)) },
  });
  win.webContents.on('did-finish-load', pushState);

  if (!pos) {
    // Default: centred in the menu bar like the iPhone island. On a
    // notched Mac (taller bar) the centre IS the notch, so sit just to
    // its right where there are actual pixels.
    const b = primary.bounds;
    const notched = menuBarHeightFor(primary) > 30;
    const cx = b.x + b.width / 2 + (notched ? 190 : 0);
    win.setPosition(Math.round(cx - WIN_W / 2), b.y);
  }
  const [px, py] = win.getPosition();
  console.log(`[drippy] pill at ${px},${py} (menu bar ${menuBarHeightFor(primary)}px)`);
}

// Right-click menu on the pill — with no Dock icon and no tray, this is
// the doorway to everything that is not a hover or a click. Facts only,
// no advice.
function showContextMenu() {
  if (!win || win.isDestroyed()) return;
  const watchLabel = monitorStatus.watching
    ? `Watching: ${monitorStatus.apps.join(', ') || 'Anthropic traffic'}`
    : 'No Anthropic traffic';
  Menu.buildFromTemplate([
    { label: `Drippy v${app.getVersion()}: ${stateLabel()}`, enabled: false },
    { label: watchLabel, enabled: false },
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
    { label: 'Usage trends', click: showTrends },
    { label: 'What Drippy can see', click: showWelcome },
    { type: 'separator' },
    { label: 'Reset day', click: resetDay },
    { label: 'Quit Drippy', click: () => app.quit() },
  ]).popup({ window: win });
}

ipcMain.on('drippy:menu', showContextMenu);

// ---------------------------------------------------------------------------
// Welcome / About window — shown on first run and from the right-click menu.
// trust moment: what Drippy can see, what it can't, and the one optional
// permission.
// ---------------------------------------------------------------------------

let welcomeWin = null;

// Drippy's windows open on whichever display Drippy is on, sitting in the
// upper third like a sheet he's holding up, not lost on another monitor.
function centerOnDrippysDisplay(w) {
  if (!win) return;
  const [wx, wy] = win.getPosition();
  const wa = screen.getDisplayMatching({ x: wx, y: wy, width: WIN_W, height: WIN_H }).workArea;
  const b = w.getBounds();
  w.setPosition(
    Math.round(wa.x + (wa.width - b.width) / 2),
    Math.round(wa.y + Math.max(0, (wa.height - b.height) / 3))
  );
}

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
  centerOnDrippysDisplay(welcomeWin);
  welcomeWin.on('closed', () => {
    welcomeWin = null;
  });
}

// ---------------------------------------------------------------------------
// Attention bubble — hover Drippy during a warning to see what the problem
// is and what to do about it. Verdict categories only, never content.
// ---------------------------------------------------------------------------

const BUBBLE_W = 300;
let bubbleHeight = 170; // grows to fit content (reported by the bubble)

let bubbleWin = null;
let blobHovered = false;
let bubbleHovered = false;
let bubbleHideTimer = null;

// Pillar colours for the stats rows (validated per-mode chart palette).
const ROW_COLORS = {
  usage: 'oklch(0.82 0.13 85)',
  env: 'oklch(0.78 0.14 155)',
  water: 'oklch(0.72 0.11 220)',
  privacy: 'oklch(0.72 0.12 300)',
  value: 'oklch(0.75 0.05 250)',
};

// The hover card: Drippy's primary transparency surface. A privacy warning
// takes priority; otherwise it is always today's numbers, with everyday
// equivalents so they mean something.
function bubblePayload() {
  if (privacyLevel > 0 && lastPrivacy) {
    const concerns = lastPrivacy.concerns; // already sorted most-severe first
    const top = concerns[0];
    return {
      kind: 'warning',
      title: `Drippy spotted: ${top.label}${concerns.length > 1 ? ` +${concerns.length - 1} more` : ''}`,
      tier: top.tier,
      detail:
        lastPrivacy.source === 'clipboard'
          ? 'On your clipboard, ready to paste into Claude.'
          : 'In your Claude composer. It has not been sent yet.',
      recommendation: impactRecommend(top.id),
      action: lastPrivacy.source === 'clipboard' ? 'Clear clipboard' : null,
    };
  }
  const tokens = Math.round(daily.tokensIn + daily.tokensOut);
  const eq = impact.equivalents(daily);
  return {
    kind: 'stats',
    title: 'Today, so far',
    rows: [
      { color: ROW_COLORS.env, label: 'Energy', value: `${daily.wh.toFixed(1)} Wh · ${daily.gco2.toFixed(1)} g CO₂e` },
      { color: ROW_COLORS.water, label: 'Water', value: `${daily.waterMl.toFixed(0)} mL` },
      { color: ROW_COLORS.usage, label: 'AI usage', value: `${daily.requests} request${daily.requests === 1 ? '' : 's'} · ~${tokens.toLocaleString()} tokens` },
      { color: ROW_COLORS.privacy, label: 'Privacy', value: `${daily.privacyEvents} warning${daily.privacyEvents === 1 ? '' : 's'}` },
      ...(daily.usd > 0
        ? [{ color: ROW_COLORS.value, label: 'Value', value: `$${daily.usd.toFixed(2)} at API rates (measured)` }]
        : []),
    ],
    footer: `${eq ? `≈ ${eq} · ` : ''}estimates ±3×`,
  };
}

const { recommendationFor: impactRecommend } = require('./pii');

// Popups hang just below the pill with a tail pointing up at it, close
// enough to feel spoken by Drippy.
// Screen-space anchor: the pill's centre X (it expands symmetrically, so
// this holds in every state) and the y just under the menu bar strip.
function pillAnchor() {
  const [wx, wy] = win.getPosition();
  const display = screen.getDisplayMatching({ x: wx, y: wy, width: WIN_W, height: WIN_H });
  return {
    cx: wx + WIN_W / 2,
    below: wy + menuBarHeightFor(display) + 8,
    wa: display.workArea,
  };
}

function positionBubble() {
  const { cx, below, wa } = pillAnchor();
  let x = Math.round(cx - BUBBLE_W / 2);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - BUBBLE_W));
  const y = Math.max(wa.y, Math.min(below, wa.y + wa.height - bubbleHeight));
  bubbleWin.setBounds({ x, y, width: BUBBLE_W, height: bubbleHeight });
  // Tail x is card-local: the card sits 14px inside the window margin.
  const tailX = Math.max(14, Math.min(BUBBLE_W - 56, Math.round(cx - x - 14 - 7)));
  bubbleWin.webContents.send('bubble:tail', { side: 'up', tailX });
}

function updateBubble() {
  // The expanded bar shows the everyday numbers itself, so the hover card is
  // reserved for privacy warnings, where the detail and remedy live.
  const shouldShow = privacyLevel > 0 && (blobHovered || bubbleHovered) && !tourActive;
  if (shouldShow) {
    // Spring-in only on a fresh appearance, not on payload refreshes.
    const fresh = !bubbleWin || !bubbleWin.isVisible();
    clearTimeout(bubbleHideTimer);
    if (!bubbleWin) {
      bubbleWin = new BrowserWindow({
        width: BUBBLE_W,
        height: bubbleHeight,
        frame: false,
        transparent: true,
        resizable: false,
        hasShadow: false,
        skipTaskbar: true,
        focusable: false,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'bubble-preload.js'),
          contextIsolation: true,
        },
      });
      bubbleWin.setAlwaysOnTop(true, 'floating');
      bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      bubbleWin.loadFile(path.join(__dirname, 'renderer', 'bubble.html'));
      bubbleWin.webContents.on('did-finish-load', () => {
        bubbleWin.webContents.send('bubble:data', { ...bubblePayload(), pop: true });
        positionBubble();
        bubbleWin.showInactive();
      });
    } else {
      bubbleWin.webContents.send('bubble:data', { ...bubblePayload(), pop: fresh });
      positionBubble();
      bubbleWin.showInactive();
    }
  } else if (bubbleWin) {
    // Grace period so the cursor can travel from Drippy to the card.
    clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(() => {
      if (bubbleWin && !(blobHovered || bubbleHovered)) bubbleWin.hide();
    }, 400);
  }
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
    title: 'Drippy usage trends',
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'trends-preload.js'),
      contextIsolation: true,
    },
  });
  trendsWin.loadFile(path.join(__dirname, 'renderer', 'trends.html'));
  centerOnDrippysDisplay(trendsWin);
  trendsWin.on('closed', () => {
    trendsWin = null;
  });
}

// First launch: Drippy gives the tour himself; the welcome sheet follows.
// The flag is written when the tour ends, so a crash mid-tour retries.
function maybeStartTour() {
  const flag = path.join(app.getPath('userData'), 'welcomed');
  if (fs.existsSync(flag)) return;
  setTimeout(startTour, 1200); // let the blob settle on screen first
}

// ---------------------------------------------------------------------------

ipcMain.handle('drippy:history', () => {
  const days = history.readDays(60);
  const today = { date: currentDay, ...daily };
  // 7-day totals and their everyday equivalents, computed here where the
  // factors live, so the trends page states them rather than deriving them.
  const week = [...days, today].slice(-7).reduce(
    (a, d) => ({
      wh: a.wh + (d.wh || 0),
      waterMl: a.waterMl + (d.waterMl || 0),
      gco2: a.gco2 + (d.gco2 || 0),
      usd: a.usd + (d.usd || 0),
    }),
    { wh: 0, waterMl: 0, gco2: 0, usd: 0 }
  );
  return { days, today, week: { ...week, equivalents: impact.equivalents(week) }, factorsVersion: impact.version };
});

ipcMain.on('drippy:hover', (_e, { over }) => {
  blobHovered = over;
  updateBubble();
});
// Renderer hit-test result: interactive only over Drippy himself, so every
// other pixel of the window lets clicks fall through to whatever is below.
ipcMain.on('drippy:hit', (_e, { over }) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!over, { forward: true });
});
ipcMain.on('drippy:bubble-hover', (_e, { over }) => {
  bubbleHovered = over;
  updateBubble();
});
ipcMain.on('drippy:bubble-height', (_e, { h }) => {
  // Size the bubble to its content so long recommendations aren't clipped.
  bubbleHeight = Math.max(120, Math.min(360, Math.round(h)));
  if (bubbleWin && !bubbleWin.isDestroyed()) positionBubble();
});
ipcMain.on('drippy:bubble-action', () => {
  // Only clipboard events offer an action; clearing is the remedy.
  const wasCritical = privacyLevel === 1;
  require('electron').clipboard.clear();
  console.log('[drippy] clipboard cleared via attention bubble');
  clearPrivacy('cleared-by-button');
  if (wasCritical) suggestions.evaluate({ type: 'critical-cleared-button' });
});

// ---------------------------------------------------------------------------
// Suggestion delivery — a mini bubble that auto-shows beside Drippy (never
// steals focus) and a reviewable feed so nothing is ever lost.
// ---------------------------------------------------------------------------

const SUG_W = 300;
let sugHeight = 120;
let sugWin = null;
let sugCurrent = null;
let sugHovered = false;
let sugAutoHide = null;

function positionSuggestion() {
  if (!sugWin || !win) return;
  // Drop just below the pill, tail pointing up at it.
  const { cx, below, wa } = pillAnchor();
  let x = Math.round(cx - SUG_W / 2);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - SUG_W));
  const y = Math.max(wa.y, Math.min(below, wa.y + wa.height - sugHeight));
  sugWin.setBounds({ x, y, width: SUG_W, height: sugHeight });
  const tailX = Math.max(18, Math.min(SUG_W - 34, Math.round(cx - x - 15)));
  sugWin.webContents.send('suggest:tail', { tailX, below: true });
}

function showSuggestion(sg) {
  sugCurrent = sg;
  if (!sugWin) {
    sugWin = new BrowserWindow({
      width: SUG_W,
      height: sugHeight,
      frame: false,
      transparent: true,
      resizable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'suggestion-preload.js'), contextIsolation: true },
    });
    sugWin.setAlwaysOnTop(true, 'floating');
    sugWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    sugWin.loadFile(path.join(__dirname, 'renderer', 'suggestion.html'));
    sugWin.webContents.on('did-finish-load', () => {
      sugWin.webContents.send('suggest:data', sugCurrent);
      positionSuggestion();
      sugWin.showInactive();
      armSuggestionAutoHide();
    });
  } else {
    sugWin.webContents.send('suggest:data', sg);
    positionSuggestion();
    sugWin.showInactive();
    armSuggestionAutoHide();
  }
}

function armSuggestionAutoHide() {
  clearTimeout(sugAutoHide);
  // Long enough to read the why line and reach the button, never nagging.
  sugAutoHide = setTimeout(() => {
    if (sugWin && !sugHovered) sugWin.hide();
  }, 12000);
}

function hideSuggestion() {
  clearTimeout(sugAutoHide);
  if (sugWin) sugWin.hide();
}

// The button on a notice DOES the thing (Jack's steer, 2026-07-20): copy
// the remedy, open the right window. The card stays up briefly for 'copy'
// so its "Copied" confirmation can be seen.
function performSuggestionAction(action) {
  if (!action) return;
  if (action.kind === 'copy') {
    require('electron').clipboard.writeText(action.payload || '');
    console.log('[drippy] notice action — copied to clipboard');
  } else if (action.kind === 'open-trends') {
    showTrends();
  } else if (action.kind === 'open-feed') {
    showFeed();
  }
}

ipcMain.on('suggest:hover', (_e, { over }) => {
  sugHovered = over;
  if (over) clearTimeout(sugAutoHide);
  else armSuggestionAutoHide();
});
ipcMain.on('suggest:act', () => {
  if (!sugCurrent) return;
  performSuggestionAction(sugCurrent.action);
  suggestions.outcome(sugCurrent.id, 'acted');
  if (!sugCurrent.action || sugCurrent.action.kind !== 'copy') hideSuggestion();
});
ipcMain.on('suggest:hide', () => hideSuggestion());
ipcMain.on('suggest:dismiss', () => {
  if (sugCurrent) suggestions.outcome(sugCurrent.id, 'dismissed');
  hideSuggestion();
});
ipcMain.on('suggest:height', (_e, { h }) => {
  sugHeight = Math.max(80, Math.min(260, Math.round(h)));
  if (sugWin && !sugWin.isDestroyed()) positionSuggestion();
});
ipcMain.on('suggest:outcome', (_e, { id, kind }) => suggestions.outcome(id, kind));
ipcMain.handle('suggest:feed', () => suggestions.feed());

let feedWin = null;
function showFeed() {
  if (feedWin) {
    feedWin.focus();
    return;
  }
  feedWin = new BrowserWindow({
    width: 480,
    height: 640,
    title: 'Drippy suggestions',
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'feed-preload.js'), contextIsolation: true },
  });
  feedWin.loadFile(path.join(__dirname, 'renderer', 'feed.html'));
  centerOnDrippysDisplay(feedWin);
  feedWin.on('closed', () => {
    feedWin = null;
  });
}

// ---------------------------------------------------------------------------
// First-run tour — Drippy introduces himself. A tour bubble sits above the
// blob while the main process puppets it through each mode: demo states are
// sent straight to the renderer, so no counters or history are touched.
// ---------------------------------------------------------------------------

const TOUR_W = 320;
let tourWin = null;
let tourHeight = 170;
let tourStep = -1;
let tourActive = false;

const TOUR_STEPS = [
  {
    text: "Hello, I'm Drippy: your AI transparency layer. I track what your AI use really costs in energy, water, carbon and privacy. Drag me along the bar to wherever suits you.",
    state: {},
  },
  {
    text: 'When AI is at work, I glow: your requests or a background agent’s, I meter both.',
    state: { glow: true },
  },
  {
    text: 'If something private is about to be sent, say an API key on your clipboard, I turn violet. For anything serious I swell up with a badge; hovering shows exactly what I found and the one-click remedy.',
    state: { mode: 'privacyEvent', privacyLevel: 1 },
  },
  {
    text: 'Hover opens today’s numbers; a click opens 30-day trends; right-click holds the rest. The welcome sheet next has the full privacy story.',
    state: {},
  },
];

function tourState(extra) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('drippy:update', {
    mode: 'ambient',
    glow: false,
    privacyLevel: 0,
    stats: statsPayload(),
    ...extra,
  });
}

function positionTour() {
  if (!tourWin || !win) return;
  const { cx, below, wa } = pillAnchor();
  let x = Math.round(cx - TOUR_W / 2);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - TOUR_W));
  const y = Math.max(wa.y, Math.min(below, wa.y + wa.height - tourHeight));
  tourWin.setBounds({ x, y, width: TOUR_W, height: tourHeight });
  const tailX = Math.max(18, Math.min(TOUR_W - 34, Math.round(cx - x - 15)));
  tourWin.webContents.send('tour:tail', { tailX, below: true });
}

function startTour() {
  if (tourActive) return;
  tourActive = true;
  tourStep = -1;
  console.log('[drippy] tour started');
  hideSuggestion();
  if (bubbleWin) bubbleWin.hide();
  if (!tourWin) {
    tourWin = new BrowserWindow({
      width: TOUR_W,
      height: tourHeight,
      frame: false,
      transparent: true,
      resizable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: { preload: path.join(__dirname, 'tour-preload.js'), contextIsolation: true },
    });
    tourWin.setAlwaysOnTop(true, 'floating');
    tourWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    tourWin.loadFile(path.join(__dirname, 'renderer', 'tour.html'));
    tourWin.webContents.on('did-finish-load', advanceTour);
  } else {
    advanceTour();
  }
}

function advanceTour() {
  tourStep += 1;
  if (tourStep >= TOUR_STEPS.length) return endTour(true);
  const s = TOUR_STEPS[tourStep];
  tourState(s.state);
  tourWin.webContents.send('tour:data', { text: s.text, step: tourStep, total: TOUR_STEPS.length });
  positionTour();
  tourWin.showInactive();
  console.log(`[drippy] tour step ${tourStep + 1}/${TOUR_STEPS.length}`);
}

function endTour(finished) {
  tourActive = false;
  tourStep = -1;
  if (tourWin) tourWin.hide();
  console.log(`[drippy] tour ${finished ? 'finished' : 'skipped'}`);
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'welcomed'), new Date().toISOString());
  } catch {}
  pushState(); // hand the blob back to reality
  showWelcome(); // the trust moment: what Drippy can and cannot see
}

ipcMain.on('tour:next', () => tourActive && advanceTour());
ipcMain.on('tour:skip', () => tourActive && endTour(false));
ipcMain.on('tour:height', (_e, { h }) => {
  tourHeight = Math.max(120, Math.min(320, Math.round(h)));
  if (tourWin && !tourWin.isDestroyed() && tourActive) positionTour();
});

// Sync opt-in and the upload ledger, surfaced in the welcome sheet
// ("What has been shared"). Off by default; setEnabled(true) enrols the
// device into a personal workspace on first use.
ipcMain.handle('sync:info', () => sync.info());
ipcMain.handle('sync:set', async (_e, enabled) => {
  try {
    return await sync.setEnabled(!!enabled);
  } catch (err) {
    console.log(`[drippy] sync opt-in failed — ${err.message || err}`);
    return { ...sync.info(), error: String(err.message || err) };
  }
});

ipcMain.handle('drippy:factors-version', () => impact.version);

ipcMain.on('drippy:open-accessibility', async () => {
  console.log('[drippy] opening Accessibility settings');
  const { shell } = require('electron');
  try {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  } catch (err) {
    // Deep link schemes shift between macOS releases; the app itself is
    // the stable fallback.
    console.log(`[drippy] settings deep link failed (${err.message || err}); opening System Settings`);
    shell.openPath('/System/Applications/System Settings.app');
  }
});

ipcMain.on('drippy:drag-start', startDrag);
ipcMain.on('drippy:drag-end', endDrag);
ipcMain.on('drippy:click', () => {
  // A warning click acknowledges it; any other click opens the trends
  // window — the droplet is a doorway to the numbers, nothing else.
  if (privacyLevel > 0) acknowledgePrivacy();
  else showTrends();
});

app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // menu-bar accessory, no Dock icon
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  history.init(app.getPath('userData'));
  loadState();
  sync.init({
    dir: app.getPath('userData'),
    getToday: () => ({ date: currentDay, ...daily }),
    getMeta: () => ({
      appVersion: app.getVersion(),
      os: process.platform,
      osVersion: process.getSystemVersion(),
      factorsVersion: impact.version,
      tzOffsetMin: -new Date().getTimezoneOffset(),
      country: app.getLocaleCountryCode() || '',
    }),
    // Development default only; production endpoints arrive with Phase 2.
    defaultEndpoint: app.isPackaged ? null : process.env.DRIPPY_SYNC_ENDPOINT || 'http://127.0.0.1:8787',
  });
  createWindow();
  monitor.start();
  engagement.start();
  claudeCode.start();
  maybeStartTour();
});

app.on('before-quit', () => saveState(true));
// The blob window never closes in normal use; the welcome window may.
app.on('window-all-closed', () => {});
