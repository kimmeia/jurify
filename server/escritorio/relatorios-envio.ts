/**
 * Geração e envio dos relatórios por e-mail — o mesmo caminho serve o botão
 * "Enviar por e-mail" (agora) e o cron dos envios programados.
 *
 * O PDF sai das mesmas procedures que alimentam a tela, via caller: se o
 * relatório mudar, o e-mail muda junto e os números continuam batendo.
 */

import { z } from "zod";
import { createLogger } from "../_core/logger";
import { enviarEmail } from "../_core/email";
import { formatarDelta, calcularDelta, calcularDeltaPontos } from "../../shared/relatorios-comparativo";

const log = createLogger("relatorios-envio");

export const RELATORIOS_ENVIAVEIS = [
  "atendimento",
  "comercial",
  "producao",
  "agenda",
  "financeiro",
] as const;

export type RelatorioEnviavel = (typeof RELATORIOS_ENVIAVEIS)[number];

export const RelatorioEnviavelSchema = z.enum(RELATORIOS_ENVIAVEIS);

export const NOME_RELATORIO: Record<RelatorioEnviavel, string> = {
  atendimento: "Atendimento",
  comercial: "Comercial",
  producao: "Produção",
  agenda: "Agenda",
  financeiro: "Financeiro",
};

/** Filtros aceitos no envio — subconjunto comum, cada relatório usa o que cabe. */
export const FiltrosEnvioSchema = z.object({
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  setorId: z.number().int().positive().optional(),
  atendenteId: z.number().int().positive().optional(),
  canalId: z.number().int().positive().optional(),
  funilId: z.number().int().positive().optional(),
  responsavelId: z.number().int().positive().optional(),
  tipo: z.string().optional(),
});

export type FiltrosEnvio = z.infer<typeof FiltrosEnvioSchema>;

export interface RelatorioGerado {
  filename: string;
  base64: string;
  /** Linhas "rótulo: valor" que vão no corpo do e-mail — quem abre no celular
   *  vê o essencial sem precisar baixar o anexo. */
  destaques: Array<{ rotulo: string; valor: string; variacao?: string }>;
  periodo: { dataInicio: string; dataFim: string };
}

const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const num = (v: number) => v.toLocaleString("pt-BR");
const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
const varTxt = (d: ReturnType<typeof calcularDelta>) => (d ? formatarDelta(d) : undefined);

/**
 * Gera o PDF do relatório pedido usando o caller do próprio router — mesma
 * permissão e mesmos filtros da tela.
 *
 * `chamar` recebe o nome da procedure e o input; quem passa é o router, que
 * é onde o caller pode ser construído sem referência circular.
 */
