/** Reduz as fotos pela metade (1440px) para o arquivo não pesar 15 MB. */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
const dir = "/home/user/jurify/scratchpad/direcoes/fotos";
const saida = "/home/user/jurify/scratchpad/direcoes/fotos-web";
mkdirSync(saida, { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".png"))) {
  const src = `data:image/png;base64,${readFileSync(`${dir}/${f}`).toString("base64")}`;
  const out = await p.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const alvo = Math.min(img.naturalWidth, img.naturalWidth > 1000 ? 1440 : 780);
    const cv = document.createElement("canvas");
    cv.width = alvo;
    cv.height = Math.round((img.naturalHeight * alvo) / img.naturalWidth);
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/png");
  }, src);
  writeFileSync(`${saida}/${f}`, Buffer.from(out.split(",")[1], "base64"));
}
await b.close();
console.log("pronto");
