/**
 * RH — ponto digital.
 *
 * Duas leituras com regras de acesso diferentes, e a diferença não é detalhe:
 *
 *  - o PRÓPRIO ponto é um direito de quem trabalha. Qualquer colaborador vê o
 *    dele, sem gate de módulo. Esconder de alguém as horas que a empresa
 *    registrou sobre ele seria o avesso do que uma folha de ponto serve;
 *  - o ponto DOS OUTROS é gestão, e passa por `checkPermission("equipe")`.
 *    `verTodos` é o que separa quem enxerga a equipe de quem enxerga só a
 *    própria linha — e cargo personalizado com a flag entra junto, por isso o
 *    gate nunca compara `cargo === "dono"`.
 *
 * O ajuste exige `editar` além de `verTodos`: corrigir a jornada de outra
 * pessoa é escrever no documento que vai pro pagamento dela.
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
  ajustarDia,
  diasDoEscritorio,
  diasDoPeriodo,
  marcarPausa,
} from "./ponto-repo";

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

function montarEspelho(linhas: DiaPontoBruto[], agora: Date) {
  const jornadas = linhas.map((l) => calcularJornada(l, agora));
  return { jornadas, total: totalDoPeriodo(jornadas) };
}

export const rhRouter = router({
  /** O ponto de quem está pedindo. Sem gate: é o cartão dele. */
  meuEspelho: protectedProcedure
    .input(z.object({ competencia: Competencia }))
    .query(async ({ ctx, input }) => {
      const { esc } = await contexto(ctx.user.id);
      const { de, ate } = limitesDoMes(input.competencia);
      const linhas = await diasDoPeriodo(esc.escritorio.id, esc.colaborador.id, de, ate);
      return montarEspelho(linhas as unknown as DiaPontoBruto[], new Date());
    }),

  /** O ponto da equipe. Exige enxergar além da própria linha. */
  espelhoEquipe: protectedProcedure
    .input(z.object({ competencia: Competencia }))
    .query(async ({ ctx, input }) => {
      const { esc } = await contexto(ctx.user.id);
      const perm = await checkPermission(ctx.user.id, "equipe", "ver");
      if (!perm.allowed || !perm.verTodos) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sem acesso ao ponto da equipe." });
      }

      const { de, ate } = limitesDoMes(input.competencia);
      const [linhas, equipe] = await Promise.all([
        diasDoEscritorio(esc.escritorio.id, de, ate),
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

      return {
        // Quem foi removido aparece MARCADO, não escondido: as horas que ele
        // trabalhou no mês existiram, e sumir com a linha faria o total da
        // equipe não bater com a soma das pessoas.
        pessoas: equipe
          .map((c) => {
            const { jornadas, total } = montarEspelho(porColab.get(c.id) ?? [], agora);
            return {
              colaboradorId: c.id,
              nome: c.nome || c.email || `#${c.id}`,
              removido: !c.ativo || !!c.removidoEm,
              jornadas,
              total,
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
      const perm = await checkPermission(ctx.user.id, "equipe", "editar");
      if (!perm.allowed || !perm.verTodos || !perm.editar) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Só quem gerencia a equipe pode ajustar o ponto." });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [alvo] = await db
        .select({ id: colaboradores.id })
        .from(colaboradores)
        .where(and(
          eq(colaboradores.id, input.colaboradorId),
          eq(colaboradores.escritorioId, esc.escritorio.id),
        ))
        .limit(1);
      if (!alvo) throw new TRPCError({ code: "NOT_FOUND", message: "Colaborador não encontrado." });

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
});
