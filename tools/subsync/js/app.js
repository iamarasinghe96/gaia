// app.js — wires everything together.

import { parseSrt, formatMs } from './srtParser.js';
import { SyncEngine } from './syncEngine.js';
import { LocalClock } from './clock.js';
import { translateCues, providerNeedsSignIn } from './translator.js';
import { speechSupported, attemptAutoSync, listen, bestCueMatch } from './speechAutoSync.js';
import { identifyFilm } from './movieId.js';
import { searchSubtitles, downloadSubtitle } from './subtitleFinder.js';
import { signedIn } from './api.js';
import {
  loadSettings, saveSettings,
  syncKeyFor, loadSync, saveSync,
} from './store.js';

const $ = (sel) => document.querySelector(sel);

// ---- state ----
const settings = loadSettings();
const engine = new SyncEngine();
const clock = new LocalClock();

const timeSource = clock;   // companion mode: subtitles run off a local clock
let srtFiles = [];          // [{ name, size, cues, warnings }]
let activeSrt = -1;
let translateAbort = null;
let wakeLock = null;
let twoPt = { a: null, b: null };

// ---- setup: load SRT (file / paste / url) ----
$('#srtFile').addEventListener('change', (e) => {
  const input = e.target;
  const file = input.files[0];
  if (!file) return;
  file.text()
    .then((txt) => addSrt(file.name, file.size, txt))
    .catch(() => setWarning(`Couldn't read "${file.name}". Try a different file.`))
    // Reset so re-picking the same file fires change again after a failed load.
    .finally(() => { input.value = ''; });
});

$('#loadPasteBtn').addEventListener('click', () => {
  const txt = $('#srtPaste').value;
  if (!txt.trim()) return;
  addSrt('Pasted subtitles', txt.length, txt);
  $('#srtPaste').value = '';
});

$('#loadUrlBtn').addEventListener('click', async () => {
  const url = $('#srtUrl').value.trim();
  if (!url) return;
  setWarning('Fetching subtitle file…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    const name = url.split('/').pop() || 'subtitles.srt';
    addSrt(name, txt.length, txt);
  } catch {
    setWarning("Couldn't fetch that URL. The site may block cross-origin requests — download the .srt and load it as a file instead.");
  }
});

function addSrt(name, size, text) {
  const { cues, warnings } = parseSrt(text);
  if (cues.length === 0) {
    setWarning(warnings.join(' '));
    return;
  }
  srtFiles.push({ name, size, cues, warnings });
  activeSrt = srtFiles.length - 1;
  rebuildSrtList();
  setWarning(warnings.length ? warnings.join(' ') : `Loaded ${cues.length} lines from "${name}".`);
  refreshStartState();
}

// Release names run long ("Movie.2026.1080p.WEBRip.x265.10bit.AAC5.1-GROUP.srt").
// Keep the head and tail so releases stay tellable apart, drop the middle.
function shortName(name, max = 40) {
  const base = name.replace(/\.srt$/i, '');
  if (base.length <= max) return base;
  const head = Math.ceil((max - 1) / 2);
  return `${base.slice(0, head)}…${base.slice(base.length - (max - 1 - head))}`;
}

