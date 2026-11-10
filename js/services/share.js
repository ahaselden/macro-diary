// Sharing: text via Web Share / clipboard, and a PNG card for a day (browser only).
import { MEALS } from '../core/constants.js';
import { rd } from '../core/format.js';
import { pretty } from '../core/dates.js';
import { totals, entryMacros } from '../domain/nutrition.js';

/** Returns 'shared' | 'copied' | 'manual' | 'cancelled' (UI toasts 'Copied to clipboard' on 'copied'). */
export async function shareText(text, title) {
  try { if (navigator.share) { await navigator.share({ title, text }); return 'shared'; } } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { prompt('Copy this:', text); return 'manual'; }
}

/** PNG card for one day. colors = {bg, fg, mu, ln} resolved by the caller. */
export function dayImage(state, day, colors) {
  const list = state.days[day] || [], t = totals(list), W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const { bg, fg, mu, ln } = colors;
  x.fillStyle = bg; x.fillRect(0,0,W,H); x.fillStyle = fg; x.textBaseline = 'alphabetic';
  x.font = '600 44px system-ui,sans-serif'; x.fillText(pretty(day), 60, 100);
  x.font = '700 150px system-ui,sans-serif'; x.fillText(String(rd(t.k)), 60, 280);
  x.fillStyle = mu; x.font = '40px system-ui,sans-serif'; x.fillText(`of ${state.goals.k} kcal`, 60, 335);
  const bars = [['Protein','p','#3b82f6'],['Carbs','c','#f59e0b'],['Fat','f','#ef4444']];
  bars.forEach(([n,k,col],i) => { const bx = 60 + i*320, w = 280;
    x.fillStyle = mu; x.font = '32px system-ui,sans-serif'; x.fillText(n, bx, 420);
    x.fillStyle = fg; x.font = '600 40px system-ui,sans-serif'; x.fillText(`${rd(t[k])} / ${state.goals[k]}g`, bx, 470);
    x.fillStyle = ln; x.fillRect(bx, 490, w, 14); x.fillStyle = col; x.fillRect(bx, 490, w * Math.min(1, t[k]/(state.goals[k]||1)), 14); });
  let y = 600;
  MEALS.forEach(m => { const es = list.filter(e => e.meal === m); if (!es.length || y > H - 120) return;
    x.fillStyle = fg; x.font = '600 38px system-ui,sans-serif'; x.fillText(`${m} · ${rd(es.reduce((a,e) => a + entryMacros(e).k, 0))} kcal`, 60, y); y += 16;
    es.forEach(e => { if (y > H - 120) return; y += 46; x.fillStyle = mu; x.font = '32px system-ui,sans-serif';
      let nm = e.name; while (x.measureText(nm).width > 760 && nm.length > 4) nm = nm.slice(0,-2); if (nm !== e.name) nm += '…';
      x.fillText(nm, 60, y); const k = `${rd(entryMacros(e).k)}`; x.fillText(k, W - 60 - x.measureText(k).width, y); });
    y += 56; });
  x.fillStyle = mu; x.font = '28px system-ui,sans-serif'; x.fillText('Macro Diary', 60, H - 50);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
