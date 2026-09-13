import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * O botão de ligar por telefone fica DESLIGADO enquanto a ponte não existe.
 *
 * O que motivou: `router-twilio.iniciarChamada` chama o cliente da API com o
 * número do cliente e mais nada. Sem o segundo número, `twilio-client` cai no
 * ramo sem ponte, que toca "Olá! Esta é uma chamada de teste do sistema" pra
 * quem atende e desliga. Não é bug de configuração — a metade que conecta as
 * duas pessoas nunca foi escrita, e o botão prometia uma ligação.
 *
 * Estes testes existem pra que religar o botão seja uma decisão CONSCIENTE:
 * quem tirar o `disabled` vai ter que tirar também a asserção que diz por quê,
 * e a que exige o segundo número no servidor.
 *
 * Nada foi removido: o popup de chamada, as procedures e o formulário de
 * credenciais continuam onde estavam.
 */

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** Recorta a linha do botão do Twilio no cabeçalho da conversa. */
function botaoDoTwilio(): string {
  const linha = ler("client/src/pages/Atendimento.tsx")
    .split("\n")
    .find((l) => l.includes("IconeTwilio") && l.includes("<Button"));
  expect(linha, "sumiu o botão de ligar por telefone do Atendimento").toBeTruthy();
  return linha!;
}

describe("botão de ligar por telefone", () => {
  it("continua na tela — esconder seria remoção", () => {
    // a condição de exibição é a mesma de antes: quem tem Twilio configurado vê
    expect(botaoDoTwilio()).toContain("{onTel &&");
    expect(ler("client/src/pages/Atendimento.tsx")).toContain("onTel={hasTwilio");
  });

  // o atributo solto, não o prefixo de variante: `\bdisabled\b` casa DENTRO de
  // `disabled:opacity-100`, e tirar o atributo passava despercebido
  const ATRIBUTO_DISABLED = /\sdisabled(?=[\s>])/;

  it("está desabilitado e não disca", () => {
    const b = botaoDoTwilio();
    expect(b).toMatch(ATRIBUTO_DISABLED);
    // o clique que abria o popup (e o popup disca ao montar) não existe mais
    expect(b).not.toMatch(/onClick/);
    expect(b).not.toMatch(/onTel\(/);
  });

  it("diz 'em breve' em texto que o leitor de tela também alcança", () => {
    // o ícone é mudo (aria-hidden); sem o title, o botão não se anuncia
    expect(botaoDoTwilio()).toMatch(/title="[^"]*em breve[^"]*"/);
    expect(ler("client/src/components/IconeTwilio.tsx")).toContain("aria-hidden");
  });

  it("o cinza do desligado não é apagado pela opacidade do Button", () => {
    // `disabled:opacity-50` é padrão do Button base e derrubaria o ícone de
    // 5,5:1 para 2,1:1 — abaixo do mínimo de 3,0 que um ícone precisa
    const b = botaoDoTwilio();
    expect(b).toContain("disabled:opacity-100");
    expect(b).toContain("text-muted-foreground");
  });

  it("usa a marca do Twilio, não um telefone genérico", () => {
    const b = botaoDoTwilio();
    expect(b).toContain("IconeTwilio");
    expect(b).not.toMatch(/<Phone\b/);
  });
});

describe("a marca em SVG embutido", () => {
  // sem os comentários: o cabeçalho do arquivo EXPLICA por que não é <img src>,
  // e a explicação casava com o próprio regex que proíbe <img src>
  const icone = () => ler("client/src/components/IconeTwilio.tsx").replace(/\/\*[\s\S]*?\*\//g, "");

  it("não depende de arquivo de fora — o build não carrega imagem externa", () => {
    expect(icone()).toContain("<svg");
    expect(icone()).not.toMatch(/<img|src=|https?:\/\//);
  });

  it("pinta por currentColor, pra servir marca e estado desligado", () => {
    expect(icone()).toContain('fill="currentColor"');
    expect(icone()).not.toMatch(/fill="#/);
  });
});

describe("Configurações avisa antes de alguém configurar à toa", () => {
  it("o card do Twilio traz o selo e a marca", () => {
    const t = ler("client/src/pages/Configuracoes.tsx");
    const i = t.indexOf('id: "twilio"');
    expect(i, "sumiu o card do Twilio").toBeGreaterThan(-1);
    const card = t.slice(i, i + 700);
    expect(card).toContain("IconeTwilio");
    expect(card).not.toContain("📞");
    expect(card).toMatch(/emBreve:\s*true/);
    // o selo tem que estar DESENHADO, não só declarado no objeto: o campo
    // `emBreve` sozinho não aparece pra ninguém
    // ancorado na expressão do card de integração — a aba Canais também
    // desenha um "Em breve" (Instagram/Messenger), com outro objeto
    const j = t.indexOf("(integ as any).emBreve ?");
    expect(j, "o selo não é renderizado em lugar nenhum").toBeGreaterThan(-1);
    expect(t.slice(j, j + 320)).toContain("Em breve");
  });

  it("o diálogo de credenciais avisa, mas continua salvando", () => {
    const t = ler("client/src/pages/configuracoes/dialogs.tsx");
    const i = t.indexOf("export function TwilioDialog");
    const dlg = t.slice(i, t.indexOf("export function", i + 10));
    expect(dlg).toMatch(/ainda não conecta as duas pontas/);
    expect(dlg).toContain("IconeTwilio");
    // os três campos e o salvar seguem lá — avisar não é desativar
    for (const campo of ["Account SID", "Auth Token", "Número Twilio"]) expect(dlg).toContain(campo);
    expect(dlg).toMatch(/criarMut|atualizarMut/);
  });
});

describe("o servidor continua intocado", () => {
  it("as procedures do Twilio seguem existindo", () => {
    const r = ler("server/integracoes/router-twilio.ts");
    for (const proc of ["iniciarChamada", "statusChamada", "encerrarChamada"]) expect(r).toContain(proc);
  });

  it("religar o botão exige antes passar o número do atendente", () => {
    // Este é o teste que documenta a causa. Enquanto `iniciarChamada` for
    // chamado com um argumento só, o cliente da API cai no ramo que toca
    // "chamada de teste" — então o botão não pode voltar a discar.
    const r = ler("server/integracoes/router-twilio.ts");
    const chamada = r.match(/await iniciarChamada\(([^)]*)\)/);
    expect(chamada, "sumiu a chamada ao cliente do Twilio").toBeTruthy();
    const argumentos = chamada![1].split(",").length;
    if (argumentos >= 3) {
      // Alguém escreveu a ponte: aí o botão PODE voltar, e este teste some.
      expect(botaoDoTwilio(), "a ponte existe — reative o botão e apague esta amarra").not.toMatch(
        /\sdisabled(?=[\s>])/,
      );
    } else {
      expect(botaoDoTwilio()).toMatch(/\sdisabled(?=[\s>])/);
      expect(ler("server/integracoes/twilio-client.ts")).toContain("chamada de teste do sistema");
    }
  });
});
