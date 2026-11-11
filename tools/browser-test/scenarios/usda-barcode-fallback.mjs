// Searching a barcode Open Food Facts does not have: USDA is asked by the digits and its branded food is listed (both services are stubbed with invented data).
export const stubs = [
  { match: 'world.openfoodfacts.org', json: { status: 0 } },
  { match: 'api.nal.usda.gov', json: { foods: [{ description: 'INVENTED OAT BAR', brandOwner: 'Acme', fdcId: 777, gtinUpc: '036000291452', dataType: 'Branded',
    foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 400 }, { nutrientNumber: '203', value: 8 }, { nutrientNumber: '205', value: 60 }, { nutrientNumber: '204', value: 12 }] }] } },
];

export default async ({ page, url, check, screenshot }) => {
  await page.goto(url + '/index.html');
  await page.locator('button', { hasText: '+ Add' }).first().click();
  await page.fill('#q', '036000291452');
  await page.click('#goSearch');
  await page.waitForSelector('#results .res', { timeout: 10000 });
  const text = await page.innerText('#results');
  check(text.includes('Invented oat bar'), 'the USDA product is listed, got: ' + text);
  check(/USDA/.test(await page.innerText('#results .res .badge')), 'the result is badged USDA');
  check(!(await page.locator('#mkBarcode').count()), 'no "create a custom food" button when a product was found');
  await screenshot('usda-found');
};
