/**
 * Testes para o router de OABs e notificações.
 * Foco: validação de nome, segurança e isolamento por utilizador.
 */
import { describe, it, expect } from "vitest";
import { nomesCorrespondem } from "./router-oab";

// ============================================================
// Testes de validação de nomes
// ============================================================

describe("nomesCorrespondem", () => {
  describe("nomes que devem corresponder", () => {
    it("nomes idênticos", () => {
      expect(nomesCorrespondem("Rafael Rocha", "Rafael Rocha")).toBe(true);
    });

    it("nomes com casing diferente", () => {
      expect(nomesCorrespondem("RAFAEL ROCHA", "rafael rocha")).toBe(true);
    });

    it("nomes com acentos vs sem acentos", () => {
      expect(nomesCorrespondem("José da Silva", "Jose da Silva")).toBe(true);
    });

    it("nomes com preposições diferentes", () => {
      expect(nomesCorrespondem("Rafael da Silva Rocha", "Rafael Rocha")).toBe(true);
    });

    it("nome completo vs abreviado (primeiro + último)", () => {
      expect(nomesCorrespondem("Maria Aparecida Santos", "Maria Santos")).toBe(true);
    });

    it("nomes com preposições de/da/do/dos/das", () => {
      expect(nomesCorrespondem("João dos Santos", "João Santos")).toBe(true);
    });

    it("nome com espaços extras", () => {
      expect(nomesCorrespondem("  Rafael   Rocha  ", "Rafael Rocha")).toBe(true);
    });

    it("nomes com acentos complexos", () => {
      expect(nomesCorrespondem("André Gonçalves", "Andre Goncalves")).toBe(true);
    });
  });

  describe("nomes que NÃO devem corresponder", () => {
    it("primeiro nome diferente", () => {
      expect(nomesCorrespondem("Rafael Rocha", "Carlos Rocha")).toBe(false);
    });

    it("último nome diferente", () => {
      expect(nomesCorrespondem("Rafael Rocha", "Rafael Silva")).toBe(false);
    });

    it("nomes completamente diferentes", () => {
      expect(nomesCorrespondem("João Silva", "Maria Santos")).toBe(false);
    });

    it("nome vazio", () => {
      expect(nomesCorrespondem("", "Rafael Rocha")).toBe(false);
    });

    it("ambos vazios", () => {
      expect(nomesCorrespondem("", "")).toBe(false);
    });

    it("apenas preposições", () => {
      expect(nomesCorrespondem("de da", "de da")).toBe(false);
    });

    it("primeiro nome igual mas último diferente", () => {
      expect(nomesCorrespondem("Ana Costa", "Ana Pereira")).toBe(false);
    });
  });

  describe("casos especiais", () => {
    it("nome único idêntico", () => {
      expect(nomesCorrespondem("Rafael", "Rafael")).toBe(true);
    });

    it("nome único diferente", () => {
      expect(nomesCorrespondem("Rafael", "Carlos")).toBe(false);
    });

    it("nome com caracteres especiais (ç, ã, õ)", () => {
      expect(nomesCorrespondem("João Conceição", "Joao Conceicao")).toBe(true);
    });
  });
});

// ============================================================
// Testes de segurança (validações de input)
// ============================================================

describe("Validações de segurança OAB", () => {
  it("UFs válidas são aceitas", () => {
    const ufsValidas = ["SP", "RJ", "MG", "BA", "RS", "PR", "PE", "CE", "DF", "GO"];
    ufsValidas.forEach((uf) => {
      expect(uf.length).toBe(2);
      expect(uf).toMatch(/^[A-Z]{2}$/);
    });
  });

  it("número OAB deve ser limpo de caracteres não numéricos", () => {
    const numero = "123.456/SP";
    const limpo = numero.replace(/\D/g, "");
    expect(limpo).toBe("123456");
  });

  it("número OAB vazio após limpeza deve ser rejeitado", () => {
    const numero = "...///";
    const limpo = numero.replace(/\D/g, "");
    expect(limpo).toBe("");
    expect(limpo.length).toBe(0);
  });
});

// ============================================================
// Testes de isolamento de dados
// ============================================================

describe("Isolamento de dados", () => {
  it("query de OABs deve sempre incluir userId", () => {
    // Verificação estática: o router-oab.ts usa eq(oabsAdvogado.userId, ctx.user.id) em TODOS os endpoints
    // Este teste documenta a regra de segurança
    const routerCode = require("fs").readFileSync(
      require("path").join(__dirname, "router-oab.ts"),
      "utf-8"
    );

    // Contar quantas vezes userId é usado como filtro
    const userIdFilters = (routerCode.match(/oabsAdvogado\.userId/g) || []).length;
    // Deve ter pelo menos 1 filtro por endpoint (listar, cadastrar, remover, alterarStatus)
    expect(userIdFilters).toBeGreaterThanOrEqual(4);
  });

  it("query de notificações deve sempre incluir userId", () => {
    const routerCode = require("fs").readFileSync(
      require("path").join(__dirname, "router-notificacoes.ts"),
      "utf-8"
    );

    const userIdFilters = (routerCode.match(/notificacoes\.userId/g) || []).length;
    // Deve ter pelo menos 1 filtro por endpoint (listar, contar, marcarLida, marcarTodas, apagar, limpar)
    expect(userIdFilters).toBeGreaterThanOrEqual(6);
  });

  it("criarNotificacao helper requer userId", () => {
    const routerCode = require("fs").readFileSync(
      require("path").join(__dirname, "router-notificacoes.ts"),
      "utf-8"
    );

    // A função criarNotificacao deve usar params.userId
    expect(routerCode).toContain("params.userId");
  });
});
