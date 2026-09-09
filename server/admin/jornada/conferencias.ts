/**
 * Catálogo de conferências do robô de jornada.
 *
 * Varrer rotas responde "a tela abriu sem explodir". É pouco: todo defeito
 * que apareceu nesta sessão — o prazo sumindo da lista, o polo lido errado,
 * o campo de responsável que não existia — mora numa tela que abre
 * perfeitamente e mostra a coisa errada.
 *
 * Conferência é o degrau seguinte: cria o dado, navega até ele e exige
 * encontrá-lo. É a diferença entre "o servidor respondeu 200" e "o que eu
 * salvei está na minha frente".
 *
 * Aqui vive só a DECLARAÇÃO — id, título e os passos em português. A
 * execução mora no spec do Playwright, e um teste amarra os dois: conferência
 * declarada sem implementação viraria uma linha verde no painel que não
 * conferiu nada.
 */

export interface Conferencia {
  /** Estável — vira chave de histórico e de log. */
  id: string;
  titulo: string;
  /** O que ela protege, em uma frase. Aparece no painel junto do resultado. */
  porque: string;
  /** Passos legíveis, na ordem. O painel mostra e marca onde parou. */
  passos: readonly string[];
}

export const CONFERENCIAS: readonly Conferencia[] = [
  {
    id: "CONF-AGENDA-PRAZO",
    titulo: "Prazo criado aparece na lista da Agenda",
    porque:
      "O evento pode existir no banco, aparecer no calendário e mesmo assim " +
      "não estar na lista — foi o que aconteceu, e nenhuma varredura de rota " +
      "pegaria, porque as duas telas abrem sem erro.",
    passos: [
      "Cria um prazo com data inicial hoje e fatal em 15 dias",
      "Abre a Agenda na aba Eventos",
      "Encontra o prazo pelo título",
      "Abre a aba Calendário e encontra o mesmo prazo",
    ],
  },
  {
    id: "CONF-AGENDA-RESPONSAVEL",
    titulo: "Tarefa atribuída cai na lista de quem recebeu",
    porque:
      "Atribuir grava um id. Se a lista de destino filtrar por outro critério, " +
      "a tarefa fica órfã: ninguém vê, e quem criou acha que despachou.",
    passos: [
      "Como Dono, cria tarefa com responsável = Gestor",
      "Sai e entra como Gestor",
      "A tarefa está na Agenda dele",
    ],
  },
  {
    id: "CONF-PONTO-GATE",
    titulo: "Ponto não aparece pra quem não recebeu o módulo",
    porque:
      "Permissão que vaza não dá erro — dá acesso. Só olhando com os olhos de " +
      "quem não deveria ver é que se descobre.",
    passos: [
      "Entra como Atendente",
      "O item Ponto não está no menu",
      "Digitando /ponto na URL, a tela nega",
    ],
  },
  {
    id: "CONF-CLIENTE-FICHA",
    titulo: "Cliente criado abre a própria ficha",
    porque:
      "Rota com :id nunca é visitada pela varredura. É onde mora metade do " +
      "app e nenhuma linha dela era olhada.",
    passos: [
      "Cria um cliente",
      "Clica nele na lista",
      "A ficha abre com o nome que foi digitado",
    ],
  },
  {
    id: "CONF-KANBAN-MOVER",
    titulo: "Card do Kanban sobrevive a mudar de coluna",
    porque:
      "Mover é a operação mais usada do Kanban e a que mais depende de estado " +
      "no cliente. Se não persistir, o card volta sozinho no reload.",
    passos: [
      "Cria um card na primeira coluna",
      "Move pra segunda coluna",
      "Recarrega a página e ele continua na segunda",
    ],
  },
];

export function buscarConferencia(id: string): Conferencia | undefined {
  return CONFERENCIAS.find((c) => c.id === id);
}
