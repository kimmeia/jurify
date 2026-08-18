/**
 * RH — ponto digital.
 *
 * Duas leituras com regras de acesso diferentes, e a diferença não é detalhe:
 *
 *  - o PRÓPRIO ponto é um direito de quem trabalha. Qualquer colaborador vê o
 *    dele, sem gate de módulo. Esconder de alguém as horas que a empresa
 *    registrou sobre ele seria o avesso do que uma folha de ponto serve;
 *  - o ponto DOS OUTROS é gestão, e passa por `checkPermission("ponto")`.
 *    O módulo é próprio, e não uma carona em "equipe": quem gerencia a equipe
 *    não passa a ver, por consequência, a jornada, as faltas e a nota de
 *    avaliação de cada colega. Isso é concessão explícita do dono na matriz de
 *    cargos — por isso o gate nunca compara `cargo === "dono"`.
 *
 * O ajuste exige `editar`: corrigir a jornada de outra pessoa é escrever no
 * documento que vai pro pagamento dela.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getEscritorioPorUsuario } from "../escritorio/db-escritorio";
import { checkPermission } from "../escritorio/check-permission";
import { getDb } from "../db";
import { colaboradores, users } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import { FUSO_HORARIO_PADRAO } from "../../shared/escritorio-types";
import { calcularJornada, totalDoPeriodo, type DiaPontoBruto } from "../../shared/ponto";
import {
  expedienteDoDia,
  intervaloPresumido,
  minutosPrevistos,
  normalizarJornada,
  pontualidade,
  type JornadaSemanal,
} from "../../shared/jornada";
import { diaCivilEmTz, toIsoString } from "../_core/dates";
import {
  contarFaltas,
  exigeMotivo,
  MOTIVOS_FALTA,
  situacaoDoDia,
  TIPOS_OCORRENCIA,
  type OcorrenciaGravada,
} from "../../shared/ocorrencias";
import { ehPendente } from "../../shared/ponto";
import {
  ajustarDia,
  diasDoEscritorio,
  diasDoPeriodo,
  marcarPausa,
  observandoDesde,
} from "./ponto-repo";
import {
  acharOcorrencia,
  anexarAtestado,
  decidirAtestado,
  excluirOcorrencia,
  ocorrenciasDoEscritorio,
  ocorrenciasDoPeriodo,
  registrarOcorrencia,
} from "./ocorrencias-repo";
import {
  mediaDasNotas,
  normalizarNotas,
  type AcaoCombinada,
  type AvaliacaoGravada,
} from "../../shared/avaliacao";
import { desempenhoDoPeriodo } from "./desempenho-repo";
import { DESEMPENHO_VAZIO } from "../../shared/desempenho";
import {
  acoesDasAvaliacoes,
  avaliacoesDoColaborador,
  avaliacoesDoEscritorio,
  decidirAcao,
  excluirAvaliacao,
  registrarAvaliacao,
} from "./avaliacoes-repo";

/** "2026-08" → { de: "2026-08-01", ate: "2026-08-31" }. */
function limitesDoMes(competencia: string): { de: string; ate: string } {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano!, mes!, 0)).getUTCDate();
  return { de: `${competencia}-01`, ate: `${competencia}-${String(ultimo).padStart(2, "0")}` };
}

const Competencia = z.string().regex(/^\d{4}-\d{2}$/, "Competência no formato AAAA-MM");

/** Hora "HH:MM" no dia informado, no fuso do escritório, como instante. */
function instanteDe(dia: string, hora: string, fusoHorario: string): Date {
  // Constrói em UTC e corrige pelo deslocamento que o fuso tinha NAQUELE dia —
  // usar o deslocamento de hoje erraria em uma hora nos meses de horário de
  // verão, e uma hora a mais na folha é uma hora que alguém contesta.
  const [h, m] = hora.split(":").map(Number);
  const ingenuo = new Date(`${dia}T${hora}:00.000Z`);
  const nome = new Intl.DateTimeFormat("en-US", { timeZone: fusoHorario, timeZoneName: "longOffset" })
    .formatToParts(ingenuo)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const casa = nome.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  const offsetMin = casa
    ? (casa[1] === "+" ? 1 : -1) * (Number(casa[2]) * 60 + Number(casa[3] ?? 0))
    : 0;
  return new Date(Date.UTC(
    Number(dia.slice(0, 4)),
    Number(dia.slice(5, 7)) - 1,
    Number(dia.slice(8, 10)),
    h!,
    m!,
  ) - offsetMin * 60000);
}

