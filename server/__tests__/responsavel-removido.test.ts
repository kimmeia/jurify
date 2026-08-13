/**
 * Colaborador removido não recebe trabalho novo.
 *
 * O caso: a Bia saiu em julho e apareceu com atendimento no relatório de
 * agosto. Não era erro do relatório — era conversa de agosto mesmo, nascida
 * no nome dela.
 *
 * A remoção é soft-delete e NÃO limpa `contatos.responsavelId`, de propósito:
 * o histórico de quem atendeu quem tem que sobreviver à saída da pessoa. Mas
 * a criação de conversa lia esse campo cru pra herdar o atendente, e a
 * conversa nascia JÁ COM dono — então o rodízio, que filtra por ativo, nunca
 * era consultado. Cliente antigo da Bia que mandou mensagem em agosto caiu
 * numa caixa que ninguém abre.
 *
 * A distinção que este teste protege, e que um search-and-replace destruiria:
 *
 *  - LER pra CONFERIR DONO (podeVerCliente, gates de "vejo só os meus") usa o
 *    valor CRU e está certo assim. A pergunta ali é "este contato é meu?", e a
 *    resposta não muda porque um terceiro saiu do escritório;
 *  - LER pra ATRIBUIR trabalho novo (conversa, compromisso, tarefa) exige que
 *    a pessoa ainda esteja aqui.
 *
 * Por isso o teste mira os pontos de ATRIBUIÇÃO pelo nome, em vez de varrer
 * todo uso de `contatos.responsavelId` — a varredura ampla acusaria os gates
 * de permissão, que estão corretos.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** O join que amarra o responsável do contato a um colaborador ativo. */
const GUARDA = /innerJoin\(\s*colaboradores,\s*and\(\s*eq\(colaboradores\.id,\s*contatos\.responsavelId\),\s*eq\(colaboradores\.ativo,\s*true\)/;

describe("herança de responsável exige colaborador ativo", () => {
  it("conversa nova do WhatsApp não nasce no nome de quem saiu", () => {
    // É o caminho que produziu o sintoma: conversa com createdAt em agosto
    // apontando pra alguém removido em julho.
    const src = ler("server/integracoes/whatsapp-handler.ts");
    const trecho = src.slice(src.indexOf("async function pegarResponsavelDoContato"));
    expect(trecho).toMatch(GUARDA);
  });

  it("compromisso e tarefa herdam só responsável ativo", () => {
    // Dois pontos com o mesmo buraco no mesmo arquivo — a agenda de quem saiu
    // também é uma caixa que ninguém abre.
    const src = ler("server/escritorio/router-agenda.ts");
    const guardas = src.match(new RegExp(GUARDA.source, "g")) ?? [];
    expect(guardas.length).toBe(2);
  });

  it("todo ponto de atribuição está coberto", () => {
    // Trava o conjunto: se alguém acrescentar um lugar que herda o
    // responsável do contato pra atribuir trabalho, este teste não vê — mas
    // se REMOVER a guarda de um dos existentes, vê na hora.
    const alvos = [
      "server/integracoes/whatsapp-handler.ts",
      "server/escritorio/router-agenda.ts",
    ];
    const total = alvos.reduce(
      (n, f) => n + (ler(f).match(new RegExp(GUARDA.source, "g")) ?? []).length,
      0,
    );
    expect(total).toBe(3);
  });

  it("o gate de permissão continua lendo o valor cru", () => {
    // `podeVerCliente` responde "este contato é meu?". Filtrar por ativo aqui
    // faria um colaborador perder acesso aos próprios clientes no dia em que
    // OUTRA pessoa fosse removida — e, pior, mudaria silenciosamente quem
    // enxerga o quê.
    const src = ler("server/escritorio/router-clientes.ts");
    const inicio = src.indexOf("async function podeVerCliente");
    expect(inicio).toBeGreaterThan(-1);
    const corpo = src.slice(inicio, inicio + 900);
    expect(corpo).toContain("contatos.responsavelId");
    expect(corpo).not.toMatch(/colaboradores\.ativo/);
  });
});
