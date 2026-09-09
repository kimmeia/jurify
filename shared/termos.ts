/**
 * Versão vigente dos Termos de Uso + Política de Privacidade.
 *
 * Bump AQUI quando o texto mudar de forma relevante: todo dono de
 * escritório com versão aceita menor é travado no próximo acesso até
 * re-aceitar (TermosGate). Colaboradores aceitam no próprio cadastro e
 * não são travados — quem responde pelo contrato é o dono.
 */
export const TERMOS_VERSAO = 2;
export const TERMOS_ATUALIZADO_EM = "24 de agosto de 2026";

/** O que mudou — mostrado no gate de re-aceite pro dono decidir informado. */
export const TERMOS_MUDANCAS_V2: readonly string[] = [
  "Papéis de dados (LGPD): o escritório é o controlador dos dados que insere; o JuridFlow atua como operador.",
  "Responsabilidade integral do escritório pelo uso dos dados de terceiros (clientes, processos, mensagens).",
  "Lista dos suboperadores de tecnologia, incluindo os provedores de IA (OpenAI e Anthropic).",
];

/**
 * Quem precisa re-aceitar os termos ao entrar no app. Pura pra ser testável:
 * admin e impersonação nunca aceitam (aceite é ato pessoal do contratante),
 * colaborador não decide pelo escritório, e dono só é travado quando a
 * versão aceita ficou pra trás (0 = nunca registrou versão).
 */
export function precisaAceitarTermos(args: {
  role: string;
  impersonado: boolean;
  ehDono: boolean;
  versaoAceita: number | null;
}): boolean {
  if (args.role === "admin") return false;
  if (args.impersonado) return false;
  if (!args.ehDono) return false;
  return (args.versaoAceita ?? 0) < TERMOS_VERSAO;
}
