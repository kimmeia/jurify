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
import { descobrirAcoes, SELETOR_ALVOS } from "./descoberta";
import { SELETOR_CARREGANDO, type ConsoleErrorMonitor, type NetworkMonitor } from "../lib/page-helpers";
import { MOTIVO_TEXTO, type AcaoDescoberta, type ResultadoAcao, type Veredito } from "./tipos";

const ESPERA_SPINNER = 8_000;
const ESPERA_ROTA = 20_000;
/** Primeira pintura da SPA passa por compilação de módulo em dev. */
const ESPERA_MONTAGEM = 20_000;
/** Teto pra superfície parar de crescer; sem ela o robô inventa achado. */
const ESPERA_ESTABILIDADE = 10_000;

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
  if (!(await esperarTelaPronta(page, ESPERA_MONTAGEM))) return false;
  await esperarSuperficieEstavel(page);
  return true;
}

/**
 * Espera a superfície parar de crescer.
 *
 * "Tem controle e não tem spinner" é o começo da tela, não o fim dela:
 * as abas de filtro de /clientes chegam depois, junto com a query que
 * alimenta os contadores. O robô descobria 10 ações, recarregava,
 * redescobria 5, e as outras 5 viravam "o controle não apareceu na
 * segunda carga" — ruído puro, com o app inteiro funcionando.
 *
 * Aqui ele conta os controles até o número repetir algumas vezes
 * seguidas. Não dá garantia (nada dá, contra render assíncrono), mas
 * troca um falso achado quase certo por uma espera de ~1,5s.
 */
async function esperarSuperficieEstavel(page: Page): Promise<void> {
  await page
    .waitForFunction(
      (seletor) => {
        const janela = window as unknown as { _roboN?: number; _roboEstavel?: number };
        const agora = document.querySelectorAll(seletor).length;
        if (janela._roboN === agora) janela._roboEstavel = (janela._roboEstavel ?? 0) + 1;
        else {
          janela._roboN = agora;
          janela._roboEstavel = 0;
        }
        return (janela._roboEstavel ?? 0) >= 3;
      },
      SELETOR_ALVOS,
      { timeout: ESPERA_ESTABILIDADE, polling: 500 },
    )
    .catch(() => {
      // Tela que nunca para de mudar (polling que remonta lista) não é
      // motivo pra abortar: segue com o que está na tela agora.
    });
}

/**
 * Prontidão é afirmação, não ausência.
 *
 * A primeira versão perguntava só "sumiu o spinner?" — e numa SPA logo
 * depois de `domcontentloaded` não existe spinner porque não existe
 * nada: o React ainda não montou. Medido contra o app: no instante do
 * `domcontentloaded`, `/clientes` tinha 0 botões e 0 spinners; seis
 * segundos depois, 47 botões. O robô varria a tela em branco, achava
 * zero ação e fechava a varredura com "0 de 0, nenhum problema".
 *
 * Verde sem ter medido nada é o mesmo defeito que este robô existe pra
 * caçar, uma camada acima. Por isso agora ele exige ver um controle
 * renderizado ANTES de aceitar que a tela está pronta.
 *
 * `networkidle` continua fora: o Inbox faz polling a cada 5s e a página
 * nunca fica ociosa.
 */
function esperarTelaPronta(page: Page, timeout: number): Promise<boolean> {
  return page
    .waitForFunction(
      (carregando) =>
        document.querySelector('button, [role="button"]') !== null &&
        document.querySelector(carregando) === null,
      SELETOR_CARREGANDO,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

/**
 * Modal aberto que o robô não abriu — portão de produto (re-aceite de
 * termos, onboarding, paywall) que fica na frente de tudo.
 */
async function modalBloqueante(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      const r = d.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(d);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const titulo = (
        d.querySelector("h1, h2, h3, [role=heading]")?.textContent ??
        d.textContent ??
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      return titulo.slice(0, 80) || "(modal sem título)";
    }
    return null;
  });
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

  // Um portão que cobre a tela bloqueia TODA ação da rota. Sem esta
  // checagem o robô tenta clicar atrás dele e devolve uma falha por
  // controle: medido, o modal de re-aceite dos Termos virou 48 achados
  // em 4 rotas, todos a mesma coisa. Relatório que multiplica um
  // problema por quarenta e oito é relatório em que ninguém confia.
  const bloqueio = await modalBloqueante(page);
  if (bloqueio) {
    return [
      {
        id: `${rota}::<bloqueio>::0`,
        rota,
        nome: "<rota bloqueada>",
        ocorrencia: 0,
        ocorrenciaDom: 0,
        veredito: {
          estado: "nao_verificada",
          motivo: "rota_bloqueada",
          evidencia: `${MOTIVO_TEXTO.rota_bloqueada} — "${bloqueio}"`,
        },
      },
    ];
  }

  const acoes = await descobrirAcoes(page, rota);
  const resultados: ResultadoAcao[] = [];

  // Rota que renderizou e não expôs nada some do relatório em silêncio, e
  // silêncio soma como saúde. Vira linha.
  if (acoes.length === 0) {
    resultados.push({
      id: `${rota}::<superfície>::0`,
      rota,
      nome: "<nenhuma ação encontrada>",
      ocorrencia: 0,
      ocorrenciaDom: 0,
      veredito: {
        estado: "nao_verificada",
        motivo: "efeito_nao_observavel",
        evidencia: "a tela carregou e não expôs nenhum controle com nome acessível",
      },
    });
  }

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

  // O motivo do Playwright vai junto: "não aceitou o clique" sozinho não
  // distingue overlay na frente, elemento se movendo e handler travado —
  // e é a diferença entre uma linha acionável e uma linha inútil.
  const erroClique = await page
    .locator(`[data-robo-acao="${alvo.ocorrenciaDom}"]`)
    .click({ timeout: 5_000 })
    .then(() => null)
    .catch((e: unknown) => String((e as Error).message).replace(/\s+/g, " ").slice(0, 420));

  if (erroClique) {
    return {
      estado: "falhou",
      evidencia: `o controle está visível e habilitado mas o clique não completou em 5s — ${erroClique}`,
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
  if (!(await esperarTelaPronta(page, ESPERA_SPINNER))) {
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
