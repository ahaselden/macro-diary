// Google Health sync, the network part (backlog item 20, step 2; spec docs/specs/google-health-sync.md, D62).
// Browser-only sign-in with Google Identity Services (a 1-hour access token, no client secret, no refresh token), then two reads from health.googleapis.com.
// The token lives only inside run(): never stored, never put in a message, a URL or a console. Every message below is fixed text; nothing from Google's
// answers is copied into one. Storage, fetch, the Google script and the clock are injected so tests can fake them.
import { SYNC_DAYS, buildDailyRollUpBody, buildSleepUrl, parseHealthAnswers, checkClientId } from '../domain/google-health-api.js';

export const GIS_URL = 'https://accounts.google.com/gsi/client';
export const SCOPE = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly';
export const CLIENT_ID_KEY = 'macrodiary.googleclient.v1';
const BASE = 'https://health.googleapis.com/v4/users/me';
const MAX_SLEEP_PAGES = 4;

const M = {
  noSave: 'Could not save the Client ID on this device.',
  busy: 'A sync is already running.',
  script: 'Could not load Google sign-in. Check your connection and try again.',
  denied: 'Google did not allow access. While the app is in test mode, only accounts added as test users can sign in.',
  closed: 'The Google sign-in window was closed before it finished. Tap Sync Google Health to try again.',
  blocked: 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  origin: 'Google does not accept this web address for your Client ID. Add it under Authorized JavaScript origins in the Google Cloud console.',
  failed: 'Google sign-in failed.',
  noToken: 'Google sign-in did not return an access token.',
  notLinked: 'This Google account is not linked in the Google Health app yet. Open the app on your phone, sign in, then try again.',
  s401: 'Google rejected the sign-in. Tap Sync Google Health to sign in again.',
  s403: 'Google refused access to your health data. Check that both Health permissions were ticked on the consent screen and the Google Health API is enabled.',
  s429: 'Google says there were too many requests. Wait a minute and try again.',
  network: 'Could not reach Google. Check your connection and try again.',
  unreadable: 'Google Health sent an answer this app could not read.',
};
const http = n => `Google Health answered with an error (HTTP ${n}). Try again later.`;
const OBJ = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');

/** The Client ID on THIS device only (its own localStorage key, outside the saved diary data, so it is in no backup and no sync record). */
export function createClientIdStore(storage) {
  return {
    get() {
      try {
        const v = storage && storage.getItem(CLIENT_ID_KEY);
        const r = typeof v === 'string' ? checkClientId(v) : null;
        return r && r.ok ? r.id : '';
      } catch { return ''; }
    },
    set(text) {
      const r = checkClientId(text);
      if (!r.ok) return r;
      try {
        if (!storage) return { ok: false, message: M.noSave };
        storage.setItem(CLIENT_ID_KEY, r.id);
        return { ok: true, id: r.id };
      } catch { return { ok: false, message: M.noSave }; }
    },
    clear() {
      try {
        if (!storage) return;
        if (typeof storage.removeItem === 'function') storage.removeItem(CLIENT_ID_KEY);
        else storage.setItem(CLIENT_ID_KEY, '');
      } catch { /* nothing to clear */ }
    },
  };
}

/** Adds Google's sign-in script once and resolves with the global `google` object. */
function defaultLoadGoogle() {
  return new Promise((resolve, reject) => {
    const have = () => globalThis.google && globalThis.google.accounts && globalThis.google.accounts.oauth2;
    if (have()) { resolve(globalThis.google); return; }
    const s = document.createElement('script');
    s.src = GIS_URL; s.async = true;
    s.onload = () => resolve(globalThis.google);
    s.onerror = () => reject(new Error('script'));
    document.head.appendChild(s);
  });
}

const mentions = (word, ...values) => values.some(v => str(v).includes(word));

