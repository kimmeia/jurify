/**
 * Filtrar os cards do Kanban pela data de CONCLUSÃO, não só pela de criação.
 *
 * Pedido do dono (13/09): *"filtro so permite buscar por data de criação do
 * card, quero saber também por data de conclusão."*
 *
 * O card sempre soube em QUAL coluna estava; nunca soube QUANDO chegou nela.
 * Agora sabe: `kanban_cards.concluidoEm` é gravado quando ele entra numa
 * coluna de conclusão e VOLTA A NULL quando sai pro fluxo — a regra que ele
 * escolheu, pra o filtro bater com o que o quadro mostra.
 *
 * O passado não se perdeu: a migration 0231 preencheu tudo a partir de
 * `kanban_movimentacoes`, que já registrava cada movimento desde sempre.
 *
 * Aqui ficam as três pontas: a regra SQL do filtro (pura), o que a migration
 * promete, e a tela.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { and } from "drizzle-orm";

import { condicoesCards } from "../escritorio/kanban-filtros";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** Renderiza as condições em SQL de verdade — banco falso engole `isNull`. */
function sqlDe(conds: any[]): string {
  const dialeto = new MySqlDialect();
  return dialeto.sqlToQuery(and(...conds)!).sql;
}

const BASE = { escritorioId: 7, colunasIds: [1, 2] };

describe("a regra do filtro por período", () => {
  it("sem `campoData`, compara a data de CRIAÇÃO — como sempre foi", () => {
    const sql = sqlDe(condicoesCards({
      ...BASE,
      filtros: { dataInicio: "2026-09-01", dataFim: "2026-09-30" },
    }));
    expect(sql).toContain("createdAtKCard");
    expect(sql).not.toContain("concluidoEmKCard");
  });

  it("com `campoData: concluido`, compara a data de CONCLUSÃO", () => {
    const sql = sqlDe(condicoesCards({
      ...BASE,
      filtros: { dataInicio: "2026-09-01", dataFim: "2026-09-30", campoData: "concluido" },
    }));
    expect(sql).toContain("concluidoEmKCard");
    // A data de criação não pode sobrar na cláusula: o card entraria pelas
    // duas pontas e o filtro devolveria mais do que o pedido.
    expect(sql.match(/createdAtKCard/g)).toBeNull();
  });

  it("card sem data de conclusão fica FORA, mesmo com só uma ponta do período", () => {
    // `NULL > data` em SQL não é falso, é desconhecido — a linha sumiria
    // sozinha. A condição explícita existe pra valer também quando o usuário
    // abre só o "desde" ou só o "até", e pra deixar a intenção escrita.
    for (const filtros of [
      { dataInicio: "2026-09-01", campoData: "concluido" as const },
      { dataFim: "2026-09-30", campoData: "concluido" as const },
    ]) {
      expect(sqlDe(condicoesCards({ ...BASE, filtros }))).toMatch(/IS NOT NULL/i);
    }
  });

  it("sem período nenhum, `campoData` não inventa filtro", () => {
    const sql = sqlDe(condicoesCards({ ...BASE, filtros: { campoData: "concluido" } }));
    expect(sql, "filtrar por conclusão sem período esconderia o quadro inteiro")
      .not.toContain("concluidoEmKCard");
  });

  it("o dia digitado começa e termina no fuso do ESCRITÓRIO, como no de criação", () => {
    const conds = condicoesCards({
      ...BASE,
      filtros: { dataInicio: "2026-09-05", dataFim: "2026-09-05", campoData: "concluido" },
      fusoHorario: "America/Sao_Paulo",
    });
    // O drizzle já formata a data pro MySQL na hora de montar a query, então
    // o que sobra em `params` é a string — é ela que vai pro banco.
    const params = new MySqlDialect().sqlToQuery(and(...conds)!).params;
    const datas = params.filter((p) => typeof p === "string" && /^\d{4}-\d{2}-\d{2} /.test(p));
    expect(datas.length).toBe(2);
    // 05/09 em São Paulo (UTC-3) = 03:00Z do dia 5 até 02:59:59.999Z do dia 6.
    expect(datas[0]).toBe("2026-09-05 03:00:00.000");
    expect(datas[1]).toBe("2026-09-06 02:59:59.999");
  });
});

