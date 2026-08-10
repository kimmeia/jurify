import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const nome of ['lista', 'detalhe']) {
  for (const tema of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    await p.goto('file://' + process.cwd() + '/mk-acordos/' + nome + '.html');
    if (tema === 'dark') await p.evaluate(() => document.documentElement.classList.add('dark'));
    await p.waitForTimeout(350);
    console.log(nome, tema, JSON.stringify(await p.evaluate(() => ({ larguraPagina: document.documentElement.scrollWidth }))));
    await p.screenshot({ path: `mk-acordos/${nome}-${tema}.png`, fullPage: true });
    await p.close();
  }
}
await b.close();
