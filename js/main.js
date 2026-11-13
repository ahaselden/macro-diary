// Boot + wiring only. Each screen owns its own handlers (initX); screens talk through core/bus.js.
import { store } from './core/store.js';
import { toast } from './core/dom.js';
import { initTabs, showTab } from './ui/tabs.js';
import { initTheme, applyTheme } from './ui/theme.js';
import { initDiary, renderDiary } from './ui/diary.js';
import { initAddFood } from './ui/add-food.js';
import { initExport } from './ui/export-view.js';
import { initSettings } from './ui/settings-view.js';
import { initSync, applySyncSetup, syncConfig } from './ui/sync-view.js';
import { parseSetupLink, planSetupLinkApply } from './services/sync/setup-link.js';
import { DEFAULT_SYNC } from './services/sync/defaults.js';
import { initRecipes } from './ui/recipes-view.js';
import { initRecipeImport } from './ui/recipe-import.js';
import { initPlan } from './ui/plan-view.js';
import { initShop } from './ui/shop-view.js';
import { initHealthImport } from './ui/health-import-view.js';

store.onSaveError = () => toast('Could not save – storage full or blocked');

initTabs();
initTheme();
initDiary();
initAddFood();
initExport();
initSettings();
initSync();
initRecipes();
initRecipeImport();
initPlan();
initShop();
initHealthImport();

// A setup link (#sync-setup=…) pre-fills Settings → Sync with the project URL + key. Always stripped from the address bar.
// An invalid link is ignored; a device already signed in to another project asks first (never switched silently).
async function handleSetupLink() {
  if (!location.hash.includes('sync-setup=')) return;
  const link = parseSetupLink(location.hash);
  history.replaceState(null, '', location.pathname + location.search);
  const plan = planSetupLinkApply(syncConfig().get(), link, DEFAULT_SYNC);
  if (plan.action === 'ignore') return;
  if (plan.action === 'confirm' && !confirm('This link points to a different sync project. Switch this device to it? You will be signed out of the current one.')) return;
  await applySyncSetup(plan.patch);
  toast('Sync settings added — now sign in');
}
handleSetupLink();

applyTheme();
showTab('diary');
renderDiary();

// Offline support (needs http/https; the preview pane and file:// don't register it)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
