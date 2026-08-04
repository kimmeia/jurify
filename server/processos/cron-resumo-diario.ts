/**
 * Cron do resumo diário.
 *
 * Roda de hora em hora e dispara para os escritórios cuja hora LOCAL bate com
 * a configurada. O servidor roda em UTC — um cron fixo em UTC mandaria o
 * resumo às 4h da manhã pra quem está em Manaus, e a essa altura ninguém lê.
 *
 * Idempotência vem do UNIQUE (escritório, dia, canal) em `resumo_diario_envios`:
 * reinício de processo, tick duplicado ou redeploy no horário não redisparam.
 * E cada tentativa grava o resultado REAL de cada canal — sem isso o painel
 * mostraria "ativo" enquanto o Resend está fora e ninguém recebe nada.
 */

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  escritorios,
  eventosProcesso,
  motorMonitoramentos,
  prazosSugeridos,
  resumoDiarioEnvios,
  users,
} from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import { enviarEmail } from "../_core/email";
import { diasUteisAte, ehDiaUtil } from "./prazo-processual";
import { classificarGrupo } from "./router-movimentacoes";
import {
  assuntoEmail,
  htmlEmail,
  textoEmail,
  textoWhatsApp,
  type DadosResumo,
  type ItemResumo,
} from "./resumo-diario";
import type { AnaliseMovimentacao } from "./resumir-movimentacao";

const log = createLogger("cron-resumo-diario");

/** Guarda de concorrência em-processo — mesmo padrão do cron de monitoramento. */
let resumoRodando = false;

/** Quantos itens acionáveis cabem no resumo antes de virar lista. */
const MAX_ITENS_ACIONAVEIS = 8;

/** Dias sem movimentação que fazem um processo virar "vale um olhar". */
const DIAS_PARADO = 60;

function urlBase(): string {
  return process.env.APP_URL?.replace(/\/$/, "") || "https://juridflow.com.br";
}

/** Dia local do escritório no formato YYYY-MM-DD — chave de idempotência. */
export function diaRefEmTz(fusoHorario: string, agora = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: fusoHorario,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(agora);
  } catch {
    return agora.toISOString().slice(0, 10);
  }
}

/** Hora local (0-23) do escritório agora. */
export function horaLocalEm(fusoHorario: string, agora: Date): number {
  try {
    const s = agora.toLocaleString("en-US", { timeZone: fusoHorario, hour: "2-digit", hour12: false });
    const h = Number(s.match(/\d+/)?.[0] ?? NaN);
    return Number.isFinite(h) ? h % 24 : agora.getUTCHours();
  } catch {
    // Fuso inválido no cadastro não pode derrubar o cron dos outros.
    return agora.getUTCHours();
  }
}

function parseAnalise(raw: string | null): AnaliseMovimentacao | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AnaliseMovimentacao;
  } catch {
    return null;
  }
}

/**
 * Monta o resumo de um escritório a partir das movimentações das últimas 24h.
 * Devolve null quando não há absolutamente nada — aí nem log de envio faz
 * sentido criar.
 */
