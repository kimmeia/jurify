/**
 * Para cada comparação, mede o retângulo do alvo nos dois estados e diz se a
 * história fica VISÍVEL: no celular, o anel tem que cruzar a linha dos 390px
 * no "antes" e não cruzar no "depois". Sem isso o dono olha dois quadros
 * parecidos e não vê diferença — foi exatamente o que aconteceu.
 *
 *   node mede-alvos.mjs <comparador.html> [subir-alternativo]
 */
import { chromium } from "/home/user/jurify/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs";

const [ARQ] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await b.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
await p.goto(`file://${ARQ}`, { waitUntil: "load" });
await p.waitForTimeout(1200);

const n = await p.$$eval("[data-i]", (b) => b.length);
console.log("#".padEnd(3), "achado".padEnd(34), "vista".padEnd(9), "antes: dir/larg".padEnd(18), "depois: dir/larg".padEnd(18), "história");

for (let i = 0; i < n; i++) {
  await p.click(`[data-i="${i}"]`);
  await p.waitForTimeout(1300);
  const d = await p.evaluate(() => {
    const it = JSON.parse(document.getElementById("itens").textContent)[
      Number([...document.querySelectorAll("[data-i]")].find((b) => b.getAttribute("aria-current") === "true").dataset.i)
    ];
    const frames = [...document.querySelectorAll("#par iframe")];
    const medir = (f) => {
      const doc = f.contentDocument;
      if (!doc) return null;
      // mesma busca do comparador
      let el;
      if (it.alvo.seletor === "nome-movimentacao") {
        el = [...doc.querySelectorAll("span")].find((s) => typeof s.className === "string" && s.className.startsWith("w-[220px]"));
      } else {
        const alvos = [...doc.querySelectorAll("body *")].filter((e2) => {
          const t = e2.textContent || "";
          if (!t.includes(it.alvo.texto)) return false;
          return ![...e2.children].some((f2) => (f2.textContent || "").includes(it.alvo.texto));
        });
        el = alvos[0];
        for (let k = 0; k < (it.alvo.subir || 0) && el && el.parentElement && el.parentElement.tagName !== "BODY"; k++) el = el.parentElement;
      }
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const se = doc.scrollingElement;
      return { dir: Math.round(r.right + se.scrollLeft), larg: Math.round(r.width), tag: el.tagName.toLowerCase(), cls: (typeof el.className === "string" ? el.className : "").slice(0, 44) };
    };
    return { id: it.id, vista: it.vista, a: medir(frames[0]), d: medir(frames[1]) };
  });
  const limite = d.vista === "celular" ? 390 : 1440;
  const conta = d.a && d.d
    ? (d.a.dir > limite && d.d.dir <= limite ? "cruza→cabe ✔"
      : d.a.larg !== d.d.larg ? "muda de tamanho"
      : "MESMO retângulo")
    : "alvo não achado";
  console.log(
    String(i + 1).padEnd(3), d.id.padEnd(34), d.vista.padEnd(9),
    `${d.a ? d.a.dir + "/" + d.a.larg : "—"}`.padEnd(18),
    `${d.d ? d.d.dir + "/" + d.d.larg : "—"}`.padEnd(18),
    conta,
  );
  if (d.a) console.log("     antes ", d.a.tag, d.a.cls);
  if (d.d) console.log("     depois", d.d.tag, d.d.cls);
}
await b.close();