describe("o servidor grava e limpa a data", () => {
  const router = ler("server/escritorio/router-kanban.ts");

  it("mover pra coluna de conclusão grava a data; pra coluna normal, limpa", () => {
    const i = router.indexOf("const concluidoEm = destino.tipo === \"conclusao\"");
    expect(i, "a gravação da data de conclusão sumiu do moverCard").toBeGreaterThan(-1);
    expect(router.slice(i, i + 90)).toContain("? new Date()");
    expect(router.slice(i, i + 90), "sair da conclusão tem que LIMPAR a data").toContain(": null");
    // E o UPDATE tem que levar o campo, não só calculá-lo.
    const j = router.indexOf("colunaId: input.colunaDestinoId, ordem: ordemFinal");
    expect(router.slice(j, j + 120)).toContain("concluidoEm");
  });

  it("card criado DIRETO numa coluna de conclusão já nasce com data", () => {
    // Esse card nunca é movido, então nunca passaria pelo `moverCard` — sem
    // isto ele ficaria fora do filtro pra sempre.
    const i = router.indexOf("concluidoEm: colunaAlvo.tipo === \"conclusao\"");
    expect(i, "o criarCard não grava a data de conclusão").toBeGreaterThan(-1);
    expect(router.slice(i, i + 80)).toContain("? new Date()");
    // E a consulta da coluna precisa trazer o `tipo`, senão é sempre
    // undefined. Recortado no `criarCard`: o `moverCard` faz a MESMA consulta,
    // e olhar o arquivo inteiro deixava a mutação passar verde.
    const criar = router.slice(router.indexOf("criarCard:"), i);
    expect(criar, "a coluna alvo do criarCard não traz o tipo").toContain(
      "select({ id: kanbanColunas.id, tipo: kanbanColunas.tipo })",
    );
  });

  it("as duas procedures aceitam `campoData` — quadro e PDF", () => {
    expect(router.match(/campoData: z\.enum\(\["criado", "concluido"\]\)/g)?.length).toBe(2);
  });

  it("o PDF diz no rótulo QUAL data foi filtrada", () => {
    // O mesmo intervalo devolve listas diferentes nas duas datas; o arquivo
    // impresso tem que contar qual delas ele é.
    expect(router).toContain('" (por conclusão)" : " (por criação)"');
  });
});

describe("a migration 0231 recupera o passado", () => {
  const sql = ler("drizzle/0231_kanban_concluido_em.sql");

  it("a coluna é aditiva e nasce NULL", () => {
    expect(sql).toMatch(/ADD COLUMN concluidoEmKCard TIMESTAMP NULL DEFAULT NULL/);
  });

  it("preenche pela ÚLTIMA entrada em coluna de conclusão, não pela primeira", () => {
    expect(sql).toContain("MAX(m.createdAtKMov)");
    expect(sql).toContain("d.tipoKC = 'conclusao'");
  });

  it("só preenche quem está AGORA concluído, e zera quem não está", () => {
    // A regra é "vale a última vez, e some se o card voltar pro fluxo".
    expect(sql).toContain("SET c.concluidoEmKCard = NULL");
    expect(sql).toContain("WHERE kc.tipoKC <> 'conclusao'");
  });

  it("card criado direto na conclusão, sem histórico, cai na data de criação", () => {
    expect(sql).toContain("SET c.concluidoEmKCard = c.createdAtKCard");
  });

  it("o índice acompanha o escritório — o filtro varre a faixa toda", () => {
    expect(sql).toContain("(escritorioIdKCard, concluidoEmKCard)");
  });
});

describe("a tela", () => {
  const barra = ler("client/src/pages/kanban/filtros-bar.tsx");

  it("a escolha da data vem ANTES do intervalo", () => {
    const seletor = barra.indexOf("Contar pela data de");
    const de = barra.indexOf(">De<");
    expect(seletor).toBeGreaterThan(-1);
    expect(de).toBeGreaterThan(-1);
    expect(seletor, "quem digita as datas primeiro erra de qual estava falando")
      .toBeLessThan(de);
    expect(barra).toContain('<SelectItem value="criado">Criação do card</SelectItem>');
    expect(barra).toContain('<SelectItem value="concluido">Conclusão do card</SelectItem>');
  });

  it("o rótulo do botão muda junto com a escolha", () => {
    expect(barra).toContain('filtros.campoData === "concluido" ? "Concluído em" : "Criado em"');
  });

  it("escolher conclusão SEM período não grava campoData", () => {
    // Senão o rótulo diria "Concluído em" sem filtro nenhum aplicado.
    expect(barra).toContain('campoData: temPeriodo && campoLocal === "concluido" ? "concluido" : undefined');
  });

  it("limpar o período limpa a escolha junto", () => {
    const i = barra.indexOf("Limpar");
    const bloco = barra.slice(Math.max(0, i - 700), i);
    expect(bloco).toContain("campoData: undefined");
  });

  it("avisa que só entram cards concluídos", () => {
    expect(barra).toContain("Só entram os cards que estão numa coluna de conclusão");
  });
});
