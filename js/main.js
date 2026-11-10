// Boot + wiring only. Each screen owns its own handlers (initX); screens talk through core/bus.js.
import { store } from './core/store.js';
import { toast } from './core/dom.js';
import { initTabs, showTab } from './ui/tabs.js';
import { initTheme, applyTheme } from './ui/theme.js';
import { initDiary, renderDiary } from './ui/diary.js';
import { initAddFood } from './ui/add-food.js';
import { initExport } from './ui/export-view.js';
import { initSettings } from './ui/settings-view.js';
import { initSync } from './ui/sync-view.js';
import { initRecipes } from './ui/recipes-view.js';
import { initPlan } from './ui/plan-view.js';
import { initShop } from './ui/shop-view.js';

store.onSaveError = () => toast('Could not save – storage full or blocked');

initTabs();
initTheme();
initDiary();
initAddFood();
initExport();
initSettings();
initSync();
initRecipes();
initPlan();
initShop();

applyTheme();
showTab('diary');
renderDiary();

// Offline support (needs http/https; the preview pane and file:// don't register it)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
