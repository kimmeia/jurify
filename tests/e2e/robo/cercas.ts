/**
 * O que o robô não clica, e por quê.
 *
 * Conta isolada resolve dado: o escritório é dele, nasce vazio e é
 * apagado no fim. Não resolve três coisas que atravessam a fronteira da
 * conta — e é isso que está aqui.
 *
 * A proteção natural cobre parte: escritório novo não tem Meta, Asaas
 * nem credencial de tribunal configurados, então metade destes botões
 * nem funcionaria. A cerca existe pro dia em que alguém apontar o robô
 * pra um escritório que TEM — staging com integração ligada, por
 * exemplo. Depender da conta estar vazia é depender de sorte.
 *
 * Cada cerca vira uma linha `nao_verificada` no relatório, com o motivo
 * escrito. Ela não some do mapa: continua sendo superfície do app que
 * ninguém testou.
 */

import type { Motivo } from "./tipos";

interface Cerca {
  motivo: Motivo;
  /** Casa contra o nome acessível do controle. */
  nome: RegExp;
  /** Quando presente, restringe a cerca a estas rotas. */
  rotas?: RegExp;
}

const CERCAS: readonly Cerca[] = [
  {
    // Convite, cobrança e disparo de campanha saem de verdade: e-mail
    // pelo Resend, boleto pelo Asaas, mensagem pela Meta. Um robô que
    // roda de hora em hora vira remetente de spam.
    motivo: "cerca_integracao_externa",
    nome: /convidar|enviar convite|reenviar|cobran|gerar boleto|emitir|conectar|desconectar|whatsapp|instagram|publicar campanha|disparar/i,
  },
  {
    // Tribunal bloqueia OAB por tentativa repetida. O robô roda em
    // laço; é o pior cliente possível pra esse tipo de endpoint.
    motivo: "cerca_credencial_tribunal",
    nome: /revalidar|validar credencial|consultar (andamento|processo)|sincronizar tribunal|pje|esaj|projudi/i,
  },
  {
    // Painel admin opera sobre escritório dos OUTROS. É a única
    // superfície onde isolamento por conta não protege ninguém.
    motivo: "cerca_admin",
    nome: /.*/,
    rotas: /^\/admin(\/|$)/,
  },
  {
    // Óbvio e fácil de esquecer: sem isto a varredura morre na primeira
    // rota que tiver menu de usuário aberto.
    //
    // Casa o rótulo inteiro, não o prefixo: "Sair do modo foco" e "Sair
    // da seleção" são ação de tela, e barrá-las apagaria do mapa
    // superfície que o robô deveria exercitar.
    motivo: "cerca_encerra_sessao",
    nome: /^(sair|logout|sair da conta)$|^(encerrar sess|excluir minha conta|deletar conta)/i,
  },
];

/** Retorna o motivo da cerca que barra esta ação, ou `null` se passa. */
export function cercaQueBarra(rota: string, nome: string): Motivo | null {
  for (const cerca of CERCAS) {
    if (cerca.rotas && !cerca.rotas.test(rota)) continue;
    if (cerca.nome.test(nome)) return cerca.motivo;
  }
  return null;
}

export const CERCAS_PARA_TESTE = CERCAS;