async function contexto(userId: number) {
  const esc = await getEscritorioPorUsuario(userId);
  if (!esc?.colaborador) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Colaborador não encontrado." });
  }
  return { esc, fuso: esc.escritorio.fusoHorario || FUSO_HORARIO_PADRAO };
}

/** Minutos desde a meia-noite LOCAL de um instante — a conta do atraso. */
function minutosLocais(instante: Date | null, fuso: string): number | null {
  if (!instante) return null;
  const hhmm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instante);
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h! * 60 + m! : null;
}

/**
 * O expediente daquele dia começou depois de o ponto passar a registrar?
 *
 * Só quando a resposta é sim o atraso significa alguma coisa. Comparar a
 * entrada com um horário anterior à existência do registro mede a hora do
 * deploy, não a hora de chegada de ninguém.
 */
export function pontualidadeApuravel(
  jornada: JornadaSemanal | null,
  dia: string,
  fuso: string,
  desde: Date | null,
): boolean {
  if (!desde) return true;
  const e = expedienteDoDia(jornada, dia);
  if (!e) return true;
  return instanteDe(dia, e.inicio, fuso) >= desde;
}

/**
 * O espelho de um colaborador: o que ele fez, contra o que foi contratado.
 *
 * Quem não tem jornada definida recebe `previsto: 0` e `atrasado: false` em
 * tudo — o ponto mostra as horas e não cobra carga que ninguém configurou.
 */
function montarEspelho(
  linhas: DiaPontoBruto[],
  agora: Date,
  jornada: JornadaSemanal | null,
  fuso: string,
  desde: Date | null = null,
  ocorrencias: OcorrenciaGravada[] = [],
) {
  const porDia = new Map<string, OcorrenciaGravada[]>();
  for (const o of ocorrencias) {
    const lista = porDia.get(o.dia) ?? [];
    lista.push(o);
    porDia.set(o.dia, lista);
  }

  // Falta lançada em dia que ninguém logou não tem linha de ponto — e é
  // justamente o caso mais comum. Sem a linha sintética a falta some da
  // tabela e o espelho volta a mostrar o dia em branco que ela veio explicar.
  const comPonto = new Set(linhas.map((l) => l.dia));
  const sinteticas: DiaPontoBruto[] = [...porDia.keys()]
    .filter((d) => !comPonto.has(d))
    .map((dia) => ({
      dia,
      entradaEm: null,
      pausaInicioEm: null,
      pausaFimEm: null,
      saidaEm: null,
      ultimaAtividadeEm: null,
    }));

  const jornadas = [...linhas, ...sinteticas]
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map((l) => {
      const j = calcularJornada(l, agora);
      const doDia = porDia.get(j.dia) ?? [];
      const falta = situacaoDoDia(doDia);
      // Abonada zera o previsto: cobrar a jornada de um dia de férias seria
      // transformar o direito em dívida.
      const previsto = falta === "abonada" ? 0 : minutosPrevistos(jornada, j.dia);
      const apuravel = pontualidadeApuravel(jornada, j.dia, fuso, desde);
      const p = apuravel
        ? pontualidade(jornada, j.dia, minutosLocais(j.entrada, fuso))
        : { atrasoMin: 0, atrasado: false };

      // O intervalo do contrato PRESUMIDO, quando ninguém bateu a pausa.
      //
      // Sem isto o espelho premia quem esquece de marcar o almoço: o previsto
      // já vem com o intervalo descontado (12h–18h com 1h de almoço = 5h), mas
      // o realizado só desconta a pausa que foi REGISTRADA. Quem entrou 12h e
      // saiu 17h40 sem clicar em "sair pro almoço" aparecia com +40min de
      // saldo por uma hora de almoço que ele tirou e não marcou — todo dia,
      // pra todo mundo. Presumir é a mesma escolha da saída deduzida: quando o
      // sistema não observou, ele assume o combinado e DIZ que assumiu, em vez
      // de fingir que o intervalo não existiu.
      //
      // Só presume quando a pessoa ficou tempo suficiente pra ter almoçado —
      // quem trabalhou 40 minutos não tirou uma hora de intervalo.
      const expediente = expedienteDoDia(jornada, j.dia);
      const intervaloContratado = expediente?.intervaloMin ?? 0;
      const intervaloPresumidoMin = intervaloPresumido(
        j.minutos,
        j.minutosPausa,
        intervaloContratado,
      );
      const minutosLiquidos =
        j.minutos != null ? Math.max(j.minutos - intervaloPresumidoMin, 0) : null;

      return {
        ...j,
        // `minutos` é o LÍQUIDO — é ele que a tabela mostra, que o total soma e
        // que o saldo compara. O bruto fica ao lado pra quem quiser conferir.
        minutos: minutosLiquidos,
        minutosBrutos: j.minutos,
        intervaloPresumidoMin,
        previstoMin: previsto,
        // Saldo só existe quando os dois lados existem. Dia aberto ou sem
        // jornada não vira "-8h" — seria cobrar uma falta que ninguém apurou.
        // Atestado ainda não revisado também fica de fora: enquanto ninguém
        // olhou o papel, descontar já seria uma decisão tomada.
        saldoMin:
          falta === "abonada" || falta === "aguardando"
            ? null
            : falta === "descontada"
              ? previsto > 0 ? (minutosLiquidos ?? 0) - previsto : null
              : minutosLiquidos != null && previsto > 0 ? minutosLiquidos - previsto : null,
        atrasoMin: p.atrasoMin,
        atrasado: p.atrasado,
        ocorrencias: doDia,
        falta,
        avisos: apuravel
          ? j.avisos
          : [
              ...j.avisos,
              "O ponto passou a registrar depois do início do expediente deste dia — a hora de entrada não foi observada e o atraso não foi apurado.",
            ],
      };
    });

  const total = totalDoPeriodo(jornadas);
  const previstoMin = jornadas.reduce((s, j) => s + j.previstoMin, 0);
  // Dia com falta lançada não é dia pendente: pendente é o que falta o gestor
  // resolver, e a falta É a resolução. Deixá-lo nos dois lugares faria a tela
  // pedir de volta uma decisão já tomada.
  const resolvidosPorFalta = jornadas.filter((j) => ehPendente(j.status) && j.falta != null).length;

  return {
    jornadas,
    ocorrencias,
    total: {
      ...total,
      diasPendentes: Math.max(total.diasPendentes - resolvidosPorFalta, 0),
      previstoMin,
      // O saldo do mês compara o realizado dos dias FECHADOS com o previsto
      // desses mesmos dias: misturar previsto de dia pendente daria um
      // vermelho que some quando o gestor lançar a saída.
      saldoMin: jornadas
        .filter((j) => j.saldoMin != null)
        .reduce((s, j) => s + (j.saldoMin ?? 0), 0),
      diasAtrasados: jornadas.filter((j) => j.atrasado).length,
      faltas: contarFaltas(ocorrencias),
    },
  };
}

