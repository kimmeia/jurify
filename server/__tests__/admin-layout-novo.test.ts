import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { gerarSlugCopia } from "../billing/planos-repo";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("gerarSlugCopia", () => {
  it("sem colisão vira -copia; colidindo, numera a partir do 2", () => {
    expect(gerarSlugCopia("essencial", new Set())).toBe("essencial-copia");
    expect(gerarSlugCopia("essencial", new Set(["essencial-copia"]))).toBe("essencial-copia-2");
    expect(gerarSlugCopia("essencial", new Set(["essencial-copia", "essencial-copia-2"]))).toBe(
      "essencial-copia-3",
    );
  });
});

describe("amarras do admin novo (menu enxuto + editor de planos)", () => {
  it("menu do admin tem os hubs e não tem mais os itens fundidos", () => {
    const layout = ler("client/src/components/AdminLayout.tsx");
    expect(layout).toContain("/admin/saude");
    expect(layout).toContain("/admin/ia");
    expect(layout).toContain("Saúde do sistema");
    // Os antigos não podem voltar como item de menu — viraram abas.
    for (const rotaAntiga of [
      "/admin/erros",
      "/admin/robo-auditor",
      "/admin/robo-jornada",
      "/admin/email-log",
      "/admin/auditoria",
      "/admin/agentes-ia",
      "/admin/jurisia",
    ]) {
      expect(layout, `menu ainda aponta pra ${rotaAntiga}`).not.toContain(`"${rotaAntiga}"`);
    }
  });

  it("links antigos redirecionam pros hubs com a aba certa", () => {
    const app = ler("client/src/App.tsx");
    expect(app).toContain('Redirect to="/admin/saude?aba=erros"');
    expect(app).toContain('Redirect to="/admin/saude?aba=robo-auditor"');
    expect(app).toContain('Redirect to="/admin/saude?aba=robo-jornada"');
    expect(app).toContain('Redirect to="/admin/saude?aba=emails"');
    expect(app).toContain('Redirect to="/admin/saude?aba=auditoria"');
    expect(app).toContain('Redirect to="/admin/ia?aba=agentes"');
    expect(app).toContain('Redirect to="/admin/ia?aba=jurisia"');
    expect(app).toContain('path="/admin/planos/:slug"');
  });

  it("os hubs montam todas as páginas fundidas — nada some do painel", () => {
    const saude = ler("client/src/pages/admin/AdminSaude.tsx");
    for (const comp of ["AdminErros", "AdminRoboAuditor", "AdminRoboJornada", "AdminEmailLog", "AdminAuditoria"]) {
      expect(saude).toContain(`<${comp} />`);
    }
    const ia = ler("client/src/pages/admin/AdminIA.tsx");
    expect(ia).toContain("<AdminAgentesIA />");
    expect(ia).toContain("<AdminJurisIa />");
  });

  it("lista de planos tem vitrine, duplicar e reordenar; editar navega pro editor", () => {
    const secao = ler("client/src/pages/admin/financeiro/PlanosSection.tsx");
    expect(secao).toContain("duplicarPlano");
    expect(secao).toContain("reordenarPlanos");
    expect(secao).toContain("Na vitrine do site");
    expect(secao).toContain("Fora da vitrine");
    expect(secao).toContain("/admin/planos/");
  });

  it("duplicar no servidor nasce fora da vitrine e sem selo popular", () => {
    const adm = ler("server/routers/admin.ts");
    const trecho = adm.slice(adm.indexOf("duplicarPlano:"), adm.indexOf("reordenarPlanos:"));
    expect(trecho).toContain("oculto: true");
    expect(trecho).toContain("popular: false");
    expect(trecho).toContain("gerarSlugCopia");
  });

  it("prévia do editor usa os MESMOS textos do cartão da LP (não podem divergir)", () => {
    const editor = ler("client/src/pages/admin/AdminPlanoEditor.tsx");
    const pricing = ler("client/src/pages/landing/Pricing.tsx");
    for (const texto of [
      "Sob consulta",
      "💬 Agendar demonstração",
      "💬 Falar com a gente",
      "preço fechado na conversa, do seu tamanho",
      "apresentamos numa demonstração ao vivo",
    ]) {
      expect(editor, `prévia sem o texto: ${texto}`).toContain(texto);
      expect(pricing, `LP sem o texto: ${texto}`).toContain(texto);
    }
  });

  it("Configurações não tem mais a aba Planos duplicada", () => {
    const settings = ler("client/src/pages/admin/AdminSettings.tsx");
    expect(settings).not.toContain('value="planos"');
  });
});
