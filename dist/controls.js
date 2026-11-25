import {desktopStrings, localizeDesktop} from './desktop-i18n.js';

const {invoke} = window.__TAURI__.core;
const {listen} = window.__TAURI__.event;
const $ = id => document.getElementById(id);
const DEFAULT_PICKER_COLOR = '#243448';
let settings;
let strings = desktopStrings();
let queue = Promise.resolve();
let pendingColor = undefined;
let flushingColor = false;
const disposers = [];

function report(error) {
  console.error('Desktop control operation failed:', error);
  $('status').classList.add('error');
  $('status').textContent = strings.operationFailed + String(error);
}

const PRESET_LABELS = {
  'black-widow': 'presetBlackWidow',
  redknee: 'presetRedknee',
  peacock: 'presetPeacock',
  wandering: 'presetWandering',
  'funnel-web': 'presetFunnelWeb',
  wolf: 'presetWolf',
  'golden-orb': 'presetGoldenOrb',
  goliath: 'presetGoliath',
  huntsman: 'presetHuntsman',
  crab: 'presetCrab',
};

function renderColor(color, preset = null) {
  const activePreset = typeof preset === 'string' && PRESET_LABELS[preset] ? preset : null;
  const normalized = !activePreset && typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
  $('colorValue').textContent = activePreset
    ? strings[PRESET_LABELS[activePreset]]
    : normalized ? normalized.toUpperCase() : strings.colorDefault;
  $('resetColor').disabled = !normalized && !activePreset;
  if (document.activeElement !== $('colorPicker')) {
    $('colorPicker').value = normalized ?? DEFAULT_PICKER_COLOR;
  }
  document.querySelectorAll('[data-color]').forEach(button => {
    const selected = normalized === button.dataset.color.toLowerCase();
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelectorAll('[data-preset]').forEach(button => {
    const selected = activePreset === button.dataset.preset;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function render(next) {
  if (!settings || settings.language !== next.language || settings.platform !== next.platform) {
    strings = localizeDesktop(document, next.language, next.platform);
    $('colorPicker').parentElement.title = strings.customColor;
  }
  settings = next;
  document.body.classList.toggle('dark', settings.dark);
  document.querySelectorAll('[data-mode]').forEach(button => {
    const selected = button.dataset.mode === settings.mode;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  for (const key of ['speed', 'size']) {
    if (document.activeElement !== $(key)) $(key).value = settings[key];
    $(key + 'Value').textContent = Number($(key).value).toFixed(2) + '×';
  }
  renderColor(settings.color ?? null, settings.preset ?? null);
  $('paused').textContent = settings.paused ? strings.resume : strings.pause;
  $('visible').textContent = settings.visible ? strings.hide : strings.show;
  const isWindows = settings.platform === 'windows';
  $('allowCrossScreen').setAttribute('aria-pressed', String(settings.allowCrossScreen));
  $('avoidPointer').hidden = !isWindows;
  $('avoidPointer').setAttribute('aria-pressed', String(!!settings.avoidPointer));
  $('autoStart').hidden = !isWindows;
  $('autoStart').setAttribute('aria-pressed', String(!!settings.autoStart));
  $('status').classList.remove('error');
  $('status').textContent = !settings.visible ? strings.hiddenStatus
    : settings.paused ? strings.pausedStatus : strings.readyStatus;
}

function send(type, value) {
  // Serialize IPC so rapid slider changes cannot arrive out of order.
  queue = queue.then(() => invoke('update_settings', {command: {type, value}})).then(render).catch(report);
  return queue;
}

function sendColor(color) {
  pendingColor = color;
  renderColor(color);
  if (flushingColor) return;
  flushingColor = true;
  const flush = () => {
    const value = pendingColor;
    pendingColor = undefined;
    send('color', value).finally(() => {
      if (pendingColor !== undefined) flush();
      else flushingColor = false;
    });
  };
  flush();
}

document.querySelectorAll('[data-mode]').forEach(button => {
  button.addEventListener('click', () => send('mode', button.dataset.mode));
});
for (const key of ['speed', 'size']) {
  $(key).addEventListener('input', () => {
    $(key + 'Value').textContent = Number($(key).value).toFixed(2) + '×';
    send(key, Number($(key).value));
  });
}
document.querySelectorAll('[data-color]').forEach(button => {
  button.addEventListener('click', () => sendColor(button.dataset.color));
});
document.querySelectorAll('[data-preset]').forEach(button => {
  button.addEventListener('click', () => {
    pendingColor = undefined;
    renderColor(null, button.dataset.preset);
    send('preset', button.dataset.preset);
  });
});
$('colorPicker').addEventListener('input', event => {
  sendColor(event.target.value);
});
$('resetColor').addEventListener('click', () => {
  sendColor(null);
});
for (const key of ['paused', 'visible', 'allowCrossScreen', 'avoidPointer', 'autoStart']) {
  $(key).addEventListener('click', () => send(key, !settings[key]));
}
window.addEventListener('keydown', event => {
  if (event.code === 'Space' && !['INPUT', 'BUTTON'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    send('paused', !settings.paused);
  }
});
window.addEventListener('pagehide', () => disposers.forEach(dispose => dispose()), {once: true});

try {
  disposers.push(await listen('pet-settings', event => render(event.payload)));
  disposers.push(await listen('desktop-error', event => report(event.payload)));
  render(await invoke('get_settings'));
  $('settings').disabled = false;
} catch (error) {
  report(error);
}
