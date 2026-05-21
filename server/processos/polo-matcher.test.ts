import { describe, it, expect } from "vitest";
import {
  digitosDe,
  identificarPoloDoCliente,
  nomesIguais,
  normalizarNome,
  type ParteParaMatch,
} from "./polo-matcher";

describe("polo-matcher", () => {
  describe("normalizarNome", () => {
    it("remove acentos e diacríticos", () => {
      expect(normalizarNome("José da Silva")).toBe("jose da silva");
      expect(normalizarNome("MARIA JOSÉ AÇÃO")).toBe("maria jose acao");
      expect(normalizarNome("João")).toBe("joao");
    });

    it("lowercase + colapsa espaços", () => {
      expect(normalizarNome("  MARIA   SILVA  ")).toBe("maria silva");
      expect(normalizarNome("Maria\nSilva\tSantos")).toBe("maria silva santos");
    });

    it("remove pontuação preservando letras e espaços", () => {
      expect(normalizarNome("João da Silva (CPF)")).toBe("joao da silva cpf");
      expect(normalizarNome("MARIA SILVA, JR.")).toBe("maria silva jr");
      expect(normalizarNome("EMPRESA LTDA - ME")).toBe("empresa ltda me");
    });

    it("trim aplicado", () => {
      expect(normalizarNome("   ")).toBe("");
      expect(normalizarNome("")).toBe("");
    });
  });

  describe("digitosDe", () => {
    it("extrai apenas dígitos", () => {
      expect(digitosDe("123.456.789-00")).toBe("12345678900");
      expect(digitosDe("12.345.678/0001-90")).toBe("12345678000190");
      expect(digitosDe("CPF: 999.999.999-99")).toBe("99999999999");
    });

    it("trata null/undefined/vazio", () => {
      expect(digitosDe(null)).toBe("");
      expect(digitosDe(undefined)).toBe("");
      expect(digitosDe("")).toBe("");
      expect(digitosDe("abc")).toBe("");
    });
  });

  describe("nomesIguais", () => {
    it("match exato após normalização", () => {
      expect(nomesIguais("Maria Silva", "MARIA SILVA")).toBe(true);
      expect(nomesIguais("José", "Jose")).toBe(true);
      expect(nomesIguais("João da Silva", "joao da silva")).toBe(true);
    });

    it("containment funciona com nomes longos", () => {
      expect(
        nomesIguais("MARIA SILVA SANTOS", "MARIA SILVA SANTOS DA COSTA"),
      ).toBe(true);
      expect(
        nomesIguais("FRANCISCO LEONARDO DA SILVA", "FRANCISCO LEONARDO DA SILVA NOGUEIRA"),
      ).toBe(true);
    });

    it("containment NÃO funciona com nomes curtos (evita FP)", () => {
      // "Ana" < 10 chars — não bate com "Ana Silva Souza"
      expect(nomesIguais("Ana", "Ana Silva Souza")).toBe(false);
      // "João" — só 4 chars
      expect(nomesIguais("João", "João Pedro Carlos")).toBe(false);
    });

    it("nomes diferentes não batem", () => {
      expect(nomesIguais("Maria Silva", "Pedro Silva")).toBe(false);
      expect(nomesIguais("João Carlos", "João Pedro")).toBe(false);
    });

    it("vazio / null-like seguro", () => {
      expect(nomesIguais("", "Maria Silva")).toBe(false);
      expect(nomesIguais("Maria", "")).toBe(false);
      expect(nomesIguais("", "")).toBe(false);
    });
  });

  describe("identificarPoloDoCliente", () => {
    const APELIDO = "FRANCISCO LEONARDO DA SILVA NOGUEIRA";
    const CPF = "03523803306";

    function parte(
      polo: "ativo" | "passivo" | "terceiro",
      nome: string,
      documento: string | null = null,
    ): ParteParaMatch {
      return { polo, nome, documento };
    }

    describe("match por documento (camada 1)", () => {
      it("retorna passivo quando documento bate em parte passiva", () => {
        const partes = [
          parte("ativo", "BANCO XPTO S.A.", "12345678000100"),
          parte("passivo", "Francisco Leonardo", CPF),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("passivo");
      });

      it("retorna ativo quando documento bate apenas em parte ativa", () => {
        const partes = [
          parte("ativo", "Francisco Leonardo", CPF),
          parte("passivo", "EMPRESA RÉ LTDA", "99999999000100"),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("ativo");
      });

      it("retorna terceiro quando documento bate apenas em parte terceira", () => {
        const partes = [
          parte("ativo", "AUTOR X", "11111111111"),
          parte("passivo", "RÉU Y", "22222222222"),
          parte("terceiro", "Francisco Leonardo", CPF),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("terceiro");
      });

      it("documento com máscara também bate (sanitiza antes de comparar)", () => {
        const partes = [
          parte("passivo", "Francisco Leonardo", "035.238.033-06"),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("passivo");
      });

      it("passivo > ativo quando cliente aparece em ambos (ex: reconvenção)", () => {
        const partes = [
          parte("ativo", "Francisco Leonardo", CPF),
          parte("passivo", "Francisco Leonardo", CPF),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("passivo");
      });

      it("terceiro > ativo quando cliente aparece em ambos", () => {
        const partes = [
          parte("ativo", "Francisco Leonardo", CPF),
          parte("terceiro", "Francisco Leonardo", CPF),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("terceiro");
      });
    });

    describe("match por nome (camada 2 — quando documento não bate)", () => {
      it("usa nome quando partes não têm documento", () => {
        const partes = [
          parte("ativo", "BANCO XPTO S.A."),
          parte("passivo", "FRANCISCO LEONARDO DA SILVA NOGUEIRA"),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("passivo");
      });

      it("name match tolerante a caixa e acento", () => {
        const partes = [
          parte("passivo", "francisco leonardo da silva nogueira"),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("passivo");
      });

      it("name match tolerante a sobrenome a mais (containment)", () => {
        const partes = [
          parte("passivo", "FRANCISCO LEONARDO DA SILVA NOGUEIRA JUNIOR"),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("passivo");
      });

      it("desconhecido quando nem documento nem nome batem", () => {
        const partes = [
          parte("ativo", "Outra Pessoa Qualquer"),
          parte("passivo", "Empresa XPTO"),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("desconhecido");
      });

      it("documento bate ignora nome divergente", () => {
        const partes = [
          // Mesmo CPF mas nome diferente — provavelmente erro de cadastro,
          // mas documento é fonte de verdade.
          parte("passivo", "FRANCISCO LEONARDO SILVA", CPF),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("passivo");
      });

      it("documento de outra parte NÃO interfere no match por nome", () => {
        const partes = [
          parte("ativo", "OUTRO FULANO", "99999999999"),
          parte("passivo", "FRANCISCO LEONARDO DA SILVA NOGUEIRA", null),
        ];
        expect(identificarPoloDoCliente(APELIDO, CPF, partes)).toBe("passivo");
      });
    });

    describe("edge cases", () => {
      it("partes vazio → desconhecido", () => {
        expect(identificarPoloDoCliente(APELIDO, CPF, [])).toBe("desconhecido");
      });

      it("apelido null + nenhum documento bate → desconhecido", () => {
        const partes = [parte("passivo", "FRANCISCO LEONARDO DA SILVA NOGUEIRA")];
        expect(identificarPoloDoCliente(null, CPF, partes)).toBe("desconhecido");
      });

      it("apelido null + documento bate → identifica polo", () => {
        const partes = [parte("passivo", "Nome qualquer", CPF)];
        expect(identificarPoloDoCliente(null, CPF, partes)).toBe("passivo");
      });

      it("searchKey vazio + apelido bate → identifica polo por nome", () => {
        const partes = [parte("passivo", APELIDO, "99999999999")];
        expect(identificarPoloDoCliente(APELIDO, "", partes)).toBe("passivo");
      });

      it("partes não-array (defesa contra capa malformada) → desconhecido", () => {
        expect(
          identificarPoloDoCliente(APELIDO, CPF, null as unknown as ParteParaMatch[]),
        ).toBe("desconhecido");
        expect(
          identificarPoloDoCliente(APELIDO, CPF, undefined as unknown as ParteParaMatch[]),
        ).toBe("desconhecido");
      });
    });
  });
});
