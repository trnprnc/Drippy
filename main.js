const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AnthropicMonitor = require('./monitor');
const EngagementSensor = require('./engagement');
const PrivacySensor = require('./privacy');
const ClaudeCodeMonitor = require('./claude-code');
const impact = require('./impact');
const history = require('./history');
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

// Window is larger than the 56x52 blob so the breathing glow halo, drop
// shadow and the 64px footprint ring render without clipping.
const WIN_W = 160;
const WIN_H = 170;

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
// Daily reference points: the footprint ring's three arcs fill toward these,
// so a light day shows short arcs and a heavy day fuller ones. The arcs are
// Drippy's three pillars: AI usage, environment, and privacy.
const FOOTPRINT_REF = { requests: 40, gco2: 20, privacy: 3 };

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
let privacyLevel = 0; // 0 = none, 1 = critical (badge), 2 = caution (squint)
let privacyStartedAt = 0;
let privacyClearTimer = null;
let footprintShown = false;
let aiSecondsTimer = null;

let userPresent = false; // a Claude surface is frontmost
let userTyping = false; // and input is happening right now

function totalInFlight() {
  return inFlightFg + inFlightBg;
}

// The attention progression:
//   eyes forward — AI is in use (Claude open in front of you, or your
//                  request is running)
//   eyes on the work (gaze) — you're actively typing/working
//   warning — privacy concern: eyes STAY on the work (that's where the
//             problem is); hover Drippy for details and a recommendation
//   glow — AI energy flowing on this machine (any request, yours or not)
function visualFlags() {
  if (privacyLevel > 0) return { eyes: false, gaze: true, glow: false, privacyLevel };
  const fg = inFlightFg > 0 || fgLinger;
  return {
    eyes: userPresent || fg,
    gaze: userTyping,
    glow: fg || inFlightBg > 0 || bgLinger,
    privacyLevel: 0,
  };
}

function currentMode() {
  if (privacyLevel > 0) return 'privacyEvent';
  const f = visualFlags();
  if (f.eyes || f.glow) return 'live'; // flags drive the visuals
  if (footprintShown) return 'footprint';
  return 'resting';
}

function trayStateLabel() {
  if (privacyLevel === 1) return 'warning: hover Drippy for details';
  if (privacyLevel === 2) return 'heads-up: hover Drippy for details';
  const f = visualFlags();
  if (inFlightFg > 0 || fgLinger) return 'your request is running';
  if (f.glow && f.eyes) return 'attentive · background AI activity';
  if (f.glow) return 'background AI activity';
  if (f.gaze) return 'watching you work';
  if (f.eyes) return 'attentive';
  if (footprintShown) return "day's footprint";
  return 'resting';
}

function footprintArcs() {
  // Each arc is a gauge that fills 0..1 toward its daily reference (capped).
  // usage = how much AI you leaned on, env = what it cost the planet,
  // privacy = how often sensitive data nearly slipped out.
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  return {
    usage: clamp01(daily.requests / FOOTPRINT_REF.requests),
    env: clamp01(daily.gco2 / FOOTPRINT_REF.gco2),
    privacy: clamp01(daily.privacyEvents / FOOTPRINT_REF.privacy),
  };
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
  // While the tour is puppeting the blob, real state stays out of the way
  // (the tray keeps telling the truth underneath).
  if (tourActive) {
    updateTrayMenu();
    updateTrayIcon();
    return;
  }
  const mode = currentMode();
  const flags = mode === 'footprint' ? { eyes: false, gaze: false, glow: false, privacyLevel: 0 } : visualFlags();
  win.webContents.send('drippy:update', {
    mode,
    ...flags,
    dozing,
    leanDir: leanDirection(),
    arcs: footprintArcs(),
  });
  updateTrayMenu();
  updateTrayIcon();
}

