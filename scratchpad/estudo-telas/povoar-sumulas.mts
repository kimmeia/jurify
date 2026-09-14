/**
 * Põe súmulas no banco LOCAL pelo caminho de verdade — a mesma procedure que o
 * painel chama quando alguém cola o texto oficial.
 *
 * O texto não foi escrito aqui: sai de `server/juridico/fontes-revisional.ts`,
 * que já está no repositório e já é a base curada que os pareceres citam. Usar
 * outra fonte pra "povoar tela" seria inventar enunciado, que é justamente o
 * que não pode acontecer num produto jurídico.
 *
 *   pnpm tsx scratchpad/estudo-telas/povoar-sumulas.mts
 */
import "dotenv/config";
import { FONTES_REVISIONAL } from "../../server/juridico/fontes-revisional";
import { importarSumulasDeTexto } from "../../server/jurisia/coletor-ementas";

const numeroEOrgao = (id: string) => {
  const m = id.match(/S[úu]mula\s+(\d+)\/(STJ|STF)/i);
  return m ? { numero: m[1], orgao: m[2].toUpperCase() } : null;
};

const porOrgao: Record<string, string[]> = { STJ: [], STF: [] };
for (const f of FONTES_REVISIONAL) {
  if (f.tipo !== "sumula") continue;
  const n = numeroEOrgao(f.identificador);
  if (!n) continue;
  porOrgao[n.orgao].push(`Súmula ${n.numero} ${f.texto}`);
}

for (const [orgao, fonteId] of [
  ["STJ", "stj-sumulas"],
  ["STF", "stf-sumulas"],
] as const) {
  const texto = porOrgao[orgao].join("\n\n");
  if (!texto) continue;
  const r = await importarSumulasDeTexto({ fonteId, texto });
  console.log(orgao, JSON.stringify(r));
}

process.exit(0);
