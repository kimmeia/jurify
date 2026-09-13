/**
 * Converte os PNGs das capturas em JPEG menor, usando o próprio Chromium
 * (não há Pillow nem ImageMagick neste ambiente).
 *
 *   node leva-pra-jpeg.mjs <pasta> [larguraMax] [qualidade]
 *
 * Existe porque o comparador é um HTML AUTO-CONTIDO: as imagens vão embutidas
 * em base64, e 14 MB de PNG viram um arquivo que o dono não abre.
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";

const [PASTA, LARGURA = "1500", QUALIDADE = "0.82"] = process.argv.slice(2);

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext()).newPage();

let antes = 0, depois = 0;
for (const arq of readdirSync(PASTA).filter((a) => a.endsWith(".png"))) {
  const origem = `${PASTA}/${arq}`;
  antes += statSync(origem).size;
  const b64 = readFileSync(origem).toString("base64");
  const jpeg = await p.evaluate(
    ([dados, larguraMax, q]) =>
      new Promise((ok) => {
        const img = new Image();
        img.onload = () => {
          const escala = Math.min(1, larguraMax / img.width);
          const cv = document.createElement("canvas");
          cv.width = Math.round(img.width * escala);
          cv.height = Math.round(img.height * escala);
          const cx = cv.getContext("2d");
          cx.fillStyle = "#fff";
          cx.fillRect(0, 0, cv.width, cv.height);
          cx.drawImage(img, 0, 0, cv.width, cv.height);
          ok(cv.toDataURL("image/jpeg", q));
        };
        img.src = "data:image/png;base64," + dados;
      }),
    [b64, Number(LARGURA), Number(QUALIDADE)],
  );
  const saida = origem.replace(/\.png$/, ".jpg");
  writeFileSync(saida, Buffer.from(jpeg.split(",")[1], "base64"));
  depois += statSync(saida).size;
}
await b.close();
console.log(`${PASTA}: ${(antes / 1048576).toFixed(1)} MB → ${(depois / 1048576).toFixed(1)} MB`);
