// off-barcode-404 checklist C1-C4 (docs/specs/off-barcode-404.md). Services stubbed with invented data via page.route (per case).
// A 404/500 response makes the browser log "Failed to load resource", so console errors are allowed here and uncaught page errors are checked by hand.
export const allowConsoleErrors = true;

const NOT_FOUND = { code: '0810030528814', status: 0, status_verbose: 'product not found' };
const USDA_FOOD = { description: 'COCA COLA', brandOwner: 'Acme', fdcId: 555, gtinUpc: '810030528814', dataType: 'Branded',
  foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 42 }, { nutrientNumber: '203', value: 0 }, { nutrientNumber: '205', value: 10.6 }, { nutrientNumber: '204', value: 0 }] };

async function stub(page, { off, usda }) {
  await page.route(/world\.openfoodfacts\.org/, r => r.fulfill({ status: off.status, contentType: 'application/json', body: JSON.stringify(off.json) }));
  await page.route(/api\.nal\.usda\.gov/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(usda || { foods: [] }) }));
}

async function open(page, url) {
  await page.goto(url + '/index.html');
  await page.locator('button', { hasText: '+ Add' }).first().click();
}

export default async ({ page, url, check, screenshot }) => {
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  const body = () => page.innerText('body');

  // C1
  await stub(page, { off: { status: 404, json: NOT_FOUND } });
  await open(page, url);
  await page.fill('#q', '810030528814');
  await page.click('#goSearch');
  await page.waitForSelector('#mkBarcode', { timeout: 10000 });
  let t = await body();
  check(/Not found/i.test(t), 'C1: "Not found" message visible, got: ' + t.slice(0, 400));
  check(/Create a custom food/.test(await page.innerText('#mkBarcode')), 'C1: "Create a custom food" button visible');
  check(!t.includes('HTTP 404') && !t.includes('Open Food Facts: HTTP'), 'C1: no HTTP error text on the page');
  await screenshot('C1');
  await page.unroute(/world\.openfoodfacts\.org/); await page.unroute(/api\.nal\.usda\.gov/);

  // C2
  await stub(page, { off: { status: 404, json: NOT_FOUND }, usda: { foods: [USDA_FOOD] } });
  await open(page, url);
  await page.fill('#q', '810030528814');
  await page.click('#goSearch');
  await page.waitForSelector('#results .res', { timeout: 10000 });
  t = await page.innerText('#results');
  check(await page.locator('#results .res').count() === 1, 'C2: exactly one result, got ' + await page.locator('#results .res').count());
  check(t.includes('Coca cola'), 'C2: "Coca cola" listed, got: ' + t);
  check(!t.includes('HTTP 404') && !/HTTP \d{3}/.test(await body()), 'C2: no HTTP error text');
  await screenshot('C2');
  await page.unroute(/world\.openfoodfacts\.org/); await page.unroute(/api\.nal\.usda\.gov/);

  // C3
  await stub(page, { off: { status: 500, json: NOT_FOUND } });
  await open(page, url);
  await page.fill('#q', '810030528814');
  await page.click('#goSearch');
  await page.waitForFunction(() => document.body.innerText.includes('HTTP 500'), null, { timeout: 10000 }).catch(() => {});
  t = await body();
  check(t.includes('Open Food Facts: HTTP 500'), 'C3: "Open Food Facts: HTTP 500" shown, got: ' + t.slice(0, 500));
  await screenshot('C3');
  await page.unroute(/world\.openfoodfacts\.org/); await page.unroute(/api\.nal\.usda\.gov/);

  // C4
  await stub(page, { off: { status: 404, json: NOT_FOUND } });
  await open(page, url);
  await page.fill('#q', 'apple');
  await page.click('#goSearch');
  await page.waitForFunction(() => document.body.innerText.includes('HTTP 404'), null, { timeout: 10000 }).catch(() => {});
  t = await body();
  check(t.includes('Open Food Facts: HTTP 404'), 'C4: "Open Food Facts: HTTP 404" still shown for a name search, got: ' + t.slice(0, 500));
  await screenshot('C4');

  check(pageErrors.length === 0, 'no uncaught page errors: ' + pageErrors.join('; '));
};
