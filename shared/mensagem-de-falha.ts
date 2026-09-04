/**
 * Texto do aviso quando uma ação falha e o botão não tem tratamento próprio.
 * O servidor já manda mensagens em português; o que precisa de tradução é a
 * falha de transporte (o navegador fala "Failed to fetch") e o erro interno
 * genérico.
 */

export type ErroDeAcao = {
  message?: unknown;
  data?: { code?: string } | null;
} | null | undefined;

export const TITULO_FALHA_PADRAO = "Não foi possível concluir a ação";

export function mensagemDeFalha(erro: ErroDeAcao): { titulo: string; descricao: string } {
  const bruta = typeof erro?.message === "string" ? erro.message.trim() : "";
  const code = erro?.data?.code;

  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(bruta)) {
    return { titulo: TITULO_FALHA_PADRAO, descricao: "Sem conexão com o servidor. Verifique sua internet e tente de novo." };
  }
  if (code === "INTERNAL_SERVER_ERROR" || /^internal server error$/i.test(bruta)) {
    return {
      titulo: TITULO_FALHA_PADRAO,
      descricao: bruta && !/^internal server error$/i.test(bruta) ? bruta : "Erro no servidor. Tente de novo em instantes.",
    };
  }
  if (code === "FORBIDDEN") {
    return { titulo: "Sem permissão", descricao: bruta || "Você não tem permissão para esta ação." };
  }
  return { titulo: TITULO_FALHA_PADRAO, descricao: bruta || "Tente de novo em instantes." };
}