/** O que o banco devolve, no formato que a tela consome. */
function paraGravada(
  linhas: Array<{
    id: number;
    colaboradorId: number;
    dia: string;
    tipo: string;
    motivo: string | null;
    descricao: string | null;
    atestadoUrl: string | null;
    atestadoNome: string | null;
    aprovadoEm: Date | string | null;
  }>,
): OcorrenciaGravada[] {
  return linhas.map((l) => ({
    id: l.id,
    colaboradorId: l.colaboradorId,
    dia: l.dia,
    tipo: l.tipo as OcorrenciaGravada["tipo"],
    motivo: l.motivo as OcorrenciaGravada["motivo"],
    descricao: l.descricao,
    atestadoUrl: l.atestadoUrl,
    atestadoNome: l.atestadoNome,
    aprovadoEm: toIsoString(l.aprovadoEm) ?? null,
  }));
}

/** Junta as avaliações com o plano combinado de cada uma. */
function montarAvaliacoes(
  linhas: Array<{
    id: number;
    colaboradorId: number;
    ciclo: string;
    notas: string | null;
    media: string | null;
    comentario: string | null;
    avaliadoEm: Date | string | null;
    avaliadoPorNome: string | null;
  }>,
  acoes: Array<{
    id: number;
    avaliacaoId: number;
    descricao: string;
    prazo: string | null;
    concluidoEm: Date | string | null;
  }>,
): AvaliacaoGravada[] {
  const porAvaliacao = new Map<number, AcaoCombinada[]>();
  for (const a of acoes) {
    const lista = porAvaliacao.get(a.avaliacaoId) ?? [];
    lista.push({
      id: a.id,
      descricao: a.descricao,
      prazo: a.prazo,
      concluidoEm: toIsoString(a.concluidoEm) ?? null,
    });
    porAvaliacao.set(a.avaliacaoId, lista);
  }

  return linhas.map((l) => {
    const notas = normalizarNotas(l.notas);
    return {
      id: l.id,
      colaboradorId: l.colaboradorId,
      ciclo: l.ciclo,
      notas,
      // A média é recalculada das notas em vez de lida da coluna: se um
      // critério for aposentado, a coluna guardaria a média de uma régua que
      // não existe mais, e a tela mostraria um número que não sai da soma
      // dos critérios exibidos logo abaixo dele.
      media: mediaDasNotas(notas),
      comentario: l.comentario,
      avaliadoPorNome: l.avaliadoPorNome,
      avaliadoEm: toIsoString(l.avaliadoEm) ?? null,
      acoes: porAvaliacao.get(l.id) ?? [],
    };
  });
}

