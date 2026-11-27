// WKWebView / WebView2 may suspend browser frames in a non-activating overlay. Use one
// demand-driven native source instead of racing three schedulers every frame.
export function createDesktopClock(child, requestNativeFrame) {
  let serial = 0, ticket = null, running = true, disposed = false, intervalMs = null;
  let epoch = 0, systemSuspended = false, deferredRedraw = false;
  const pending = new Map();
  function schedule(once = false) {
    if (disposed) return;
    if (systemSuspended) {
      if (once) deferredRedraw = true;
      return;
    }
    if (ticket !== null || !pending.size || (!running && !once)) return;
    const id = ticket = ++serial;
    const result = requestNativeFrame(id, intervalMs, epoch);
    result?.then?.(accepted => {
      // A rejected request has no matching tick.
      if (accepted === false && ticket === id) ticket = null;
    });
  }
  return {
    request(callback) {
      const id = ++serial;
      if (!disposed) { pending.set(id, callback); schedule(); }
      return id;
    },
    cancel(id) { pending.delete(id); },
    tick(id, frameEpoch = epoch) {
      if (disposed || systemSuspended || id !== ticket || frameEpoch !== epoch) return;
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
    setSystemSuspended(value, nextEpoch = epoch + 1, replayRedraw = true) {
      if (disposed || nextEpoch < epoch) return;
      if (value || nextEpoch !== epoch) {
        if (ticket !== null && !running) deferredRedraw = true;
        ticket = null;
      }
      epoch = nextEpoch;
      systemSuspended = value;
      if (!value) {
        const once = replayRedraw && deferredRedraw;
        deferredRedraw = false;
        schedule(once);
      }
    },
    redraw() { schedule(true); },
    dispose() { disposed = true; ticket = null; pending.clear(); },
  };
}
