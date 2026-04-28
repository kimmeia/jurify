/**
 * Helpers puros para o autocomplete de Respostas Rápidas no Atendimento.
 *
 * O usuário digita "/atalho" no input de mensagem e espera um dropdown
 * com templates. Ao selecionar, o "/atalho" é substituído pelo conteúdo.
 *
 * A lógica de parsing vive aqui (pura, testável) — o componente React
 * só cuida da UI e dos eventos do teclado.
 */

export interface AtalhoAtivo {
  /** Índice da barra "/" (inclusivo) no valor do input. */
  inicio: number;
  /** Texto digitado após a barra (sem a "/" inicial), já em lowercase. */
  filtro: string;
}

/**
 * Detecta se o cursor está dentro de um atalho em digitação.
 *
 * Regras:
 *  - O "/" precisa estar no início do input OU ser precedido por espaço
 *    (evita disparar autocomplete em URLs "http://" ou caminhos "a/b").
 *  - Se houver whitespace entre a "/" e o cursor, cancela (o usuário
 *    passou do atalho).
 *  - Se o cursor estiver ANTES da "/" mais recente, não ativa (o usuário
 *    está editando texto à esquerda).
 *
 * Retorna `{inicio, filtro}` quando ativa; `null` quando não.
 */
export function detectarAtalhoAtivo(
  valor: string,
  posicaoCursor: number,
): AtalhoAtivo | null {
  if (posicaoCursor < 1 || posicaoCursor > valor.length) return null;

  // Varre pra trás a partir do cursor procurando uma "/" sem whitespace
  // intermediário. Qualquer whitespace encontrado antes da "/" aborta.
  let inicio = -1;
  for (let i = posicaoCursor - 1; i >= 0; i--) {
    const ch = valor[i];
    if (ch === "/") {
      inicio = i;
      break;
    }
    if (ch === " " || ch === "\t" || ch === "\n") return null;
  }
  if (inicio === -1) return null;

  // "/" precisa estar no início ou logo após whitespace.
  if (inicio > 0) {
    const anterior = valor[inicio - 1];
    if (anterior !== " " && anterior !== "\t" && anterior !== "\n") return null;
  }

  const filtro = valor.slice(inicio + 1, posicaoCursor).toLowerCase();
  return { inicio, filtro };
}

/**
 * Aplica o conteúdo de um template substituindo o segmento do atalho.
 *
 * Dado o valor `"olá /bol"` com `inicio=4` e `posicaoCursor=8`, ao aplicar
 * `conteudo="Boleto gerado em anexo"` devolve `"olá Boleto gerado em anexo"`
 * com cursor posicionado no fim do conteúdo inserido (27).
 */
export function aplicarAtalho(
  valor: string,
  inicio: number,
  posicaoCursor: number,
  conteudo: string,
): { valor: string; cursor: number } {
  const antes = valor.slice(0, inicio);
  const depois = valor.slice(posicaoCursor);
  const novoValor = antes + conteudo + depois;
  return { valor: novoValor, cursor: antes.length + conteudo.length };
}

/**
 * Filtra e ordena a lista de templates para exibição no dropdown.
 *
 * - Considera apenas templates com `atalho` preenchido (sem atalho,
 *   o autocomplete não faz sentido).
 * - `startsWith` case-insensitive: "bol" casa com "/bol" e "/boleto".
 * - Ordenação alfabética por atalho — estável e previsível.
 * - Limita a `maxItens` (default 8) pro dropdown não estourar a tela.
 */
export function filtrarTemplatesParaAtalho<
  T extends { atalho: string | null | undefined },
>(templates: T[], filtro: string, maxItens = 8): T[] {
  const norm = filtro.toLowerCase();
  const comAtalho = templates.filter(
    (t) => typeof t.atalho === "string" && t.atalho.trim().length > 0,
  );
  const match = norm
    ? comAtalho.filter((t) => {
        const a = (t.atalho as string).toLowerCase();
        // Aceita "/bol" no cadastro e match com "bol" digitado (sem a barra).
        const semBarra = a.startsWith("/") ? a.slice(1) : a;
        return semBarra.startsWith(norm);
      })
    : comAtalho;

  return match
    .slice()
    .sort((a, b) => (a.atalho as string).localeCompare(b.atalho as string))
    .slice(0, maxItens);
}
