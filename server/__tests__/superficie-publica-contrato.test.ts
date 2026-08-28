/**
 * O contrato inverso da amarra de proveniência.
 *
 * `pagina-publica-url-autenticada.test.ts` diz o que a tela sem login NÃO
 * pode chamar. Aqui trava o outro lado: o que ela chama tem que existir,
 * estar registrado no servidor e continuar sendo público. Foi essa metade
 * que faltou em 10/08 — o /uploads virou autenticado e nada avisou que uma
 * tela sem sessão dependia dele.
 *
 * Um endereço público quebra de três jeitos, e os três passam por typecheck:
 *   1. a rota some ou muda de caminho (string mágica dos dois lados);
 *   2. a rota existe no arquivo mas ninguém chama o `register*` no boot;
 *   3. a procedure vira `protectedProcedure` numa refatoração de segurança.
 */

import { describe, expect, it } from "vitest";
import { ler, paginasPublicas, semComentarios } from "./_paginas-publicas";

const publicas = paginasPublicas();
// Sem comentários: `// registerX(app)` comentado ainda casaria no toContain,
// e a rota sumiria do boot com o teste verde.
const boot = semComentarios(ler("server/_core/index.ts"));
const routers = ler("server/routers.ts");

/** Arquivos de servidor que declaram rota Express (varridos uma vez só). */
function arquivosDeRota(): { caminho: string; fonte: string }[] {
  const alvos = [
    "server/escritorio/assinatura-pdf-route.ts",
    "server/calculos/export-pdf-route.ts",
    "server/integracoes/agente-chat-pdf-route.ts",
    "server/_core/sse-notifications.ts",
    "server/_core/index.ts",
  ];
  return alvos.map((caminho) => ({ caminho, fonte: ler(caminho) }));
}

