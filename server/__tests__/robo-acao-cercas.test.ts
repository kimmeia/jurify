/**
 * As duas travas do robô de ação que não precisam de browser.
 *
 * A primeira é a cerca: o robô roda em laço numa conta que ele mesmo
 * cria, e três coisas atravessam a fronteira dessa conta — integração
 * externa que dispara no mundo real, credencial de tribunal que bloqueia
 * OAB por tentativa repetida, e painel admin que opera sobre escritório
 * de terceiros. Se uma cerca for afrouxada por engano, quem paga é
 * gente de fora do teste. Por isso ela é verificada aqui, no `pnpm
 * test`, e não só quando alguém lembra de rodar o robô.
 *
 * A segunda é a catraca de `confirm()` nativo. Diálogo nativo é o maior
 * produtor de verde falso do app: o robô dispensa, a ação não acontece,
 * e sem tratador isso passaria por sucesso. Cada `confirm()` é uma ação
 * destrutiva que nenhum robô consegue exercitar — a lista abaixo é essa
 * dívida, e ela só pode encolher.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { cercaQueBarra } from "../../tests/e2e/robo/cercas";
import { MOTIVO_TEXTO, type Motivo } from "../../tests/e2e/robo/tipos";

const RAIZ_REPO = join(__dirname, "..", "..");
const RAIZ_CLIENT = join(RAIZ_REPO, "client", "src");

describe("cercas do robô de ação", () => {
  const BARRADAS: ReadonlyArray<[string, string, Motivo]> = [
    ["/configuracoes", "Convidar colaborador", "cerca_integracao_externa"],
    ["/configuracoes", "Desconectar o Asaas", "cerca_integracao_externa"],
    ["/financeiro", "Gerar boleto", "cerca_integracao_externa"],
    ["/configuracoes", "Revalidar", "cerca_credencial_tribunal"],
    ["/processos", "Consultar andamento", "cerca_credencial_tribunal"],
    ["/admin/clientes", "Salvar", "cerca_admin"],
    ["/admin", "Qualquer coisa", "cerca_admin"],
    ["/dashboard", "Sair", "cerca_encerra_sessao"],
  ];

  for (const [rota, nome, motivo] of BARRADAS) {
    it(`barra "${nome}" em ${rota}`, () => {
      expect(cercaQueBarra(rota, nome)).toBe(motivo);
    });
  }

  const LIBERADAS: ReadonlyArray<[string, string]> = [
    ["/clientes", "Novo cliente"],
    ["/clientes", "Salvar"],
    ["/tarefas", "Concluir"],
    ["/atendimento", "Todas 0"],
    ["/kanban", "Nova coluna"],
    // "Sair" só barra no começo do nome: "Sair do modo foco" é navegação
    // interna, e barrar por conter a palavra apagaria ação legítima.
    ["/smartflow", "Sair do modo foco"],
  ];

  for (const [rota, nome] of LIBERADAS) {
    it(`deixa passar "${nome}" em ${rota}`, () => {
      expect(cercaQueBarra(rota, nome)).toBeNull();
    });
  }

  it("todo motivo tem texto de relatório", () => {
    const semTexto = (Object.keys(MOTIVO_TEXTO) as Motivo[]).filter(
      (m) => !MOTIVO_TEXTO[m]?.trim(),
    );
    expect(semTexto, "motivo sem explicação vira linha muda no relatório").toEqual([]);
  });
});

/**
 * Dívida conhecida em 08/09/2026: arquivo → quantos `confirm()` nativos.
 *
 * NÃO acrescente entradas. Ação destrutiva usa AlertDialog — está no
 * CLAUDE.md como anti-pattern desde antes deste robô existir. Cada
 * número que baixa aqui é uma ação que o robô passa a conseguir
 * exercitar de verdade.
 */
const CONFIRM_CONHECIDOS: Readonly<Record<string, number>> = {
  "client/src/components/calculos/ParecerEditor.tsx": 1,
  "client/src/pages/Agendamento.tsx": 1,
  "client/src/pages/Configuracoes.tsx": 3,
  // "Excluir coluna" já virou AlertDialog na main — sobraram "Excluir
  // funil" e "Arquivar todos os cards".
  "client/src/pages/Kanban.tsx": 2,
  "client/src/pages/Plans.tsx": 1,
  "client/src/pages/Tarefas.tsx": 1,
  "client/src/pages/admin/AdminAgentesIA.tsx": 1,
  "client/src/pages/admin/AdminClients.tsx": 2,
  "client/src/pages/admin/financeiro/CuponsSection.tsx": 1,
  "client/src/pages/configuracoes/dialogs.tsx": 3,
  "client/src/pages/configuracoes/meta-connect-dialog.tsx": 1,
  "client/src/pages/configuracoes/tabs.tsx": 1,
};

/** Pega `confirm(`, `window.confirm(` e `!confirm(`, mas não `onConfirm(`. */
const PADRAO_CONFIRM = /\bconfirm\(/g;

function arquivosTsx(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTsx(caminho));
    else if (nome.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

describe("catraca de confirm() nativo", () => {
  const encontrados = new Map<string, number>();
  for (const caminho of arquivosTsx(RAIZ_CLIENT)) {
    const ocorrencias = readFileSync(caminho, "utf8").match(PADRAO_CONFIRM)?.length ?? 0;
    if (ocorrencias > 0) {
      encontrados.set(relative(RAIZ_REPO, caminho).replace(/\\/g, "/"), ocorrencias);
    }
  }

  it("nenhum confirm() novo entrou", () => {
    const novos: string[] = [];
    for (const [arquivo, quantos] of encontrados) {
      const conhecidos = CONFIRM_CONHECIDOS[arquivo] ?? 0;
      if (quantos > conhecidos) {
        novos.push(`${arquivo}: ${quantos} (conhecidos: ${conhecidos})`);
      }
    }
    expect(
      novos,
      "ação destrutiva usa AlertDialog — confirm() nativo o robô não consegue " +
        "responder, e o clique conta como não verificado em vez de testado",
    ).toEqual([]);
  });

  it("nenhuma entrada da lista ficou obsoleta", () => {
    const obsoletas: string[] = [];
    for (const [arquivo, conhecidos] of Object.entries(CONFIRM_CONHECIDOS)) {
      const quantos = encontrados.get(arquivo) ?? 0;
      if (quantos < conhecidos) {
        obsoletas.push(`${arquivo}: agora ${quantos}, a lista ainda diz ${conhecidos}`);
      }
    }
    expect(
      obsoletas,
      "dívida paga precisa sair da lista, senão a catraca para de apertar",
    ).toEqual([]);
  });
});
