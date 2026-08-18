/**
 * Duas maneiras de o sistema mentir sobre o documento — as duas vistas em
 * produção no mesmo dia, em movimentações vizinhas.
 *
 * 1. FALSO POSITIVO. O PJe serve a peça dentro de um visualizador JSF. Pedir
 *    a URL por HTTP devolve 200 com a casca da tela — menu, nome de quem está
 *    logado, id do servidor. Isso passou por uma checagem de "tem mais de 40
 *    caracteres" e virou teor gravado; em cima dele a IA escreveu quatro
 *    conclusões jurídicas confiantes sobre uma decisão que nunca leu, e o card
 *    passou a anunciar "sem impacto direto no nosso cliente".
 *
 *    Texto errado dá pra perceber. Resumo bem escrito de texto errado, não.
 *
 * 2. FALSO NEGATIVO. A classificação era decidida na coleta e gravada pra
 *    sempre. Quando o extrator de id no rótulo entrou no ar, tudo que já havia
 *    sido coletado ficou congelado em "sem_documento" — inclusive uma sentença
 *    cujo rótulo diz, com todas as letras, "Embargos de Declaração
 *    Não-acolhidos 226220878 - Sentença". O id estava escrito na tela e o
 *    sistema respondia que não havia documento.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { pareceCascaDeAplicacao, textoDoDocumento } from "../processos/teor-documento";
import {
  documentoIdDoEvento,
  documentoTipoDoEvento,
  teorStatusDoEvento,
} from "../processos/documento-do-evento";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** O que voltou de verdade quando o botão foi clicado em produção. */
const CASCA_REAL = [
  "Abrir menu",
  "Consulta Documentos do Processo",
  "bruno sobreira",
  "BRUNO BOYADJIAN SOBREIRA BRUNO BOYADJIAN SOBREIRA (000.000.000-00) / Advogado",
  "tjpjp09",
].join("\n");

describe("a casca do visualizador não passa por documento", () => {
  it("reconhece o que voltou em produção", () => {
    expect(pareceCascaDeAplicacao(CASCA_REAL)).toBe(true);
  });

  it("textoDoDocumento recusa, em vez de devolver o menu", async () => {
    const html = Buffer.from(`<html><body><p>${CASCA_REAL}</p></body></html>`, "utf-8");
    await expect(textoDoDocumento(html, "text/html")).rejects.toThrow(/visualizador/i);
  });

  it("despacho curto de verdade continua passando", async () => {
    // A tentação seria exigir um tamanho mínimo. Despacho legítimo cabe em uma
    // linha, e um piso de caracteres jogaria fora justamente os mais diretos.
    const despacho = "Vistos. Recebo os embargos. Intime-se a parte contrária. Cumpra-se.";
    expect(pareceCascaDeAplicacao(despacho)).toBe(false);
    const html = Buffer.from(`<html><body>${despacho}</body></html>`, "utf-8");
    await expect(textoDoDocumento(html, "text/html")).resolves.toContain("Recebo os embargos");
  });

  it("a checagem de 40 caracteres deixou de ser a única defesa", () => {
    const guarda = ler("server/processos/documento-por-id.ts");
    expect(guarda).toContain("texto.trim().length < 40");
    // O piso continua valendo pra resposta vazia, mas quem barra a casca é o
    // textoDoDocumento, que todos os caminhos atravessam.
    expect(ler("server/processos/teor-documento.ts")).toContain("pareceCascaDeAplicacao(texto)");
  });
});

describe("rótulo desmente o “sem documento”", () => {
  const sentenca = {
    conteudo: "Embargos de Declaração Não-acolhidos 226220878 - Sentença",
    teorUrl: null,
    teorStatus: "sem_documento",
    documentoIdTribunal: null,
    documentoTipo: null,
  };

  it("acha o id que estava escrito na tela o tempo todo", () => {
    expect(documentoIdDoEvento(sentenca)).toBe("226220878");
    expect(documentoTipoDoEvento(sentenca)).toBe("Sentença");
  });

  it("vira pendente, e o botão de buscar aparece", () => {
    expect(teorStatusDoEvento(sentenca)).toBe("pendente");
  });

  it("movimento de rotina continua sem documento", () => {
    // "Conclusos para despacho" não tem peça mesmo — inventar um botão ali
    // seria trocar um erro por outro.
    expect(teorStatusDoEvento({ ...sentenca, conteudo: "Conclusos para despacho" })).toBe(
      "sem_documento",
    );
  });

  it("não reescreve status que são fato do que já se tentou", () => {
    // "erro" e "indisponivel" dizem o que aconteceu numa tentativa real; só a
    // afirmação "não existe documento" é que o rótulo pode desmentir sozinho.
    for (const status of ["erro", "indisponivel", "ok", "pendente"]) {
      expect(teorStatusDoEvento({ ...sentenca, teorStatus: status })).toBe(status);
    }
  });

  it("a derivação vale na lista e no detalhe", () => {
    // Lista e drawer discordarem sobre "tem documento?" seria pior que os dois
    // estarem errados juntos.
    const router = ler("server/processos/router-movimentacoes.ts");
    expect(router).toContain("teorStatus: teorStatusDoEvento(row.ev)");
    expect(router).toContain("teorStatus: teorStatusDoEvento(r)");
    expect(router).toContain("documentoId: documentoIdDoEvento(row.ev)");
  });

  it("o botão de baixar aceita id vindo do rótulo", () => {
    const router = ler("server/processos/router-movimentacoes.ts");
    expect(router).toContain("const documentoId = documentoIdDoEvento(row.ev)");
    expect(router).not.toContain("row.ev.documentoIdTribunal!");
  });
});

describe("a limpeza do que já foi gravado errado", () => {
  const migration = ler("drizzle/0195_teor_casca_do_visualizador.sql");

  it("apaga o teor falso E a análise escrita em cima dele", () => {
    // Deixar o resumo seria pior que deixar o teor: ele é convincente.
    for (const campo of ["teor = NULL", "resumo_ia = NULL", "analiseJson = NULL"]) {
      expect(migration, campo).toContain(campo);
    }
  });

  it("volta pra pendente, pra poder ser lido de novo", () => {
    expect(migration).toContain("teorStatus = 'pendente'");
  });

  it("leva junto a sugestão de prazo derivada do menu", () => {
    expect(migration).toContain("DELETE ps FROM prazos_sugeridos ps");
    // Sugestão já aprovada ou descartada é decisão do advogado, não se mexe.
    expect(migration).toContain("ps.status = 'pendente'");
  });
});
