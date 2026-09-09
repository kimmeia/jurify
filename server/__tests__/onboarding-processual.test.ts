import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/**
 * Onboarding do pacote processual (mockup aprovado 24/08): quem chega da
 * campanha não cai numa tela vazia — cai num caminho de 3 passos que abre
 * os fluxos REAIS (cofre, cliente essencial, novas ações). Estas amarras
 * garantem que o caminho continua inteiro: um deep-link quebrado aqui é
 * um clique de anúncio morto.
 */
describe("guia de 3 passos no dashboard processual", () => {
  const guia = ler("client/src/pages/dashboards/GuiaProcessual.tsx");

  it("os 3 passos apontam pros fluxos reais via deep-link ?novo=1", () => {
    expect(guia).toContain("/processos?tab=cofre&novo=1");
    expect(guia).toContain("/clientes?novo=1");
    expect(guia).toContain("/processos?tab=novas-acoes&novo=1");
  });

  it("passo 3 trava sem credencial; guia some quando completo", () => {
    expect(guia).toContain("Precisa do passo 1");
    // Completo = credencial + monitoramento (cliente é opcional).
    expect(guia).toContain("passo1 && passo3");
    expect(guia).toContain("este guia some quando terminar");
  });

  it("linha de sucesso só pra quem acabou de completar, e é dismissível", () => {
    // sessionStorage: conta antiga que já monitora há meses nunca vê a festa.
    expect(guia).toContain("guiaProcessualEmAndamento");
    expect(guia).toContain("Entendi, pode esconder");
  });

  it("cobertura transparente: número de estados sai da lista compartilhada", () => {
    expect(guia).toContain("TRIBUNAIS_PJE.length");
  });

  it("dashboard monta o guia (substituiu o aviso amber de credencial)", () => {
    const dash = ler("client/src/pages/dashboards/DashboardProcessual.tsx");
    expect(dash).toContain("<GuiaProcessual");
    expect(dash).not.toContain("semCredencial");
  });
});

describe("deep-links ?novo=1 abrem o fluxo real", () => {
  it("clientes essencial abre o cadastro", () => {
    const cli = ler("client/src/pages/ClientesEssencial.tsx");
    expect(cli).toContain('get("novo") === "1"');
    expect(cli).toContain("setCriarOpen(true)");
  });

  it("cofre abre o cadastro de credencial; novas ações abre e pré-seleciona o único cliente", () => {
    const proc = ler("client/src/pages/Processos.tsx");
    // Duas telas leem o mesmo parâmetro (CofreTab e NovasAcoesTab).
    expect(proc.split('get("novo") === "1"').length).toBeGreaterThanOrEqual(3);
    // Pré-seleção só quando existe exatamente 1 cliente com CPF/CNPJ.
    expect(proc).toContain("preSelecionarDoGuia");
    expect(proc).toContain("clientes.length === 1");
  });
});

describe("avisar quando chegar (tribunal fora da cobertura)", () => {
  it("procedure persiste o interesse por escritório", () => {
    const router = ler("server/escritorio/router-cofre-credenciais.ts");
    expect(router).toContain("registrarInteresseTribunal");
    expect(router).toContain("interesseTribunais");
  });

  it("migration 0206 + schema em sincronia", () => {
    const sql = ler("drizzle/0206_interesse_tribunais.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS interesse_tribunais");
    const schema = ler("drizzle/schema.ts");
    expect(schema).toContain("interesse_tribunais");
    expect(schema).toContain("export const interesseTribunais");
  });

  it("cofre oferece o registro na tela de cadastro", () => {
    const proc = ler("client/src/pages/Processos.tsx");
    expect(proc).toContain("Avisar quando chegar");
    expect(proc).toContain("registrarInteresseTribunal");
  });
});
