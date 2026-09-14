/**
 * Os cards de Canais e de Apps externos usam a MARCA REAL, não emoji.
 *
 * Pedido do dono, com todas as letras: *"quero que use as logos reais nos
 * cards (whatsapp, facebook, instagram) em canais e app externos. nada de
 * parecido, quero ícones reais."* Antes eram 💬 📸 💙 🤖 🦾 — desenhos que
 * LEMBRAM a marca e não são a marca.
 *
 * Emoji é fácil de voltar (é uma string curta no meio de um objeto), então a
 * amarra confere as duas pontas: nenhum `logo:` de card é literal de texto, e
 * os desenhos vêm do arquivo único das marcas.
 *
 * O Asaas fica de fora de propósito: a marca não está no Simple Icons nem em
 * pacote que este ambiente alcance, e desenhar "parecido" é o que ele pediu
 * pra não fazer. Quando o SVG oficial entrar, esta lista cresce.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const tela = ler("client/src/pages/Configuracoes.tsx");
const marcas = ler("client/src/components/logos-marcas.tsx");

describe("as marcas dos cards são reais", () => {
  it("nenhum card de canal ou de app externo leva emoji como logo", () => {
    // Pega `logo: "..."` — literal de texto. JSX (`logo: <Logo… />`) não casa.
    const literais = [...tela.matchAll(/\blogo:\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(
      literais.filter((x) => x !== "💰"),
      `logo em texto (emoji?) nos cards: ${literais.join(" ")}`,
    ).toEqual([]);
  });

  it("os quatro canais e as duas IAs apontam pro arquivo das marcas", () => {
    expect(tela).toContain('from "@/components/logos-marcas"');
    for (const logo of ["LogoWhatsApp", "LogoInstagram", "LogoMessenger", "LogoOpenAI", "LogoClaude"]) {
      expect(tela, `${logo} não é usado na tela`).toContain(`<${logo} `);
      expect(marcas, `${logo} não é exportado`).toContain(`export function ${logo}(`);
    }
    // O Twilio já tinha marca real antes deste pedido, em arquivo próprio.
    expect(tela).toContain("<IconeTwilio ");
  });

  it("cada marca é um traçado de verdade, não uma letra desenhada à mão", () => {
    // Traçado curto é sinal de desenho inventado. Medidos: Claude 1.811,
    // OpenAI 1.460, Instagram 1.914, WhatsApp 1.016 e Messenger 462 — este
    // último é curto porque a marca dele É simples (bolha + raio), por isso o
    // piso fica em 400 e não na média.
    const paths = [...marcas.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
    expect(paths.length, "faltou marca no arquivo").toBe(5);
    for (const d of paths) expect(d.length).toBeGreaterThan(400);
    expect(paths.filter((d) => d.length > 1000).length, "3 das 5 são traçados longos")
      .toBeGreaterThanOrEqual(3);
  });

  it("a cor é a da marca, não a do tema", () => {
    // `currentColor` herdaria a paleta do app: WhatsApp roxo no dia em que o
    // tema mudar. O único que varia é a OpenAI, preta, que precisa clarear no
    // tema escuro pra não sumir.
    expect(marcas).toContain('fill="#25D366"'); // WhatsApp
    expect(marcas).toContain('fill="#0866FF"'); // Messenger (azul da Meta)
    expect(marcas).toContain('fill="#D97757"'); // Claude
    expect(marcas).toContain('fill="url(#marca-instagram)"'); // degradê oficial
    expect(marcas).toContain("dark:fill-white"); // OpenAI no tema escuro
    expect(marcas, "marca com cor do tema deixa de ser a marca").not.toContain(
      'fill="currentColor"',
    );
  });

  it("o quadrado do card não pinta por cima da marca", () => {
    // O ladrilho era um degradê CHEIO da cor do canal, feito pra emoji branco.
    // Verde da marca sobre verde do ladrilho some.
    const i = tela.indexOf("{canal.isAdicionar ? \"+\" : canal.logo}");
    expect(i, "o ladrilho do card de canal sumiu").toBeGreaterThan(-1);
    const ladrilho = tela.slice(tela.lastIndexOf("<div", i), i);
    expect(ladrilho, "o ladrilho voltou a ser degradê cheio").toContain("bg-card");
    // O degradê sobrou só no cartão "+ Adicionar", que não tem marca.
    expect(ladrilho).toContain("canal.isAdicionar");
  });
});

describe("o banner da conexão simplificada saiu, o caminho manual não", () => {
  it("o banner não existe mais", () => {
    expect(tela, "o banner voltou").not.toContain("Conexão simplificada via Facebook");
  });

  it("cadastrar WhatsApp Cloud manualmente continua alcançável", () => {
    // Era a ÚNICA porta desse cadastro, e morava DENTRO do banner removido.
    // Sem isto, tirar o banner levava junto o plano B de quem não consegue
    // autorizar pelo Facebook — e ninguém pediu isso.
    expect(tela).toContain("Ou cadastrar WhatsApp Cloud manualmente (avançado)");
    const i = tela.indexOf("Ou cadastrar WhatsApp Cloud manualmente (avançado)");
    const botao = tela.slice(tela.lastIndexOf("<button", i), i);
    expect(botao, "o texto ficou, o clique não").toContain("setManualWhatsappOpen(true)");
    expect(tela).toContain("open={manualWhatsappOpen}");
  });
});
