/**
 * As cinco remoções da tela de Processos — decisão do dono em 13/09, depois de
 * ele abrir a tela num teste de uso.
 *
 * Palavras dele: "podemos remover essa aba alertas pq ja pega em monitoramento,
 * os creditos pq não usamos mais, resumo diarío também pode remover pq
 * construiremos essa função em smartflow e consulta cnj desnecessário" e, na
 * mensagem seguinte, "e os cards monitorados, nova ação e parados tambem
 * desnecessário".
 *
 * O que esta amarra protege não é a ausência por si — é que a FUNÇÃO não foi
 * embora com o botão. O caso que exigiu conferência antes de remover: a aba
 * Alertas era o painel de aprovar prazo sugerido, e se fosse o único caminho,
 * tirá-la deixaria o cron enchendo uma tabela que ninguém lê. Não é: a timeline
 * do Monitoramento chama a MESMA `prazosSugeridos.aprovar`. É isso que o
 * primeiro teste trava.
 *
 * `descartar` ficou sem tela e está anotado no documento de estado.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
const processos = ler("client/src/pages/Processos.tsx");

/** Trecho entre duas âncoras — a 2ª exclusiva, pra não pegar a função vizinha. */
function recorte(fonte: string, de: string, ate: string): string {
  const i = fonte.indexOf(de);
  expect(i, `âncora não encontrada: ${de}`).toBeGreaterThan(-1);
  const j = fonte.indexOf(ate, i + de.length);
  expect(j, `âncora final não encontrada: ${ate}`).toBeGreaterThan(-1);
  return fonte.slice(i, j);
}

describe("aba Alertas: sai da tela sem levar o aprovar", () => {
  it("aprovar prazo sugerido continua na timeline do Monitoramento", () => {
    expect(processos, "o único caminho de aprovar prazo sugerido sumiu com a aba")
      .toContain("prazosSugeridos.aprovar.useMutation");
    // O botão que dispara. Sem ele a mutation existiria sem porta.
    expect(processos).toContain("criarPrazoMut.mutate({ id: prazo.id })");
    expect(processos, "o selo que mostra onde clicar").toContain("Requer prazo");
  });

  it("a aba não existe mais — nem gatilho, nem conteúdo, nem badge", () => {
    expect(processos).not.toContain('value="alertas"');
    expect(processos).not.toContain("<AlertasTab />");
    expect(processos).not.toContain("<AlertasBadge />");
    expect(processos, "o painel inteiro saiu").not.toContain("function AlertasTab(");
    expect(processos, "o contador do badge saiu").not.toContain("prazosSugeridos?.contador");
  });

  it("link antigo ?tab=alertas cai na Central em vez de abrir vazio", () => {
    const inicial = recorte(processos, "const tabInicial = (() => {", "const [tab, setTab]");
    expect(inicial, "o valor antigo tem que ser tratado, não apenas ignorado")
      .toContain('if (t === "alertas") return "central";');
    expect(inicial, "alertas não pode voltar pra lista de abas válidas")
      .not.toMatch(/t === "alertas"\s*\|\|/);
  });
});

describe("cabeçalho: nem crédito, nem botão, nem pastilha", () => {
  const cabecalho = recorte(
    processos,
    "function CabecalhoProcessos(",
    "export default function Processos(",
  );

  it("o cabeçalho não recebe mais nada de fora", () => {
    // Props eram `saldo`, `onConsultar` e `onResumo` — as três morreram com os
    // controles. Assinatura sem parâmetro é a prova de que não sobrou entrada.
    expect(cabecalho).toContain("function CabecalhoProcessos() {");
    expect(processos).toContain("<CabecalhoProcessos />");
  });

  it("a pastilha de crédito saiu do cabeçalho", () => {
    expect(cabecalho).not.toContain("<Coins");
    expect(cabecalho).not.toContain("créditos");
  });

  it("os dois botões saíram", () => {
    expect(cabecalho, "nenhum controle na direita do título").not.toContain("<Button");
    expect(processos).not.toContain("Resumo diário");
    expect(processos).not.toContain("setResumoAberto");
    expect(processos).not.toContain("setConsultarAberto");
    expect(processos, "o modal do resumo diário não é mais montado aqui")
      .not.toContain("<ConfigResumoDiario");
  });

  it("as três pastilhas de contagem saíram, e quem contava também", () => {
    expect(processos, "o renderizador das pastilhas era só delas")
      .not.toContain("function PastilhaProc(");
    expect(processos).not.toContain("<PastilhaProc");
    // As duas queries que alimentavam as pastilhas eram cópia das que os badges
    // já fazem. Restaram exatamente duas de monitoramentos — a do MonitorarTab
    // (a lista em si) e a do badge da aba. Novas ações também restaram duas: a
    // NovasAcoesTab e o badge dela.
    const monitoramentos = (processos.match(/processos\.meusMonitoramentos\.useQuery/g) || []).length;
    expect(monitoramentos, "a query dos monitorados voltou a ser 3 (cabeçalho de novo)").toBe(2);
    const novasAcoes = (processos.match(/processos\.listarNovasAcoes\.useQuery/g) || []).length;
    expect(novasAcoes, "a query de novas ações voltou a ser 3 (cabeçalho de novo)").toBe(2);
  });

  it("o número que as pastilhas mostravam sobrevive no badge da aba", () => {
    const conta = recorte(processos, "function MonitoramentosCount(", "function NovasAcoesBadge(");
    expect(conta, "o badge do Monitoramento é quem mostra parados/total agora")
      .toContain("m.diagnostico");
    const novas = recorte(processos, "function NovasAcoesBadge(", "// TAB: NOVAS AÇÕES");
    expect(novas, "o badge de Novas Ações é quem mostra as não lidas")
      .toContain("totalNaoLidas");
  });
});

describe("o que ficou de pé de propósito", () => {
  it("a busca avulsa continua no arquivo, sem porta e com o motivo escrito", () => {
    // O dono autorizou tirar o BOTÃO. Apagar a consulta é outra decisão, e a
    // regra da casa é não remover sem autorização expressa daquela remoção.
    expect(processos).toContain("function ConsultarTab()");
    expect(processos, "quem ler isto depois tem que saber que é deliberado")
      .toContain("SEM ENTRADA NA TELA DESDE 13/09");
  });

  it("o aviso de saldo baixo saiu depois, quando ele autorizou a moeda inteira", () => {
    // Em 13/09 este aviso ficou de pé de propósito: ele tinha pedido a
    // PASTILHA. Na mensagem seguinte veio "tudo referente a creditos pode
    // excluir" — e aí o aviso, que mandava "comprar mais créditos", saiu.
    expect(processos).not.toContain("Saldo baixo.");
    expect(processos).not.toContain("comprar mais créditos");
  });
});
