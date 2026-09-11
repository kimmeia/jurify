/**
 * "Todo módulo que usa créditos, substituir por limite que definirei no plano.
 * Vamos usar limites para tudo para simplificar e acabar com esse uso de
 * créditos." (dono, 11/09/2026.)
 *
 * O que existia: processos vigiados e CPFs vigiados tinham limite de VAGA no
 * plano E consumiam crédito; consultar processo, buscar por CPF/CNPJ, resumir
 * com IA e calcular saíam do MESMO saldo, com preços diferentes por operação
 * (1, 3, 1, 1) — e a cota mensal de crédito era derivada do próprio plano
 * (cálculos + vigiados×2 + CPFs×15). O plano financiava em crédito aquilo que
 * ele também limitava por vaga.
 *
 * Agora: vaga continua vaga, e cada operação avulsa tem um teto mensal escrito
 * no plano, com contador que zera na virada do mês.
 *
 * Grandfather: `null` E `0` significam "sem limite". Os planos antigos têm 0
 * em campos que ninguém conferia — tratar 0 como teto barraria todo mundo no
 * dia do deploy.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  ACAO_OPERACAO,
  CAMPO_DO_PLANO,
  OPERACOES_LIMITADAS,
  ROTULO_OPERACAO,
  competenciaDaData,
  excedeuLimite,
  fracaoUsada,
  limiteVale,
  mensagemLimiteAtingido,
} from "../../shared/limites-uso";
import { LIMITE_ILIMITADO } from "../../shared/planos-types";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("a régua: o que conta como limite", () => {
  it("null e 0 são 'sem limite' — é o que preserva os planos antigos", () => {
    expect(limiteVale(null)).toBe(false);
    expect(limiteVale(undefined)).toBe(false);
    expect(limiteVale(0)).toBe(false);
  });

  it("o marcador de ilimitado também não barra", () => {
    expect(limiteVale(LIMITE_ILIMITADO)).toBe(false);
    expect(limiteVale(LIMITE_ILIMITADO + 10)).toBe(false);
  });

  it("número escrito de propósito vale", () => {
    expect(limiteVale(1)).toBe(true);
    expect(limiteVale(300)).toBe(true);
  });

  it("estourou quando chegou no teto — não quando passou dele", () => {
    expect(excedeuLimite(199, 200)).toBe(false);
    expect(excedeuLimite(200, 200)).toBe(true);
    expect(excedeuLimite(201, 200)).toBe(true);
  });

  it("sem limite nunca estoura", () => {
    expect(excedeuLimite(99999, null)).toBe(false);
    expect(excedeuLimite(99999, 0)).toBe(false);
  });

  it("a barra não assusta quando não há limite", () => {
    expect(fracaoUsada({ operacao: "calculo", usado: 500, limite: null, extra: 0 })).toBe(0);
    expect(fracaoUsada({ operacao: "calculo", usado: 50, limite: 100, extra: 0 })).toBe(0.5);
    expect(fracaoUsada({ operacao: "calculo", usado: 300, limite: 100, extra: 0 })).toBe(1);
  });
});

describe("a competência é o que faz o contador zerar", () => {
  it("usa o fuso de Brasília, não o do servidor", () => {
    // 1º de outubro às 02h UTC ainda é 30 de setembro em Brasília.
    expect(competenciaDaData(new Date("2026-10-01T02:00:00Z"))).toBe("2026-09");
    expect(competenciaDaData(new Date("2026-10-01T12:00:00Z"))).toBe("2026-10");
  });

  it("vira no primeiro instante do mês local", () => {
    expect(competenciaDaData(new Date("2026-09-30T23:59:00-03:00"))).toBe("2026-09");
    expect(competenciaDaData(new Date("2026-10-01T00:01:00-03:00"))).toBe("2026-10");
  });
});

describe("as quatro operações", () => {
  it("cada uma tem rótulo, ação e campo no plano", () => {
    for (const op of OPERACOES_LIMITADAS) {
      expect(ROTULO_OPERACAO[op]).toBeTruthy();
      expect(ACAO_OPERACAO[op]).toBeTruthy();
      expect(CAMPO_DO_PLANO[op]).toBeTruthy();
    }
  });

  it("vigiar processo e vigiar CPF NÃO entram: são vaga, não consumo do mês", () => {
    expect(OPERACOES_LIMITADAS).not.toContain("monitorar_processo_mes" as never);
    expect(OPERACOES_LIMITADAS).not.toContain("monitorar_pessoa_mes" as never);
  });

  it("cálculo aponta para o campo que o plano já tinha", () => {
    expect(CAMPO_DO_PLANO.calculo).toBe("creditosCalculosMes");
  });

  it("a mensagem de bloqueio diz o número e manda falar com a gente", () => {
    expect(mensagemLimiteAtingido("consulta_processo", 200)).toBe(
      "Você usou 200 consultas de processo deste mês. Fale com a gente para liberar mais.",
    );
  });

  it("a mensagem NÃO oferece compra avulsa (decisão do dono)", () => {
    for (const op of OPERACOES_LIMITADAS) {
      const m = mensagemLimiteAtingido(op, 10).toLowerCase();
      expect(m).not.toContain("compr");
      expect(m).not.toContain("pacote");
    }
  });
});

describe("o motor no servidor", () => {
  const motor = ler("server/billing/limites-uso.ts");

  it("fail-open: cortesia e plano não resolvido não barram", () => {
    expect(motor).toContain("if (!sub?.planId || sub.cortesia) return null;");
    expect(motor).toContain("if (!plano) return null;");
  });

  it("erro de leitura libera em vez de barrar", () => {
    expect(motor).toContain("Falha ao ler limite de uso — liberando");
  });

  it("o extra concedido soma ao limite do plano", () => {
    expect(motor).toContain("return (bruto as number) + Math.max(0, extra);");
  });

  it("o contador é por escritório, competência e operação", () => {
    expect(motor).toContain("eq(escritorioUsoMensal.escritorioId, escritorioId)");
    expect(motor).toContain("eq(escritorioUsoMensal.competencia, competenciaAtual())");
    expect(motor).toContain("eq(escritorioUsoMensal.operacao, operacao)");
  });

  it("somar uso nunca derruba a operação que já aconteceu", () => {
    expect(motor).toContain("Falha ao registrar uso do mês");
  });

  it("o extra vale só no mês: entra na linha da competência, não vira saldo", () => {
    expect(motor).toContain("extraConcedido: sql`${escritorioUsoMensal.extraConcedido} + ${quantidade}`");
  });
});

describe("as operações passaram a contar no limite", () => {
  const processos = ler("server/routers/processos.ts");

  it("consultar processo conta nos TRÊS caminhos que consultam", () => {
    // consultarCNJ, detalhe do CNJ e histórico do monitoramento. Contar em um
    // e esquecer os outros é como o limite vazaria sem ninguém ver.
    const chamadas = processos.match(/await contarUso\(esc\.escritorio\.id, "consulta_processo"\);/g) ?? [];
    expect(chamadas).toHaveLength(3);
  });

  it("buscar por CPF/CNPJ conta na régua própria (decisão do dono: dois limites)", () => {
    expect(processos).toContain('await contarUso(esc.escritorio.id, "busca_documento");');
  });

  it("resumo de IA conta", () => {
    expect(processos).toContain('await contarUso(esc.escritorio.id, "resumo_ia");');
  });

  it("nenhuma operação de processo debita crédito", () => {
    expect(processos).not.toContain("consumirCreditosEscritorio");
    expect(processos).not.toContain("await consumirCreditos(");
  });

  it("vigiar processo e vigiar CPF deixaram de cobrar — a vaga já mandou", () => {
    expect(processos).toContain("Vigiar processo não conta no limite mensal");
    expect(processos).toContain("Vigiar CPF/CNPJ também é VAGA do plano");
    expect(processos).toContain("verificarLimiteMonitoramentos");
  });

  it("a importação também parou de debitar por monitor", () => {
    const importador = ler("server/escritorio/router-importar-processos.ts");
    expect(importador).not.toContain("consumirCreditosEscritorio");
    expect(importador).toContain("Vigiar processo é VAGA do plano");
  });

  it("cálculo conta no teto do mês (era o mesmo bolso dos processos)", () => {
    const db = ler("server/db.ts");
    expect(db).toContain('const aval = await verificarUso(esc.escritorio.id, "calculo");');
    expect(db).toContain('await registrarUso(esc.escritorio.id, "calculo");');
  });

  it("o saldo de créditos e o histórico continuam no banco", () => {
    // Decisão do dono: "param de valer, e nada é apagado".
    expect(ler("server/billing/escritorio-creditos.ts")).toContain("export async function consumirCreditosEscritorio");
    expect(ler("drizzle/0221_limites_uso_mensal.sql")).not.toMatch(/DROP TABLE|DELETE FROM/i);
  });

  it("sem escritório resolvido, consumirCredito libera (fail-open, igual ao resto da régua)", () => {
    // O docstring de consumirCredito promete "sem banco, sem escritório, plano
    // não resolvido" liberam — mas o `if (!esc) return false` sobrevivia do
    // desenho antigo (saldo de crédito, onde negar sem escritório fazia
    // sentido) e barrava exatamente o caso que o próprio comentário descreve
    // como liberado. Sem este `return true`, quem cai aqui via a mensagem
    // errada "Seus créditos acabaram" nos 5 routers de cálculo.
    const db = ler("server/db.ts");
    const trecho = db.slice(db.indexOf("export async function consumirCredito"));
    expect(trecho).toContain("const esc = await getEscritorioPorUsuario(userId);\n    if (!esc) return true;");
  });
});

describe("a tela mostra barra de uso no lugar do saldo", () => {
  const painel = ler("client/src/components/UsoDoMes.tsx");

  it("operação sem limite some da lista", () => {
    expect(painel).toContain("filter((u: UsoDoMesItem) => limiteVale(u.limite))");
  });

  it("a barra muda de cor perto do fim", () => {
    expect(painel).toContain('if (fracao >= 1) return "bg-danger";');
    expect(painel).toContain('if (fracao >= 0.8) return "bg-warning";');
  });

  it("o extra liberado aparece", () => {
    expect(painel).toContain("liberados");
  });

  it("o dashboard trocou o card de créditos pelo de uso", () => {
    const dash = ler("client/src/pages/dashboards/DashboardGeral.tsx");
    expect(dash).toContain("<UsoDoMes titulo=\"\" />");
    expect(dash).not.toContain('titulo="Créditos de cálculo"');
  });

  it("a tela de Cálculos mostra o teto do mês, não o saldo", () => {
    const calc = ler("client/src/pages/calculos/Calculos.tsx");
    expect(calc).toContain("Cálculos deste mês");
    expect(calc).toContain('u.operacao === "calculo"');
    expect(calc).not.toContain('<p className="text-xs text-white/70 mb-1">Disponíveis</p>');
  });
});

describe("o painel define os limites e libera mais", () => {
  const admin = ler("server/routers/admin.ts");

  it("o plano ganhou os três campos novos", () => {
    for (const campo of ["maxConsultasProcessoMes", "maxBuscasDocumentoMes", "maxResumosIaMes"]) {
      expect(admin).toContain(`${campo}: z.number().int().min(0).nullable().optional(),`);
      expect(admin).toContain(`dadosUpdate.${campo} = input.${campo};`);
    }
  });

  it("existe como aumentar o limite deste mês", () => {
    expect(admin).toContain("aumentarLimiteDoMes: adminProcedure");
    expect(admin).toContain("await concederExtra(esc.escritorio.id, input.operacao, input.quantidade);");
  });

  it("aumentar limite é auditado, com a competência", () => {
    expect(admin).toContain('acao: "admin_aumentou_limite_mes"');
    expect(admin).toContain("competencia: competenciaAtual()");
  });

  it("o editor de planos tem os três campos", () => {
    const editor = ler("client/src/pages/admin/AdminPlanoEditor.tsx");
    expect(editor).toContain('label="Consultas de processo / mês"');
    expect(editor).toContain('label="Buscas por CPF/CNPJ / mês"');
    expect(editor).toContain('label="Resumos de IA / mês"');
  });
});

describe("a migration é não-destrutiva e faz grandfather", () => {
  const sql = ler("drizzle/0221_limites_uso_mensal.sql");

  it("as colunas nascem NULL — nenhum plano existente passa a barrar", () => {
    expect(sql).toContain("ADD COLUMN max_consultas_processo_mes INT DEFAULT NULL");
    expect(sql).toContain("ADD COLUMN max_buscas_documento_mes   INT DEFAULT NULL");
    expect(sql).toContain("ADD COLUMN max_resumos_ia_mes         INT DEFAULT NULL");
  });

  it("só os três planos do pacote recebem teto", () => {
    for (const slug of ["atende", "escritorio", "escala"]) {
      expect(sql).toContain(`WHERE slug = '${slug}'`);
    }
  });

  it("nada é apagado", () => {
    expect(sql).not.toMatch(/DROP|DELETE FROM|TRUNCATE/i);
  });

  it("o boot também cria a tabela e as colunas", () => {
    const auto = ler("server/_core/auto-migrate.ts");
    expect(auto).toContain("CREATE TABLE IF NOT EXISTS escritorio_uso_mensal");
    expect(auto).toContain("max_consultas_processo_mes");
  });
});
