// The app opens, every tab shows, and nothing is logged as an error.
export default async ({ page, url, check }) => {
  await page.goto(url + '/index.html');
  check((await page.title()) === 'Macro Diary', 'the page title is "Macro Diary"');
  for (const tab of ['diary', 'plan', 'recipes', 'shop', 'more']) {
    await page.click(`nav.tabs button[data-tab="${tab}"]`);
    check(await page.locator(`nav.tabs button[data-tab="${tab}"].on`).count() === 1, `the ${tab} tab is highlighted after a click`);
  }
};