function rebuildSrtList() {
  const sel = $('#srtList');
  sel.innerHTML = '';
  srtFiles.forEach((f, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${shortName(f.name)} · ${f.cues.length} lines`;
    opt.title = f.name;
    sel.appendChild(opt);
  });
  sel.value = String(activeSrt);
  $('#srtListRow').hidden = srtFiles.length === 0;
}

$('#srtList').addEventListener('change', (e) => {
  activeSrt = Number(e.target.value);
  applyActiveSrt();
});

function applyActiveSrt() {
  if (activeSrt < 0) return;
  const f = srtFiles[activeSrt];
  engine.setCues(f.cues);
  // Restore any saved alignment for this file.
  const saved = loadSync(syncKeyFor(f));
  if (saved) { engine.offsetMs = saved.offsetMs; engine.scale = saved.scale; }
  else { engine.reset(); }
  updateOffsetReadout();
}

// ---- auto-find: listen → identify → download → load → start ----
const LISTEN_MS = 15000;

// Speech recognition wants a BCP-47 tag, not the bare ISO code the subtitle
// language picker uses — "hi-US" is not a locale.
const SPEECH_LOCALES = {
  en: 'en-US', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', zh: 'zh-CN', si: 'si-LK',
};
const speechLocale = (lang) => SPEECH_LOCALES[lang] || 'en-US';

let autoBusy = false;

function setAutoStatus(msg) {
  $('#autoStatus').textContent = msg || '';
}

const AUTO_ERRORS = {
  'signin': 'Sign in with Google (top right) to find subtitles automatically or by name. Loading a .srt yourself needs no account.',
  'signin-unavailable': "Sign-in isn't available right now. You can still load a .srt yourself.",
  'auth': 'Your sign-in has expired. Sign out, sign back in, then try again.',
  'limit': "You've reached the limit for now (searches per hour, downloads per day). Try again later, or load a .srt yourself.",
  'busy': 'The service is busy right now. Try again in a minute.',
  'not_configured': "This part of SubSync isn't switched on yet. Load a .srt yourself for now.",
  'network': "Couldn't reach the server. Check your connection and try again.",
  'server': 'Something went wrong on our side. Try again in a minute.',
  'unreadable': "Didn't catch enough dialogue. Turn the volume up and try again.",
  'too_long': 'That was too much to send at once. Try again.',
  'transcript-too-short': "Didn't catch enough dialogue. Turn the volume up and try again.",
  'refused': "Couldn't identify that one. Search by name or load the .srt yourself.",
  'os_auth': 'The subtitle service turned the request away. Please try again later.',
  'os_quota': "Today's subtitle downloads are used up. Try again tomorrow, or load a .srt yourself.",
  'no-results': 'No subtitles found for that film.',
};

function autoErrorMessage(err) {
  if (AUTO_ERRORS[err.message]) return AUTO_ERRORS[err.message];
  // A cross-origin block surfaces as a bare TypeError with no status.
  if (err.name === 'TypeError') return "Couldn't reach the server. Check your connection and try again.";
  return `Something went wrong: ${err.message}`;
}

$('#autoFindBtn').addEventListener('click', async () => {
  if (autoBusy) return;
  if (!speechSupported()) {
    setAutoStatus("This browser can't listen through the mic. Load the .srt manually.");
    return;
  }

  autoBusy = true;
  $('#autoFindBtn').disabled = true;
  try {
    setAutoStatus('Listening… keep the film playing.');
    const { transcript } = await listen(LISTEN_MS, speechLocale(settings.sourceLang));
    // Start the clock the moment listening ends so it keeps pace with the film
    // while the download runs.
    clock.reset();
    clock.start();

    setAutoStatus('Working out which film this is…');
    const guesses = await identifyFilm(transcript);
    if (guesses.length === 0) throw new Error('refused');

    const pick = await askWhichFilm(transcript, guesses);
    if (!pick) { setAutoStatus('Cancelled.'); return; }

    setAutoStatus(`Looking for “${pick.title}” subtitles…`);
    const hits = await searchSubtitles({
      title: pick.title,
      year: pick.year,
      language: settings.sourceLang,
    });
    if (hits.length === 0) throw new Error('no-results');

    setAutoStatus('Downloading…');
    const loaded = await downloadAndLoad(hits[0]);
    if (!loaded) return;
    const { remaining } = loaded;

    applyActiveSrt();
    anchorFromTranscript(transcript);
    enterStage();
    setAutoStatus(remaining === null ? '' : `${remaining} downloads left today.`);
  } catch (err) {
    clock.pause();
    setAutoStatus(autoErrorMessage(err));
  } finally {
    autoBusy = false;
    $('#autoFindBtn').disabled = false;
  }
});

// Rough first alignment. The matched line was heard somewhere inside the
// listening window, so anchor it to the middle — good to a few seconds, which
// Tap to sync then refines.
function anchorFromTranscript(transcript) {
  const f = srtFiles[activeSrt];
  const match = bestCueMatch(transcript, f.cues);
  if (!match) {
    setWarning('Loaded. Use Tap to sync when you hear a line you can see.');
    return;
  }
  engine.syncCueToNow(match.cue, -LISTEN_MS / 2);
  persistSync();
  updateOffsetReadout();
  setWarning('Loaded and roughly aligned — Tap to sync to sharpen it.');
}

// Shared chooser. Resolves to the chosen option's value, or null if dismissed.
// Listeners are bound to an AbortController so a call that ends by *picking*
// still tears down its cancel handler — otherwise stale handlers accumulate
// and the next call's promise never settles.
function askChoice({ heading, note, options, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const ac = new AbortController();
    const list = $('#pickChoices');
    list.innerHTML = '';
    $('#pickTitle').textContent = heading;
    $('#pickNote').textContent = note || '';
    $('#pickNote').hidden = !note;
    $('#pickCancelBtn').textContent = cancelLabel;

    const close = (value) => {
      ac.abort();
      $('#pickPrompt').hidden = true;
      list.innerHTML = '';
      resolve(value);
    };

    options.forEach((o) => {
      const btn = document.createElement('button');
      btn.className = 'pick-choice';
      const label = document.createElement('span');
      label.textContent = o.label;
      btn.append(label);
      if (o.sub) {
        const sub = document.createElement('span');
        sub.className = 'pick-sub';
        sub.textContent = o.sub;
        btn.append(sub);
      }
      btn.addEventListener('click', () => close(o.value), { signal: ac.signal });
      list.appendChild(btn);
    });

    $('#pickCancelBtn').addEventListener('click', () => close(null), { signal: ac.signal });
    $('#pickPrompt').hidden = false;
  });
}

function askWhichFilm(transcript, guesses) {
  return askChoice({
    heading: 'Is this the film?',
    note: `Heard: “${clip(transcript, 140)}”`,
    options: guesses.map((g) => ({
      label: `${g.title}${g.year ? ` (${g.year})` : ''}`,
      sub: g.why,
      value: g,
    })),
    cancelLabel: 'None of these',
  });
}

// Download one search hit and load it. Shared by search and auto-find.
// Returns null when addSrt rejects the file — it has already said why.
async function downloadAndLoad(hit) {
  const { name, text, remaining } = await downloadSubtitle({ fileId: hit.fileId });
  const before = srtFiles.length;
  addSrt(name, text.length, text);
  return srtFiles.length > before ? { name, text, remaining } : null;
}

// Hits arrive sorted by download count: the release most people actually have
// is the one most likely to match the cut being watched.
function releaseOptions(hits) {
  return hits.slice(0, 8).map((h) => ({
    label: shortName(h.release || h.name, 52),
    sub: `${h.downloads.toLocaleString()} downloads · ${h.language || '?'}`,
    value: h,
  }));
}

// ---- search by name ----
let searchBusy = false;

async function runSearch() {
  const title = $('#searchInput').value.trim();
  if (!title || searchBusy) return;

  searchBusy = true;
  $('#searchBtn').disabled = true;
  const status = (m) => { $('#searchStatus').textContent = m || ''; };

  try {
    status(`Searching for “${title}”…`);
    const hits = await searchSubtitles({
      title,
      language: settings.sourceLang,
    });
    if (hits.length === 0) {
      status(`No ${settings.sourceLang.toUpperCase()} subtitles found for “${title}”. Check the spelling, or change “The .srt is in”.`);
      return;
    }

    status('');
    const pick = await askChoice({
      heading: 'Which release?',
      note: 'Pick the one matching your copy — a mismatched cut will drift.',
      options: releaseOptions(hits),
    });
    if (!pick) { status('Cancelled.'); return; }

    status('Downloading…');
    const loaded = await downloadAndLoad(pick);
    if (!loaded) { status(''); return; }

    applyActiveSrt();
    status(
      `Loaded “${shortName(loaded.name)}”. Tap Start, then tap the screen on the first line you hear.`
      + (loaded.remaining === null ? '' : ` · ${loaded.remaining} downloads left today.`)
    );
  } catch (err) {
    status(autoErrorMessage(err));
  } finally {
    searchBusy = false;
    $('#searchBtn').disabled = false;
  }
}

$('#searchBtn').addEventListener('click', runSearch);
$('#searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
});

function refreshStartState() {
  const needsSrt = srtFiles.length === 0;
  $('#startBtn').disabled = needsSrt;
  // A dead Start button with no explanation reads as broken.
  $('#startHint').textContent = needsSrt ? 'Load a .srt file to continue.' : '';
}

function setWarning(msg) {
  $('#warnings').textContent = msg || '';
}

// ---- start ----
function enterStage() {
  $('#setup').hidden = true;
  $('#stage').hidden = false;
  document.body.classList.add('mode-companion', 'ss-staging');

  $('#autoSyncBtn').hidden = !speechSupported();
  $('#clockToggle').textContent = clock.isRunning() ? 'Pause' : 'Play';

  showLangPrompt();
  requestWakeLock();
  renderLoop();
}

$('#startBtn').addEventListener('click', () => {
  applyActiveSrt();
  enterStage();
});
$('#gearBtn').addEventListener('click', updateTranslateHint);

$('#backBtn').addEventListener('click', () => {
  $('#stage').hidden = true;
  $('#setup').hidden = false;
  document.body.classList.remove('ss-staging');
  setControlsOpen(false);
  hideTapPrompt();
  clock.pause();
  releaseWakeLock();
});

// ---- language prompt overlay ----
function showLangPrompt() {
  $('#langPrompt').hidden = false;
}
document.querySelectorAll('#langPrompt [data-lang]').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.targetLang = btn.dataset.lang;
    saveSettings(settings);
    syncSettingsToControls();
    $('#langPrompt').hidden = true;
    // Nothing else to configure — start running and put the tap target up.
    clock.start();
    $('#clockToggle').textContent = 'Pause';
    showTapPrompt();
    if (settings.targetLang !== 'off') maybeOfferTranslate();
  });
});

function maybeOfferTranslate() {
  const f = srtFiles[activeSrt];
  const hasAny = f.cues.some((c) => c.translated);
  if (!hasAny) setWarning(`Tip: open Controls → Translate to fill in ${settings.targetLang === 'si' ? 'Sinhala' : 'English'}.`);
}

// ---- controls drawer ----
function setControlsOpen(open) {
  $('#controls').classList.toggle('open', open);
  $('#controlsScrim').hidden = !open;
}
$('#gearBtn').addEventListener('click', () => {
  setControlsOpen(!$('#controls').classList.contains('open'));
});
$('#closeControlsBtn').addEventListener('click', () => setControlsOpen(false));
$('#controlsScrim').addEventListener('click', () => setControlsOpen(false));

// Mode B transport
$('#clockToggle').addEventListener('click', () => {
  clock.toggle();
  $('#clockToggle').textContent = clock.isRunning() ? 'Pause' : 'Play';
});

// ---- Tap to Sync ----
// The prompt covers the caption area, so the target is the whole screen.
let tapCue = null;

function showTapPrompt() {
  tapCue = null;
  $('#tapPrompt').hidden = false;
}

function hideTapPrompt() {
  $('#tapPrompt').hidden = true;
  tapCue = null;
}

$('#tapPrompt').addEventListener('click', () => {
  const now = timeSource.getTimeMs();
  const cue = tapCue || engine.activeCue(now) || engine.upcomingCue(now);
  if (!cue) return;
  engine.syncCueToNow(cue, now);
  persistSync();
  updateOffsetReadout();
  hideTapPrompt();
});

$('#reSyncBtn').addEventListener('click', () => {
  setControlsOpen(false);
  showTapPrompt();
});

// ---- Two-point sync ----
$('#ptABtn').addEventListener('click', () => {
  const now = timeSource.getTimeMs();
  const cue = engine.activeCue(now) || engine.upcomingCue(now);
  twoPt.a = { cue, actual: now };
  $('#twoPtInfo').textContent = `Point A set on: "${clip(cue.text)}"`;
});
$('#ptBBtn').addEventListener('click', () => {
  const now = timeSource.getTimeMs();
  const cue = engine.activeCue(now) || engine.upcomingCue(now);
  twoPt.b = { cue, actual: now };
  $('#twoPtInfo').textContent = `Point B set on: "${clip(cue.text)}"`;
});
$('#applyTwoPt').addEventListener('click', () => {
  if (!twoPt.a || !twoPt.b) {
    $('#twoPtInfo').textContent = 'Set both point A and point B first.';
    return;
  }
  const ok = engine.twoPointSync(twoPt.a.cue, twoPt.a.actual, twoPt.b.cue, twoPt.b.actual);
  if (!ok) { $('#twoPtInfo').textContent = 'Pick two different lines.'; return; }
  persistSync();
  updateOffsetReadout();
  $('#twoPtInfo').textContent = 'Two-point sync applied.';
});

// ---- Nudge ----
const nudge = (ms) => { engine.nudge(ms); persistSync(); updateOffsetReadout(); };
$('#nudgeMinus1').addEventListener('click', () => nudge(-1000));
$('#nudgeMinusS').addEventListener('click', () => nudge(-100));
$('#nudgePlusS').addEventListener('click', () => nudge(100));
$('#nudgePlus1').addEventListener('click', () => nudge(1000));
$('#resetSyncBtn').addEventListener('click', () => { engine.reset(); persistSync(); updateOffsetReadout(); });

// Keyboard: arrows nudge, space pauses the clock, Escape closes the drawer.
document.addEventListener('keydown', (e) => {
  if ($('#stage').hidden) return;
  if (e.key === 'Escape') setControlsOpen(false);
  else if (e.key === 'ArrowLeft') nudge(-100);
  else if (e.key === 'ArrowRight') nudge(100);
  else if (e.key === ' ') { e.preventDefault(); $('#clockToggle').click(); }
});

function persistSync() {
  if (activeSrt < 0) return;
  saveSync(syncKeyFor(srtFiles[activeSrt]), { offsetMs: engine.offsetMs, scale: engine.scale });
}
function updateOffsetReadout() {
  $('#offsetReadout').textContent = `offset ${formatMs(engine.offsetMs)} · scale ${engine.scale.toFixed(4)}`;
}

// ---- Settings controls ----
function syncSettingsToControls() {
  $('#targetLang').value = settings.targetLang;
  $('#sourceLang').value = settings.sourceLang;
  $('#showBoth').checked = settings.showBoth;
  $('#fontScale').value = settings.fontScale;
  $('#bgOpacity').value = settings.bgOpacity;
  $('#capBright').value = settings.capBright;
  $('#endpoint').value = settings.endpoint;
  updateTranslateHint();
  applyDisplayVars();
}

$('#targetLang').addEventListener('change', (e) => { settings.targetLang = e.target.value; saveSettings(settings); });
$('#sourceLang').addEventListener('change', (e) => { settings.sourceLang = e.target.value; saveSettings(settings); });
$('#showBoth').addEventListener('change', (e) => { settings.showBoth = e.target.checked; saveSettings(settings); });
$('#fontScale').addEventListener('input', (e) => { settings.fontScale = Number(e.target.value); applyDisplayVars(); saveSettings(settings); });
$('#bgOpacity').addEventListener('input', (e) => { settings.bgOpacity = Number(e.target.value); applyDisplayVars(); saveSettings(settings); });
$('#capBright').addEventListener('input', (e) => { settings.capBright = Number(e.target.value); applyDisplayVars(); saveSettings(settings); });

function applyDisplayVars() {
  document.documentElement.style.setProperty('--cap-scale', settings.fontScale);
  document.documentElement.style.setProperty('--cap-bg', settings.bgOpacity);
  document.documentElement.style.setProperty('--cap-bright', settings.capBright);
}

// ---- Translation ----
$('#translateBtn').addEventListener('click', async () => {
  if (activeSrt < 0) return;
  const tgt = $('#targetLang').value;
  if (tgt === 'off') { setControlMsg('Pick a language under “Translate to” first.'); return; }
  const src = $('#sourceLang').value;
  if (src === tgt) {
    setControlMsg('The file is already in that language — nothing to translate.');
    return;
  }
  const f = srtFiles[activeSrt];

  if (translateAbort) translateAbort.abort();
  translateAbort = new AbortController();
  $('#translateBtn').disabled = true;
  $('#translateProgress').hidden = false;

  const langLabel = tgt === 'si' ? 'Sinhala' : 'English';
  try {
    const { failed } = await translateCues(f.cues, {
      src, tgt,
      endpoint: settings.endpoint,
      signal: translateAbort.signal,
      onProgress: (done, total, fail) => {
        $('#translateBar').style.width = `${Math.round((done / total) * 100)}%`;
        $('#translateCount').textContent = `${done}/${total}${fail ? ` · ${fail} failed` : ''}`;
      },
    });
    setControlMsg(
      failed
        ? `Translated to ${langLabel} with ${failed} lines skipped. Tap Translate again to fill the gaps — finished lines are cached.`
        : `Translated every line to ${langLabel}. Cached for offline use.`
    );
  } catch (err) {
    setControlMsg(
      err.message === 'signin' || err.message === 'signin-unavailable'
        ? 'Groq translation needs Google sign-in: go Back, sign in at the top right, then translate again. Or switch “Translated by” to MyMemory.'
        : AUTO_ERRORS[err.message]
          ? `Translation stopped. ${AUTO_ERRORS[err.message]} Finished lines are kept.`
          : `Translation failed: ${err.message}`
    );
  } finally {
    $('#translateBtn').disabled = false;
  }
});

$('#endpoint').addEventListener('change', (e) => {
  settings.endpoint = e.target.value;
  saveSettings(settings);
  updateTranslateHint();
});

function updateTranslateHint() {
  const needsSignIn = providerNeedsSignIn(settings.endpoint);
  $('#translateHint').textContent = needsSignIn && !signedIn()
    ? 'Groq translation needs Google sign-in (Back, then Sign in at the top right).'
    : needsSignIn
      ? 'Translated in batches, so a full film takes a couple of minutes. Done once, then cached offline.'
      : 'Free but rate-limited: a full film will exceed the daily quota. Fine for short files.';
}

function setControlMsg(msg) { $('#twoPtInfo').textContent = msg; }

// ---- Experimental auto-sync ----
$('#autoSyncBtn').addEventListener('click', async () => {
  $('#autoSyncBtn').disabled = true;
  $('#autoSyncBtn').textContent = 'Listening…';
  try {
    const res = await attemptAutoSync(
      engine.cues,
      () => timeSource.getTimeMs(),
      { lang: langTag(settings.sourceLang) }
    );
    if (res) {
      engine.syncCueToNow(res.matchedCue, res.listenedAtMs);
      persistSync();
      updateOffsetReadout();
      setControlMsg(`Matched "${clip(res.matchedCue.text)}" (${Math.round(res.confidence * 100)}%). Fine-tune with the nudge buttons.`);
    } else {
      setControlMsg("Couldn't match the audio — use Tap to Sync instead.");
    }
  } catch {
    setControlMsg('Speech recognition failed on this device. Use Tap to Sync.');
  } finally {
    $('#autoSyncBtn').disabled = false;
    $('#autoSyncBtn').textContent = 'Auto-sync (experimental)';
  }
});

// ---- render loop ----
function renderLoop() {
  if ($('#stage').hidden) return;

  const t = timeSource.getTimeMs();
  const cue = engine.activeCue(t);

  const capO = $('#captionOriginal');
  const capT = $('#captionTranslated');

  if (!cue) {
    capO.textContent = '';
    capT.textContent = '';
    $('#captionWrap').classList.remove('live');
  } else {
    $('#captionWrap').classList.add('live');
    const tgt = settings.targetLang;
    const translated = cue.translated;

    // The primary (large) line always goes in capT; capO is the small line
    // used only when showing both.
    if (tgt === 'off') {
      capT.textContent = cue.text;
      capO.textContent = '';
    } else if (settings.showBoth) {
      capT.textContent = translated || cue.text;
      capO.textContent = translated ? cue.text : '';
    } else {
      capT.textContent = translated || cue.text;
      capO.textContent = '';
    }
  }

  // While the tap prompt is up it owns the caption area, and the line it
  // names is frozen — a target that changed under your finger would be
  // impossible to hit.
  if (!$('#tapPrompt').hidden) {
    if (!tapCue) tapCue = engine.activeCue(t) || engine.upcomingCue(t);
    $('#tapPromptLine').textContent = tapCue ? clip(tapCue.text, 90) : '—';
    capO.textContent = '';
    capT.textContent = '';
  }

  $('#clockTime').textContent = formatMs(t);

  requestAnimationFrame(renderLoop);
}

// ---- helpers ----
function clip(s, n = 42) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function langTag(code) {
  return { en: 'en-US', hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', zh: 'zh-CN' }[code] || 'en-US';
}

// ---- wake lock ----
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* not supported / denied — non-fatal */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#stage').hidden) requestWakeLock();
});

// ---- init ----
syncSettingsToControls();
applyDisplayVars();
refreshStartState();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
