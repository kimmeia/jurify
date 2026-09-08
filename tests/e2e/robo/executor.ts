/**
 * Exercita uma ação e decide o veredito.
 *
 * As duas regras do desenho moram aqui.
 *
 * A primeira é o isolamento por ação: cada clique começa de uma carga
 * limpa da rota e o erro de um não contamina o próximo. Sem isso a
 * primeira ação que abre modal bloqueia todas as seguintes, e o
 * relatório vira "uma tela travada" em vez de "o estado do módulo" — o
 * mesmo defeito que o robô de jornada teve na primeira versão.
 *
 * A segunda é a que muda o produto: `ok` exige prova. Clique sem
 * incidente NÃO é aprovação, porque "nada explodiu" e "fez o que
 * promete" são afirmações diferentes, e só a segunda interessa. Sem
 * prova o veredito é `nao_verificada`, com o motivo por escrito.
 */

import type { Page } from "@playwright/test";
import { provaPara } from "./catalogo";
import { cercaQueBarra } from "./cercas";
import { descobrirAcoes } from "./descoberta";
import type { ConsoleErrorMonitor, NetworkMonitor } from "../lib/page-helpers";
import { MOTIVO_TEXTO, type AcaoDescoberta, type ResultadoAcao, type Veredito } from "./tipos";

const ESPERA_SPINNER = 8_000;
const ESPERA_ROTA = 20_000;

export interface Sonda {
  page: Page;
  console: ConsoleErrorMonitor;
  rede: NetworkMonitor;
  /** Vira `true` quando o app abre confirm/alert nativo. */
  dialogos: string[];
}

/**
 * Diálogo nativo é o maior produtor de verde falso do app.
 *
 * Sem tratador o Playwright dispensa sozinho e segue como se nada
 * tivesse acontecido: o clique "passou" e a exclusão nunca ocorreu.
 * Registrando aqui, o robô sabe que o caminho foi interrompido e recusa
 * a aprovação — o motivo `dialogo_nativo` conta quantas ações destrutivas
 * continuam fora de alcance enquanto os `confirm()` não virarem
 * AlertDialog.
 */
export function instalarSonda(
  page: Page,
  monitorConsole: ConsoleErrorMonitor,
  monitorRede: NetworkMonitor,
): Sonda {
  const dialogos: string[] = [];
  page.on("dialog", (d) => {
    dialogos.push(`${d.type()}: ${d.message()}`);
    void d.dismiss().catch(() => {});
  });
  return { page, console: monitorConsole, rede: monitorRede, dialogos };
}

async function carregarRota(page: Page, rota: string): Promise<boolean> {
  const abriu = await page
    .goto(rota, { waitUntil: "domcontentloaded", timeout: ESPERA_ROTA })
    .then(() => true)
    .catch(() => false);
  if (!abriu) return false;
  return esperarTelaPronta(page);
}

function esperarTelaPronta(page: Page): Promise<boolean> {
  // `networkidle` não serve: o Inbox faz polling a cada 5s e a página
  // nunca fica ociosa. O sinal utilizável é o esqueleto sair.
  return page
    .waitForFunction(
      () => !document.querySelector('[role="progressbar"], .animate-spin'),
      null,
      { timeout: ESPERA_SPINNER },
    )
    .then(() => true)
    .catch(() => false);
}

