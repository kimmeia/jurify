/**
 * O que o robô sabe conferir depois de clicar.
 *
 * Este catálogo não lista as ações do app — quem lista é a descoberta,
 * olhando a tela. Aqui ficam só as PROVAS: dado um clique, o que na
 * tela demonstra que ele fez o que promete.
 *
 * Ação sem prova registrada não vira `ok`. Vira `nao_verificada` com o
 * motivo `sem_prova_registrada`, e é assim que o relatório fica honesto
 * no primeiro dia: quase tudo âmbar, porque quase nada tem prova ainda.
 * O número de âmbar é a dívida, e ele só desce quando alguém escreve
 * prova nova aqui. É a única métrica do robô que mede progresso nosso e
 * não sorte do app.
 *
 * Prova boa é a que uma tela sozinha não consegue falsificar: contagem
 * que aparece em dois lugares, total que tem que fechar com as parcelas.
 * Prova ruim é "o botão ficou cinza" — isso o próprio botão controla.
 */

import type { Page } from "@playwright/test";
import type { Veredito } from "./tipos";

export interface Prova {
  /** Rotas onde esta prova vale. */
  rota: RegExp;
  /** Nome acessível do controle que ela cobre. */
  nome: RegExp;
  descricao: string;
  verificar(page: Page): Promise<Veredito>;
}

/** Espera curta: a prova roda logo depois do clique, não é navegação. */
const ESPERA = 4_000;

/** Espelha o `limite` da query `crm.listarConversas` em `Atendimento.tsx`. */
const LIMITE_LISTA_CONVERSAS = 300;

/**
 * Contagem que a tela mostra tem que bater com a que ela lista.
 *
 * É a família de defeito que mais apareceu no sistema: a pílula e a
 * lista respondem a mesma pergunta por caminhos diferentes (uma
 * procedure de contagem, outra de listagem) e os filtros chegam só em
 * um dos dois. A tela fica plausível e errada ao mesmo tempo.
 */
async function contagemBateComLista(
  page: Page,
  seletorContador: string,
  seletorLinha: string,
  /**
   * Teto da query que alimenta a lista. Acima dele os dois números
   * divergem por desenho — o contador vem do banco e a lista vem capada
   * — e comparar produziria falha inventada.
   */
  limiteDaLista: number,
): Promise<Veredito> {
  const contador = page.locator(seletorContador).first();

  const texto = await contador
    .textContent({ timeout: ESPERA })
    .catch(() => null);
  if (texto === null) {
    return {
      estado: "nao_verificada",
      motivo: "efeito_nao_observavel",
      evidencia: `contador \`${seletorContador}\` não apareceu em ${ESPERA / 1000}s`,
    };
  }

  const declarado = Number(texto.replace(/\D/g, ""));
  if (!Number.isFinite(declarado) || texto.trim() === "") {
    return {
      estado: "nao_verificada",
      motivo: "efeito_nao_observavel",
      evidencia: `contador trouxe "${texto.trim()}", que não é número`,
    };
  }

  const listado = await page.locator(seletorLinha).count();
  if (listado >= limiteDaLista) {
    return {
      estado: "nao_verificada",
      motivo: "efeito_nao_observavel",
      evidencia: `a lista bateu o teto de ${limiteDaLista}; acima disso divergir do contador é o desenho, não defeito`,
    };
  }

  if (declarado === listado) {
    return {
      estado: "ok",
      evidencia: `contador e lista concordam em ${declarado}`,
    };
  }
  return {
    estado: "falhou",
    evidencia: `contador diz ${declarado} e a lista traz ${listado} — a mesma pergunta com duas respostas na mesma tela`,
  };
}

/**
 * Botão de criar tem que abrir formulário.
 *
 * Prova fraca de propósito: ela não afirma que o registro é salvo, só
 * que o caminho abre. Vale porque o modo de falhar que ela pega é o
 * mais comum e o mais invisível — o clique não faz nada e o usuário
 * conclui que o sistema travou.
 */
async function abreFormulario(page: Page): Promise<Veredito> {
  const dialogo = page.locator('[role="dialog"], [data-state="open"]').first();
  const apareceu = await dialogo
    .waitFor({ state: "visible", timeout: ESPERA })
    .then(() => true)
    .catch(() => false);

  if (!apareceu) {
    return {
      estado: "falhou",
      evidencia: `clicou e nenhum formulário abriu em ${ESPERA / 1000}s`,
    };
  }
  return { estado: "ok", evidencia: "o formulário abriu" };
}

export const PROVAS: readonly Prova[] = [
  {
    rota: /^\/(clientes|processos|tarefas|acordos|agenda|kanban|financeiro)$/,
    nome: /^(nov[oa]|adicionar|criar|cadastrar)\b/i,
    descricao: "botão de criar abre o formulário",
    verificar: abreFormulario,
  },
  {
    rota: /^\/atendimento$/,
    // As quatro pílulas do Inbox. O rótulo é curto na tela ("Em atend.")
    // e o nome acessível junta rótulo e número, daí o casamento por
    // prefixo.
    nome: /^(todas|em atend|aguardando|resolvidas)\b/i,
    descricao: "pílula de filtro concorda com a lista de conversas",
    verificar: (page) =>
      contagemBateComLista(
        page,
        '[data-testid="inbox-pill"][data-ativa="true"] [data-testid="inbox-pill-contagem"]',
        '[data-testid="inbox-conversa"]',
        LIMITE_LISTA_CONVERSAS,
      ),
  },
];

export function provaPara(rota: string, nome: string): Prova | null {
  return PROVAS.find((p) => p.rota.test(rota) && p.nome.test(nome)) ?? null;
}
