const {invoke} = window.__TAURI__.core;
const {listen} = window.__TAURI__.event;
const $ = id => document.getElementById(id);
let settings;
let queue = Promise.resolve();
const disposers = [];

function report(error) {
  console.error('Desktop control operation failed:', error);
  $('status').classList.add('error');
  $('status').textContent = '操作未完成：' + String(error);
}

function render(next) {
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
  $('paused').textContent = settings.paused ? '继续 ▷' : '暂停 Ⅱ';
  $('visible').textContent = settings.visible ? '隐藏蜘蛛' : '显示蜘蛛';
  $('allowCrossScreen').setAttribute('aria-pressed', String(settings.allowCrossScreen));
  $('status').classList.remove('error');
  $('status').textContent = !settings.visible ? '蜘蛛已隐藏，可随时重新显示。'
    : settings.paused ? '已暂停，继续后恢复活动和点击互动。'
    : '⌘ Command + 单击冲刺前往，鼠标可正常操作其他应用。';
}

function send(type, value) {
  // Serialize IPC so rapid slider changes cannot arrive out of order.
  queue = queue.then(() => invoke('update_settings', {command: {type, value}})).then(render).catch(report);
  return queue;
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
for (const key of ['paused', 'visible', 'allowCrossScreen']) {
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
