// Screen Wake Lock (keeps the screen on while cooking). The browser objects are passed in so this can be tested with fakes.
// The browser releases the lock whenever the page is hidden, so while it is wanted we ask again when the page becomes visible.
export function createWakeLock(nav, doc) {
  let wanted = false, sentinel = null, state = 'off', pending = false, listening = false;
  const supported = () => !!nav && typeof nav === 'object' && !!nav.wakeLock && typeof nav.wakeLock.request === 'function';
  const releaseQuietly = async s => { try { await s.release(); } catch { /* already released */ } };

  async function request() {
    if (pending) return state;
    pending = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (!wanted) { await releaseQuietly(s); return state; }   // disabled while the request was in flight
      sentinel = s; state = 'on';
      if (s && typeof s.addEventListener === 'function') s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
    } catch { if (wanted) state = 'failed'; }
    finally { pending = false; }
    return state;
  }
  const onVisible = () => { if (wanted && !sentinel && doc && doc.visibilityState === 'visible') request(); };

  return {
    isSupported: supported,
    status: () => state,
    async enable() {
      if (!supported()) { state = 'unsupported'; return state; }
      wanted = true;
      if (!listening && doc && typeof doc.addEventListener === 'function') { doc.addEventListener('visibilitychange', onVisible); listening = true; }
      if (sentinel) return state;
      return request();
    },
    async disable() {
      wanted = false;
      if (listening && doc && typeof doc.removeEventListener === 'function') doc.removeEventListener('visibilitychange', onVisible);
      listening = false;
      const s = sentinel; sentinel = null;
      if (state !== 'unsupported') state = 'off';
      if (s) await releaseQuietly(s);
    },
  };
}
