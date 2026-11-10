// Settings → "Sync between devices" card. Three states: not configured → connect form; configured but signed out →
// sign-in form; signed in → status, Sync now, auto-sync switch, sign out. See docs/SYNC.md and docs/SYNC-SETUP.md.
import { state, replace, save } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { esc } from '../core/format.js';
import { on, emit } from '../core/bus.js';
import { createSyncConfig, effectiveConnection, isSignedIn } from '../services/sync/config.js';
import { createSyncService } from '../services/sync/index.js';
import { DEFAULT_SYNC } from '../services/sync/defaults.js';
import { buildSetupLink } from '../services/sync/setup-link.js';
import { shareText } from '../services/share.js';

let svc, cfg, applying = false;

const ago = ms => {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

function render(st = svc.status()) {
  const box = $('#syncBox'); if (!box) return;
  const hasDefault = effectiveConnection({}, DEFAULT_SYNC).source === 'default';
  const c = cfg.get(), conn = effectiveConnection(c, DEFAULT_SYNC);
  if (conn.source === 'none') {
    box.innerHTML = `<p class="muted" style="margin-top:0">Keep your diary in step across your phone and PC. Needs a free Supabase project — see <b>docs/SYNC-SETUP.md</b> in the project. Until then, Backup/Restore below still works.</p>
      <label for="syncUrl">Project URL</label><input id="syncUrl" placeholder="https://abcd1234.supabase.co" autocapitalize="off" autocomplete="off" value="${esc(c.url || '')}">
      <label for="syncKey">Anon public key</label><input id="syncKey" placeholder="eyJ…" autocapitalize="off" autocomplete="off" value="${esc(c.anonKey || '')}">
      <button class="primary" style="width:100%;margin-top:10px" data-act="connect">Connect</button>${hasDefault ? `<button class="ghost" data-act="usedefault" style="width:100%">Use the built-in server instead</button>` : ''}<p class="muted" id="syncMsg"></p>`;
  } else if (!isSignedIn(c)) {
    box.innerHTML = `<p class="muted" style="margin-top:0">${conn.source === 'default' ? 'Sign in (or create your account the first time) to sync this diary.' : `Connected to <b>${esc(conn.url)}</b>. Sign in (or create your account the first time).`}</p>
      <label for="syncEmail">Email</label><input id="syncEmail" type="email" autocomplete="email" autocapitalize="off" value="${esc(c.email || '')}">
      <label for="syncPass">Password</label><input id="syncPass" type="password" autocomplete="current-password">
      <div class="row" style="margin-top:10px"><button class="primary" data-act="signin">Sign in</button><button data-act="signup">Create account</button></div>
      <button class="ghost" data-act="reconfigure" style="width:100%">${conn.source === 'default' ? 'Advanced: use my own project' : 'Change server'}</button><p class="muted" id="syncMsg">${esc(st.error || '')}</p>`;
  } else {
    const label = st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Last sync failed' : `Last synced ${ago(st.lastSyncAt)}`;
    box.innerHTML = `<p style="margin:0 0 4px"><b>${esc(st.email)}</b></p><p class="muted" id="syncMsg" style="margin:0 0 10px">${esc(label)}${st.error ? ' — ' + esc(st.error) : ''}</p>
      <div class="row"><button class="primary" data-act="sync" ${st.state === 'syncing' ? 'disabled' : ''}>Sync now</button><button data-act="signout">Sign out</button></div>
      <div class="chk"><input type="checkbox" id="syncAuto" ${st.auto ? 'checked' : ''}><label for="syncAuto" style="margin:0;color:inherit">Sync automatically after changes</label></div>
      ${addDeviceHtml(conn)}`;
  }
}

/** "Add another device": a link with the project URL and key (never a password or sign-in) that pre-fills Sync on a second device. */
function addDeviceHtml(conn) {
  if (conn.source === 'default') return `<h3 style="margin:14px 0 4px">Add another device</h3><p class="muted" style="margin:0">Open Macro Diary on the other device, then sign in with the same email and password.</p>`;
  const setupLink = buildSetupLink(location.href, conn);
  if (!setupLink) return '';
  return `<h3 style="margin:14px 0 4px">Add another device</h3>
    <p class="muted" style="margin:0 0 6px">Open this link on your other device to fill in the server settings. The link holds the project URL and key only — never your password or sign-in. Then sign in there with the same email and password.</p>
    <input id="syncLink" readonly value="${esc(setupLink)}" onfocus="this.select()"><button data-act="copylink" style="width:100%;margin-top:6px">Copy / share link</button>`;
}

/** Used by main.js for a setup link opened on this device (it decides apply/confirm/ignore first). */
export async function applySyncSetup(patch) {
  if (isSignedIn(cfg.get())) { try { await svc.signOut(); } catch { /* best effort */ } }
  cfg.set({ ...patch, session: null, meta: null });   // a different project: forget the old session and bookkeeping
  render();
}
export const syncConfig = () => cfg;

export function initSync() {
  cfg = createSyncConfig(globalThis.localStorage);
  svc = createSyncService({
    config: cfg, getState: () => state, onStatus: render,
    // a sync that received data refreshes every screen (the `applying` flag stops those refreshes re-triggering a sync)
    applyState: next => { applying = true; replace(next); save(); emit('settings:changed'); emit('diary:changed'); emit('recipes:changed'); emit('plan:changed'); applying = false; },
  });
  // any local change → sync shortly after the user stops editing (changes made by a sync itself don't re-trigger it)
  for (const evt of ['diary:changed', 'recipes:changed', 'plan:changed']) on(evt, () => { if (!applying) svc.schedule(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') svc.schedule(1000); });
  window.addEventListener('online', () => svc.schedule(1000));
  svc.schedule(1500);   // and once shortly after the app opens

  $('#syncBox').addEventListener('click', async ev => {
    const act = ev.target.closest('[data-act]')?.dataset.act; if (!act) return;
    const msg = t => { const m = $('#syncMsg'); if (m) m.textContent = t; };
    try {
      if (act === 'connect') { const err = svc.configure({ url: $('#syncUrl').value, anonKey: $('#syncKey').value }); err ? msg(err) : render(); }
      else if (act === 'reconfigure') { cfg.set({ url: '', anonKey: '', useOwnProject: true }); render(); }
      else if (act === 'usedefault') { cfg.set({ url: '', anonKey: '', useOwnProject: false }); render(); }
      else if (act === 'copylink') { const r = await shareText($('#syncLink').value, 'Macro Diary sync setup'); if (r === 'copied') toast('Link copied'); }
      else if (act === 'signin' || act === 'signup') {
        msg(act === 'signin' ? 'Signing in…' : 'Creating account…');
        await (act === 'signin' ? svc.signIn : svc.signUp)($('#syncEmail').value, $('#syncPass').value);
        toast('Signed in'); render(); svc.syncNow();
      }
      else if (act === 'sync') { const r = await svc.syncNow(); if (r.ok) toast(r.changed ? 'Synced — changes received' : 'Synced'); }
      else if (act === 'signout') { await svc.signOut(); toast('Signed out'); render(); }
    } catch (e) { msg(e && e.message ? e.message : 'Something went wrong'); }
  });
  $('#syncBox').addEventListener('change', ev => { if (ev.target.id === 'syncAuto') svc.setAuto(ev.target.checked); });
  render();
}