function requestStarted(fg) {
  noteActivity();
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

// level 1 = critical (full alarm + badge), 2 = caution (a quiet squint).
function privacyEvent(level = 1) {
  noteActivity();
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

function clearPrivacy() {
  const wasCritical = privacyLevel === 1;
  privacyLevel = 0;
  clearTimeout(privacyClearTimer);
  updateBubble();
  pushState();
  suggestions.evaluate({ type: 'warning-cleared', wasCritical });
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
  noteActivity();
  footprintShown = !footprintShown;
  pushState();
  updateBubble(); // show/hide the footprint breakdown if hovering
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
  }
}, 60 * 1000).unref();

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
// Records one request's impact into today's totals, per-app breakdown and
// history. `est` comes either from byte estimation (network monitor) or from
// exact provider usage (Claude Code transcripts).
function recordRequest({ app: appName, fg, ms, est }) {
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
    ms,
    in: est.inputTokens,
    out: est.outputTokens,
    wh: +est.wh.toFixed(3),
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
    recordRequest({ app: appName, fg, ms: durationMs, est });
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
  recordRequest({ app: 'Claude Code', fg: true, ms: 0, est });
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
  console.log(`[drippy] suggests — [${sg.family}] ${sg.text}`);
  showSuggestion(sg);
  // Drippy embodies the point: a bike for "go take a break" (wellbeing),
  // a magnifying glass for "I had a close look at your writing" (authenticity).
  const shape = sg.family === 'wellbeing' ? 'bike' : sg.family === 'authenticity' ? 'glass' : null;
  if (shape && win && !win.isDestroyed()) win.webContents.send('drippy:morph', shape);
});
setInterval(() => {
  prune();
  suggestions.evaluate();
}, 30 * 1000).unref();

// Eyes open the moment the user starts working in Claude — quiet
// acknowledgment that Drippy sees the activity. Glow stays reserved for an
// actual request in flight.
const privacy = new PrivacySensor();
privacy.on('aitell', (t) => suggestions.evaluate({ type: 'aitell', signals: t.signals }));

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
  if (present || typing) noteActivity(); // you're back — wake and reset idle
  console.log(`[drippy] engagement — present:${present} typing:${typing}${present ? ` (${appName})` : ''}`);
  monitor.setHot(present); // react in ~1s while you're actually there
  if (typingStarted) monitor.poke(); // a send is probably imminent
  privacy.setContext({ present, typing });
  pushState();
});