/** Lê as avaliações de um escopo já resolvido, com as ações juntas. */
async function lerAvaliacoes(
  escritorioId: number,
  colaboradorId: number | null,
): Promise<AvaliacaoGravada[]> {
  const linhas = colaboradorId == null
    ? await avaliacoesDoEscritorio(escritorioId)
    : await avaliacoesDoColaborador(escritorioId, colaboradorId);
  const acoes = await acoesDasAvaliacoes(escritorioId, linhas.map((l) => l.id));
  return montarAvaliacoes(linhas, acoes);
}

/**
 * O gate de escrita do RH.
 *
 * Registrar falta, anexar atestado e abonar são atos que mexem no que a pessoa
 * recebe. Exigem `editar` no módulo Ponto — ver o cartão dos outros não
 * autoriza reescrevê-lo.
 */
async function exigirGestorDeEquipe(userId: number) {
  const perm = await checkPermission(userId, "ponto", "editar");
  if (!perm.allowed || !perm.editar) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só quem gerencia o ponto pode fazer isso." });
  }
  return perm;
}

/** O colaborador existe e é deste escritório? */
async function exigirColaboradorDoEscritorio(escritorioId: number, colaboradorId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
  const [alvo] = await db
    .select({ id: colaboradores.id })
    .from(colaboradores)
    .where(and(
      eq(colaboradores.id, colaboradorId),
      eq(colaboradores.escritorioId, escritorioId),
    ))
    .limit(1);
  if (!alvo) throw new TRPCError({ code: "NOT_FOUND", message: "Colaborador não encontrado." });
}

