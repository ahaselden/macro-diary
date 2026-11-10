// Settings → "Sync between devices" card. Three states: not configured → connect form; configured but signed out →
// sign-in form; signed in → status, Sync now, auto-sync switch, sign out. See docs/SYNC.md and docs/SYNC-SETUP.md.
import { state, replace, save } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { esc } from '../core/format.js';
import { on, emit } from '../core/bus.js';
import { createSyncConfig, isConfigured, isSignedIn } from '../services/sync/config.js';
import { createSyncService } from '../services/sync/index.js';

let svc, cfg, applying = false;

const ago = ms => {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

function render(st = svc.status()) {
  const box = $('#syncBox'); if (!box) return;
  const c = cfg.get();
  if (!isConfigured(c)) {
    box.innerHTML = `<p class="muted" style="margin-top:0">Keep your diary in step across your phone and PC. Needs a free Supabase project — see <b>docs/SYNC-SETUP.md</b> in the project. Until then, Backup/Restore below still works.</p>
      <label for="syncUrl">Project URL</label><input id="syncUrl" placeholder="https://abcd1234.supabase.co" autocapitalize="off" autocomplete="off" value="${esc(c.url || '')}">
      <label for="syncKey">Anon public key</label><input id="syncKey" placeholder="eyJ…" autocapitalize="off" autocomplete="off" value="${esc(c.anonKey || '')}">
      <button class="primary" style="width:100%;margin-top:10px" data-act="connect">Connect</button><p class="muted" id="syncMsg"></p>`;
  } else if (!isSignedIn(c)) {
    box.innerHTML = `<p class="muted" style="margin-top:0">Connected to <b>${esc(c.url)}</b>. Sign in (or create your account the first time).</p>
      <label for="syncEmail">Email</label><input id="syncEmail" type="email" autocomplete="email" autocapitalize="off" value="${esc(c.email || '')}">
      <label for="syncPass">Password</label><input id="syncPass" type="password" autocomplete="current-password">
      <div class="row" style="margin-top:10px"><button class="primary" data-act="signin">Sign in</button><button data-act="signup">Create account</button></div>
      <button class="ghost" data-act="reconfigure" style="width:100%">Change server</button><p class="muted" id="syncMsg">${esc(st.error || '')}</p>`;
  } else {
    const label = st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Last sync failed' : `Last synced ${ago(st.lastSyncAt)}`;
    box.innerHTML = `<p style="margin:0 0 4px"><b>${esc(st.email)}</b></p><p class="muted" id="syncMsg" style="margin:0 0 10px">${esc(label)}${st.error ? ' — ' + esc(st.error) : ''}</p>
      <div class="row"><button class="primary" data-act="sync" ${st.state === 'syncing' ? 'disabled' : ''}>Sync now</button><button data-act="signout">Sign out</button></div>
      <div class="chk"><input type="checkbox" id="syncAuto" ${st.auto ? 'checked' : ''}><label for="syncAuto" style="margin:0;color:inherit">Sync automatically after changes</label></div>`;
  }
}

export function initSync() {
  cfg = createSyncConfig(globalThis.localStorage);
  svc = createSyncService({
    config: cfg, getState: () => state, onStatus: render,
    applyState: next => { applying = true; replace(next); save(); emit('settings:changed'); emit('diary:changed'); applying = false; },
  });
  // any local change → sync shortly after the user stops editing (changes made by a sync itself don't re-trigger it)
  on('diary:changed', () => { if (!applying) svc.schedule(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') svc.schedule(1000); });
  window.addEventListener('online', () => svc.schedule(1000));
  svc.schedule(1500);   // and once shortly after the app opens

  $('#syncBox').addEventListener('click', async ev => {
    const act = ev.target.closest('[data-act]')?.dataset.act; if (!act) return;
    const msg = t => { const m = $('#syncMsg'); if (m) m.textContent = t; };
    try {
      if (act === 'connect') { const err = svc.configure({ url: $('#syncUrl').value, anonKey: $('#syncKey').value }); err ? msg(err) : render(); }
      else if (act === 'reconfigure') { cfg.set({ url: '', anonKey: '' }); render(); }
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
