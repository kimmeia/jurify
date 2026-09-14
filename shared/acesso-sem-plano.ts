/**
 * "Só libera o uso depois de escolher plano ou teste" — decisão do dono em
 * 13/09/2026.
 *
 * Até aqui essa regra era um DESENHO: o `SubscriptionGuard` redirecionava no
 * navegador, mas a API respondia normalmente sem assinatura — o porteiro de
 * módulos (`gate-modulos.ts`) é fail-open de propósito e lê "sem assinatura"
 * como "não sei", liberando tudo. Quem fechasse a tela e chamasse o servidor
 * direto usava o sistema inteiro sem plano nenhum.
 *
 * A régua NÃO muda: quem tem acesso continua sendo `getActiveSubscription`
 * (cortesia > paga > teste > cancelada em carência). O que muda é que ela
 * passa a valer fora do navegador também.
 *
 * Ao contrário do mapa de módulos, aqui a decisão é **deny-by-default**:
 * namespace que ninguém declarou EXIGE plano. É o oposto do fail-open de lá,
 * e de propósito — módulo novo que nasce sem porteiro só perde uma venda;
 * tela nova que nasce sem plano entrega o produto de graça. O teste
 * `uso-so-com-plano.test.ts` confere que todo namespace do appRouter está
 * classificado aqui, então "desconhecido" nunca acontece com router de
 * verdade — só com chamada inventada.
 */

/**
 * Namespaces tRPC que respondem ANTES de existir plano. Cada um está aqui por
 * um motivo que o onboarding precisa:
 *
 *  - `auth`/`termos`: entrar, sair, confirmar e-mail, aceitar os termos;
 *  - `subscription`: é a porta — planos, teste grátis, checkout, troca;
 *  - `configuracoes`: a tela do plano mora DENTRO de Configurações (o
 *    cabeçalho pede `meuEscritorio` ao montar) e `criarEscritorio` é daqui;
 *  - `permissoes`: Configurações pede os cargos ao montar — sem isso a tela
 *    onde se escolhe o plano não renderiza;
 *  - `notificacoes`/`push`: sino e registro do navegador, não são o produto;
 *  - `admin*`: passam por `adminProcedure`, que não é `protectedProcedure` —
 *    não chegam nem no porteiro. Estão na lista pra o teste de completude
 *    ficar honesto, não pra liberar nada.
 */
export const NAMESPACES_LIBERADOS_SEM_PLANO: readonly string[] = [
  "auth",
  "termos",
  "subscription",
  "configuracoes",
  "permissoes",
  "notificacoes",
  "push",

  // painel da plataforma — cercado pelo adminProcedure
  "admin",
  "adminFinanceiro",
  "adminAgentesIa",
  "adminSmartflow",
  "adminIntegracoes",
  "adminErros",
  "adminBackup",
  "adminManutencao",
  "adminEmailLog",
  "adminTribunais",
  "adminRoboAuditor",
  "adminJornada",
];

const LIBERADOS = new Set(NAMESPACES_LIBERADOS_SEM_PLANO);

export const MOTIVO_SEM_PLANO = "sem_plano";

export const MENSAGEM_SEM_PLANO =
  "Escolha um plano ou comece o teste grátis para usar o JuridFlow.";

/** Esta chamada tRPC exige plano (ou teste) vigente? Namespace não declarado exige. */
export function precisaDePlano(path: string): boolean {
  const ns = path.split(".")[0];
  return !LIBERADOS.has(ns);
}
