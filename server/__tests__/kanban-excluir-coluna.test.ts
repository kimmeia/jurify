/**
 * Excluir coluna é a operação mais destrutiva do Kanban.
 *
 * Ela apaga um número arbitrário de cards de uma vez, sem arquivar e sem
 * desfazer. Já custou 82 cards num escritório — 80 deles de uma coluna só,
 * que foi de 95 para 36 entre dois relatórios.
 *
 * Três coisas faltavam, e cada uma sozinha teria evitado o estrago:
 *
 *   · gate nenhum. `protectedProcedure` puro só confere login, então qualquer
 *     colaborador podia decidir pelos cards de todo mundo.
 *   · os satélites ficavam para trás. O `deletarCard` ao lado sempre limpou;
 *     aqui não, e o histórico órfão virava a única prova de que os cards
 *     existiram (é o que a KAN-02 do auditor acusa até hoje).
 *   · `confirm()` do navegador perguntando "excluir coluna e seus cards?" —
 *     sem dizer quantos, e sem oferecer arquivar, que preserva tudo.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const router = ler("server/escritorio/router-kanban.ts");
const tela = ler("client/src/pages/Kanban.tsx");

const corpoDeletarColuna = (() => {
  const i = router.indexOf("deletarColuna: protectedProcedure");
  const fim = router.indexOf("// ─── CARDS", i);
  expect(i, "deletarColuna sumiu do router").toBeGreaterThan(0);
  expect(fim, "o marcador da seção CARDS sumiu — o recorte ficaria cego").toBeGreaterThan(i);
  return router.slice(i, fim);
})();

describe("excluir coluna — quem pode", () => {
  it("exige dono ou gestor, não só estar logado", () => {
    // `verTodos` é o que separa "mexe nos próprios cards" de "decide pelos
    // cards de todo mundo". Excluir coluna é a segunda coisa.
    expect(corpoDeletarColuna).toContain('checkPermission(ctx.user.id, "kanban", "excluir")');
    expect(corpoDeletarColuna).toContain("!perm.verTodos");
    expect(corpoDeletarColuna).toContain("Só dono ou gestor pode excluir uma coluna inteira.");
  });

  it("não usa o escritório solto — usa o do checkPermission", () => {
    // getEscritorioPorUsuario responde "de quem é", não "pode o quê".
    expect(corpoDeletarColuna).not.toContain("getEscritorioPorUsuario");
    expect(corpoDeletarColuna).toContain("perm.escritorioId");
  });
});

describe("excluir coluna — o que vai junto", () => {
  it("limpa os satélites, como o deletarCard sempre fez", () => {
    for (const tabela of ["kanbanMovimentacoes", "kanbanResponsavelLog", "kanbanComentarios"]) {
      expect(corpoDeletarColuna, tabela).toContain(`db.delete(${tabela})`);
    }
  });

  it("apaga os cards por id, não por coluna", () => {
    // Apagar por `colunaId` não dá a lista de ids — e sem os ids não há como
    // limpar os satélites. Buscar primeiro é o que torna a limpeza possível.
    expect(corpoDeletarColuna).toContain("inArray(kanbanCards.id, ids)");
    expect(corpoDeletarColuna).not.toContain("delete(kanbanCards).where(eq(kanbanCards.colunaId");
  });

  it("devolve quantos cards levou junto", () => {
    expect(corpoDeletarColuna).toContain("cardsExcluidos: ids.length");
  });
});

describe("excluir coluna — o aviso na tela", () => {
  it("não pergunta pelo confirm() do navegador", () => {
    const i = tela.indexOf("setColunaParaExcluir({");
    expect(i, "o botão de excluir coluna deveria abrir o AlertDialog").toBeGreaterThan(0);
    expect(tela.slice(i, i + 200)).not.toContain("confirm(");
  });

  it("diz o número de cards antes, não depois — e o número vem do servidor", () => {
    // A lista da tela é filtrada (arquivados escondidos, filtro do quadro);
    // contar por ela prometia "nenhum card será afetado" e apagava cinco.
    expect(tela).toContain("kanban.previaExcluirColuna.useQuery");
    expect(tela).toContain("Esta coluna tem {previaColuna.total}");
    expect(tela).not.toContain("colunaParaExcluir?.cards");
  });

  it("oferece arquivar, que é a saída que preserva tudo", () => {
    // Quase sempre a intenção é "tirar do quadro", não "destruir".
    expect(tela).toContain("Arquivar os {previaColuna.total} e excluir a coluna");
    expect(tela).toContain('modo: "arquivar"');
    expect(tela).toContain("continuam consultáveis");
  });

  it("a confirmação destrutiva não é a única opção nem a mais fácil", () => {
    expect(tela).toContain("Excluir tudo");
    expect(tela).toContain("<AlertDialogCancel>Cancelar</AlertDialogCancel>");
  });
});
