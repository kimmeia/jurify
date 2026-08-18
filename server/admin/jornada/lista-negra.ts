/**
 * O que o robô nunca clica.
 *
 * O robô navega dentro de um escritório descartável, então em tese poderia
 * clicar em tudo — o estrago morreria com o escritório. Duas razões pra não
 * confiar nisso:
 *
 *  1. A parede do `escritorioId` é do produto, e é justamente o produto que
 *     o robô está lá pra testar. Se ela tiver um furo, o clique destrutivo
 *     acontece do lado errado dela. A lista negra é a segunda tranca, e ela
 *     não depende do código que está sendo auditado estar correto.
 *
 *  2. Nem tudo que destrói respeita escritório. Cancelar assinatura fala com
 *     o Asaas, gerar cobrança cria fatura de verdade, e um "excluir" numa
 *     tela admin não tem dono.
 *
 * A régua: o robô CRIA, EDITA, NAVEGA e CONFERE. O que apaga, cobra, cancela
 * ou dispara mensagem fica fora — por escrito, não por bom senso de quem
 * escreveu o passo.
 */

/**
 * Casado contra o nome acessível do controle (texto visível, `aria-label` ou
 * `title`), sem acento e em minúsculas. Nome acessível e não seletor CSS
 * porque é o que o usuário lê: mudar a classe do botão não deve furar a
 * trava, mudar o texto pra "Apagar definitivamente" também não.
 */
export const ACOES_PROIBIDAS: readonly RegExp[] = [
  // Destruição
  /\bexclui/, /\bexcluir\b/, /\bapagar\b/, /\bapague\b/, /\bdeletar\b/, /\bremover\b/, /\bremove\b/,
  /\blimpar tudo\b/, /\besvaziar\b/, /\barquivar\b/,
  // Dinheiro
  /\bcobran[cç]a\b/, /\bcobrar\b/, /\bfaturar\b/, /\bemitir\b/, /\bgerar boleto\b/, /\bgerar pix\b/,
  /\bcancelar assinatura\b/, /\btrocar plano\b/, /\bcomprar\b/, /\bcr[eé]dito/,
  // Mensagem saindo pra alguém
  /\benviar\b/, /\breenviar\b/, /\bdisparar\b/, /\bnotificar\b/, /\bconvidar\b/,
  // Consulta paga no tribunal
  /\bmonitorar\b/, /\bconsultar cnj\b/, /\bcarregar detalhes\b/, /\bler documento\b/,
  /\bbuscar o documento\b/, /\btentar de novo\b/, /\bvalidar\b/,
  // Irreversível de conta
  /\bimpersonar\b/, /\bassumir sess/, /\bredefinir senha\b/, /\bdesativar\b/,
];

/** Normaliza como o robô lê o nome do controle: sem acento, minúsculo, sem espaço duplo. */
export function normalizarNomeAcessivel(bruto: string | null | undefined): string {
  return (bruto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `true` = o robô não encosta.
 *
 * Na dúvida a resposta é sim: um controle que o robô deixa de clicar custa
 * uma conferência a menos; um que ele clica sem dever pode custar um dado.
 */
export function ehAcaoProibida(nomeAcessivel: string | null | undefined): boolean {
  const nome = normalizarNomeAcessivel(nomeAcessivel);
  if (!nome) return false;
  return ACOES_PROIBIDAS.some((re) => re.test(nome));
}

/**
 * Rotas que o robô não visita nem por URL.
 *
 * `/admin` é global por natureza: não tem `escritorioId` pra filtrar, então
 * a parede principal não existe lá dentro. O robô também não tem conta que
 * abra essa porta — isto é o cinto além do suspensório.
 */
export const ROTAS_PROIBIDAS: readonly string[] = ["/admin", "/impersonar", "/checkout", "/assinatura"];

export function ehRotaProibida(rota: string): boolean {
  const limpa = rota.trim().toLowerCase();
  return ROTAS_PROIBIDAS.some((p) => limpa === p || limpa.startsWith(`${p}/`));
}
