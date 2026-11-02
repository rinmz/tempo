'use strict';

const $ = (id) => document.getElementById(id);
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

const DEFAULTS = {
  enabled: true,
  overlay: true,
  remaining: true,
  silenceSkip: false,
  silenceLevel: 2,
  smartSpeed: false,
  skipSegments: false,
};
const TOGGLES = ['enabled', 'overlay', 'remaining', 'silenceSkip', 'smartSpeed', 'skipSegments'];
const SPONSOR_ORIGINS = { origins: ['https://sponsor.ajay.app/*'] };
// Must match content.js: level 0 → 4×, level 4 → 8×.
const levelSpeed = (level) => Math.round(4 + level);

const prefs = { ...DEFAULTS };
let tabId = null;
let lastState = null;

// ---------------------------------------------------------------------------
// Localization
// ---------------------------------------------------------------------------

document.documentElement.lang = chrome.i18n.getUILanguage();
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
$('version').textContent = `${t('extName')} · ${chrome.runtime.getManifest().version}`;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const format = (s) => `${Number(s.toFixed(2))}×`;

function duration(sec) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return t('durationSec', [String(s)]);
  if (s < 3600) return t('durationMin', [String(Math.floor(s / 60)), String(s % 60)]);
  return t('durationHour', [String(Math.floor(s / 3600)), String(Math.floor((s % 3600) / 60))]);
}

// Fill a message that contains one bold value, without using innerHTML.
function setRich(el, key, value) {
  const [before, after = ''] = t(key, ['\u0001']).split('\u0001');
  const b = document.createElement('b');
  b.textContent = value;
  el.replaceChildren(before, b, after);
}

function support(id, text, active) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('list-item__support--active', !!active);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(state = lastState) {
  lastState = state;
  const available = !!state && state.hasVideo;
  const on = prefs.enabled;
  const active = available && on;

  // Speed
  $('speed').textContent = format(available ? state.speed : 1);
  $('decrease').disabled = !active || state.speed <= state.min;
  $('increase').disabled = !active || state.speed >= state.max;
  $('status').textContent = !on ? t('statusDisabled')
    : !available ? t('statusUnavailable')
      : state.locked ? t('statusLocked') : t('statusNormal');
  $('reset').hidden = !(active && state.locked);

  // Feature lines: say what is happening, not what the switch is.
  if (!prefs.silenceSkip) support('silence-support', t('silenceOff'));
  else if (available && state.silenceAvailable === false) support('silence-support', t('silenceUnavailable'));
  else support('silence-support', t('silenceOn', [`${levelSpeed(prefs.silenceLevel)}×`]), true);

  if (!prefs.smartSpeed) support('smart-support', t('smartOff'));
  else if (!available) support('smart-support', t('featureOn'), true);
  else if (state.smartSource === 'captions') support('smart-support', t('smartFromCaptions', [format(state.playbackRate)]), true);
  else if (state.smartSource === 'audio') support('smart-support', t('smartFromAudio', [format(state.playbackRate)]), true);
  else support('smart-support', t('smartWaiting'), true);

  support('segments-support', prefs.skipSegments ? t('segmentsOn') : t('segmentsOff'), prefs.skipSegments);

  // Time saved
  const media = available ? state.watchedMedia || 0 : 0;
  const real = available ? state.watchedReal || 0 : 0;
  const saved = Math.max(0, media - real);
  if (media < 10) {
    $('saved-headline').textContent = t('statsEmpty');
    $('saved-meter').hidden = true;
    $('saved-detail').textContent = '';
  } else {
    setRich($('saved-headline'), 'statsSaved', duration(saved));
    $('saved-meter').hidden = false;
    $('saved-fill').style.width = `${Math.min(100, (saved / media) * 100)}%`;
    const extra = saved - media / 2; // compared with watching at a constant 2×
    $('saved-detail').textContent = extra >= 1
      ? t('statsAhead', [duration(extra)])
      : t('statsWatched', [duration(media)]);
  }
}

function renderPrefs() {
  for (const key of TOGGLES) $(key).checked = !!prefs[key];
  $('silence-extra').hidden = !prefs.silenceSkip;
  renderLevel(prefs.silenceLevel);
  render();
}

function renderLevel(level) {
  const slider = $('silenceLevel');
  slider.value = String(level);
  slider.style.setProperty('--pct', `${(level / 4) * 100}%`);
  slider.setAttribute('aria-valuetext', `${levelSpeed(level)}×`);
}

// ---------------------------------------------------------------------------
// Messaging & storage
// ---------------------------------------------------------------------------

function send(message) {
  if (tabId === null) return render(null);
  chrome.tabs.sendMessage(tabId, message, (state) => {
    if (chrome.runtime.lastError) return render(null); // not a YouTube tab
    render(state);
  });
}

function save(key, value) {
  prefs[key] = value;
  renderPrefs();
  chrome.storage.sync.set({ [key]: value });
  setTimeout(() => send({ type: 'get' }), 50);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

$('decrease').addEventListener('click', () => send({ type: 'step', dir: -1 }));
$('increase').addEventListener('click', () => send({ type: 'step', dir: 1 }));
$('reset').addEventListener('click', () => send({ type: 'reset' }));

for (const key of TOGGLES) {
  if (key === 'skipSegments') continue;
  $(key).addEventListener('change', (e) => save(key, e.target.checked));
}

// Sponsor skipping needs access to SponsorBlock; ask only when it is turned on.
$('skipSegments').addEventListener('change', (e) => {
  if (!e.target.checked) return save('skipSegments', false);
  save('skipSegments', true);
  chrome.permissions.request(SPONSOR_ORIGINS, (granted) => {
    if (!granted) save('skipSegments', false);
  });
});

$('silenceLevel').addEventListener('input', (e) => {
  renderLevel(Number(e.target.value));
  support('silence-support', t('silenceOn', [`${levelSpeed(Number(e.target.value))}×`]), true);
});
$('silenceLevel').addEventListener('change', (e) => save('silenceLevel', Number(e.target.value)));

function showView(name, byKeyboard) {
  $('view-main').hidden = name !== 'main';
  $('view-settings').hidden = name !== 'settings';
  // Move focus only for keyboard users, so mouse clicks don't leave a focus ring.
  if (byKeyboard) (name === 'main' ? $('open-settings') : $('close-settings')).focus();
}
$('open-settings').addEventListener('click', (e) => showView('settings', e.detail === 0));
$('close-settings').addEventListener('click', (e) => showView('main', e.detail === 0));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

chrome.storage.sync.get(DEFAULTS, async (stored) => {
  Object.assign(prefs, stored);
  if (prefs.skipSegments && !(await chrome.permissions.contains(SPONSOR_ORIGINS))) {
    prefs.skipSegments = false;
    chrome.storage.sync.set({ skipSegments: false });
  }
  renderPrefs();
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    tabId = tab ? tab.id : null;
    send({ type: 'get' });
    setInterval(() => send({ type: 'get' }), 1000);
  });
});
