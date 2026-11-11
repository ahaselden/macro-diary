// Add food > Custom: a photo with a barcode in it offers the product (Open Food Facts is stubbed with an invented product; nothing reaches the internet).
export const stubs = [{ match: 'world.openfoodfacts.org', json: { status: 1, product: {
  code: '4006381333931', product_name: 'Invented <b>Oat</b> Bar', brands: 'Acme',
  nutriments: { 'energy-kcal_100g': 400, proteins_100g: 8, carbohydrates_100g: 60, fat_100g: 12 }, serving_quantity: 40, serving_size: '1 bar (40 g)' }, products: [] } }];

// Draws an EAN-13 (4006381333931) as a PNG inside the page, so no image file is needed.
const drawBarcode = () => {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = L.map(c => [...c].map(b => b ^ 1).join('')), G = R.map(c => [...c].reverse().join(''));
  const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'], code = '4006381333931';
  let m = '101'; for (let i = 0; i < 6; i++) m += (P[+code[0]][i] === 'L' ? L : G)[+code[i + 1]];
  m += '01010'; for (let i = 7; i < 13; i++) m += R[+code[i]]; m += '101';
  const px = 4, mods = '0'.repeat(15) + m + '0'.repeat(15), cv = document.createElement('canvas');
  cv.width = mods.length * px + 200; cv.height = 500;
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#000';
  for (let i = 0; i < mods.length; i++) if (mods[i] === '1') c.fillRect(100 + i * px, 100, px, 300);
  return cv.toDataURL('image/png').split(',')[1];
};

export default async ({ page, url, check, screenshot }) => {
  await page.goto(url + '/index.html');
  await page.locator('button', { hasText: '+ Add' }).first().click();
  await page.click('#dBody .seg [data-t=custom]');
  const png = await page.evaluate(drawBarcode);
  await page.setInputFiles('#cFile', { name: 'barcode.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForSelector('#cUseBar', { timeout: 15000 });
  check((await page.inputValue('#cBar')) === '4006381333931', 'the Barcode field was filled with the code');
  const msg = await page.innerText('#cCodeMsg');
  check(msg.includes('Invented <b>Oat</b> Bar'), 'the product name is shown as text (escaped), got: ' + msg);
  await screenshot('offer');
  await page.click('#cUseBar');
  await page.waitForSelector('#results .res');
  check((await page.inputValue('#q')) === '4006381333931', 'Use this product opened the Search tab on the code');
};
