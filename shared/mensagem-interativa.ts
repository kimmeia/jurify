/**
 * O que uma mensagem interativa do WhatsApp deixa gravado na conversa.
 *
 * Os botões saem para o cliente pela Cloud API, mas quem atende via só o
 * texto da pergunta: as opções não eram guardadas em lugar nenhum, e a
 * escolha do cliente chegava como texto comum — indistinguível de alguém
 * digitando o título do botão.
 *
 * Aqui ficam o formato gravado em `mensagens.payload` e a leitura dele. A
 * leitura é defensiva de propósito: payload é texto livre no banco, escrito
 * por versões diferentes do sistema ao longo do tempo.
 */

export type OpcaoInterativa = { id: string; titulo: string };

export type EnvioInterativo = {
  /** "botoes" = até 3 botões; "lista" = menu suspenso. */
  modo: "botoes" | "lista";
  /** Na lista, os itens de todas as seções em ordem — a tela mostra um por linha. */
  opcoes: OpcaoInterativa[];
  /** Rótulo do botão que abre a lista (só no modo lista). */
  drawerLabel?: string;
  /** Template aprovado: os botões vêm do template, não do bloco. */
  template?: string;
};

/** Clique que voltou da Meta (button_reply / list_reply). */
export type CliqueInterativo = { tipo?: string; id: string; titulo: string };

function comoObjeto(payload: unknown): Record<string, unknown> | null {
  if (!payload) return null;
  let obj: unknown = payload;
  if (typeof payload === "string") {
    try { obj = JSON.parse(payload); } catch { return null; }
  }
  return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
}

function opcoesValidas(bruto: unknown): OpcaoInterativa[] {
  if (!Array.isArray(bruto)) return [];
  const out: OpcaoInterativa[] = [];
  for (const o of bruto) {
    if (!o || typeof o !== "object") continue;
    const id = String((o as any).id ?? "").trim();
    const titulo = String((o as any).titulo ?? "").trim();
    if (id && titulo) out.push({ id, titulo });
  }
  return out;
}

/** As opções que FORAM ENVIADAS nesta mensagem. `null` quando não é interativa. */
export function envioInterativoDoPayload(payload: unknown): EnvioInterativo | null {
  const obj = comoObjeto(payload);
  const bruto = comoObjeto(obj?.interativo);
  if (!bruto) return null;
  const opcoes = opcoesValidas(bruto.opcoes);
  if (opcoes.length === 0) return null;
  const template = typeof bruto.template === "string" && bruto.template.trim() ? bruto.template.trim() : undefined;
  const drawerLabel = typeof bruto.drawerLabel === "string" && bruto.drawerLabel.trim() ? bruto.drawerLabel.trim() : undefined;
  return { modo: bruto.modo === "lista" ? "lista" : "botoes", opcoes, drawerLabel, template };
}

/** O clique que o cliente deu. `null` quando ele digitou em vez de clicar. */
export function cliqueDoPayload(payload: unknown): CliqueInterativo | null {
  const obj = comoObjeto(payload);
  const bruto = comoObjeto(obj?.interactiveReply);
  if (!bruto) return null;
  const id = String(bruto.id ?? "").trim();
  const titulo = String(bruto.titulo ?? "").trim();
  if (!id && !titulo) return null;
  return { tipo: typeof bruto.tipo === "string" ? bruto.tipo : undefined, id, titulo };
}

/**
 * Achata as seções da lista: a tela mostra as opções uma embaixo da outra,
 * e o título da seção não muda o que o cliente pode escolher.
 */
export function opcoesDasSecoes(
  secoes: Array<{ itens?: Array<{ id?: string; titulo?: string }> }> | undefined,
): OpcaoInterativa[] {
  const plano: unknown[] = [];
  for (const s of secoes || []) for (const i of s?.itens || []) plano.push(i);
  return opcoesValidas(plano);
}
