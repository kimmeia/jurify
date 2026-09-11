/**
 * Onde o convite "Instalar o JuridFlow" pode aparecer.
 *
 * O convite é montado uma vez só, por cima de todas as telas — inclusive as
 * que quem não tem login abre. No iPhone ele aparece sozinho três segundos
 * depois de a página carregar, sem depender de nada: foi assim que o cliente
 * de um escritório recebeu um documento para assinar e ganhou junto o botão
 * de baixar o app de um sistema que ele nunca vai usar.
 *
 * A regra é de PÚBLICO, não de tela: o convite fica onde a pessoa é usuária
 * do sistema ou está virando uma (login, cadastro, convite de colaborador,
 * recuperação de senha, confirmação de e-mail, fim do checkout) e sai de onde
 * ela é um terceiro (assinatura por link) ou apenas um leitor (página
 * inicial, termos, privacidade).
 *
 * Rota pública nova precisa entrar numa das duas listas — a amarra em
 * `convite-instalar-app.test.ts` deriva as rotas do App.tsx e quebra enquanto
 * a nova não estiver classificada.
 */

/** Telas sem login em que o convite continua aparecendo. */
export const ROTAS_PUBLICAS_COM_CONVITE = [
  "/login",
  "/cadastro",
  "/convite",
  "/esqueci-senha",
  "/redefinir-senha",
  "/confirmar-email",
  "/checkout/success",
] as const;

/** Telas sem login em que o convite NÃO aparece. */
export const ROTAS_PUBLICAS_SEM_CONVITE = [
  "/",
  "/assinar",
  "/termos",
  "/privacidade",
  "/404",
] as const;

function raizDaRota(caminho: string): string {
  const limpo = (caminho || "/").split("?")[0].split("#")[0];
  if (limpo === "/") return "/";
  return limpo.replace(/\/+$/, "") || "/";
}

/**
 * `false` só nas telas listadas como sem convite. Rota desconhecida (as
 * internas do app, que exigem sessão) devolve `true`: dentro do sistema o
 * convite é justamente o que se quer.
 */
export function conviteInstalarAppPermitido(caminho: string): boolean {
  const rota = raizDaRota(caminho);
  return !ROTAS_PUBLICAS_SEM_CONVITE.some((r) => (r === "/" ? rota === "/" : rota === r || rota.startsWith(r + "/")));
}
