/**
 * A moeda "crédito" saiu do JuridFlow — autorização do dono em 13/09: "tudo
 * referente a creditos pode excluir caso pois não usaremos mais isso".
 *
 * Contexto que torna a remoção segura, e que foi conferido ANTES de cortar:
 * desde 11/09 o crédito já não decidia nada. `consumirCredito` — o nome
 * sobreviveu à troca — por dentro chamava `verificarUso`/`registrarUso` do
 * TETO MENSAL, e mesmo assim a tela dizia "Seus créditos acabaram. Adquira
 * mais créditos", mandando comprar o que não estava à venda.
 *
 * Três coisas que NÃO são a moeda e por isso continuam de pé:
 *   1. `creditosCalculosMes` — a coluna guardou o nome antigo, mas É o teto
 *      mensal de cálculos (`CAMPO_DO_PLANO.calculo`). Apagá-la tiraria o
 *      limite. O que mudou foi o RÓTULO na tela do painel.
 *   2. as tabelas `escritorio_creditos`/`escritorio_transacoes` — histórico
 *      não se joga fora por migration; ninguém mais lê.
 *   3. "cartão de crédito", "Crédito Pessoal", "crédito em mês diferente" —
 *      mesma palavra, outro assunto. Uma varredura cega por "crédito"
 *      destruiria o módulo de cálculo bancário.
 *
 * O achado mais grave da varredura está no último describe.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
const existe = (rel: string) => fs.existsSync(path.join(raiz, rel));

describe("o mecanismo da moeda foi embora", () => {
  it("os módulos que mantinham saldo, custo e migração não existem mais", () => {
    expect(existe("server/billing/escritorio-creditos.ts")).toBe(false);
    expect(existe("server/processos/custos-creditos.ts")).toBe(false);
    expect(existe("server/billing/migrate-legacy-credits.ts")).toBe(false);
  });

  it("nenhum arquivo de produção importa o que foi removido", () => {
    for (const f of [
      "server/routers/processos.ts",
      "server/routers/admin.ts",
      "server/routers/dashboard.ts",
      "server/_core/cron-jobs.ts",
      "server/processos/cron-monitoramento.ts",
    ]) {
      const fonte = ler(f);
      expect(fonte, `${f} ainda importa o módulo de créditos`).not.toContain("escritorio-creditos");
      expect(fonte, `${f} ainda importa a tabela de custos`).not.toContain("custos-creditos");
    }
  });

  it("as procedures da moeda saíram do servidor", () => {
    const proc = ler("server/routers/processos.ts");
    expect(proc).not.toContain("saldo: protectedProcedure");
    expect(proc).not.toContain("adicionarCreditos");
    const admin = ler("server/routers/admin.ts");
    for (const p of ["concederCreditos", "retirarCreditos", "migrarCreditosLegacy"]) {
      expect(admin, `${p} ainda existe`).not.toContain(`${p}:`);
    }
    expect(ler("server/routers/dashboard.ts")).not.toContain("credits: protectedProcedure");
  });

  it("o que substituiu cada um continua lá", () => {
    // Operação avulsa → teto mensal; vaga de monitoramento → limite do plano;
    // "dar créditos" → aumentar o limite DESTE mês.
    // Import E chamada: trocar só uma das duas deixava o literal de pé e o
    // mutante passava — foi o que aconteceu na 1ª volta desta bateria.
    const proc = ler("server/routers/processos.ts");
    expect(proc).toContain('const { consumirUso } = await import("../billing/limites-uso");');
    expect(proc).toContain("await consumirUso(escritorioId, operacao);");
    expect(ler("server/routers/admin.ts")).toContain("aumentarLimiteDoMes:");
    expect(ler("server/routers/dashboard.ts")).toContain("usoDoMes:");
  });
});

describe("o teto mensal de cálculos NÃO foi confundido com a moeda", () => {
  it("`creditosCalculosMes` continua sendo o campo do plano que limita cálculo", () => {
    expect(ler("shared/limites-uso.ts")).toContain('calculo: "creditosCalculosMes"');
    expect(ler("drizzle/schema.ts")).toContain('creditosCalculosMes: int("creditos_calculos_mes")');
  });

  it("a função que conta cálculo diz o que faz, e o teto decide de verdade", () => {
    const db = ler("server/db.ts");
    expect(db).toContain("export async function contarCalculoNoMes");
    // Ancorado na DECLARAÇÃO: o nome antigo sobrevive no comentário que
    // explica a troca, e olhar o arquivo inteiro reprovaria o próprio registro.
    expect(db, "o nome era a última mentira de pé")
      .not.toContain("export async function consumirCredito");
    expect(db).toContain('verificarUso(esc.escritorio.id, "calculo")');
  });

  it("a mensagem de limite parou de mandar comprar o que não se vende", () => {
    for (const f of [
      "server/calculos/router-financiamento.ts",
      "server/calculos/router-imobiliario.ts",
      "server/calculos/router-previdenciario.ts",
      "server/calculos/router-trabalhista.ts",
    ]) {
      const fonte = ler(f);
      expect(fonte, `${f} ainda fala em crédito`).not.toMatch(/créditos acabaram|Adquira mais créditos|Créditos esgotados/);
      expect(fonte).toContain("contarCalculoNoMes");
      expect(fonte).toContain("limite de cálculos do seu plano");
    }
  });

  it("o painel de planos rotula o campo pelo que ele faz", () => {
    const editor = ler("client/src/pages/admin/AdminPlanoEditor.tsx");
    expect(editor).toContain('label="Cálculos por mês"');
    expect(editor).not.toContain('label="Créditos cálculo/mês"');
  });
});

describe("a moeda saiu das telas", () => {
  it("Processos não fala em crédito nem mostra saldo", () => {
    const tela = ler("client/src/pages/Processos.tsx");
    expect(tela).not.toMatch(/créditos?/i);
    expect(tela, "o chip de saldo saiu").not.toContain("processos.saldo");
    expect(tela, "o aviso que mandava comprar saiu").not.toContain("Saldo baixo.");
  });

  it("as telas de cálculo dizem limite do mês, não crédito", () => {
    for (const f of [
      "client/src/pages/calculos/Bancario.tsx",
      "client/src/pages/calculos/Imobiliario.tsx",
      "client/src/pages/calculos/Previdenciario.tsx",
    ]) {
      const fonte = ler(f);
      expect(fonte, `${f} ainda anuncia custo em crédito`)
        .not.toMatch(/consome 1 crédito|\(1 crédito\)|crédito descontado/i);
    }
  });

  it("o painel admin não concede, retira nem mostra saldo", () => {
    const admin = ler("client/src/pages/admin/AdminClients.tsx");
    for (const s of ["concederCreditos", "retirarCreditos", "migrarCreditosLegacy", "creditosQtd"]) {
      expect(admin, `${s} ainda está na tela`).not.toContain(s);
    }
  });

  it("o Dashboard mostra uso do mês no lugar da barra de saldo", () => {
    const dash = ler("client/src/pages/dashboards/DashboardGeral.tsx");
    expect(dash).not.toContain("dashboard.credits");
    expect(dash).not.toContain("percentCreditos");
    expect(dash, "o substituto tem que estar montado").toContain("<UsoDoMes");
  });

  it("o que é 'crédito' em outro sentido não foi tocado", () => {
    // Uma varredura cega por "crédito" levaria o módulo bancário junto.
    expect(ler("client/src/pages/calculos/Bancario.tsx")).toContain("Crédito Pessoal");
    expect(ler("client/src/pages/financeiro/FiltrosAtribuir.tsx")).toContain("Cartão de crédito");
    expect(ler("client/src/pages/financeiro/Relatorios.tsx")).toContain("creditoMesDiferente");
  });
});

describe("acesso e monitoramento pararam de depender de saldo", () => {
  it("entrar no app é ter assinatura, e só", () => {
    const guard = ler("client/src/components/SubscriptionGuard.tsx");
    expect(guard).toContain("const hasAccess = !!subscription;");
    expect(guard, "crédito era a segunda porta").not.toContain("hasCredits");
    const layout = ler("client/src/components/AppLayout.tsx");
    expect(layout).toContain("const itemsLocked = isUser && subFetched && !hasSubscription;");
    expect(layout).not.toContain("hasCredits");
  });

  it("o cron que PAUSAVA monitoramento por saldo baixo não existe mais", () => {
    // O pior achado da varredura: `cobrarMonitoramentosMensais` rodava a cada
    // 6h, debitava crédito por processo vigiado e, sem saldo, marcava o
    // monitoramento como "pausado" e notificava o advogado. Com a moeda
    // parada de ser recarregada, ele viraria uma máquina de desligar vigia.
    expect(ler("server/processos/cron-monitoramento.ts"))
      .not.toContain("export async function cobrarMonitoramentosMensais");
    const crons = ler("server/_core/cron-jobs.ts");
    expect(crons).not.toContain("cobrarMonitoramentosMensais");
    expect(crons, "o reset de cota também saiu").not.toContain("resetCotaMensalEscritorios");
  });

  it("quem barra monitoramento continua sendo a VAGA do plano", () => {
    const proc = ler("server/routers/processos.ts");
    const vagas = proc.match(/verificarLimiteMonitoramentos\(/g) ?? [];
    expect(vagas.length, "a régua da vaga sumiu junto com a moeda").toBeGreaterThanOrEqual(2);
  });
});

describe("o cartão do plano parou de vender o que a conta não mostra", () => {
  const mig = ler("drizzle/0229_cartao_sem_ponto_da_equipe.sql");

  it("o Ponto sai do texto do cartão", () => {
    expect(mig).toContain("'Comissões automáticas por colaborador'");
    expect(mig).toContain("Comissões automáticas por colaborador e ponto da equipe");
  });

  it("a cesta do plano NÃO é tocada — o módulo volta quando sair do beta", () => {
    // Mesma coisa: a cesta é CITADA no comentário que explica por que ela
    // fica. O que não pode existir é um UPDATE nela.
    expect(mig).not.toMatch(/SET\s+modulos_liberados/i);
    expect(mig).not.toMatch(/DROP|DELETE\s+FROM/i);
  });

  it("troca por texto, não por posição: a lista é editável no painel", () => {
    // As TRÊS: o caminho do JSON_REPLACE, o valor procurado e a guarda do
    // WHERE. Conferir só "existe um JSON_SEARCH" deixava trocar o caminho por
    // um índice fixo ('$[2]') com o literal ainda de pé no WHERE.
    expect((mig.match(/JSON_SEARCH\(features, 'one'/g) || []).length,
      "o caminho do REPLACE e a guarda do WHERE").toBe(2);
    expect(mig).toContain("JSON_UNQUOTE(JSON_SEARCH(features, 'one'");
    expect(mig, "índice fixo quebra quem editou a lista no painel").not.toMatch(/'\$\[\d+\]'/);
    expect(mig, "rodar duas vezes não pode quebrar").toContain("IS NOT NULL");
  });
});
