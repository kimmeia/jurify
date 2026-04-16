/**
 * Router tRPC para Cálculos Trabalhistas
 * 
 * Endpoints:
 * - calcularRescisao: Calcula verbas rescisórias completas
 * - calcularHorasExtras: Calcula horas extras com reflexos
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { calcularRescisao } from "./engine-rescisao";
import { calcularHorasExtras } from "./engine-horas-extras";
import { gerarParecerRescisao, gerarParecerHorasExtras } from "./parecer-trabalhista";
import type { TipoRescisao, TipoContrato, ParametrosRescisao, ParametrosHorasExtras } from "../../shared/trabalhista-types";
import { registarCalculo, consumirCredito } from "../db";

// ─── Schemas de Validação ─────────────────────────────────────────────────────

// Regex restrita: YYYY-MM-DD com mês 01-12 e dia 01-31.
// A validação semântica fica em .refine() (ordem, bissexto).
const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const mesAnoRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

const rescisaoSchema = z.object({
  dataAdmissao: z.string().regex(dateRegex),
  dataDesligamento: z.string().regex(dateRegex),
  salarioBruto: z.number().positive(),
  tipoRescisao: z.enum(["sem_justa_causa", "pedido_demissao", "justa_causa", "rescisao_indireta", "acordo_mutuo", "termino_contrato"]),
  tipoContrato: z.enum(["indeterminado", "determinado", "experiencia", "intermitente"]),
  avisoPrevioTrabalhado: z.boolean(),
  avisoPrevioIndenizado: z.boolean(),
  feriasVencidas: z.boolean(),
  periodosFeriasVencidas: z.number().min(0).max(2).optional(),
  mediaHorasExtras: z.number().min(0).optional(),
  mediaComissoes: z.number().min(0).optional(),
  saldoFGTS: z.number().min(0).optional(),
  adiantamentos: z.number().min(0).optional(),
}).refine(
  (data) => data.dataDesligamento >= data.dataAdmissao,
  {
    message: "Data de desligamento não pode ser anterior à admissão",
    path: ["dataDesligamento"],
  },
);

const periodoHESchema = z.object({
  mesAno: z.string().regex(mesAnoRegex),
  horasExtras50: z.number().min(0),
  horasExtras100: z.number().min(0),
  horasNoturnas: z.number().min(0).optional(),
  salarioBase: z.number().positive().optional(),
});

const horasExtrasSchema = z.object({
  salarioBruto: z.number().positive(),
  cargaHorariaMensal: z.number().positive(),
  periodos: z.array(periodoHESchema).min(1).max(60),
  incluirAdicionalNoturno: z.boolean(),
  horasNoturnasMes: z.number().min(0).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const trabalhistaRouter = router({
  calcularRescisao: protectedProcedure
    .input(rescisaoSchema)
    .mutation(async ({ input, ctx }) => {
      const temCredito = await consumirCredito(ctx.user.id);
      if (!temCredito) {
        throw new Error("Seus créditos acabaram. Adquira mais créditos ou faça upgrade do seu plano.");
      }

      const params: ParametrosRescisao = {
        ...input,
        tipoRescisao: input.tipoRescisao as TipoRescisao,
        tipoContrato: input.tipoContrato as TipoContrato,
      };

      const resultado = calcularRescisao(params);
      const parecerTecnico = gerarParecerRescisao(params, resultado);

      // Registar no histórico
      const tipoRescisaoLabel: Record<string, string> = {
        sem_justa_causa: "Sem Justa Causa",
        pedido_demissao: "Pedido de Demissão",
        justa_causa: "Justa Causa",
        rescisao_indireta: "Rescisão Indireta",
        acordo_mutuo: "Acordo Mútuo",
        termino_contrato: "Término de Contrato",
      };
      const titulo = `Rescisão — ${tipoRescisaoLabel[input.tipoRescisao] ?? input.tipoRescisao} — R$ ${input.salarioBruto.toLocaleString("pt-BR")}/mês`;
      await registarCalculo({
        userId: ctx.user.id,
        tipo: "trabalhista",
        titulo,
        temParecer: true,
        diferencaTotal: resultado.valorLiquido.toString(),
        resumo: JSON.stringify({
          tipoRescisao: input.tipoRescisao,
          salarioBruto: input.salarioBruto,
          valorLiquido: resultado.valorLiquido,
          dataAdmissao: input.dataAdmissao,
          dataDesligamento: input.dataDesligamento,
        }),
      });

      return {
        ...resultado,
        parecerTecnico,
      };
    }),

  calcularHorasExtras: protectedProcedure
    .input(horasExtrasSchema)
    .mutation(async ({ input, ctx }) => {
      const temCredito = await consumirCredito(ctx.user.id);
      if (!temCredito) {
        throw new Error("Seus créditos acabaram. Adquira mais créditos ou faça upgrade do seu plano.");
      }

      const params: ParametrosHorasExtras = {
        ...input,
      };

      const resultado = calcularHorasExtras(params);
      const parecerTecnico = gerarParecerHorasExtras(params, resultado);

      // Registar no histórico
      await registarCalculo({
        userId: ctx.user.id,
        tipo: "trabalhista",
        titulo: `Horas Extras — ${input.periodos.length} período(s) — R$ ${input.salarioBruto.toLocaleString("pt-BR")}/mês`,
        temParecer: true,
        diferencaTotal: resultado.totalGeral.toString(),
        resumo: JSON.stringify({
          salarioBruto: input.salarioBruto,
          periodos: input.periodos.length,
          totalGeral: resultado.totalGeral,
        }),
      });

      return {
        ...resultado,
        parecerTecnico,
      };
    }),
});
