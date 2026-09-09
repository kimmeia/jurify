/**
 * Amarra do client pro fuso das datas de calendário.
 *
 * Um prazo "10/09" chega como meia-noite (ou meio-dia) UTC e, formatado no
 * fuso do navegador, vira "09/09"; e "hoje" por `toISOString()` já é amanhã
 * depois das 21h no Brasil. Os pontos abaixo passaram a usar os helpers de
 * `shared/data-calendario.ts`. O teste é específico por TRECHO: cada
 * arquivo tem outras datas que são instantes de verdade (createdAt,
 * coletadoEm) e continuam, legitimamente, no fuso local.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const CLIENT = path.resolve(__dirname, "../../client/src");
const ler = (rel: string) => readFileSync(path.join(CLIENT, rel), "utf-8");

function bloco(fonte: string, marcador: string, tamanho = 400): string {
  const i = fonte.indexOf(marcador);
  expect(i, `marcador não encontrado: ${marcador}`).toBeGreaterThan(-1);
  return fonte.slice(i, i + tamanho);
}

function contar(fonte: string, trecho: string): number {
  return fonte.split(trecho).length - 1;
}

const IMPORT_HELPER = /from "@shared\/data-calendario"/;

describe("processos-1 · central de movimentações", () => {
  const fonte = ler("pages/Movimentacoes.tsx");

  it("o 'Vence dd/mm' do card sai da parte de data em UTC", () => {
    expect(fonte).toMatch(IMPORT_HELPER);
    expect(fonte).toContain(
      '{audiencia ? "Audiência" : "Vence"} {formatarDataCalendario(p.data, { ano: false })}',
    );
    expect(fonte).not.toContain('"Vence"} {dataCurta(p.data)}');
  });

  it("dataCurta continua existindo pra data do evento (não é prazo)", () => {
    expect(fonte).toContain("{dataCurta(item.dataEvento)}");
  });
});

describe("processos-1 · timeline do processo e aba Alertas", () => {
  const fonte = ler("pages/Processos.tsx");

  it("'vence dd/mm/aaaa' na timeline usa o helper", () => {
    expect(fonte).toMatch(IMPORT_HELPER);
    expect(fonte).toContain("` · vence ${formatarDataCalendario(prazo.dataSugerida)}`");
    expect(fonte).not.toContain("new Date(prazo.dataSugerida).toLocaleDateString");
  });

  it("a pill da aba Alertas mostra a data de calendário, não '09/09 21:00'", () => {
    expect(fonte).toContain("{formatarDataCalendario(sug.dataSugerida)}");
    expect(fonte).not.toContain("new Date(sug.dataSugerida).toLocaleString(");
  });
});

describe("shell-1 · drawer da movimentação", () => {
  const fonte = ler("components/MovimentacaoDetalheDrawer.tsx");

  it("dia da semana e data do prazo vêm do mesmo helper (nunca 'quinta-feira, 09/09')", () => {
    expect(fonte).toMatch(IMPORT_HELPER);
    expect(bloco(fonte, "function diaSemana(", 120)).toContain("return diaSemanaCalendario(d);");
    expect(fonte).toContain(
      '{prazo.tipo === "audiencia" ? "em" : "vence"} {diaSemana(prazo.data)}, {formatarDataCalendario(prazo.data)}',
    );
    expect(fonte).toContain(
      '{prazo.tipo === "audiencia" ? "Em" : "Vence"} {formatarDataCalendario(prazo.data)} · {diaSemana(prazo.data)}',
    );
    expect(fonte).not.toContain("dataBR(prazo.data)");
  });

  it("os dois diálogos pré-preenchem a data fatal com o dia em UTC", () => {
    expect(contar(fonte, "evento.prazo?.data ? dataCalendarioISO(evento.prazo.data) : dataFallback()")).toBe(2);
    expect(fonte).not.toContain("format(new Date(evento.prazo.data)");
  });

  it("dataBR segue local pra instantes de verdade (coletadoEm)", () => {
    expect(fonte).toContain("dataBR(data.coletadoEm)");
  });
});

describe("kanban-5 · card e histórico", () => {
  const kanban = ler("pages/Kanban.tsx");
  const timeline = ler("pages/kanban/timeline-card.tsx");

  it("o rodapé do card formata o prazo em UTC ('10 set', não '09 set')", () => {
    expect(kanban).toMatch(IMPORT_HELPER);
    expect(kanban).toContain('{formatarDataCalendario(card.prazo, { ano: false, mes: "curto" })}');
    expect(kanban).not.toContain("new Date(card.prazo).toLocaleDateString(");
  });

  it("'Atrasado' no quadro só quando o DIA virou (calendário × hoje local)", () => {
    expect(kanban).toContain("dataCalendarioISO(card.prazo) < dataLocalHoje()");
    expect(kanban).not.toContain("new Date(card.prazo) < new Date()");
  });

  it("o input de prazo do painel lê o mesmo dia do helper", () => {
    expect(kanban).toContain("cardDetalhe.prazo ? dataCalendarioISO(cardDetalhe.prazo) : \"\"");
    expect(kanban).not.toContain("new Date(cardDetalhe.prazo).toISOString()");
  });

  it("o histórico do card mostra o prazo em UTC", () => {
    expect(timeline).toMatch(IMPORT_HELPER);
    expect(timeline).toContain("Prazo: {formatarDataCalendario(prazo)}");
    expect(timeline).not.toContain("new Date(prazo).toLocaleDateString");
  });
});

describe("financeiro-4 · nova cobrança com vencimento hoje", () => {
  const fonte = ler("pages/financeiro/dialogs.tsx");

  it("aviso e botão comparam com o hoje LOCAL (aviso + disabled)", () => {
    expect(fonte).toMatch(IMPORT_HELPER);
    expect(contar(fonte, "vencimento < dataLocalHoje()")).toBe(2);
    expect(fonte).not.toContain("vencimento < new Date().toISOString()");
  });
});

describe("financeiro-5 · despesas: data padrão de pagamento/vencimento", () => {
  const fonte = ler("pages/financeiro/Despesas.tsx");

  it("hojeIso delega pro dia local", () => {
    expect(fonte).toMatch(IMPORT_HELPER);
    const b = bloco(fonte, "function hojeIso(): string {", 80);
    expect(b).toContain("return dataLocalHoje();");
    expect(b).not.toContain("toISOString()");
  });

  it("os defaults continuam passando por hojeIso (vencimento, pagamento, lote)", () => {
    expect(contar(fonte, "hojeIso()")).toBeGreaterThanOrEqual(4);
  });
});

describe("admin-5 · vencimentos do Asaas no painel admin", () => {
  const fonte = ler("pages/admin/AdminFinanceiro.tsx");

  it("dueDate e nextDueDate (YYYY-MM-DD) não passam por new Date() local", () => {
    expect(fonte).toMatch(IMPORT_HELPER);
    expect(fonte).toContain("{formatarDataCalendario(p.dueDate)}");
    expect(fonte).toContain('{s.nextDueDate ? formatarDataCalendario(s.nextDueDate) : "—"}');
    expect(fonte).not.toContain("new Date(p.dueDate)");
    expect(fonte).not.toContain("new Date(s.nextDueDate)");
  });
});
