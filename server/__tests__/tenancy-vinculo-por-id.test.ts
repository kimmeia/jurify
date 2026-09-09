/**
 * Id que chega do cliente não escolhe o escritório.
 *
 * Três buracos encontrados na varredura de véspera de lançamento, todos da
 * mesma família: uma procedure aceita `contatoId` (ou resolve o escritório
 * da sessão) e o banco é consultado sem amarrar o dono.
 *
 * 1. `agentesIa.listarCapturadosDoContato` é `protectedProcedure` — só checa
 *    login — e passava o `contatoId` cru pra uma leitura sem `escritorioId`.
 *    Qualquer usuário logado lia os campos capturados de QUALQUER contato da
 *    plataforma. O filtro por definições do próprio escritório, que vem
 *    depois, não protege: chave que os dois escritórios definem passa.
 *
 * 2. A agenda gravava `contatoId` sem conferir dono. A leitura escopada que
 *    existia ali só rodava dentro do `if (!responsavelId && input.contatoId)`
 *    — mandando um responsável junto, o id alheio entrava. Depois, toda tela
 *    que junta agendamento e contato pra mostrar o nome exibia dado de outro
 *    escritório, sem bug nenhum nessas telas.
 *
 * 3. `getEscritorioPorUsuario` decide o escritório da sessão inteira com
 *    `LIMIT 1` sem `ORDER BY`. Quem tem dois vínculos ativos (removido de um,
 *    abriu o próprio, foi restaurado no primeiro) caía num escritório
 *    indefinido — podia mudar entre requisições.
 *
 * Teste de texto porque exercitar de verdade exige banco por caso; o que ele
 * guarda é a presença da amarra, que foi o defeito.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = (...p: string[]) => join(__dirname, "..", ...p);

describe("leitura de campos capturados exige o escritório", () => {
  const FONTE = readFileSync(raiz("integracoes", "agente-captura-campos.ts"), "utf8");

  it("nenhuma leitura de contatos filtra só por id", () => {
    const soPorId = FONTE.match(/\.from\(contatos\)\s*(?:\/\/[^\n]*\n\s*)*\.where\(eq\(contatos\.id,/g) ?? [];
    expect(
      soPorId,
      "sem `escritorioId` na cláusula, qualquer usuário logado lê o cadastro de qualquer contato",
    ).toEqual([]);
  });

  it("as três leituras de contatos amarram o escritório", () => {
    const leituras = (FONTE.match(/\.from\(contatos\)/g) ?? []).length;
    const amarradas = (FONTE.match(/eq\(contatos\.escritorioId,/g) ?? []).length;
    expect(amarradas, `${leituras} leituras de contatos, ${amarradas} amarradas`).toBe(leituras);
  });
});

describe("agenda não aceita contato de outro escritório", () => {
  const FONTE = readFileSync(raiz("escritorio", "router-agenda.ts"), "utf8");

  it("toda procedure que valida responsável também valida o contato", () => {
    const responsavel = (FONTE.match(/await validarResponsavel\(/g) ?? []).length;
    const contato = (FONTE.match(/await exigirContatoDoEscritorio\(/g) ?? []).length;
    expect(responsavel).toBeGreaterThan(0);
    expect(
      contato,
      "compromisso, tarefa e atualização gravam `contatoId` cru — as três precisam do portão",
    ).toBe(responsavel);
  });

  it("o portão vem antes da escrita", () => {
    const portao = FONTE.indexOf("await exigirContatoDoEscritorio(");
    const insere = FONTE.indexOf("contatoId: input.contatoId");
    expect(portao).toBeGreaterThan(0);
    expect(insere).toBeGreaterThan(0);
    expect(portao, "validar depois de gravar não valida nada").toBeLessThan(insere);
  });
});

describe("escritório da sessão é determinístico", () => {
  const FONTE = readFileSync(raiz("escritorio", "db-escritorio.ts"), "utf8");

  it("a escolha do vínculo ativo é ordenada", () => {
    const trecho = FONTE.slice(
      FONTE.indexOf("export async function getEscritorioPorUsuario"),
      FONTE.indexOf("export async function criarEscritorio"),
    );
    expect(trecho).toContain(".from(colaboradores)");
    expect(
      trecho,
      "com dois vínculos ativos e sem ORDER BY, o escritório da sessão inteira fica indefinido",
    ).toContain(".orderBy(");
  });
});
