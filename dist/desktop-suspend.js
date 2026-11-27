export async function subscribeSystemSuspend(tauri, apply, registerCleanup) {
  let latestEpoch = -1;
  function receive(snapshot) {
    if (snapshot.epoch <= latestEpoch) return;
    latestEpoch = snapshot.epoch;
    apply(snapshot);
  }
  const unlisten = await tauri.event.listen('system-suspend', event => receive(event.payload));
  registerCleanup(unlisten);
  receive(await tauri.core.invoke('get_system_suspend_state'));
}

// New epochs can start work while an old invocation is still returning.
export function createEpochRequest() {
  let active = null;
  return {
    begin(epoch) {
      if (active?.epoch === epoch) return null;
      active = {epoch};
      return active;
    },
    isCurrent(request) { return request === active; },
    finish(request) { if (request === active) active = null; },
  };
}
