import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/**
 * "Criar cliente" do painel (mockup aprovado 26/08): conta nasce pela mão
 * do admin com e-mail confirmado, sem passar pelo cadastro público — pra
 * demo e cliente fechado no WhatsApp.
 */
describe("admin.criarCliente", () => {
  const adm = ler("server/routers/admin.ts");
  const trecho = adm.slice(adm.indexOf("criarCliente: adminProcedure"), adm.indexOf("marcarCortesiaUser:"));

  it("recusa e-mail duplicado em vez de criar conta em cima", () => {
    expect(trecho).toContain("Já existe conta com esse e-mail.");
  });

  it("e-mail nasce confirmado; termos NÃO são forjados (gate pede no 1º login)", () => {
    expect(trecho).toContain("emailVerificado: true");
    // A trilha LGPD é do CLIENTE: nenhuma linha de aceite é criada por ele.
    expect(trecho).not.toContain("aceitesTermos");
    expect(trecho).not.toContain("termosVersaoAceita");
  });

  it("escritório nasce junto e o trial marca jaUsouTrial (sem trial duplo depois)", () => {
    expect(trecho).toContain("criarEscritorio");
    expect(trecho).toContain("jaUsouTrial: true");
  });

  it("cortesia × trial: trial exige plano; cortesia aceita validade futura", () => {
    expect(trecho).toContain("Escolha o plano pro teste de 14 dias.");
    expect(trecho).toContain("Validade da cortesia precisa estar no futuro.");
  });

  it("ação auditada — fica registrado quem criou", () => {
    expect(trecho).toContain('"user.criarCliente"');
  });

  it("a tela tem o botão, o dialog e o copiar credenciais", () => {
    const tela = ler("client/src/pages/admin/AdminClients.tsx");
    expect(tela).toContain("Criar cliente");
    expect(tela).toContain("CriarClienteDialog");
    expect(tela).toContain("gerarSenhaProvisoria");
    expect(tela).toContain("navigator.clipboard");
    // A senha nunca volta do servidor — só vive no estado do form.
    const dlg = tela.slice(tela.indexOf("function CriarClienteDialog"), tela.indexOf("type FunilKey"));
    expect(dlg).toContain('fase === "form"');
  });
});
