import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const nome of ['comercial', 'operacional', 'financeiro']) {
  for (const tema of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    await p.goto('file://' + process.cwd() + '/mockups-painel/' + nome + '.html');
    if (tema === 'dark') await p.evaluate(() => document.documentElement.classList.add('dark'));
    await p.waitForTimeout(350);
    const m = await p.evaluate(() => {
      const cel = document.querySelectorAll('.lg\\:col-span-2')[0];
      const lat = document.querySelector('.lg\\:absolute');
      return {
        principal: cel ? Math.round(cel.firstElementChild.getBoundingClientRect().height) : null,
        lateral: lat ? Math.round(lat.firstElementChild.getBoundingClientRect().height) : null,
        larguraPagina: document.documentElement.scrollWidth,
      };
    });
    console.log(nome, tema, JSON.stringify(m));
    await p.screenshot({ path: `mockups-painel/${nome}-${tema}.png`, fullPage: true });
    await p.close();
  }
}
await b.close();
