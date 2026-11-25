// WKWebView / WebView2 may suspend browser frames in a non-activating overlay. Use one
// demand-driven native source instead of racing three schedulers every frame.
export function createDesktopClock(child, requestNativeFrame) {
  let serial = 0, ticket = null, running = true, disposed = false, intervalMs = null;
  const pending = new Map();
  function schedule(once = false) {
    if (disposed || ticket !== null || !pending.size || (!running && !once)) return;
    ticket = ++serial;
    if (intervalMs !== null) requestNativeFrame(ticket, intervalMs);
    else requestNativeFrame(ticket);
  }
  return {
    request(callback) {
      const id = ++serial;
      if (!disposed) { pending.set(id, callback); schedule(); }
      return id;
    },
    cancel(id) { pending.delete(id); },
    tick(id) {
      if (disposed || id !== ticket) return;
      ticket = null;
      const callbacks = [...pending.keys()];
      const now = child.performance.now();
      for (const callbackId of callbacks) {
        const callback = pending.get(callbackId);
        pending.delete(callbackId);
        if (callback) callback(now);
      }
      schedule();
    },
    setIntervalMs(value) { intervalMs = Number.isFinite(value) && value > 0 ? value : null; },
    setRunning(value) { running = value; if (value) schedule(); },
    redraw() { schedule(true); },
    dispose() { disposed = true; ticket = null; pending.clear(); },
  };
}