/** The fixed message for a token response (callback) that carries an `error`, or '' when it does not. */
function responseMessage(resp) {
  if (!OBJ(resp)) return M.noToken;
  if (!resp.error) return typeof resp.access_token === 'string' && resp.access_token ? '' : M.noToken;
  const err = str(resp.error);
  if (mentions('origin_mismatch', resp.error, resp.error_description)) return M.origin;
  if (err === 'access_denied') return M.denied;
  if (err === 'popup_closed') return M.closed;
  return /^[a-z_]{1,40}$/.test(err) ? `Google sign-in failed (${err}).` : M.failed;
}

/** The fixed message for the error_callback of the token client (the popup did not finish). */
function popupMessage(err) {
  const type = OBJ(err) ? str(err.type) : '';
  if (type === 'popup_closed') return M.closed;
  if (type === 'popup_failed_to_open') return M.blocked;
  if (OBJ(err) && mentions('origin_mismatch', err.type, err.message, err.error)) return M.origin;
  return M.failed;
}

/** Signs in and resolves { token } or { message }. */
function signIn(google, clientId) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: resp => { const m = responseMessage(resp); finish(m ? { message: m } : { token: resp.access_token }); },
        error_callback: err => finish({ message: popupMessage(err) }),
      });
      client.requestAccessToken();
    } catch { finish({ message: M.failed }); }
  });
}

/** One request; resolves { json } or { message }. */
async function call(fetchFn, url, init, token) {
  let res;
  try {
    res = await fetchFn(url, { ...init, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  } catch { return { message: M.network }; }
  let body = null, text = '';
  try { text = await res.text(); } catch { text = ''; }
  try { body = JSON.parse(text); } catch { body = undefined; }
  if (res.ok) return body === undefined ? { message: M.unreadable } : { json: body };
  const details = OBJ(body) && OBJ(body.error) && Array.isArray(body.error.details) ? body.error.details : [];
  if (details.some(d => OBJ(d) && d.reason === 'ACCOUNT_NOT_LINKED')) return { message: M.notLinked };
  if (res.status === 401) return { message: M.s401 };
  if (res.status === 403) return { message: M.s403 };
  if (res.status === 429) return { message: M.s429 };
  return { message: http(res.status) };
}

/**
 * createHealthSync({ fetch, loadGoogle, now }).run(clientId) -> { ok: true, days } | { ok: false, message } | { ok: false, busy: true, message }.
 * Never rejects. One run at a time. ALL-OR-NOTHING: the first failure ends the run and returns no days.
 */
export function createHealthSync({ fetch: fetchFn = (...a) => globalThis.fetch(...a), loadGoogle = defaultLoadGoogle, now = () => new Date() } = {}) {
  let running = false;
  return {
    async run(clientId) {
      const id = checkClientId(clientId);
      if (!id.ok) return { ok: false, message: id.message };
      if (running) return { ok: false, busy: true, message: M.busy };
      running = true;
      try {
        let google;
        try { google = await loadGoogle(); } catch { google = null; }
        if (!google || !google.accounts || !google.accounts.oauth2 || typeof google.accounts.oauth2.initTokenClient !== 'function') return { ok: false, message: M.script };
        const t = await signIn(google, id.id);
        if (t.message) return { ok: false, message: t.message };
        const today = now();
        const steps = await call(fetchFn, `${BASE}/dataTypes/steps/dataPoints:dailyRollUp`, { method: 'POST', body: JSON.stringify(buildDailyRollUpBody(today, SYNC_DAYS)) }, t.token);
        if (steps.message) return { ok: false, message: steps.message };
        const records = [];
        let pageToken = '';
        for (let page = 0; page < MAX_SLEEP_PAGES; page++) {
          const r = await call(fetchFn, buildSleepUrl(today, SYNC_DAYS, pageToken), { method: 'GET' }, t.token);
          if (r.message) return { ok: false, message: r.message };
          if (OBJ(r.json) && Array.isArray(r.json.dataPoints)) records.push(...r.json.dataPoints);
          pageToken = OBJ(r.json) && typeof r.json.nextPageToken === 'string' ? r.json.nextPageToken : '';
          if (!pageToken) break;
        }
        return { ok: true, days: parseHealthAnswers(steps.json, { dataPoints: records }) };
      } catch { return { ok: false, message: M.failed }; }
      finally { running = false; }
    },
  };
}