export async function gerarRelatorioPdf(args: {
  relatorio: RelatorioEnviavel;
  filtros: FiltrosEnvio;
  nomeEscritorio: string;
  escritorioId: number;
  chamar: (procedure: string, input: any) => Promise<any>;
}): Promise<RelatorioGerado | null> {
  const { relatorio, filtros, nomeEscritorio, escritorioId, chamar } = args;

  if (relatorio === "atendimento") {
    const r = await chamar("exportarAtendimentoPdf", filtros);
    const d = await chamar("atendimento", { ...filtros, comparar: true });
    const ant = d?.anterior;
    return {
      filename: r.filename,
      base64: r.base64,
      periodo: d.periodo,
      destaques: [
        {
          rotulo: "Atendimentos",
          valor: num(d.totalConversas),
          variacao: varTxt(calcularDelta(d.totalConversas, ant?.totalConversas)),
        },
        {
          rotulo: "Taxa de conversão",
          valor: pct(d.taxaConversao),
          variacao: varTxt(calcularDeltaPontos(d.taxaConversao, ant?.taxaConversao)),
        },
        {
          rotulo: "Ticket médio",
          valor: d.ticketMedio != null ? brl(d.ticketMedio) : "—",
          variacao: varTxt(calcularDelta(d.ticketMedio, ant?.ticketMedio)),
        },
        { rotulo: "Leads ganhos", valor: num(d.leadsGanhos) },
        { rotulo: "Leads perdidos", valor: num(d.leadsPerdidos) },
      ],
    };
  }

  if (relatorio === "producao") {
    const r = await chamar("exportarProducaoPdf", filtros);
    const d = await chamar("producao", { ...filtros, comparar: true });
    const ant = d?.anterior;
    return {
      filename: r.filename,
      base64: r.base64,
      periodo: d.periodo,
      destaques: [
        {
          rotulo: "Processos no período",
          valor: num(d.cardsTotal),
          variacao: varTxt(calcularDelta(d.cardsTotal, ant?.cardsTotal)),
        },
        {
          rotulo: "Dentro do prazo",
          valor: num(d.cardsDentroPrazo),
          variacao: varTxt(calcularDelta(d.cardsDentroPrazo, ant?.cardsDentroPrazo)),
        },
        {
          rotulo: "Atrasados",
          valor: num(d.cardsAtrasados),
          variacao: varTxt(calcularDelta(d.cardsAtrasados, ant?.cardsAtrasados, true)),
        },
        {
          rotulo: "Taxa dentro do prazo",
          valor: pct(d.taxaDentroPrazo),
          variacao: varTxt(calcularDeltaPontos(d.taxaDentroPrazo, ant?.taxaDentroPrazo)),
        },
        { rotulo: "Voltaram de etapa", valor: num(d.movimentacaoDetalhe?.voltaram ?? 0) },
      ],
    };
  }

  if (relatorio === "comercial") {
    const r = await chamar("exportarComercialPdf", filtros);
    const d = await chamar("comercialDashboard", filtros);
    return {
      filename: r.filename,
      base64: r.base64,
      periodo: d.periodo,
      destaques: [
        { rotulo: "Faturado", valor: brl(d.kpis.faturado) },
        { rotulo: "Contratos fechados", valor: num(d.kpis.contratosFechados) },
        { rotulo: "Valor fechado", valor: brl(d.kpis.valorTotalFechado) },
        { rotulo: "Ticket médio", valor: brl(d.kpis.ticketMedio) },
      ],
    };
  }

  if (relatorio === "agenda") {
    const r = await chamar("exportarAgendaPdf", filtros);
    const d = await chamar("agenda", filtros);
    const t = d.totais;
    return {
      filename: r.filename,
      base64: r.base64,
      periodo: {
        dataInicio: String(d.periodo.inicio).slice(0, 10),
        dataFim: String(d.periodo.fim).slice(0, 10),
      },
      destaques: [
        { rotulo: "Agendamentos", valor: num(t.total) },
        { rotulo: "Compareceram", valor: num(t.compareceu) },
        { rotulo: "Não vieram", valor: num(t.naoCompareceu) },
        { rotulo: "Taxa de comparecimento", valor: pct(t.taxaComparecimento) },
      ],
    };
  }

  // Financeiro tem gerador próprio (DRE) e não passa pelo router de relatórios.
  const { dataInicio, dataFim } = filtros;
  if (!dataInicio || !dataFim) return null;
  const { calcularDRE } = await import("./dre");
  const { gerarDREPDF } = await import("./dre-pdf");
  const dre = await calcularDRE(escritorioId, dataInicio, dataFim, "vencimento");
  const buffer = await gerarDREPDF(dre, nomeEscritorio);
  return {
    filename: `dre_${dataInicio}_${dataFim}.pdf`,
    base64: buffer.toString("base64"),
    periodo: { dataInicio, dataFim },
    destaques: [
      { rotulo: "Receita total", valor: brl(dre.receitas.total) },
      { rotulo: "Despesa total", valor: brl(dre.despesas.total) },
      { rotulo: "Resultado líquido", valor: brl(dre.resultadoLiquido) },
      {
        rotulo: "Margem",
        valor: Number.isNaN(dre.margemPercent) ? "—" : `${dre.margemPercent.toFixed(1)}%`,
      },
    ],
  };
}

