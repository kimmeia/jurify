/**
 * Baixa Inter + Poppins do Google Fonts e devolve UM css com as fontes
 * embutidas em base64 — só os subconjuntos latin e latin-ext, que é o que
 * português usa. O mockup tem que abrir no navegador do dono mesmo offline.
 *
 *   node fontes.mjs > fontes.css
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// Inter pedida na forma VARIÁVEL (um arquivo cobre 100..900) — pedir peso
// por peso trazia 5 arquivos de 83kb cada. Poppins só existe estática e no
// app serve apenas à marca "J" (font-display, extrabold).
const URL_CSS =
  "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&family=Poppins:wght@700;800&display=swap";

const css = await (await fetch(URL_CSS, { headers: { "User-Agent": UA } })).text();

// Os blocos vêm em ordem e o comentário /* latin */ marca cada subconjunto.
const blocos = css.split("@font-face").slice(1);
let saida = "";
for (const bruto of blocos) {
  const bloco = "@font-face" + bruto.split("}")[0] + "}";
  const rotulo = (bruto.match(/\/\* *([a-z-]+) *\*\//) || [])[1];
  const antes = css.slice(0, css.indexOf(bruto));
  const sub = (antes.match(/\/\* *([a-z-]+) *\*\/(?![\s\S]*\/\* *[a-z-]+ *\*\/)/) || [])[1] || rotulo;
  if (sub !== "latin") continue; // latin-ext é polonês/turco; português cabe em latin
  const url = (bloco.match(/url\((https:[^)]+)\)/) || [])[1];
  if (!url) continue;
  const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
  saida += bloco.replace(
    /url\(https:[^)]+\)/,
    `url(data:font/woff2;base64,${buf.toString("base64")})`,
  ) + "\n";
  process.stderr.write(`${sub} ${(buf.length / 1024).toFixed(0)}kb\n`);
}
process.stdout.write(saida);
