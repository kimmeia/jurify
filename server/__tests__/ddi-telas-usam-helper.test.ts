/**
 * Amarra de texto: as telas usam a régua do shared pro DDI, não cópias locais.
 *
 * O bug foi o mesmo em seis lugares e se repetiu porque cada tela tinha a
 * sua máscara / o seu `wa.me/55…`. `mascararTelefoneBR` e `telefoneParaWaMe`
 * (shared/telefone.ts) são a regra única; o que este arquivo trava é que os
 * pontos corrigidos continuam passando por elas — e que ninguém volta a
 * cortar em `slice(0, 11)` sem tirar o 55, nem a montar `https://wa.me/55`
 * na mão no client.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

function entre(texto: string, inicio: string, fim: string): string {
  const a = texto.indexOf(inicio);
  expect(a, `não achei "${inicio}"`).toBeGreaterThanOrEqual(0);
  const b = texto.indexOf(fim, a);
  expect(b, `não achei "${fim}" depois de "${inicio}"`).toBeGreaterThan(a);
  return texto.slice(a, b);
}

const importaDoShared = (texto: string, nome: string) =>
  new RegExp(`import \\{[^}]*\\b${nome}\\b[^}]*\\} from "@shared/telefone"`).test(texto);

describe("shared/telefone.ts é a régua", () => {
  const shared = ler("shared/telefone.ts");

  it("exporta a máscara e o link", () => {
    expect(shared).toMatch(/export function mascararTelefoneBR\(/);
    expect(shared).toMatch(/export function telefoneParaWaMe\(/);
  });

  it("a máscara corta o DDI antes de limitar a 11 dígitos", () => {
    const fn = entre(shared, "export function mascararTelefoneBR(", "export function telefoneParaWaMe(");
    const corte = fn.indexOf('if (bruto.length >= 12 && bruto.startsWith("55")) bruto = bruto.slice(2);');
    const limite = fn.indexOf("bruto.slice(0, 11)");
    expect(corte).toBeGreaterThanOrEqual(0);
    expect(limite).toBeGreaterThan(corte);
  });

  it("o link só prefixa 55 quando ainda não tem", () => {
    const fn = entre(shared, "export function telefoneParaWaMe(", "/** Os dois valores apontam");
    expect(fn).toMatch(/d\.length >= 12 && d\.startsWith\("55"\) \? d : `55\$\{d\}`/);
  });
});

describe("Atendimento — Nova Conversa (atendimento-x1)", () => {
  const atendimento = ler("client/src/pages/Atendimento.tsx");

  it("maskPhoneBR local virou wrapper de mascararTelefoneBR", () => {
    expect(importaDoShared(atendimento, "mascararTelefoneBR")).toBe(true);
    const fn = entre(atendimento, "function maskPhoneBR(", "function isValidPhoneBR(");
    expect(fn).toMatch(/return mascararTelefoneBR\(value\);/);
    expect(fn).not.toMatch(/slice\(0, 11\)/);
  });

  it("deep-link e digitação passam pela mesma máscara", () => {
    const dialogo = entre(atendimento, "function IniciarConversaDialog({", "function NovoLeadDialog({");
    expect(dialogo).toMatch(/setTel\(maskPhoneBR\(preencherDe\.telefone\)\)/);
    expect(dialogo).toMatch(/onChange=\{\(e\) => setTel\(maskPhoneBR\(e\.target\.value\)\)\}/);
  });
});

describe("Novo Cliente (clientes-1)", () => {
  const detailTabs = ler("client/src/pages/clientes/detail-tabs.tsx");

  it("formatTel delega pra mascararTelefoneBR", () => {
    expect(importaDoShared(detailTabs, "mascararTelefoneBR")).toBe(true);
    expect(detailTabs).toMatch(/const formatTel = \(v: string\) => mascararTelefoneBR\(v\);/);
    const dialogo = entre(detailTabs, "const formatTel = ", "<DialogTitle>Novo Cliente</DialogTitle>");
    expect(dialogo).not.toMatch(/slice\(0, 11\)/);
  });

  it("o campo Telefone continua usando formatTel", () => {
    expect(detailTabs).toMatch(/onChange=\{e => setTel\(formatTel\(e\.target\.value\)\)\}/);
  });
});

describe("Agenda — WhatsApp Web (agenda-9)", () => {
  const agenda = ler("client/src/pages/Agenda.tsx");

  it("os três links passam por telefoneParaWaMe", () => {
    expect(importaDoShared(agenda, "telefoneParaWaMe")).toBe(true);
    const hrefs = agenda.match(/href=\{telefoneParaWaMe\(/g) ?? [];
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
  });

  it("nenhum href volta a prefixar 55 fixo", () => {
    expect(agenda).not.toContain("https://wa.me/55");
  });
});

describe("Assinaturas — Enviar WhatsApp (assinaturas-8 / clientes-x2)", () => {
  const detailTabs = ler("client/src/pages/clientes/detail-tabs.tsx");
  const fn = entre(detailTabs, "const enviarWhatsApp = (token: string) => {", "enviarMut.mutate({ id: assin.id });");

  it("monta o link pelo helper", () => {
    expect(importaDoShared(detailTabs, "telefoneParaWaMe")).toBe(true);
    expect(fn).toMatch(/const linkWa = telefoneParaWaMe\(tel\);/);
    expect(fn).toMatch(/window\.open\(`\$\{linkWa\}\?text=\$\{msg\}`, "_blank"\)/);
    expect(fn).not.toMatch(/https:\/\/wa\.me\//);
  });

  it("sem link não abre nada nem marca enviado", () => {
    expect(fn).toMatch(/if \(!tel \|\| !linkWa\) \{/);
  });
});

describe("ninguém no client monta wa.me/55 na mão", () => {
  function arquivosTsx(dir: string): string[] {
    const saida: string[] = [];
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) saida.push(...arquivosTsx(caminho));
      else if (nome.endsWith(".tsx")) saida.push(caminho);
    }
    return saida;
  }

  it("zero ocorrências de `wa.me/55` fixo em client/src", () => {
    const culpados = arquivosTsx(join(raiz, "client", "src"))
      .filter((f) => readFileSync(f, "utf8").includes("wa.me/55"))
      .map((f) => f.slice(raiz.length + 1));
    expect(culpados).toEqual([]);
  });
});
