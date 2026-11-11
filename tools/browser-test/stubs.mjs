// Pure helpers for the headless tester (no Playwright import, no I/O, never throws): what to do with each network request, and the report text.
const str = v => typeof v === 'string';
const SAME_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parse(u) { try { return str(u) && u.length < 100000 ? new URL(u) : null; } catch { return null; } }

/** True only for http(s) URLs whose host is localhost, 127.0.0.1 or [::1]. */
export function isLocalUrl(u) {
  const x = parse(u);
  return !!x && (x.protocol === 'http:' || x.protocol === 'https:') && SAME_HOSTS.has(x.hostname) && !x.username && !x.password;
}

function sameOrigin(url, appOrigin) {
  const a = parse(url), b = parse(appOrigin);
  if (!a || !b || !isLocalUrl(url) || !isLocalUrl(appOrigin)) return false;
  return a.protocol === b.protocol && a.port === b.port;
}

/**
 * What to do with a request: continue (the app's own files), fulfill (a stub), or abort (everything else: a test must never reach the live internet).
 * stubs: [{ match: string (substring of the URL) | RegExp, status?, json?, body?, contentType? }], the first match wins; bad entries are ignored.
 */
export function routeFor(url, opts) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    if (str(url) && /^(data|blob|about):/i.test(url)) return { action: 'continue' };
    if (!parse(url)) return { action: 'abort' };
    if (sameOrigin(url, o.appOrigin)) return { action: 'continue' };            // stubs can never intercept the app itself
    const stubs = Array.isArray(o.stubs) ? o.stubs : [];
    for (let i = 0; i < stubs.length; i++) {
      try {
        const s = stubs[i];
        if (!s || typeof s !== 'object') continue;
        const m = s.match;
        const hit = str(m) ? url.includes(m) : m instanceof RegExp ? m.test(url) : false;
        if (!hit) continue;
        const status = Number.isInteger(s.status) && s.status >= 100 && s.status <= 599 ? s.status : 200;
        if ('json' in s && s.json !== undefined) return { action: 'fulfill', status, contentType: str(s.contentType) ? s.contentType : 'application/json', body: JSON.stringify(s.json) };
        return { action: 'fulfill', status, contentType: str(s.contentType) ? s.contentType : 'text/plain', body: str(s.body) ? s.body : '' };
      } catch { /* a hostile stub: skip it */ }
    }
    return { action: 'abort' };
  } catch { return { action: 'abort' }; }
}

const clip = (t, n) => (str(t) ? t.slice(0, n) : '');

/** results: [{ name, ok, error?, consoleErrors?: string[], screenshot?: string }] -> { passed, failed, ok, text }. */
export function summarize(results) {
  if (!Array.isArray(results) || !results.length) return { passed: 0, failed: 0, ok: false, text: 'No scenarios ran.' };
  let passed = 0, failed = 0;
  const lines = [];
  for (const r of results) {
    const ok = !!r && typeof r === 'object' && r.ok === true;
    const name = r && typeof r === 'object' && str(r.name) && r.name ? r.name : '(unnamed)';
    if (ok) passed++; else failed++;
    lines.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (r && typeof r === 'object') {
      if (!ok && str(r.error) && r.error) lines.push('  error: ' + clip(r.error, 500));
      if (Array.isArray(r.consoleErrors)) for (const c of r.consoleErrors.slice(0, 10)) if (str(c)) lines.push('  console: ' + clip(c, 300));
      if (str(r.screenshot) && r.screenshot) lines.push('  screenshot: ' + r.screenshot);
    }
  }
  lines.push('', `${passed} passed, ${failed} failed`);
  return { passed, failed, ok: failed === 0, text: lines.join('\n') };
}