export const rhRouter = router({
  /** O ponto de quem está pedindo. Sem gate: é o cartão dele. */
  meuEspelho: protectedProcedure
    .input(z.object({ competencia: Competencia }))
    .query(async ({ ctx, input }) => {
      const { esc, fuso } = await contexto(ctx.user.id);
      const { de, ate } = limitesDoMes(input.competencia);
      const [linhas, desde, ocorrencias] = await Promise.all([
        diasDoPeriodo(esc.escritorio.id, esc.colaborador.id, de, ate),
        observandoDesde(esc.escritorio.id),
        ocorrenciasDoPeriodo(esc.escritorio.id, esc.colaborador.id, de, ate),
      ]);
      const jornada = normalizarJornada((esc.colaborador as { jornadaSemanal?: string | null }).jornadaSemanal);
      // A avaliação do próprio colaborador não tem gate, pela mesma razão do
      // espelho: é sobre ele, e sonegar a nota a quem foi avaliado é o avesso
      // de uma avaliação.
      const avaliacoes = await lerAvaliacoes(esc.escritorio.id, esc.colaborador.id);
      return {
        ...montarEspelho(
          linhas as unknown as DiaPontoBruto[],
          new Date(),
          jornada,
          fuso,
          desde,
          paraGravada(ocorrencias),
        ),
        avaliacoes,
      };
    }),

  /** O ponto da equipe. Exige enxergar além da própria linha. */
  espelhoEquipe: protectedProcedure
    .input(z.object({ competencia: Competencia }))
    .query(async ({ ctx, input }) => {
      const { esc, fuso } = await contexto(ctx.user.id);
      const perm = await checkPermission(ctx.user.id, "ponto", "ver");
      if (!perm.allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso ao ponto da equipe." });
      }

      const { de, ate } = limitesDoMes(input.competencia);
      const [linhas, desde, ocorrencias, equipe] = await Promise.all([
        diasDoEscritorio(esc.escritorio.id, de, ate),
        observandoDesde(esc.escritorio.id),
        ocorrenciasDoEscritorio(esc.escritorio.id, de, ate),
        (async () => {
          const db = await getDb();
          if (!db) return [];
          return db
            .select({
              id: colaboradores.id,
              nome: users.name,
              email: users.email,
              ativo: colaboradores.ativo,
              removidoEm: colaboradores.removidoEm,
              cargo: colaboradores.cargo,
              jornadaSemanal: colaboradores.jornadaSemanal,
            })
            .from(colaboradores)
            .innerJoin(users, eq(colaboradores.userId, users.id))
            .where(eq(colaboradores.escritorioId, esc.escritorio.id));
        })(),
      ]);

      const agora = new Date();
      const porColab = new Map<number, DiaPontoBruto[]>();
      for (const l of linhas as unknown as Array<DiaPontoBruto & { colaboradorId: number }>) {
        const lista = porColab.get(l.colaboradorId) ?? [];
        lista.push(l);
        porColab.set(l.colaboradorId, lista);
      }

      const ocorPorColab = new Map<number, OcorrenciaGravada[]>();
      for (const o of paraGravada(ocorrencias)) {
        const lista = ocorPorColab.get(o.colaboradorId) ?? [];
        lista.push(o);
        ocorPorColab.set(o.colaboradorId, lista);
      }

      // O desempenho cobre o mês inteiro da competência, com as MESMAS janelas
      // do relatório de Atendimento — a regra de como as linhas viram números
      // mora em `shared/desempenho`, então a ficha e o relatório não divergem.
      const desempenho = await desempenhoDoPeriodo(
        esc.escritorio.id,
        new Date(`${de}T00:00:00.000Z`),
        new Date(`${ate}T23:59:59.999Z`),
      );

      const avalPorColab = new Map<number, AvaliacaoGravada[]>();
      for (const a of await lerAvaliacoes(esc.escritorio.id, null)) {
        const lista = avalPorColab.get(a.colaboradorId) ?? [];
        lista.push(a);
        avalPorColab.set(a.colaboradorId, lista);
      }

      return {
        // Quem foi removido aparece MARCADO, não escondido: as horas que ele
        // trabalhou no mês existiram, e sumir com a linha faria o total da
        // equipe não bater com a soma das pessoas.
        pessoas: equipe
          .map((c) => {
            const espelho = montarEspelho(
              porColab.get(c.id) ?? [],
              agora,
              normalizarJornada(c.jornadaSemanal),
              fuso,
              desde,
              ocorPorColab.get(c.id) ?? [],
            );
            return {
              colaboradorId: c.id,
              nome: c.nome || c.email || `#${c.id}`,
              removido: !c.ativo || !!c.removidoEm,
              // A ficha mostra cargo e jornada no cabeçalho; vêm daqui pra não
              // exigir uma segunda consulta que poderia divergir desta.
              cargo: c.cargo,
              jornadaSemanal: c.jornadaSemanal,
              // Da mais recente pra mais antiga — a tela lê `[0]` como "a
              // última" e o resto vira histórico.
              avaliacoes: avalPorColab.get(c.id) ?? [],
              desempenho: desempenho.get(c.id) ?? DESEMPENHO_VAZIO,
              ...espelho,
            };
          })
          .filter((p) => p.jornadas.length > 0 || !p.removido)
          .sort((a, b) => a.nome.localeCompare(b.nome)),
      };
    }),

  /** Início e retorno do almoço — a única marcação que o sistema não infere. */
  registrarPausa: protectedProcedure
    .input(z.object({ lado: z.enum(["inicio", "fim"]) }))
    .mutation(async ({ ctx, input }) => {
      const { esc, fuso } = await contexto(ctx.user.id);
      const r = await marcarPausa(
        { escritorioId: esc.escritorio.id, colaboradorId: esc.colaborador.id, fusoHorario: fuso },
        input.lado,
      );
      if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.motivo ?? "Não deu pra registrar." });
      return { ok: true };
    }),

  /**
   * Corrige a jornada de um dia. Gestor apenas.
   *
   * Hora vazia ("") apaga a marcação — é como se lança "não trabalhou" num dia
   * que o sistema registrou por engano. Omitir o campo mantém o que estava.
   */
  ajustarDia: protectedProcedure
    .input(z.object({
      colaboradorId: z.number().int().positive(),
      dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      observacao: z.string().trim().min(3).max(255),
      entrada: z.string().regex(/^(\d{2}:\d{2})?$/).optional(),
      pausaInicio: z.string().regex(/^(\d{2}:\d{2})?$/).optional(),
      pausaFim: z.string().regex(/^(\d{2}:\d{2})?$/).optional(),
      saida: z.string().regex(/^(\d{2}:\d{2})?$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { esc, fuso } = await contexto(ctx.user.id);
      await exigirGestorDeEquipe(ctx.user.id);
      await exigirColaboradorDoEscritorio(esc.escritorio.id, input.colaboradorId);

      const hora = (v: string | undefined) =>
        v === undefined ? undefined : v === "" ? null : instanteDe(input.dia, v, fuso);

      await ajustarDia({
        escritorioId: esc.escritorio.id,
        colaboradorId: input.colaboradorId,
        dia: input.dia,
        gestorId: esc.colaborador.id,
        observacao: input.observacao,
        entradaEm: hora(input.entrada),
        pausaInicioEm: hora(input.pausaInicio),
        pausaFimEm: hora(input.pausaFim),
        saidaEm: hora(input.saida),
      });

      return { ok: true };
    }),

  /**
   * Lança uma ocorrência. Gestor apenas — inclusive a do próprio gestor.
   *
   * Falta exige motivo, e conduta exige descrição: "advertência" sem o que
   * aconteceu não serve de nada três meses depois, que é exatamente quando
   * alguém vai ler.
   */
  registrarOcorrencia: protectedProcedure
    .input(z.object({
      colaboradorId: z.number().int().positive(),
      dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      tipo: z.enum(TIPOS_OCORRENCIA as [string, ...string[]]),
      motivo: z.enum(MOTIVOS_FALTA as [string, ...string[]]).optional(),
      descricao: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { esc } = await contexto(ctx.user.id);
      const perm = await exigirGestorDeEquipe(ctx.user.id);
      await exigirColaboradorDoEscritorio(esc.escritorio.id, input.colaboradorId);

      const tipo = input.tipo as OcorrenciaGravada["tipo"];
      const motivo = (input.motivo ?? null) as OcorrenciaGravada["motivo"];
      const descricao = input.descricao?.trim() || null;

      if (exigeMotivo(tipo) && !motivo) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Toda falta precisa de um motivo." });
      }
      if (!exigeMotivo(tipo) && !descricao) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Descreva o que aconteceu — o registro é lido meses depois.",
        });
      }

      const id = await registrarOcorrencia({
        escritorioId: esc.escritorio.id,
        colaboradorId: input.colaboradorId,
        dia: input.dia,
        tipo,
        // Motivo em ocorrência que não é falta seria ruído gravado.
        motivo: exigeMotivo(tipo) ? motivo : null,
        descricao,
        gestorId: perm.colaboradorId,
      });
      return { id };
    }),

  /**
   * Anexa o atestado a uma falta. Só o gestor, por decisão do dono.
   *
   * Anexar não abona — a aprovação é ato separado. E a URL precisa ser do
   * próprio escritório: sem essa checagem, o campo aceitaria o caminho de um
   * arquivo de outro cliente do sistema.
   */
  anexarAtestado: protectedProcedure
    .input(z.object({
      ocorrenciaId: z.number().int().positive(),
      url: z.string().max(500),
      nome: z.string().trim().min(1).max(255),
    }))
    .mutation(async ({ ctx, input }) => {
      const { esc } = await contexto(ctx.user.id);
      await exigirGestorDeEquipe(ctx.user.id);

      const prefixo = `/uploads/escritorio_${esc.escritorio.id}/`;
      if (!input.url.startsWith(prefixo) || input.url.includes("..")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Arquivo fora deste escritório." });
      }

      const ocor = await acharOcorrencia(esc.escritorio.id, input.ocorrenciaId);
      if (!ocor) throw new TRPCError({ code: "NOT_FOUND", message: "Ocorrência não encontrada." });
      if (ocor.tipo !== "falta") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Atestado só entra em falta." });
      }

      await anexarAtestado({
        escritorioId: esc.escritorio.id,
        ocorrenciaId: input.ocorrenciaId,
        url: input.url,
        nome: input.nome.trim(),
      });
      return { ok: true };
    }),

  /**
   * Aprova (ou desfaz a aprovação do) atestado. Gestor apenas.
   *
   * Aprovar sem documento anexado é recusado de propósito: a aprovação existe
   * justamente pra registrar que alguém OLHOU o papel. Sem papel, o clique
   * viraria um abono automático com aparência de conferência.
   */
  decidirAtestado: protectedProcedure
    .input(z.object({
      ocorrenciaId: z.number().int().positive(),
      aprovar: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { esc } = await contexto(ctx.user.id);
      const perm = await exigirGestorDeEquipe(ctx.user.id);

      const ocor = await acharOcorrencia(esc.escritorio.id, input.ocorrenciaId);
      if (!ocor) throw new TRPCError({ code: "NOT_FOUND", message: "Ocorrência não encontrada." });
      if (input.aprovar && !ocor.atestadoUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Anexe o atestado antes de aprovar.",
        });
      }

      await decidirAtestado({
        escritorioId: esc.escritorio.id,
        ocorrenciaId: input.ocorrenciaId,
        gestorId: perm.colaboradorId,
        aprovar: input.aprovar,
      });
      return { ok: true };
    }),

  /**
   * Avalia um colaborador no ciclo. Gestor apenas.
   *
   * Exige pelo menos um critério com nota: avaliação sem nota nenhuma fecha o
   * ciclo na tela — o colaborador deixa de aparecer como "vencida" — sem ter
   * avaliado coisa alguma. Seria pior que não avaliar, porque cala o alarme.
   */
  avaliar: protectedProcedure
    .input(z.object({
      colaboradorId: z.number().int().positive(),
      ciclo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Ciclo no formato AAAA-MM"),
      notas: z.record(z.string(), z.number()),
      comentario: z.string().trim().max(2000).optional(),
      acoes: z.array(z.object({
        descricao: z.string().trim().min(3).max(500),
        prazo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { esc } = await contexto(ctx.user.id);
      const perm = await exigirGestorDeEquipe(ctx.user.id);
      await exigirColaboradorDoEscritorio(esc.escritorio.id, input.colaboradorId);

      const notas = normalizarNotas(input.notas);
      const media = mediaDasNotas(notas);
      if (media == null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Dê nota a pelo menos um critério.",
        });
      }

      const id = await registrarAvaliacao({
        escritorioId: esc.escritorio.id,
        colaboradorId: input.colaboradorId,
        ciclo: input.ciclo,
        notasJson: JSON.stringify(notas),
        media,
        comentario: input.comentario?.trim() || null,
        gestorId: perm.colaboradorId,
        acoes: (input.acoes ?? []).map((a) => ({
          descricao: a.descricao,
          prazo: a.prazo ?? null,
        })),
      });
      return { id, media };
    }),

  /** Dá uma ação combinada por cumprida (ou desfaz). Gestor apenas. */
  decidirAcao: protectedProcedure
    .input(z.object({
      acaoId: z.number().int().positive(),
      concluir: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { esc } = await contexto(ctx.user.id);
      const perm = await exigirGestorDeEquipe(ctx.user.id);

      const ok = await decidirAcao({
        escritorioId: esc.escritorio.id,
        acaoId: input.acaoId,
        gestorId: perm.colaboradorId,
        concluir: input.concluir,
      });
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Ação não encontrada." });
      return { ok: true };
    }),

  /** Apaga uma avaliação lançada por engano, com o plano dela. Gestor apenas. */
  excluirAvaliacao: protectedProcedure
    .input(z.object({ avaliacaoId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { esc } = await contexto(ctx.user.id);
      await exigirGestorDeEquipe(ctx.user.id);

      const ok = await excluirAvaliacao(esc.escritorio.id, input.avaliacaoId);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Avaliação não encontrada." });
      return { ok: true };
    }),

  /** Apaga uma ocorrência lançada por engano. Gestor apenas. */
  excluirOcorrencia: protectedProcedure
    .input(z.object({ ocorrenciaId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { esc } = await contexto(ctx.user.id);
      await exigirGestorDeEquipe(ctx.user.id);

      const ocor = await acharOcorrencia(esc.escritorio.id, input.ocorrenciaId);
      if (!ocor) throw new TRPCError({ code: "NOT_FOUND", message: "Ocorrência não encontrada." });

      await excluirOcorrencia(esc.escritorio.id, input.ocorrenciaId);
      return { ok: true };
    }),
});
