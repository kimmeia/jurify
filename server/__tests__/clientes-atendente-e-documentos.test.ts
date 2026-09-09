/**
 * Pacote aprovado no mockup de 20/08: coluna Atendente na lista de Clientes,
 * Documentos em blocos estilo explorador com Renomear, e visualizador que
 * navega entre os arquivos da pasta sem fechar.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("coluna Atendente", () => {
  it("o servidor entrega o nome do responsável em lote", () => {
    const router = ler("server/escritorio/router-clientes.ts");
    expect(router).toContain("responsavelNome");
    // Em lote, não N+1: um select pros responsáveis da página inteira.
    expect(router).toContain("inArray(colaboradores.id, respIds)");
  });

  it("a lista mostra a coluna, com estado vazio honesto", () => {
    const clientes = ler("client/src/pages/Clientes.tsx");
    expect(clientes).toContain(">Atendente</div>");
    expect(clientes).toContain("c.responsavelNome");
    expect(clientes).toContain("sem atendente");
  });

  it("cabeçalho e linha usam a MESMA grade", () => {
    // Grades divergentes desalinham as colunas silenciosamente — o bug
    // clássico de tabela em grid.
    const clientes = ler("client/src/pages/Clientes.tsx");
    const grades = clientes.match(/grid-cols-\[24px_48px_1fr_160px_180px_140px_100px_150px\]/g) ?? [];
    expect(grades.length).toBe(2); // header + LinhaCliente (modo lead)
    const gradesCliente = clientes.match(/grid-cols-\[24px_48px_1fr_160px_180px_140px_100px_40px\]/g) ?? [];
    expect(gradesCliente.length).toBe(2);
  });
});

describe("renomear arquivo (servidor)", () => {
  const router = ler("server/escritorio/router-clientes.ts");
  const bloco = router.slice(router.indexOf("renomearArquivo:"), router.indexOf("// ─── PASTAS"));

  it("existe, com o mesmo cerco dos vizinhos (editar + dono do cliente + escritório)", () => {
    expect(bloco).toContain('checkPermission(ctx.user.id, "clientes", "editar")');
    expect(bloco).toContain("podeVerCliente(db, arquivo.contatoId");
    expect(bloco).toContain("eq(clienteArquivos.escritorioId, perm.escritorioId)");
  });

  it("só muda o rótulo — url/blob intactos, nenhum link quebra", () => {
    expect(bloco).toContain("set({ nome: input.nome.trim() })");
    expect(bloco).not.toContain("url:");
  });
});

describe("documentos em explorador + visualizador", () => {
  const tabs = ler("client/src/pages/clientes/detail-tabs.tsx");

  it("pastas e arquivos viram grade de blocos", () => {
    const grids = tabs.match(/grid-cols-2 sm:grid-cols-3 lg:grid-cols-4/g) ?? [];
    expect(grids.length).toBeGreaterThanOrEqual(2);
  });

  it("o menu do arquivo ganhou Renomear, ligado à procedure nova", () => {
    expect(tabs).toContain("renomearArquivo.useMutation");
    expect(tabs).toContain("setRenomeandoArq({ id: a.id, nome: a.nome })");
  });

  it("clicar no arquivo abre o visualizador, não uma aba nova", () => {
    expect(tabs).toContain("setViewerIdx(idx)");
  });

  it("o visualizador navega: setas, teclado e fita de miniaturas", () => {
    expect(tabs).toContain('e.key === "ArrowRight"');
    expect(tabs).toContain('e.key === "ArrowLeft"');
    expect(tabs).toContain("setViewerIdx(viewerIdx - 1)");
    expect(tabs).toContain("setViewerIdx(viewerIdx + 1)");
    expect(tabs).toContain("{viewerIdx + 1} de {arquivos.length}");
  });

  it("trocar de pasta fecha o visualizador e o renomear pendente", () => {
    // Navegar com a esteira aberta sobre a pasta antiga mostraria arquivo de
    // um contexto que não está mais na tela.
    const reset = tabs.slice(tabs.indexOf("const resetEstadosLocais"), tabs.indexOf("const entrarNaPasta"));
    expect(reset).toContain("setViewerIdx(null)");
    expect(reset).toContain("setRenomeandoArq(null)");
  });
});
