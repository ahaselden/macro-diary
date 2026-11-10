// "Custom" tab of the add-food dialog: enter a food by hand.
import { state, save } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { foodKey } from '../domain/food.js';
import { showFood } from './amount-picker.js';

export function renderCustom() {
  $('#tabBody').innerHTML = `
    <label>Name</label><input id="cName" placeholder="e.g. Homemade chili" autocomplete="off">
    <label>Serving size (g)</label><input id="cSize" type="number" inputmode="decimal" value="100">
    <div class="row"><div><label>Calories</label><input id="cK" type="number" inputmode="decimal"></div><div><label>Protein (g)</label><input id="cP" type="number" inputmode="decimal"></div></div>
    <div class="row"><div><label>Carbs (g)</label><input id="cC" type="number" inputmode="decimal"></div><div><label>Fat (g)</label><input id="cF" type="number" inputmode="decimal"></div></div>
    <p class="muted">Values are per serving above.</p>
    <div class="chk"><input type="checkbox" id="cSave" checked><label style="margin:0;color:inherit" for="cSave">Save to My foods</label></div>
    <button class="primary" style="width:100%" id="cGo">Continue</button>`;
  $('#cGo').onclick = () => {
    const name = $('#cName').value.trim() || 'Quick add', size = +$('#cSize').value || 100, k = +$('#cK').value;
    if (!(k >= 0) || $('#cK').value === '') { toast('Enter calories'); return; }
    const s = 100 / size, food = { name, brand: '', source: 'Custom', servingG: size,
      per100: { k: k * s, p: (+$('#cP').value || 0) * s, c: (+$('#cC').value || 0) * s, f: (+$('#cF').value || 0) * s } };
    food.updatedAt = Date.now();
    if ($('#cSave').checked) { state.custom = [food, ...state.custom.filter(f => foodKey(f) !== foodKey(food))].slice(0, 100); save(); }
    showFood(food);
  };
}
