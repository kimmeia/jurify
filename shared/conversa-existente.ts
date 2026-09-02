/**
 * "Este número já tem conversa?" — a decisão, separada da consulta.
 *
 * A tela de Nova Conversa avisa antes de o atendente escrever a mensagem, pra
 * não nascer uma segunda conversa com quem já está sendo atendido. Qual aviso
 * mostrar depende de três coisas (existe contato? existe conversa? é minha?),
 * e é aqui que essa combinação vive — fora do router, onde dá pra testar sem
 * banco.
 */

export type EstadoNumero =
  /** Número ainda não reconhecível — não há o que consultar. */
  | "incompleto"
  /** Nada no escritório: contato novo. */
  | "livre"
  /** Contato cadastrado, mas sem nenhuma conversa. */
  | "cadastrado"
  /** Conversa em andamento (aguardando ou em atendimento). */
  | "aberta"
  /** Conversa resolvida ou fechada. */
  | "encerrada"
  /** Existe conversa, mas é de outro atendente e quem pergunta só vê as suas. */
  | "sem_acesso";

const ENCERRADOS = new Set(["resolvido", "fechado"]);

export function estadoDoNumero(args: {
  /** Achou contato com esse telefone no escritório? */
  contatoEncontrado: boolean;
  /** Conversa mais recente desse contato, ou null. */
  conversa: { status: string; atendenteId: number | null } | null;
  /** Quem pergunta só enxerga os próprios atendimentos (verProprios). */
  soAsMinhas: boolean;
  /** Colaborador de quem pergunta. */
  meuColaboradorId: number | null;
}): EstadoNumero {
  if (!args.contatoEncontrado) return "livre";
  if (!args.conversa) return "cadastrado";

  // Conversa de outra pessoa e quem pergunta não tem alcance nela. O aviso
  // sai, mas sem nome, sem histórico e sem botão de abrir: evitar a conversa
  // duplicada não é motivo pra escancarar o atendimento alheio.
  //
  // Os dois `!= null` são o que impede `null === null` de declarar "minha" uma
  // conversa que não tem atendente — ninguém a possui, e quem só vê as
  // próprias não deveria abri-la por este caminho.
  const minha =
    args.meuColaboradorId != null &&
    args.conversa.atendenteId != null &&
    args.conversa.atendenteId === args.meuColaboradorId;
  if (args.soAsMinhas && !minha) return "sem_acesso";

  return ENCERRADOS.has(args.conversa.status) ? "encerrada" : "aberta";
}
