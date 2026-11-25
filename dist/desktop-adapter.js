// Drive the original UI so the desktop pet uses its exact behavior and side effects.
export function applySettings(page, spider, settings) {
  const click = id => page.getElementById(id).click();
  if (spider.state.mode !== settings.mode) {
    page.querySelector(`[data-mode="${settings.mode}"]`).click();
  }
  for (const key of ['speed', 'size']) {
    if (spider.state[key] !== settings[key]) {
      const input = page.getElementById(key);
      input.value = String(settings[key]);
      input.dispatchEvent(new page.defaultView.Event('input', {bubbles: true}));
    }
  }
  if (spider.state.feet !== settings.feet) click('feet');
  if (spider.state.dark !== settings.dark) click('theme');
  if (spider.appearance?.setAppearance) {
    spider.appearance.setAppearance(settings.color ?? null, settings.preset ?? null);
  } else if (spider.appearance?.setColor) {
    spider.appearance.setColor(settings.color ?? null);
  }
  const paused = settings.paused || !settings.visible;
  if (spider.state.paused !== paused) click('pause');
}