export async function montarResumoDoEscritorio(
  escritorioId: number,
  nomeDestinatario: string,
  dataRef: string,
): Promise<DadosResumo | null> {
  const db = await getDb();
  if (!db) return null;

  const desde = new Date(Date.now() - 24 * 3_600_000);

  const rows = await db
    .select({
      id: eventosProcesso.id,
      dataEvento: eventosProcesso.dataEvento,
      conteudo: eventosProcesso.conteudo,
      resumoIa: eventosProcesso.resumoIa,
      desfecho: eventosProcesso.desfecho,
      relevancia: eventosProcesso.relevancia,
      analiseJson: eventosProcesso.analiseJson,
      cnj: eventosProcesso.cnjAfetado,
      apelido: motorMonitoramentos.apelido,
      prazoId: prazosSugeridos.id,
      prazoTipo: prazosSugeridos.tipo,
      prazoData: prazosSugeridos.dataSugerida,
      prazoStatus: prazosSugeridos.status,
    })
    .from(eventosProcesso)
    .leftJoin(motorMonitoramentos, eq(motorMonitoramentos.id, eventosProcesso.monitoramentoId))
    .leftJoin(prazosSugeridos, eq(prazosSugeridos.eventoId, eventosProcesso.id))
    .where(
      and(
        eq(eventosProcesso.escritorioId, escritorioId),
        eq(eventosProcesso.tipo, "movimentacao"),
        gte(eventosProcesso.dataEvento, desde),
      ),
    )
    .orderBy(desc(eventosProcesso.dataEvento))
    .limit(300);

  if (rows.length === 0) return null;

  const hoje = new Date();
  const exigemAcao: ItemResumo[] = [];
  const relevantes: string[] = [];
  let totalRelevantes = 0;
  let totalRotina = 0;
  const processos = new Set<string>();

  for (const r of rows) {
    if (r.cnj) processos.add(r.cnj);
    const analise = parseAnalise(r.analiseJson);
    const temPrazoPendente = !!r.prazoId && r.prazoStatus === "pendente";
    const grupo = classificarGrupo({ relevancia: r.relevancia, temPrazoPendente, analise });
    const cliente = r.apelido ?? r.cnj ?? "(sem apelido)";
    const titulo = analise?.titulo ?? r.resumoIa ?? r.conteudo.slice(0, 140);

    if (grupo === "exigem_acao") {
      exigemAcao.push({
        cliente,
        cnj: r.cnj,
        titulo,
        pontos: analise?.pontos ?? [],
        citacao: analise?.providencia.citacao ?? null,
        desfecho: r.desfecho,
        ehAudiencia: r.prazoTipo === "audiencia" || analise?.ato === "audiencia",
        prazoData: r.prazoData ?? null,
        prazoDiasUteisRestantes: r.prazoData ? diasUteisAte(r.prazoData, hoje) : null,
        vara: null,
      });
    } else if (grupo === "relevante") {
      totalRelevantes++;
      if (relevantes.length < 6) relevantes.push(`${titulo.slice(0, 90)} (${cliente})`);
    } else {
      totalRotina++;
    }
  }

  // Mais urgente primeiro — é a ordem em que ele vai trabalhar.
  exigemAcao.sort((a, b) => {
    const va = a.prazoDiasUteisRestantes ?? 9999;
    const vb = b.prazoDiasUteisRestantes ?? 9999;
    return va - vb;
  });

  const parados = await processosParados(escritorioId);

  return {
    nomeDestinatario,
    dataRef,
    totalMovimentacoes: rows.length,
    totalProcessos: processos.size,
    exigemAcao: exigemAcao.slice(0, MAX_ITENS_ACIONAVEIS),
    relevantes,
    totalRelevantes,
    totalRotina,
    paradosHaMuito: parados,
    urlCentral: `${urlBase()}/movimentacoes`,
  };
}

/** Monitoramentos ativos sem movimentação há muito tempo. */
async function processosParados(escritorioId: number): Promise<Array<{ cliente: string; dias: number }>> {
  const db = await getDb();
  if (!db) return [];
  const limite = new Date(Date.now() - DIAS_PARADO * 86_400_000);
  const rows = await db
    .select({
      apelido: motorMonitoramentos.apelido,
      searchKey: motorMonitoramentos.searchKey,
      ultima: motorMonitoramentos.ultimaMovimentacaoEm,
    })
    .from(motorMonitoramentos)
    .where(
      and(
        eq(motorMonitoramentos.escritorioId, escritorioId),
        eq(motorMonitoramentos.status, "ativo"),
      ),
    )
    .limit(200);

  return rows
    .filter((r) => r.ultima && r.ultima < limite)
    .map((r) => ({
      cliente: r.apelido ?? r.searchKey,
      dias: Math.floor((Date.now() - r.ultima!.getTime()) / 86_400_000),
    }))
    .sort((a, b) => b.dias - a.dias)
    .slice(0, 3);
}

async function jaEnviado(escritorioId: number, dataRef: string, canal: "email" | "whatsapp") {
  const db = await getDb();
  if (!db) return true;
  const [row] = await db
    .select({ id: resumoDiarioEnvios.id })
    .from(resumoDiarioEnvios)
    .where(
      and(
        eq(resumoDiarioEnvios.escritorioId, escritorioId),
        eq(resumoDiarioEnvios.dataRef, dataRef),
        eq(resumoDiarioEnvios.canal, canal),
      ),
    )
    .limit(1);
  return !!row;
}