/** URLs `/api/...` escritas na tela pública, incluindo prefixo de template. */
function endpointsChamados(arquivo: string): string[] {
  const fonte = semComentarios(ler(arquivo));
  const achados = new Set<string>();
  for (const m of fonte.matchAll(/["'`](\/api\/[^"'`$]*)/g)) {
    achados.add(m[1]);
  }
  return [...achados];
}

describe("rota Express que a tela pública chama", () => {
  const chamados = publicas.flatMap((p) =>
    endpointsChamados(p).map((url) => ({ pagina: p, url })),
  );

  it("a varredura acha o endpoint do documento de assinatura", () => {
    // Âncora: sem ela, um regex furado deixaria a suíte verde sem ter olhado
    // endereço nenhum.
    expect(chamados.map((c) => c.url)).toContain("/api/assinatura/pdf/token/");
  });

  it.each(chamados.map((c) => [c.pagina, c.url]))(
    "%s → %s existe e está registrada no boot",
    (_pagina, url) => {
      // `/api/trpc` sai daqui — quem cuida dele é o bloco das procedures.
      if (url.startsWith("/api/trpc")) return;

      const arquivos = arquivosDeRota();
      const dono = arquivos.find(({ fonte }) =>
        [...fonte.matchAll(/app\.(?:get|post)\(\s*["'`]([^"'`]+)["'`]/g)].some((m) => {
          // "/api/assinatura/pdf/token/:token" cobre a chamada
          // "/api/assinatura/pdf/token/" — compara pelo trecho literal.
          const literal = m[1].split("/:")[0];
          return url.startsWith(literal) || literal.startsWith(url.replace(/\/$/, ""));
        }),
      );
      expect(dono, `nenhuma rota Express serve ${url}`).toBeDefined();

      // A rota pode existir no arquivo e nunca ser montada.
      const registrador = /export function (register\w+)\(/.exec(dono!.fonte)?.[1];
      if (registrador) {
        expect(boot, `${registrador} não é chamado no boot`).toContain(`${registrador}(app)`);
      }
    },
  );

  it("a rota por token não exige sessão (o token É a autenticação)", () => {
    const rota = ler("server/escritorio/assinatura-pdf-route.ts");
    const i = rota.indexOf('app.get("/api/assinatura/pdf/token/:token"');
    expect(i).toBeGreaterThan(0);
    const handler = rota.slice(i, rota.indexOf("\n  });", i));
    expect(handler, "handler público não pode resolver usuário").not.toContain("resolverUser");
    expect(handler).not.toContain("authenticateRequest");
    // E nenhum middleware de sessão pode ter sido montado no prefixo.
    const middlewares = [...boot.matchAll(/app\.use\(\s*\n?\s*["'`](\/api\/assinatura[^"'`]*)/g)];
    for (const m of middlewares) {
      const trecho = boot.slice(m.index!, m.index! + 260);
      expect(trecho, `middleware em ${m[1]} não pode autenticar`).not.toContain(
        "authenticateRequest",
      );
    }
  });
});

/**
 * Procedures que a tela pública chama SÓ depois do login. A tela é
 * alcançável sem sessão, a chamada não é — e cada par aqui é uma decisão
 * consciente, não um descuido. Par novo que não seja `publicProcedure` faz
 * o teste falhar até alguém escrever o porquê.
 */
const EXIGEM_LOGIN_DE_PROPOSITO: Record<string, string> = {
  "configuracoes.aceitarConvite":
    "aceitar convite é ato de usuário logado; a tela tem estado needLogin antes disso",
  "subscription.current":
    "/checkout/success só é alcançada depois do pagamento, com sessão viva",
};

describe("procedure tRPC que a tela pública chama", () => {
  const chamadas = publicas.flatMap((pagina) => {
    const fonte = semComentarios(ler(pagina));
    const achadas = new Set<string>();
    for (const m of fonte.matchAll(
      /trpc(?:\s+as\s+any)?\)?\.([a-zA-Z]\w*)\.([a-zA-Z]\w*)\.use(?:Query|Mutation|SuspenseQuery)/g,
    )) {
      achadas.add(`${m[1]}.${m[2]}`);
    }
    return [...achadas].map((chave) => ({ pagina, chave }));
  });

  it("a varredura enxerga as procedures da tela de assinatura", () => {
    const chaves = chamadas.map((c) => c.chave);
    expect(chaves).toContain("assinaturas.visualizarPorToken");
    expect(chaves).toContain("assinaturas.assinarPorToken");
    expect(chamadas.length).toBeGreaterThanOrEqual(8);
  });

  it.each(chamadas.map((c) => [c.pagina, c.chave]))(
    "%s → %s é publicProcedure (ou exceção declarada)",
    (_pagina, chave) => {
      const [ns, proc] = chave.split(".");
      const motivo = EXIGEM_LOGIN_DE_PROPOSITO[chave];

      // namespace → arquivo do router, pelo import de routers.ts
      const nomeRouter = new RegExp(`^\\s*${ns}:\\s*(\\w+)`, "m").exec(routers)?.[1];
      const spec = nomeRouter
        ? new RegExp(`import\\s*\\{[^}]*\\b${nomeRouter}\\b[^}]*\\}\\s*from\\s*["'](\\.[^"']+)["']`)
            .exec(routers)?.[1]
        : null;
      if (!spec) {
        expect(motivo, `não achei o router de ${chave} — declare a exceção`).toBeDefined();
        return;
      }
      const fonte = ler(`server/${spec.replace(/^\.\//, "")}.ts`);
      const declaracao = new RegExp(`\\b${proc}:\\s*(\\w+Procedure)`).exec(fonte)?.[1];

      if (motivo) {
        // Exceção só vale enquanto continuar sendo o que ela diz que é.
        expect(declaracao, `${chave} virou pública — tire da lista de exceções`).not.toBe(
          "publicProcedure",
        );
        return;
      }
      expect(
        declaracao,
        `${chave} é chamada por tela sem login mas está como ${declaracao}. ` +
          `Ou volta a ser publicProcedure, ou entra em EXIGEM_LOGIN_DE_PROPOSITO com o motivo.`,
      ).toBe("publicProcedure");
    },
  );
});

/**
 * Campos de caminho de arquivo que o payload público PODE trazer.
 *
 * Hoje: nenhum. O dono autorizou tirar documentoUrl e documentoAssinadoUrl
 * (28/08) — a tela recebe só `temDocumento` e busca o conteúdo pela rota por
 * token. Quem quiser reintroduzir um campo de endereço aqui declara o motivo,
 * e o teste cobra que exista rota pública capaz de servi-lo.
 */
const CAMPOS_DE_ARQUIVO: Record<string, string> = {};

describe("payload público não entrega caminho navegável", () => {
  const router = ler("server/escritorio/router-assinaturas.ts");
  const mapDoc = router.slice(router.indexOf("function mapDoc("), router.indexOf("function mapDoc(") + 700);

  it("todo campo *Url exposto pela procedure pública está declarado", () => {
    const expostos = [...mapDoc.matchAll(/^\s*(\w*[Uu]rl):/gm)].map((m) => m[1]);
    for (const campo of expostos) {
      expect(
        CAMPOS_DE_ARQUIVO[campo],
        `mapDoc expõe "${campo}" pra tela sem login e ninguém disse como ela pode usar. ` +
          `Declare em CAMPOS_DE_ARQUIVO — e confira se existe rota por token que sirva isso.`,
      ).toBeDefined();
    }
  });

  it("a tela sabe se há documento sem receber o endereço dele", () => {
    // Âncora: sem isto, um mapDoc esvaziado por engano passaria no teste acima
    // por não ter nenhum campo pra reprovar.
    expect(mapDoc).toContain("temDocumento");
    expect(mapDoc).not.toContain("documentoUrl:");
    expect(mapDoc).not.toContain("documentoAssinadoUrl:");
  });

  it("o mapper do OPERADOR continua com os dois campos (tem sessão e usa)", () => {
    // A tela do escritório oferece "ver documento" e "baixar PDF assinado".
    // Uma limpeza por tabela que aplicasse a regra da tela pública aqui
    // apagaria os dois botões sem nada ficar vermelho.
    const listar = router.slice(router.indexOf("listarPorCliente"), router.indexOf("function mapDoc("));
    expect(listar).toContain("documentoUrl: r.documentoUrl");
    expect(listar).toContain("documentoAssinadoUrl: r.documentoAssinadoUrl");
  });

  it("visualizarPorToken continua pública e usando o mapper declarado", () => {
    const i = router.indexOf("visualizarPorToken: publicProcedure");
    expect(i).toBeGreaterThan(0);
    expect(router.slice(i, i + 1400)).toContain("mapDoc(doc)");
  });

  it("os caminhos gravados são mesmo internos — por isso a regra existe", () => {
    // Se um dia virarem URL absoluta de CDN/S3 (P2 do relatório), esta
    // asserção cai e a regra toda merece ser repensada, não contornada.
    expect(router).toContain("`/uploads/assinaturas/escritorio_${doc.escritorioId}/");
  });
});
