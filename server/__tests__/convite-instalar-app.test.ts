/**
 * "Mandei um link para o cliente assinar e junto foi o botão para baixar o
 * app. Isso não pode acontecer — app é apenas para quem é usuário do
 * sistema." (dono, 10/09/2026.)
 *
 * O convite era montado uma vez só, fora do <Switch>, então aparecia em toda
 * tela do site. No iPhone ele nem depende do navegador oferecer instalação:
 * aparece sozinho três segundos depois de a página carregar. Quem testa está
 * logado e vê o convite no lugar certo — o cliente do escritório, que abre
 * `/assinar/:token` e nunca terá login, via o mesmo banner.
 *
 * A regra é de PÚBLICO. Por isso as duas listas são exaustivas sobre as rotas
 * DERIVADAS do App.tsx: rota pública nova quebra este teste até alguém dizer
 * se ela é de usuário ou de terceiro. Lista escrita à mão envelheceria calada,
 * que foi exatamente como o banner chegou na assinatura.
 */

import { describe, expect, it } from "vitest";

import {
  ROTAS_PUBLICAS_COM_CONVITE,
  ROTAS_PUBLICAS_SEM_CONVITE,
  conviteInstalarAppPermitido,
} from "../../shared/convite-instalar-app";
import { ler, rotasPublicas, semComentarios } from "./_paginas-publicas";

/** "/assinar/:token" → "/assinar" — a classificação é por tela, não por token. */
function raiz(rota: string): string {
  const base = rota.split("/:")[0];
  return base === "" ? "/" : base;
}

describe("o convite não aparece pra quem não é usuário do sistema", () => {
  it("a tela de assinatura fica sem convite — é o caso do dono", () => {
    expect(conviteInstalarAppPermitido("/assinar/abc123")).toBe(false);
  });

  it("página inicial, termos e privacidade também: leitor não é usuário", () => {
    expect(conviteInstalarAppPermitido("/")).toBe(false);
    expect(conviteInstalarAppPermitido("/termos")).toBe(false);
    expect(conviteInstalarAppPermitido("/privacidade")).toBe(false);
  });

  it("login e cadastro continuam convidando: é usuário, ou está virando um", () => {
    expect(conviteInstalarAppPermitido("/login")).toBe(true);
    expect(conviteInstalarAppPermitido("/cadastro")).toBe(true);
  });

  it("convite de colaborador continua convidando", () => {
    expect(conviteInstalarAppPermitido("/convite/xyz")).toBe(true);
  });

  it("dentro do app (qualquer rota com sessão) o convite continua igual", () => {
    for (const r of ["/dashboard", "/atendimento", "/clientes/conferencia", "/admin/saude"]) {
      expect(conviteInstalarAppPermitido(r)).toBe(true);
    }
  });

  it("query string e barra no fim não driblam a regra", () => {
    expect(conviteInstalarAppPermitido("/assinar/abc?x=1")).toBe(false);
    expect(conviteInstalarAppPermitido("/termos/")).toBe(false);
    expect(conviteInstalarAppPermitido("/?utm_source=meta")).toBe(false);
  });

  it('"/" é comparada inteira: /login não vira filha da página inicial', () => {
    expect(conviteInstalarAppPermitido("/login")).toBe(true);
    expect(conviteInstalarAppPermitido("/configuracoes")).toBe(true);
  });

  it("prefixo não vaza pra rota parecida", () => {
    // "/termos" barra "/termos/qualquer-coisa" — é a mesma tela com sufixo —,
    // mas não "/termos-de-uso", que seria outra rota com nome parecido.
    expect(conviteInstalarAppPermitido("/termos/v2")).toBe(false);
    expect(conviteInstalarAppPermitido("/termos-de-uso")).toBe(true);
    expect(conviteInstalarAppPermitido("/assinaturas")).toBe(true);
  });
});

describe("as listas cobrem todas as telas sem login (derivadas do App.tsx)", () => {
  const publicas = rotasPublicas();

  it("existem telas públicas pra classificar — a derivação não pode voltar vazia", () => {
    expect(publicas.length).toBeGreaterThan(5);
    expect(publicas).toContain("/assinar/:token");
  });

  it.each(publicas)("%s está classificada numa das duas listas", (rota) => {
    const r = raiz(rota);
    const classificada =
      (ROTAS_PUBLICAS_COM_CONVITE as readonly string[]).includes(r) ||
      (ROTAS_PUBLICAS_SEM_CONVITE as readonly string[]).includes(r);
    expect(classificada).toBe(true);
  });

  it("nenhuma rota está nas duas listas ao mesmo tempo", () => {
    const nas2 = (ROTAS_PUBLICAS_COM_CONVITE as readonly string[]).filter((r) =>
      (ROTAS_PUBLICAS_SEM_CONVITE as readonly string[]).includes(r),
    );
    expect(nas2).toEqual([]);
  });

  it("a lista 'com convite' não guarda rota que não existe mais no App.tsx", () => {
    const raizes = publicas.map(raiz);
    for (const r of ROTAS_PUBLICAS_COM_CONVITE) expect(raizes).toContain(r);
  });

  it("as rotas sem convite realmente ficam sem convite", () => {
    for (const r of ROTAS_PUBLICAS_SEM_CONVITE) expect(conviteInstalarAppPermitido(r)).toBe(false);
  });

  it("as rotas com convite realmente ficam com convite", () => {
    for (const r of ROTAS_PUBLICAS_COM_CONVITE) expect(conviteInstalarAppPermitido(r)).toBe(true);
  });
});

describe("amarras no componente", () => {
  const pwa = semComentarios(ler("client/src/components/InstallPWA.tsx"));

  it("o componente consulta a regra antes de desenhar", () => {
    expect(pwa).toContain("conviteInstalarAppPermitido(rota)");
    expect(pwa).toContain('from "@shared/convite-instalar-app"');
  });

  it("a rota vem do roteador, não de window.location lido uma vez", () => {
    expect(pwa).toContain("const [rota] = useLocation();");
  });

  it("a saída antecipada fica DEPOIS dos hooks (React #310)", () => {
    const posHooks = pwa.lastIndexOf("useEffect(");
    const saida = pwa.indexOf("if (!visivel || !conviteInstalarAppPermitido(rota)) return null;");
    expect(saida).toBeGreaterThan(posHooks);
  });

  it("o convite continua montado uma vez só, no App — nada foi tirado de lá", () => {
    const app = semComentarios(ler("client/src/App.tsx"));
    expect(app).toContain("<InstallPWA />");
  });

  it("o banner segue existindo com o mesmo texto e a dica de iPhone", () => {
    expect(pwa).toContain("Instalar o JuridFlow");
    expect(pwa).toContain("Adicionar à Tela de Início");
  });
});
