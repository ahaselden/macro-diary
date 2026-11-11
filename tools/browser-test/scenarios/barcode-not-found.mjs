// A barcode that neither Open Food Facts nor USDA has: the message names both sources and still offers a custom food (services stubbed).
export const stubs = [
  { match: 'world.openfoodfacts.org', json: { status: 0 } },
  { match: 'api.nal.usda.gov', json: { foods: [] } },
];

export default async ({ page, url, check, screenshot }) => {
  await page.goto(url + '/index.html');
  await page.locator('button', { hasText: '+ Add' }).first().click();
  await page.fill('#q', '4006381333931');
  await page.click('#goSearch');
  await page.waitForSelector('#mkBarcode', { timeout: 10000 });
  const t = await page.innerText('#mkBarcode');
  check(t.includes('Open Food Facts') && t.includes('USDA'), 'the button names both sources, got: ' + t);
  check(t.includes('Create a custom food'), 'it still offers a custom food');
  await screenshot('not-found');
};
