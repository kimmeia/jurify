/**
 * A trava do JurisIA.
 *
 * Estes testes existem porque o dano de uma citação inventada não é uma tela
 * feia — é uma petição protocolada com jurisprudência que não existe. A regra
 * precisa ser estrutural e verificável, não uma frase no prompt pedindo pro
 * modelo se comportar (que foi o que falhou no filtro anti-enchimento).
 */

import { describe, it, expect } from "vitest";
import { validarResposta } from "../../shared/jurisia-resposta";

const FONTES = [101, 102, 103];
const ok = (r: ReturnType<typeof validarResposta>) => {
  if (!r.ok) throw new Error(`esperava ok, veio: ${r.motivo}`);
  return r.resposta;
};

describe("validarResposta", () => {
  it("aceita afirmação ancorada numa fonte entregue", () => {
    const r = ok(
      validarResposta(
        {
          achou: true,
          afirmacoes: [{ texto: "O juízo reduziu a taxa para 2,1% ao mês.", fontes: [101] }],
          conclusao: "Vale recorrer da parte do dano moral.",
        },
        FONTES,
      ),
    );
    expect(r.afirmacoes).toHaveLength(1);
    expect(r.fontesUsadas).toEqual([101]);
    expect(r.conclusao).toBe("Vale recorrer da parte do dano moral.");
  });

  it("recusa a resposta INTEIRA quando cita fonte que não existe", () => {
    // Id inventado não é deslize pontual: é sinal de que o turno não está
    // ancorado. Aproveitar as outras afirmações seria confiar no resto.
    const r = validarResposta(
      {
        achou: true,
        afirmacoes: [
          { texto: "O juízo reduziu a taxa para 2,1% ao mês.", fontes: [101] },
          { texto: "O STJ pacificou a matéria no Tema 1.061.", fontes: [999] },
        ],
      },
      FONTES,
    );
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ motivo: expect.stringContaining("999") });
  });

  it("recusa afirmação sem fonte nenhuma", () => {
    const r = validarResposta(
      { achou: true, afirmacoes: [{ texto: "A ação tem boas chances de êxito.", fontes: [] }] },
      FONTES,
    );
    expect(r.ok).toBe(false);
  });

  it("'não achei' é resposta válida e não exige afirmação", () => {
    // É o caminho que a tela promete: sem base no acervo, ela diz que não tem.
    const r = ok(
      validarResposta(
        { achou: false, conclusao: "Não encontrei nada sobre isso nos autos deste processo." },
        FONTES,
      ),
    );
    expect(r.achou).toBe(false);
    expect(r.afirmacoes).toEqual([]);
    expect(r.fontesUsadas).toEqual([]);
  });

  it("dizer que achou sem trazer nada verificável é recusado", () => {
    // Pior que "não achei": a tela mostraria só a conclusão, flutuando.
    const r = validarResposta({ achou: true, afirmacoes: [], conclusao: "Boas chances." }, FONTES);
    expect(r.ok).toBe(false);
  });

  it("descarta trecho curto demais pra ser afirmação", () => {
    const r = validarResposta(
      {
        achou: true,
        afirmacoes: [
          { texto: "Sim.", fontes: [101] },
          { texto: "A perícia foi deferida e o laudo tem prazo de 30 dias.", fontes: [102] },
        ],
      },
      FONTES,
    );
    expect(ok(r).afirmacoes).toHaveLength(1);
  });

  it("normaliza fonte repetida sem perder a ordem de citação", () => {
    const r = ok(
      validarResposta(
        {
          achou: true,
          afirmacoes: [
            { texto: "A sentença julgou procedente em parte o pedido.", fontes: [102, 102] },
            { texto: "O acórdão manteve a sentença por unanimidade.", fontes: [101, 102] },
          ],
        },
        FONTES,
      ),
    );
    expect(r.afirmacoes[0].fontes).toEqual([102]);
    expect(r.fontesUsadas).toEqual([102, 101]);
  });

  it("aceita string JSON, que é o que o provedor devolve", () => {
    const r = ok(
      validarResposta(
        JSON.stringify({
          achou: true,
          afirmacoes: [{ texto: "Audiência designada para 12/08 às 14h30.", fontes: [103] }],
        }),
        FONTES,
      ),
    );
    expect(r.fontesUsadas).toEqual([103]);
  });

  it("JSON quebrado não passa por acidente", () => {
    expect(validarResposta("{isso não é json", FONTES).ok).toBe(false);
    expect(validarResposta(null, FONTES).ok).toBe(false);
    expect(validarResposta(undefined, FONTES).ok).toBe(false);
  });

  it("fonte não-inteira não vira id válido", () => {
    // "101" como string ou 10.5 chegando do modelo não pode virar match.
    const r = validarResposta(
      { achou: true, afirmacoes: [{ texto: "O prazo começou a correr em 02/08.", fontes: ["101"] }] },
      FONTES,
    );
    expect(r.ok).toBe(false);
  });

  it("conclusão é opcional", () => {
    const r = ok(
      validarResposta(
        { achou: true, afirmacoes: [{ texto: "O processo está concluso para sentença.", fontes: [101] }] },
        FONTES,
      ),
    );
    expect(r.conclusao).toBeNull();
  });
});