async function registrar(params: {
  escritorioId: number;
  dataRef: string;
  canal: "email" | "whatsapp";
  status: "enviado" | "falha" | "sem_conteudo" | "nao_configurado";
  destino?: string | null;
  erro?: string | null;
  dados?: DadosResumo | null;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(resumoDiarioEnvios).values({
      escritorioId: params.escritorioId,
      dataRef: params.dataRef,
      canal: params.canal,
      status: params.status,
      destino: params.destino?.slice(0, 255) ?? null,
      erro: params.erro?.slice(0, 500) ?? null,
      exigemAcao: params.dados?.exigemAcao.length ?? 0,
      relevantes: params.dados?.totalRelevantes ?? 0,
      rotina: params.dados?.totalRotina ?? 0,
    });
  } catch (err) {
    const errAny = err as { cause?: { code?: string; errno?: number } };
    const isDup = errAny?.cause?.code === "ER_DUP_ENTRY" || errAny?.cause?.errno === 1062;
    if (!isDup) {
      log.warn(
        { escritorioId: params.escritorioId, err: err instanceof Error ? err.message : String(err) },
        "falha ao registrar envio do resumo",
      );
    }
  }
}

/**
 * Dispara o resumo de UM escritório. Exportado pra permitir o botão
 * "enviar agora" na configuração — testar sem esperar o horário é o que faz
 * o usuário confiar que está ligado.
 */
export async function dispararResumoEscritorio(
  esc: {
    id: number;
    nome: string | null;
    fusoHorario: string;
    resumoDiarioEmail: string | null;
    resumoDiarioWhatsapp: string | null;
    resumoDiarioTemplate: string | null;
  },
  emailDono: string | null,
  nomeDono: string | null,
  opts?: { ignorarJaEnviado?: boolean },
): Promise<{ email: string; whatsapp: string }> {
  const dataRef = diaRefEmTz(esc.fusoHorario);
  const primeiroNome = (nomeDono ?? esc.nome ?? "").split(" ")[0] || "advogado(a)";
  const dados = await montarResumoDoEscritorio(esc.id, primeiroNome, dataRef);

  let statusEmail = "pulado";
  let statusWhats = "pulado";

  // ── E-mail ──
  const destinoEmail = esc.resumoDiarioEmail?.trim() || emailDono;
  if (opts?.ignorarJaEnviado || !(await jaEnviado(esc.id, dataRef, "email"))) {
    if (!destinoEmail) {
      await registrar({ escritorioId: esc.id, dataRef, canal: "email", status: "nao_configurado", erro: "Sem e-mail de destino" });
      statusEmail = "nao_configurado";
    } else if (!dados) {
      await registrar({ escritorioId: esc.id, dataRef, canal: "email", status: "sem_conteudo", destino: destinoEmail });
      statusEmail = "sem_conteudo";
    } else {
      const r = await enviarEmail({
        to: destinoEmail,
        subject: assuntoEmail(dados),
        html: htmlEmail(dados),
        text: textoEmail(dados),
        tipo: "resumo_diario_movimentacoes",
        escritorioId: esc.id,
      });
      await registrar({
        escritorioId: esc.id,
        dataRef,
        canal: "email",
        status: r.success ? "enviado" : "falha",
        destino: destinoEmail,
        erro: r.error ?? null,
        dados,
      });
      statusEmail = r.success ? "enviado" : "falha";
    }
  }

  // ── WhatsApp ──
  // Fora da janela de 24h a Meta só aceita template aprovado (HSM). Sem
  // template configurado o envio seria recusado, então registramos
  // `nao_configurado` em vez de tentar e logar erro todo dia.
  if (opts?.ignorarJaEnviado || !(await jaEnviado(esc.id, dataRef, "whatsapp"))) {
    const destinoWhats = esc.resumoDiarioWhatsapp?.replace(/\D/g, "") || "";
    const template = esc.resumoDiarioTemplate?.trim() || "";
    const texto = dados ? textoWhatsApp(dados) : null;

    if (!destinoWhats || !template) {
      await registrar({
        escritorioId: esc.id,
        dataRef,
        canal: "whatsapp",
        status: "nao_configurado",
        destino: destinoWhats || null,
        erro: !destinoWhats
          ? "Sem número de destino"
          : "Sem template aprovado na Meta — WhatsApp fora da janela de 24h exige HSM",
      });
      statusWhats = "nao_configurado";
    } else if (!texto) {
      // Nada acionável: silêncio de propósito.
      await registrar({ escritorioId: esc.id, dataRef, canal: "whatsapp", status: "sem_conteudo", destino: destinoWhats, dados });
      statusWhats = "sem_conteudo";
    } else {
      try {
        const { enviarTemplatePeloCanalApi } = await import("../integracoes/canal-envio");
        const r = await enviarTemplatePeloCanalApi({
          escritorioId: esc.id,
          telefone: destinoWhats,
          nome: template,
          idioma: "pt_BR",
          componentes: [{ type: "body", parameters: [{ type: "text", text: texto.slice(0, 1024) }] }],
        });
        await registrar({
          escritorioId: esc.id,
          dataRef,
          canal: "whatsapp",
          status: r.ok ? "enviado" : "falha",
          destino: destinoWhats,
          erro: r.ok ? null : r.erro,
          dados,
        });
        statusWhats = r.ok ? "enviado" : "falha";
      } catch (err) {
        await registrar({
          escritorioId: esc.id,
          dataRef,
          canal: "whatsapp",
          status: "falha",
          destino: destinoWhats,
          erro: err instanceof Error ? err.message : String(err),
          dados,
        });
        statusWhats = "falha";
      }
    }
  }

  return { email: statusEmail, whatsapp: statusWhats };
}