/** Varre uma rota inteira: descobre a superfície e exercita cada ação. */
export async function exercitarRota(
  sonda: Sonda,
  rota: string,
): Promise<ResultadoAcao[]> {
  const { page } = sonda;

  if (!(await carregarRota(page, rota))) {
    return [
      {
        id: `${rota}::<rota>::0`,
        rota,
        nome: "<abrir a rota>",
        ocorrencia: 0,
        ocorrenciaDom: 0,
        veredito: {
          estado: "falhou",
          evidencia: `a rota não ficou utilizável em ${ESPERA_ROTA / 1000}s`,
        },
      },
    ];
  }

  const acoes = await descobrirAcoes(page, rota);
  const resultados: ResultadoAcao[] = [];

  for (const acao of acoes) {
    const cerca = cercaQueBarra(acao.rota, acao.nome);
    if (cerca) {
      resultados.push({
        ...acao,
        veredito: {
          estado: "nao_verificada",
          motivo: cerca,
          evidencia: MOTIVO_TEXTO[cerca],
        },
      });
      continue;
    }

    // Uma ação que estoura não pode derrubar a varredura: o relatório
    // útil é o conjunto, não a primeira que deu problema.
    const veredito = await exercitar(sonda, acao).catch(
      (e: unknown): Veredito => ({
        estado: "falhou",
        evidencia: `o robô não conseguiu completar o clique: ${(e as Error).message}`,
      }),
    );
    resultados.push({ ...acao, veredito });
  }

  return resultados;
}

async function exercitar(sonda: Sonda, acao: AcaoDescoberta): Promise<Veredito> {
  const { page } = sonda;

  // Recarrega antes de cada clique. Custa uma navegação por ação e paga
  // isolamento: modal aberto, filtro alterado e scroll do vizinho não
  // entram no veredito deste.
  if (!(await carregarRota(page, acao.rota))) {
    return {
      estado: "falhou",
      evidencia: "a rota parou de carregar no meio da varredura",
    };
  }

  // A marcação `data-robo-acao` só existe depois da descoberta, e ela
  // morre a cada navegação — por isso redescobrimos em vez de guardar
  // seletor. Casar por id também detecta controle que sumiu entre uma
  // carga e outra.
  const redescobertas = await descobrirAcoes(page, acao.rota);
  const alvo = redescobertas.find((a) => a.id === acao.id);
  if (!alvo) {
    return {
      estado: "nao_verificada",
      motivo: "efeito_nao_observavel",
      evidencia: "o controle não apareceu na segunda carga da rota — a tela não é estável entre visitas",
    };
  }

  const errosAntes = sonda.console.errors.length;
  const falhasAntes = sonda.rede.failures.length;
  const dialogosAntes = sonda.dialogos.length;

  const clicou = await page
    .locator(`[data-robo-acao="${alvo.ocorrenciaDom}"]`)
    .click({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (!clicou) {
    return {
      estado: "falhou",
      evidencia: "o controle está visível e habilitado mas não aceitou o clique em 5s",
    };
  }

  const prova = provaPara(acao.rota, acao.nome);
  const resultadoProva = prova ? await prova.verificar(page) : null;

  // Erro de JS e 5xx passam na frente de tudo, inclusive de prova que
  // deu certo: tela pode fazer a coisa certa e ainda assim quebrar.
  const novosErros = sonda.console.errors.slice(errosAntes);
  if (novosErros.length > 0) {
    return { estado: "falhou", evidencia: `erro de JS após o clique: ${novosErros[0]}` };
  }
  const novasFalhas = sonda.rede.failures.slice(falhasAntes);
  if (novasFalhas.length > 0) {
    const f = novasFalhas[0]!;
    return {
      estado: "falhou",
      evidencia: `o clique gerou ${f.status || "falha de rede"} em ${f.url}`,
    };
  }
  if (!(await esperarTelaPronta(page))) {
    return {
      estado: "falhou",
      evidencia: `a tela ficou carregando por mais de ${ESPERA_SPINNER / 1000}s depois do clique`,
    };
  }

  const novosDialogos = sonda.dialogos.slice(dialogosAntes);
  if (novosDialogos.length > 0) {
    return {
      estado: "nao_verificada",
      motivo: "dialogo_nativo",
      evidencia: `${MOTIVO_TEXTO.dialogo_nativo} — ${novosDialogos[0]}`,
    };
  }

  if (!resultadoProva) {
    return {
      estado: "nao_verificada",
      motivo: "sem_prova_registrada",
      evidencia: MOTIVO_TEXTO.sem_prova_registrada,
    };
  }
  return resultadoProva;
}
