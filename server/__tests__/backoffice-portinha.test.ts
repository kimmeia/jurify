/**
 * Portinha de leitura consumida pelo backoffice (backoffice.devular.com.br).
 *
 * O que estas amarras protegem, em ordem de gravidade:
 *  1. fail-CLOSED — sem chave no servidor a rota recusa TODO MUNDO. É o
 *     oposto do porteiro de módulos e do HMAC da Meta, que são fail-open de
 *     propósito; aqui abrir por falta de configuração seria porta aberta
 *     entre dois produtos.
 *  2. segredo nenhum sai — `admin_integracoes` guarda a chave cifrada na
 *     MESMA linha que o status.
 *  3. integração nunca testada não é integração com falha.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  CONTAS_POR_PAGINA,
  CONTRATO_BACKOFFICE_VERSAO,
  montarListaContas,
  montarResumoBackoffice,
  situacaoDaConta,
  statusDaIntegracao,
} from "../../shared/backoffice-contrato";
import {
  TAMANHO_MINIMO_CHAVE,
  buscaPedida,
  conferirChave,
  extrairBearer,
  paginaPedida,
} from "../backoffice/rota-resumo";

const CHAVE = "k".repeat(48);

const raiz = path.resolve(__dirname, "../..");
const fonteRota = fs.readFileSync(path.join(raiz, "server/backoffice/rota-resumo.ts"), "utf8");
const fonteCore = fs.readFileSync(path.join(raiz, "server/_core/index.ts"), "utf8");

describe("chave da portinha", () => {
  it("sem chave no servidor recusa até quem manda a chave certa", () => {
    expect(conferirChave(`Bearer ${CHAVE}`, undefined)).toBe("servidor_sem_chave");
    expect(conferirChave(`Bearer ${CHAVE}`, "")).toBe("servidor_sem_chave");
  });

  it("chave curta demais no servidor não vale como chave", () => {
    const curta = "k".repeat(TAMANHO_MINIMO_CHAVE - 1);
    expect(conferirChave(`Bearer ${curta}`, curta)).toBe("servidor_sem_chave");
  });

  it("aceita a chave certa e recusa a errada de mesmo tamanho", () => {
    expect(conferirChave(`Bearer ${CHAVE}`, CHAVE)).toBe("ok");
    expect(conferirChave(`Bearer ${"x".repeat(48)}`, CHAVE)).toBe("chave_invalida");
  });

  it("recusa sem header, sem Bearer e com tamanho diferente sem estourar", () => {
    expect(conferirChave(undefined, CHAVE)).toBe("chave_invalida");
    expect(conferirChave(CHAVE, CHAVE)).toBe("chave_invalida");
    expect(conferirChave("Bearer curta", CHAVE)).toBe("chave_invalida");
  });

  it("extrai o token tolerando espaço extra, e recusa lixo", () => {
    expect(extrairBearer("Bearer  abc ")).toBe("abc");
    expect(extrairBearer("  Bearer abc")).toBe("abc");
    expect(extrairBearer("Basic abc")).toBeNull();
    expect(extrairBearer("Bearer")).toBeNull();
    expect(extrairBearer("Bearer   ")).toBeNull();
    expect(extrairBearer(undefined)).toBeNull();
  });

  it("a rota trata os três veredictos, e o de servidor sem chave NÃO responde 200", () => {
    expect(fonteRota).toContain("servidor_sem_chave");
    expect(fonteRota).toContain("status(503)");
    expect(fonteRota).toContain("status(401)");
    // o 503 tem que vir antes da CHAMADA (não da definição de montarResposta,
    // que fica acima do handler), senão a saída antecipada some
    expect(fonteRota.indexOf("status(503)")).toBeLessThan(
      fonteRota.indexOf("await montarResposta()"),
    );
  });
});

describe("resposta", () => {
  const entrada = {
    produto: "juridflow",
    agora: new Date("2026-09-13T12:00:00.000Z"),
    stats: {
      totalClients: 50,
      activeSubscriptions: 38,
      trialingSubscriptions: 9,
      pastDueSubscriptions: 3,
      cortesiasAtivas: 2,
      mrr: 1_421_200,
    },
    integracoes: [
      { provedor: "asaas", nomeExibicao: "Asaas", status: "conectado", ultimoTeste: new Date("2026-09-13T11:56:00.000Z") },
      { provedor: "meta", nomeExibicao: "WhatsApp", status: "erro", ultimoTeste: null },
      { provedor: "resend", nomeExibicao: "Resend", status: "desconectado", ultimoTeste: null },
    ],
  };

  it("mapeia contas e receita sem inventar conta", () => {
    const r = montarResumoBackoffice(entrada);
    expect(r.contrato).toBe(CONTRATO_BACKOFFICE_VERSAO);
    expect(r.produto).toBe("juridflow");
    expect(r.geradoEm).toBe("2026-09-13T12:00:00.000Z");
    expect(r.contas).toEqual({ pagantes: 38, emTeste: 9, inadimplentes: 3, cortesias: 2, total: 50 });
  });

  it("produto que não conta cortesias manda null, nunca 0", () => {
    const { cortesiasAtivas, ...semCortesias } = entrada.stats;
    void cortesiasAtivas;
    const r = montarResumoBackoffice({ ...entrada, stats: semCortesias });
    // 0 diria "conferi e não há nenhuma"; null diz "ninguém contou"
    expect(r.contas.cortesias).toBeNull();
    expect(r.receita).toEqual({ mrrCentavos: 1_421_200, moeda: "BRL" });
  });

  it("integração nunca testada é 'desconhecido', não 'falha'", () => {
    expect(statusDaIntegracao("desconectado")).toBe("desconhecido");
    expect(statusDaIntegracao("qualquer_coisa_nova")).toBe("desconhecido");
    expect(statusDaIntegracao("conectado")).toBe("ok");
    expect(statusDaIntegracao("erro")).toBe("falha");

    const r = montarResumoBackoffice(entrada);
    expect(r.integracoes.map((i) => i.status)).toEqual(["ok", "falha", "desconhecido"]);
    expect(r.integracoes[0].conferidaEm).toBe("2026-09-13T11:56:00.000Z");
    expect(r.integracoes[1].conferidaEm).toBeNull();
  });

  it("nenhum campo de segredo sai na resposta", () => {
    const serializada = JSON.stringify(
      montarResumoBackoffice({
        ...entrada,
        // mesmo que a consulta um dia traga a linha inteira, o montador só
        // copia os quatro campos que declara
        integracoes: [
          {
            provedor: "asaas",
            nomeExibicao: "Asaas",
            status: "conectado",
            ultimoTeste: null,
            apiKeyEncrypted: "SEGREDO_QUE_NAO_PODE_SAIR",
            apiKeyIv: "iv",
            apiKeyTag: "tag",
          } as never,
        ],
      }),
    );
    expect(serializada).not.toContain("SEGREDO_QUE_NAO_PODE_SAIR");
    for (const proibido of ["apiKey", "Encrypted", "apiKeyIv", "apiKeyTag", "password", "secret"]) {
      expect(serializada).not.toContain(proibido);
    }
  });

  it("a consulta lista as colunas uma a uma, nunca select() na tabela inteira", () => {
    // `select()` sem lista traz as três colunas de chave cifrada junto.
    // A conferência é DENTRO do bloco do select — o nome da coluna aparece
    // legitimamente no comentário que explica o perigo, logo acima.
    const blocoSelect = /\.select\(\{([\s\S]*?)\}\)/.exec(fonteRota)?.[1];
    expect(blocoSelect, "não achei o select da portinha").toBeTruthy();
    expect(blocoSelect).toContain("adminIntegracoes.provedor");
    expect(blocoSelect).toContain("adminIntegracoes.status");
    expect(blocoSelect).not.toMatch(/apiKey/i);
    expect(fonteRota).not.toMatch(/\.select\(\)\s*\.from\(adminIntegracoes\)/);
  });
});

describe("banco fora não vira notícia falsa", () => {
  /**
   * getAdminStats devolve tudo ZERO quando o banco está fora. Servir esses
   * zeros faz o painel anunciar "R$ 0 de MRR" — receita sumindo da tela sem
   * nada de errado no negócio. A rota tem que calar (503), não mentir.
   */
  it("montarResposta consulta getDb e aborta antes de somar", () => {
    expect(fonteRota).toContain("BancoIndisponivel");
    const corpo = fonteRota.slice(fonteRota.indexOf("export async function montarResposta"));
    const guarda = corpo.indexOf("getDb()");
    const soma = corpo.indexOf("getAdminStats()");
    expect(guarda).toBeGreaterThan(-1);
    expect(guarda).toBeLessThan(soma);
    expect(corpo).toMatch(/if\s*\(!\(await getDb\(\)\)\)\s*throw/);
  });

  it("a rota devolve 503 nesse caso, não 200 nem 500", () => {
    const trecho = fonteRota.slice(fonteRota.indexOf("catch (err)"));
    expect(trecho).toMatch(/instanceof BancoIndisponivel[\s\S]*status\(503\)/);
    // o 503 tem que sair ANTES do 500 genérico, senão nunca é alcançado
    expect(trecho.indexOf("status(503)")).toBeLessThan(trecho.indexOf("status(500)"));
  });
});