const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Corpo do e-mail: destaques em tabela + menção ao anexo. */
export function montarEmailRelatorio(args: {
  relatorio: RelatorioEnviavel;
  gerado: RelatorioGerado;
  nomeEscritorio: string;
  programado: boolean;
}): { assunto: string; html: string; texto: string } {
  const { relatorio, gerado, nomeEscritorio, programado } = args;
  const nome = NOME_RELATORIO[relatorio];
  const intervalo = `${dataBR(gerado.periodo.dataInicio)} a ${dataBR(gerado.periodo.dataFim)}`;
  const assunto = `Relatório de ${nome} · ${intervalo}`;

  const linhasHtml = gerado.destaques
    .map(
      (d) => `<tr>
      <td style="padding:9px 0;border-bottom:1px solid #e2e8f0;color:#475569;font-size:14px">${d.rotulo}</td>
      <td style="padding:9px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-size:15px;font-weight:600;color:#0f172a">
        ${d.valor}${d.variacao ? `<span style="margin-left:8px;font-size:12px;font-weight:600;color:${d.variacao.startsWith("-") ? "#e11d48" : "#059669"}">${d.variacao}</span>` : ""}
      </td>
    </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:24px">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7c3aed">JuridFlow</p>
      <h1 style="margin:0 0 2px;font-size:20px;color:#0f172a">Relatório de ${nome}</h1>
      <p style="margin:0 0 20px;font-size:13px;color:#64748b">${nomeEscritorio} · ${intervalo}</p>

      <table style="width:100%;border-collapse:collapse">${linhasHtml}</table>

      <p style="margin:20px 0 0;font-size:13px;color:#475569">
        O relatório completo vai em anexo (<strong>${gerado.filename}</strong>).
      </p>
      ${
        programado
          ? `<p style="margin:14px 0 0;font-size:12px;color:#94a3b8">
        Você recebe este e-mail porque programou o envio deste relatório. Para
        mudar a frequência ou parar de receber, vá em Relatórios → Programar envio.
      </p>`
          : ""
      }
    </div>
  </div>
</body></html>`;

  const texto = [
    `Relatório de ${nome} — ${nomeEscritorio}`,
    `Período: ${intervalo}`,
    "",
    ...gerado.destaques.map((d) => `${d.rotulo}: ${d.valor}${d.variacao ? ` (${d.variacao})` : ""}`),
    "",
    `Relatório completo em anexo: ${gerado.filename}`,
  ].join("\n");

  return { assunto, html, texto };
}

/** Manda o relatório já gerado pra um destinatário. */
export async function enviarRelatorio(args: {
  relatorio: RelatorioEnviavel;
  gerado: RelatorioGerado;
  destinatario: string;
  nomeEscritorio: string;
  escritorioId: number;
  userId?: number;
  programado: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const { assunto, html, texto } = montarEmailRelatorio(args);
  const r = await enviarEmail({
    to: args.destinatario,
    subject: assunto,
    html,
    text: texto,
    tipo: args.programado ? "relatorio_programado" : "relatorio_manual",
    escritorioId: args.escritorioId,
    userId: args.userId,
    attachments: [{ filename: args.gerado.filename, contentBase64: args.gerado.base64 }],
  });
  if (!r.success) {
    log.warn(
      { relatorio: args.relatorio, destinatario: args.destinatario, erro: r.error },
      "falha ao enviar relatório por e-mail",
    );
  }
  return r;
}

/** Aceita "a@x.com, b@y.com" ou lista — normaliza, valida e deduplica. */
export function normalizarDestinatarios(bruto: string | string[]): {
  validos: string[];
  invalidos: string[];
} {
  const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const partes = (Array.isArray(bruto) ? bruto : bruto.split(/[,;\n]/))
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const e of partes) {
    if (!RE_EMAIL.test(e)) invalidos.push(e);
    else if (!validos.includes(e)) validos.push(e);
  }
  return { validos, invalidos };
}