/**
 * Tick horário. Percorre os escritórios com resumo ativo e dispara os que
 * estão na hora local configurada.
 */
export async function rodarResumoDiario(): Promise<{ disparados: number }> {
  if (resumoRodando) {
    log.info("tick sobreposto ignorado");
    return { disparados: 0 };
  }
  resumoRodando = true;

  try {
    const db = await getDb();
    if (!db) return { disparados: 0 };

    const ativos = await db
      .select({
        id: escritorios.id,
        nome: escritorios.nome,
        ownerId: escritorios.ownerId,
        fusoHorario: escritorios.fusoHorario,
        hora: escritorios.resumoDiarioHora,
        somenteUteis: escritorios.resumoDiarioSomenteUteis,
        resumoDiarioEmail: escritorios.resumoDiarioEmail,
        resumoDiarioWhatsapp: escritorios.resumoDiarioWhatsapp,
        resumoDiarioTemplate: escritorios.resumoDiarioTemplate,
      })
      .from(escritorios)
      .where(eq(escritorios.resumoDiarioAtivo, true));

    if (ativos.length === 0) return { disparados: 0 };

    const agora = new Date();
    const naHora = ativos.filter((e) => horaLocalEm(e.fusoHorario, agora) === e.hora);
    if (naHora.length === 0) return { disparados: 0 };

    // Donos em lote — evita 1 query por escritório.
    const donos = await db
      .select({ id: users.id, email: users.email, nome: users.name })
      .from(users)
      .where(inArray(users.id, naHora.map((e) => e.ownerId)));
    const porId = new Map(donos.map((d) => [d.id, d]));

    let disparados = 0;
    for (const esc of naHora) {
      // Fim de semana e feriado: dia sem expediente não gera movimentação
      // nova, e resumo vazio no sábado só ensina a ignorar a mensagem.
      if (esc.somenteUteis && !ehDiaUtil(agora)) continue;

      try {
        const dono = porId.get(esc.ownerId);
        await dispararResumoEscritorio(esc, dono?.email ?? null, dono?.nome ?? null);
        disparados++;
      } catch (err) {
        log.error(
          { escritorioId: esc.id, err: err instanceof Error ? err.message : String(err) },
          "resumo diário falhou para o escritório",
        );
      }
    }

    if (disparados > 0) log.info({ disparados }, "resumo diário disparado");
    return { disparados };
  } finally {
    resumoRodando = false;
  }
}