describe("lista de contas", () => {
  const linha = (over: Record<string, unknown> = {}) => ({
    id: 7,
    name: "Castro Nogueira Sociedade de Advogados",
    email: "contato@castronogueira.adv.br",
    planNome: "Escritório",
    planId: "escritorio",
    subStatus: "active",
    valorMensalCentavos: 29700,
    cortesia: false,
    cortesiaExpiraEm: null,
    createdAt: new Date("2026-03-12T10:00:00.000Z"),
    lastSignedIn: new Date("2026-09-11T18:22:00.000Z"),
    ...over,
  });

  const montar = (over: Record<string, unknown> = {}) =>
    montarListaContas({
      produto: "juridflow",
      agora: new Date("2026-09-13T12:00:00.000Z"),
      total: 38,
      pagina: 1,
      linhas: [linha(over)],
    });

  it("traduz a linha do banco para o vocabulário do painel", () => {
    const r = montar();
    expect(r.total).toBe(38);
    expect(r.porPagina).toBe(CONTAS_POR_PAGINA);
    expect(r.contas[0]).toEqual({
      id: 7,
      nome: "Castro Nogueira Sociedade de Advogados",
      email: "contato@castronogueira.adv.br",
      plano: "Escritório",
      situacao: "ativa",
      valorCentavos: 29700,
      desde: "2026-03-12T10:00:00.000Z",
      ultimoAcesso: "2026-09-11T18:22:00.000Z",
    });
  });

  it("cortesia NÃO conta como conta paga, mesmo sem validade", () => {
    const agoraMs = Date.parse("2026-09-13T12:00:00.000Z");
    // no banco cortesia fica com status "active" — sem a ordem certa ela
    // engordaria a lista de quem paga
    expect(situacaoDaConta({ subStatus: "active", cortesia: true, cortesiaExpiraEm: null, agoraMs }))
      .toBe("cortesia");
    expect(montar({ cortesia: true }).contas[0].situacao).toBe("cortesia");
  });

  it("cortesia VENCIDA volta a ser o que o status diz", () => {
    const agoraMs = Date.parse("2026-09-13T12:00:00.000Z");
    expect(situacaoDaConta({
      subStatus: "active", cortesia: true,
      cortesiaExpiraEm: Date.parse("2026-01-01T00:00:00.000Z"), agoraMs,
    })).toBe("ativa");
  });

  it("traduz os outros estados e não inventa nome para os desconhecidos", () => {
    const agoraMs = Date.now();
    expect(situacaoDaConta({ subStatus: "trialing", agoraMs })).toBe("em_teste");
    expect(situacaoDaConta({ subStatus: "past_due", agoraMs })).toBe("inadimplente");
    expect(situacaoDaConta({ subStatus: "unpaid", agoraMs })).toBe("inadimplente");
    expect(situacaoDaConta({ subStatus: null, agoraMs })).toBe("sem_assinatura");
    expect(situacaoDaConta({ subStatus: "incomplete", agoraMs })).toBe("incomplete");
  });

  it("conta sem nome e sem último acesso não quebra a linha", () => {
    const r = montar({ name: null, email: null, lastSignedIn: null, planNome: null, planId: null });
    expect(r.contas[0].nome).toBe("(sem nome)");
    expect(r.contas[0].email).toBe("");
    expect(r.contas[0].ultimoAcesso).toBeNull();
    expect(r.contas[0].plano).toBeNull();
  });

  it("página fora da faixa vira 1 — nunca OFFSET negativo", () => {
    expect(paginaPedida("3")).toBe(3);
    expect(paginaPedida("-3")).toBe(1);
    expect(paginaPedida("0")).toBe(1);
    expect(paginaPedida("abacaxi")).toBe(1);
    expect(paginaPedida(undefined)).toBe(1);
    expect(paginaPedida(["2", "9"])).toBe(2);
    expect(paginaPedida("2.9")).toBe(2);
  });

  it("busca é aparada e limitada", () => {
    expect(buscaPedida("  castro  ")).toBe("castro");
    expect(buscaPedida("x".repeat(500))).toHaveLength(120);
    expect(buscaPedida(undefined)).toBe("");
    expect(buscaPedida({ nao: "texto" })).toBe("");
  });

  it("a rota lê a MESMA função da tela Clientes do painel admin", () => {
    // consulta própria aqui faria os dois painéis divergirem no dia em que a
    // regra de "quem é cliente" mudasse num lugar só
    expect(fonteRota).toContain("getAllUsersWithSubscription");
    expect(fonteRota).toContain('tipo: "cliente"');
    expect(fonteRota).toMatch(/app\.get\("\/api\/backoffice\/contas"/);
  });

  it("contas também recusa sem chave e cala com o banco fora", () => {
    const trecho = fonteRota.slice(fonteRota.indexOf('"/api/backoffice/contas"'));
    expect(trecho).toContain("servidor_sem_chave");
    expect(trecho).toContain("status(401)");
    expect(trecho).toMatch(/instanceof BancoIndisponivel[\s\S]*status\(503\)/);
    const corpo = fonteRota.slice(fonteRota.indexOf("export async function montarContas"));
    expect(corpo).toMatch(/if\s*\(!\(await getDb\(\)\)\)\s*throw/);
  });
});

describe("registro no servidor", () => {
  it("a rota é registrada e tem teto de requisições", () => {
    // a CHAMADA, não o import: apagar só a chamada deixava o nome de pé na
    // linha do import e a amarra passava com a rota fora do ar
    expect(fonteCore).toMatch(/registerBackofficeRoutes\(app\)/);
    expect(fonteCore).toMatch(/app\.use\("\/api\/backoffice",\s*rateLimit\(/);
  });

  it("as DUAS rotas marcam a resposta como não cacheável", () => {
    // contar: com só um `toContain`, apagar o no-store de uma rota passava
    // batido porque o da outra ainda estava no arquivo
    const quantos = fonteRota.match(/Cache-Control", "no-store"/g)?.length ?? 0;
    expect(quantos).toBe(2);
  });
});

describe("cookie de sessão continua host-only", () => {
  /**
   * O backoffice mora em backoffice.devular.com.br, subdomínio do produto. Os
   * dois só ficam isolados porque o cookie de sessão NÃO declara `domain` —
   * cookie sem domain é host-only. No dia em que alguém escrever
   * `domain: ".devular.com.br"` aqui, os três apps passam a dividir sessão em
   * silêncio. Este teste é o que faz esse dia doer.
   */
  it("getSessionCookieOptions não define domain", () => {
    const fonte = fs.readFileSync(path.join(raiz, "server/_core/cookies.ts"), "utf8");
    expect(fonte).not.toMatch(/domain\s*:/);
  });
});