privacy.on('detected', ({ source, concerns }) => {
  // Count every detection so trends stay honest, including low-risk ones.
  for (const c of concerns) daily.privacyByCat[c.label] = (daily.privacyByCat[c.label] || 0) + 1;
  history.appendPrivacy({ ts: new Date().toISOString(), source, cats: concerns.map((c) => c.id) });

  const topTier = Math.min(...concerns.map((c) => c.tier)); // 1 = most serious
  if (topTier >= 3) {
    // Low risk (e.g. your own email): note it, but don't raise a warning.
    console.log(`[drippy] noted (low risk) — ${concerns.map((c) => c.label).join(', ')} (${source})`);
    return;
  }

  // Show the warning built around the concerns that actually warrant it.
  const warned = concerns.filter((c) => c.tier <= 2);
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

// Dev-only: fire a warning with a realistic fake concern so the bubble works.
function simulatePrivacy(level = 1) {
  const fake =
    level === 1
      ? { id: 'anthropic-key', label: 'Anthropic API key', severity: 'critical', tier: 1 }
      : { id: 'phone', label: 'phone number', severity: 'medium', tier: 2 };
  lastPrivacy = { source: 'clipboard', concerns: [fake], at: new Date() };
  privacyEvent(level);
}

function demoTick() {
  if (!demoEnabled) return;
  if (Math.random() < 0.18) {
    simulatePrivacy(Math.random() < 0.6 ? 1 : 2);
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
  noteActivity(); // a drag wakes Drippy and it becomes the new home
  if (bubbleWin) bubbleWin.hide();
  hideSuggestion(); // popups don't trail along mid-drag
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
  savePosition(); // wherever you put it becomes home
  pushState(); // refresh lean for the new position
}

// ---------------------------------------------------------------------------
// Doze — after a long idle Drippy condenses, in place, into a small still
// droplet: clearly deliberate, clearly still there, clearly clickable. Any
// sign of life (hover, drag, AI activity) plumps him straight back up.
// ---------------------------------------------------------------------------

const DOZE_AFTER_MS = Number(process.env.DRIPPY_DOZE_MS) || 90 * 1000;
let dozing = false;
let lastActivityAt = Date.now();

function idleEnough() {
  return (
    !dozing &&
    !dragPoll &&
    !tourActive &&
    !userPresent &&
    totalInFlight() === 0 &&
    !fgLinger &&
    !bgLinger &&
    privacyLevel === 0 &&
    !footprintShown &&
    Date.now() - lastActivityAt > DOZE_AFTER_MS
  );
}

function dozeOff() {
  if (dozing || !win) return;
  dozing = true;
  hideSuggestion(); // a condensed Drippy leaves no bubble hanging mid-air
  console.log('[drippy] condensing into a droplet');
  pushState(); // renderer melts down in place
}

// Any sign of life resets the idle clock and plumps Drippy back up.
function noteActivity() {
  lastActivityAt = Date.now();
  if (dozing) {
    dozing = false;
    console.log('[drippy] plumping back up');
    pushState();
    suggestions.evaluate({ type: 'doze-wake' });
  }
}

setInterval(() => {
  if (idleEnough()) dozeOff();
}, 5000).unref();

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
      { label: `Drippy v${app.getVersion()}: ${trayStateLabel()}`, enabled: false },
      { label: watchLabel, enabled: false },
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
              label: `Privacy: ${lastPrivacy.concerns.map((c) => c.label).join(', ')} via ${lastPrivacy.source} · ${lastPrivacy.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
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
      // Simulation and demo controls are development-only; never shipped.
      ...(app.isPackaged
        ? []
        : [
            { label: 'Simulate AI request (5s)', click: simulateRequest },
            { label: 'Simulate critical warning', click: () => simulatePrivacy(1) },
            { label: 'Simulate caution (squint)', click: () => simulatePrivacy(2) },
            {
              label: 'Simulate suggestion',
              click: () =>
                showSuggestion({
                  id: 'ask-critique',
                  family: 'practice',
                  text: 'AI loves to agree with you. Ask it to attack the idea instead; the pushback is the value.',
                  why: '9 requests in the last 30 minutes',
                  action: { label: 'Copy critique prompt', kind: 'copy', payload: 'Attack this idea. What breaks first, and why? Be specific and blunt; no praise, no hedging.' },
                }),
            },
            { label: 'Demo mode', type: 'checkbox', checked: demoEnabled, click: () => setDemo(!demoEnabled) },
          ]),
      { type: 'separator' },
      { label: 'Suggestions…', click: showFeed },
      { label: 'Usage trends…', click: showTrends },
      { label: 'About Drippy: what it can see…', click: showWelcome },
      { label: 'Replay the tour', click: startTour },
      { label: 'Reset day', click: resetDay },
      { label: 'Quit Drippy', click: () => app.quit() },
    ])
  );
}

function trayIcon(name) {
  // Monochrome template image (Drippy's exact blob + eyes); macOS tints it to
  // match the light/dark menu bar. Generated by build/tray-icon-gen.js.
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', `${name}.png`));
  if (!icon.isEmpty()) icon.setTemplateImage(true);
  return icon;
}

let trayNormalIcon = null;
let trayAlertIcon = null;
let trayShowingAlert = false;

// The menu bar reacts too: Drippy's eyes go wide during a critical warning
// (tier 1 only). A tier-2 caution stays a normal glance in the menu bar.
function updateTrayIcon() {
  if (!tray || !trayNormalIcon || trayNormalIcon.isEmpty()) return;
  const alert = privacyLevel === 1;
  if (alert === trayShowingAlert) return;
  trayShowingAlert = alert;
  tray.setImage(alert && !trayAlertIcon.isEmpty() ? trayAlertIcon : trayNormalIcon);
  console.log(`[drippy] menu-bar eyes ${alert ? 'wide (warning)' : 'normal'}`);
}

function createTray() {
  trayNormalIcon = trayIcon('trayTemplate');
  trayAlertIcon = trayIcon('trayAlertTemplate');
  tray = trayNormalIcon.isEmpty() ? new Tray(nativeImage.createEmpty()) : new Tray(trayNormalIcon);
  if (trayNormalIcon.isEmpty()) tray.setTitle('💧'); // fallback if asset missing
  tray.setToolTip('Drippy, your AI transparency companion');
  updateTrayMenu();
}

// ---------------------------------------------------------------------------
// Welcome / About window — shown on first run and from the tray. This is the
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

// Ring colours (match renderer/setRing) for the footprint breakdown rows.
const RING_COLORS = { usage: 'oklch(0.82 0.13 85)', env: 'oklch(0.78 0.14 155)', privacy: 'oklch(0.72 0.12 300)' };

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
  if (footprintShown) {
    const tokens = Math.round(daily.tokensIn + daily.tokensOut);
    return {
      kind: 'footprint',
      title: "Today's footprint",
      rows: [
        { color: RING_COLORS.usage, label: 'AI usage', value: `${daily.requests} requests · ~${tokens.toLocaleString()} tokens` },
        {
          color: RING_COLORS.env,
          label: 'Environment',
          value: `${daily.wh.toFixed(1)} Wh · ${daily.gco2.toFixed(1)} g CO₂e · ${daily.waterMl.toFixed(0)} mL water`,
        },
        { color: RING_COLORS.privacy, label: 'Privacy', value: `${daily.privacyEvents} warning${daily.privacyEvents === 1 ? '' : 's'} today` },
      ],
      footer: `Each arc fills toward a daily reference · estimates ±3× · factors v${impact.version}`,
    };
  }
  return null;
}

const { recommendationFor: impactRecommend } = require('./pii');

// Popups sit close enough to feel spoken by Drippy: beside him, overlapping
// the window's empty halo margin but never the blob itself, with a tail
// pointing back at him.
const POPUP_TUCK = 44;

function positionBubble() {
  const [wx, wy] = win.getPosition();
  const display = screen.getDisplayMatching({ x: wx, y: wy, width: WIN_W, height: WIN_H });
  // Prefer the side toward the screen centre (usually the work side).
  let x = wx - BUBBLE_W + POPUP_TUCK;
  let side = 'right'; // bubble left of Drippy, tail on its right edge
  if (x < display.workArea.x) {
    x = wx + WIN_W - POPUP_TUCK;
    side = 'left';
  }
  let y = wy + Math.round(WIN_H / 2 - bubbleHeight / 2);
  y = Math.max(display.workArea.y, Math.min(y, display.workArea.y + display.workArea.height - bubbleHeight));
  bubbleWin.setBounds({ x: Math.round(x), y: Math.round(y), width: BUBBLE_W, height: bubbleHeight });
  bubbleWin.webContents.send('bubble:tail', { side });
}

function updateBubble() {
  const shouldShow = (privacyLevel > 0 || footprintShown) && (blobHovered || bubbleHovered);
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
    // Grace period so the cursor can travel from blob to bubble.
    clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(() => {
      if (bubbleWin && !((privacyLevel > 0 || footprintShown) && (blobHovered || bubbleHovered))) bubbleWin.hide();
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

ipcMain.handle('drippy:history', () => ({
  days: history.readDays(60),
  today: { date: currentDay, ...daily },
}));

ipcMain.on('drippy:hover', (_e, { over }) => {
  if (over) noteActivity(); // hovering wakes Drippy
  blobHovered = over;
  updateBubble();
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
  clearPrivacy();
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
  const [wx, wy] = win.getPosition();
  const display = screen.getDisplayMatching({ x: wx, y: wy, width: WIN_W, height: WIN_H });
  const wa = display.workArea;
  // Hover just above Drippy's head, roughly centred on him, so it reads as
  // his thought. Never clashes with the warning bubble's spot beside him.
  const blobCenterX = wx + WIN_W / 2;
  let x = Math.round(blobCenterX - SUG_W / 2);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - SUG_W));
  let y = wy - sugHeight + 48;
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - sugHeight));
  sugWin.setBounds({ x, y, width: SUG_W, height: sugHeight });
  // Tail aims down at the blob even when the card was clamped by an edge.
  const tailX = Math.max(18, Math.min(SUG_W - 34, Math.round(blobCenterX - x - 7)));
  sugWin.webContents.send('suggest:tail', { tailX });
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

// The button on a suggestion DOES the thing (Jack's steer, 2026-07-20):
// copy the better prompt, start the break, open the right window. The card
// stays up briefly for 'copy' so its "Copied" confirmation can be seen.
let breakTimer = null;

function performSuggestionAction(action) {
  if (!action) return;
  if (action.kind === 'copy') {
    require('electron').clipboard.writeText(action.payload || '');
    console.log('[drippy] suggestion action — copied to clipboard');
  } else if (action.kind === 'break') {
    clearTimeout(breakTimer);
    if (win && !win.isDestroyed()) win.webContents.send('drippy:morph', { shape: 'bike', hold: 4200 });
    breakTimer = setTimeout(() => {
      showSuggestion({ id: 'break-done', family: 'wellbeing', text: 'Five minutes, well taken. Welcome back.', why: null, action: null });
    }, 5 * 60 * 1000);
    console.log('[drippy] suggestion action — 5 minute break started');
  } else if (action.kind === 'footprint') {
    if (!footprintShown) toggleFootprint();
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
let tourMorphTimer = null;

const TOUR_STEPS = [
  {
    text: "Hello! I'm Drippy. I sit quietly on top of your windows and make the hidden side of AI visible: energy, privacy and habits. Drag me somewhere comfortable; wherever you drop me becomes home.",
    state: { eyes: true },
  },
  {
    text: 'When AI is at work on this Mac, I glow. My eyes open when Claude is in front of you, and while you type I keep them on your work.',
    state: { eyes: true, gaze: true, glow: true },
  },
  {
    text: 'If something sensitive is about to leave this Mac, say an API key on your clipboard, I turn violet before it goes. Wide eyes and a badge mean critical: hover me for what I found and what to do about it.',
    state: { mode: 'privacyEvent', eyes: true, gaze: true, privacyLevel: 1 },
  },
  {
    text: "Ask the menu bar drop (\u{1F4A7}) for my footprint ring and I show your day: green for the environment, amber for AI usage, violet for privacy. Hover me while it's up for the numbers.",
    state: { mode: 'footprint', arcs: { usage: 0.55, env: 0.4, privacy: 0.33 } },
  },
  {
    text: "Sometimes I become things, always for a reason. A bicycle means you've been at it a while: go stretch your legs. A magnifying glass means I've had a close look at your writing. Click me any time, just for fun.",
    morphs: ['bike', 'glass'],
  },
  {
    text: 'While you work I make small, practical suggestions, each with a button that does the thing: copy a sharper prompt, start a proper break, show what I spotted. Every one says why it fired, and all of them collect in \u{1F4A7} → Suggestions. That is the tour; my welcome sheet has the rest.',
    state: { eyes: true },
  },
];

function tourState(extra) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('drippy:update', {
    mode: 'resting',
    eyes: false,
    gaze: false,
    glow: false,
    privacyLevel: 0,
    dozing: false,
    leanDir: leanDirection(),
    arcs: footprintArcs(),
    ...extra,
  });
}

function positionTour() {
  if (!tourWin || !win) return;
  const [wx, wy] = win.getPosition();
  const display = screen.getDisplayMatching({ x: wx, y: wy, width: WIN_W, height: WIN_H });
  const wa = display.workArea;
  const blobCenterX = wx + WIN_W / 2;
  let x = Math.round(blobCenterX - TOUR_W / 2);
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - TOUR_W));
  let y = wy - tourHeight + 48;
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - tourHeight));
  tourWin.setBounds({ x, y, width: TOUR_W, height: tourHeight });
  const tailX = Math.max(18, Math.min(TOUR_W - 34, Math.round(blobCenterX - x - 7)));
  tourWin.webContents.send('tour:tail', { tailX });
}

function startTour() {
  if (tourActive) return;
  tourActive = true;
  tourStep = -1;
  console.log('[drippy] tour started');
  noteActivity();
  hideSuggestion();
  footprintShown = false;
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
  clearInterval(tourMorphTimer);
  tourStep += 1;
  if (tourStep >= TOUR_STEPS.length) return endTour(true);
  const s = TOUR_STEPS[tourStep];
  if (s.morphs) {
    // The shapes step: Drippy cycles bike and glass while the card is up.
    tourState({});
    let i = 0;
    const sendMorph = () => {
      if (win && !win.isDestroyed()) win.webContents.send('drippy:morph', { shape: s.morphs[i++ % s.morphs.length], hold: 3050 });
    };
    sendMorph();
    tourMorphTimer = setInterval(sendMorph, 3300);
  } else {
    if (win && !win.isDestroyed()) win.webContents.send('drippy:morph', { shape: 'none' });
    tourState(s.state);
  }
  tourWin.webContents.send('tour:data', { text: s.text, step: tourStep, total: TOUR_STEPS.length });
  positionTour();
  tourWin.showInactive();
  console.log(`[drippy] tour step ${tourStep + 1}/${TOUR_STEPS.length}${s.morphs ? ' (shapes)' : ''}`);
}

function endTour(finished) {
  clearInterval(tourMorphTimer);
  tourMorphTimer = null;
  tourActive = false;
  tourStep = -1;
  if (tourWin) tourWin.hide();
  if (win && !win.isDestroyed()) win.webContents.send('drippy:morph', { shape: 'none' });
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

ipcMain.on('drippy:open-accessibility', () => {
  require('electron').shell.openExternal(
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  );
});

ipcMain.on('drippy:drag-start', startDrag);
ipcMain.on('drippy:drag-end', endDrag);
ipcMain.on('drippy:click', () => {
  if (privacyLevel > 0) acknowledgePrivacy();
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
  claudeCode.start();
  maybeStartTour();
});

app.on('before-quit', () => saveState(true));
// The blob window never closes in normal use; the welcome window may.
app.on('window-all-closed', () => {});
