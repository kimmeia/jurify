/**
 * Pacote aprovado no mockup de 20/08: ações do relatório na linha das abas
 * e filtros de marcar vários (setor, atendente, canal) na aba Atendimento.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { idsDoFiltro } from "../escritorio/router-relatorios";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("idsDoFiltro — singular legado e plural convivem", () => {
  it("sem nada = sem filtro", () => {
    expect(idsDoFiltro(undefined, undefined)).toBeUndefined();
    expect(idsDoFiltro(undefined, [])).toBeUndefined();
  });

  it("singular (envio programado antigo) vira lista de um", () => {
    expect(idsDoFiltro(7, undefined)).toEqual([7]);
  });

  it("plural vence o singular e sai sem duplicatas", () => {
    expect(idsDoFiltro(7, [3, 5, 3])).toEqual([3, 5]);
  });
});

describe("relatório Atendimento aceita e aplica listas", () => {
  const router = ler("server/escritorio/router-relatorios.ts");

  it("input tem os três plurais (e mantém os singulares pros agendamentos antigos)", () => {
    for (const campo of ["setorIds", "atendenteIds", "canalIds"]) {
      expect(router).toContain(`${campo}: z.array(z.number().int().positive())`);
    }
    expect(router).toContain("setorId: z.number().int().positive().optional()");
  });

  it("canal filtra por lista em todos os caminhos — nenhum eq() singular sobrou", () => {
    expect(router).not.toMatch(/eq\(conversas\.canalId,\s*input/);
    expect(router).not.toMatch(/eq\(chamadas\.canalId,\s*input/);
    expect(router).not.toMatch(/AND c\.canalIdConv = /);
  });

  it("o filtro de canal em leads FILTRA: a condição mora no join", () => {
    // Antes o innerJoin só exigia que o lead tivesse conversa — de qualquer
    // canal. Escolher "Instagram" não mudava os números de leads.
    const bloco = router.slice(router.indexOf("const joinCanalLead"), router.indexOf("const joinCanalLead") + 400);
    expect(bloco).toContain("inArray(conversas.canalId, canalIds)");
  });

  it("tempo de 1ª resposta respeita o filtro de atendente no período atual", () => {
    // O período anterior já aplicava filtroAtendSql; o atual não — com um
    // atendente marcado, o KPI misturava o escritório inteiro.
    const inicio = router.indexOf("Tempo médio de primeira resposta");
    const bloco = router.slice(inicio, inicio + 900);
    expect(bloco).toContain("${filtroAtendSql}");
  });

  it("export de PDF aceita os plurais e rotula listas", () => {
    const bloco = router.slice(router.indexOf("exportarAtendimentoPdf:"));
    expect(bloco).toContain("atendenteIds: z.array(");
    expect(bloco).toContain("juntarNomes");
  });
});

describe("envio programado grava os plurais", () => {
  it("schema de filtros do envio aceita as listas", () => {
    const envio = ler("server/escritorio/relatorios-envio.ts");
    expect(envio).toContain("setorIds: z.array(");
    expect(envio).toContain("canalIds: z.array(");
  });
});

describe("tela — botões na linha das abas e FiltroMulti", () => {
  it("a casca tem o FiltroMulti com rascunho + Aplicar", () => {
    const casca = ler("client/src/pages/relatorios/casca.tsx");
    expect(casca).toContain("export function FiltroMulti");
    expect(casca).toContain("marcar todos");
    expect(casca).toContain("Aplicar");
    // Marcar todos = sem filtro: não manda lista que não restringe nada.
    expect(casca).toContain("rascunho.size >= opcoes.length ? [] : [...rascunho]");
  });

  it("as ações se penduram na linha das abas via portal, com fallback", () => {
    const acoes = ler("client/src/pages/relatorios/acoes.tsx");
    expect(acoes).toContain("createPortal(botoes, slotAcoes)");
    expect(acoes).toContain(": botoes");
    const pagina = ler("client/src/pages/Relatorios.tsx");
    expect(pagina).toContain("<SlotAcoes />");
    expect(pagina).toContain("ref={setSlotAcoes}");
  });

  it("a aba Atendimento usa os três FiltroMulti e manda listas pra query", () => {
    const pagina = ler("client/src/pages/Relatorios.tsx");
    const aba = pagina.slice(pagina.indexOf("function AbaAtendimento"), pagina.indexOf("function fmtTempoResposta"));
    expect(aba.match(/<FiltroMulti/g)?.length).toBe(3);
    expect(aba).toContain("setorIds: setorIds.length ? setorIds : undefined");
    // Setor desmarcado arrasta os atendentes que ficaram órfãos.
    expect(aba).toContain("if (validos.length !== atendenteIds.length) setAtendenteIds(validos)");
  });
});
