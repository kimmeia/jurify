/**
 * Sondagem das fontes públicas de jurisprudência — versão linha de comando.
 *
 * A lógica mora em `server/jurisia/sondar-fontes.ts`, que é a mesma que o
 * painel admin usa. Aqui só tem terminal e arquivo.
 *
 * Prefira o botão em Admin → JurisIA: ele roda de dentro do servidor, que é a
 * rede que o coletor vai usar de verdade. Este script serve pra rodar contra
 * uma rede específica quando se quer comparar.
 *
 *   pnpm tsx scripts/sondar-fontes-juris.ts
 *   pnpm tsx scripts/sondar-fontes-juris.ts --termo "revisional bancária"
 *   pnpm tsx scripts/sondar-fontes-juris.ts --url "https://algum.endpoint/api"
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sondarFontes, type ResultadoSonda } from "../server/jurisia/sondar-fontes";

const arg = (nome: string): string | null => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const ICONE: Record<ResultadoSonda["veredito"], string> = {
  "responde-json": "🟢",
  "responde-html": "🟡",
  bloqueado: "🔴",
  vazio: "⚪",
  erro: "🔴",
};

const nomeDeArquivo = (r: ResultadoSonda, i: number) =>
  `${String(i).padStart(2, "0")}-${r.fonte}-${r.nome}`
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .slice(0, 120) + (r.tipo.includes("json") ? ".json" : ".txt");

async function main() {
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const pasta = join("scripts", ".sondagem", carimbo);
  mkdirSync(pasta, { recursive: true });

  const extra = arg("url");
  console.log("\nSondando as fontes públicas — 1 requisição por endpoint, com pausa.");
  console.log(`Corpos em: ${pasta}\n`);

  const s = await sondarFontes({
    termo: arg("termo") ?? undefined,
    extras: extra ? [extra] : [],
    aoProgredir: (feito, total, c) =>
      process.stdout.write(`  [${feito + 1}/${total}] ${c.fonte} · ${c.nome} … \n`),
  });

  console.log("\n" + "═".repeat(78));
  console.log(`RESULTADO — termo "${s.termo}"`);
  console.log("═".repeat(78));

  s.resultados.forEach((r, i) => {
    writeFileSync(join(pasta, nomeDeArquivo(r, i + 1)), r.amostra, "utf8");
    console.log(`\n${ICONE[r.veredito]} ${r.fonte} · ${r.nome}`);
    console.log(`   ${r.url}`);
    console.log(
      `   status ${r.status ?? "—"} · ${r.tipo || "sem content-type"} · ${r.bytes.toLocaleString("pt-BR")} bytes · ${r.ms}ms`,
    );
    if (r.erro) console.log(`   erro: ${r.erro}`);
    if (r.forma) console.log(`   forma: ${r.forma}`);
    if (r.temEmenta !== null) {
      console.log(`   ementa/teor no payload: ${r.temEmenta ? "SIM (aparente)" : "não encontrei"}`);
    }
  });

  if (s.bloqueioDeRede) {
    console.log("\n" + "!".repeat(78));
    console.log("ATENÇÃO: quase tudo voltou 403 curto em text/plain, de domínios diferentes.");
    console.log("Esse é o padrão de PROXY bloqueando a saída — não dos tribunais recusando.");
    console.log("Rode de novo numa rede sem proxy antes de concluir qualquer coisa.");
    console.log("!".repeat(78));
  }

  const json = s.resultados.filter((r) => r.veredito === "responde-json").length;
  console.log("\n" + "═".repeat(78));
  console.log(`${json} de ${s.resultados.length} responderam JSON.`);
  console.log(`Parecem trazer ementa/teor: ${s.comEmenta.join(", ") || "nenhum"}`);
  console.log("═".repeat(78) + "\n");

  writeFileSync(join(pasta, "resumo.json"), JSON.stringify(s.resultados, null, 2), "utf8");
}

main().catch((e) => {
  console.error("\nSondagem abortou:", e);
  process.exit(1);
});
