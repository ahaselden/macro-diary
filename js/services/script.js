// Loads a same-origin classic <script> once and resolves with the global it defines. Used for vendored libraries
// that are only needed sometimes (ZXing for scanning, Tesseract for label photos), so they cost nothing otherwise.
const pending = new Map();

export function loadScript(src, globalName) {
  if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (pending.has(src)) return pending.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => globalThis[globalName] ? resolve(globalThis[globalName]) : reject(new Error(`${globalName} did not load`));
    s.onerror = () => { pending.delete(src); reject(new Error('Could not load ' + src + ' (offline?)')); };
    document.head.appendChild(s);
  });
  pending.set(src, p);
  return p;
}
