/**
 * Router tRPC — Módulo Previdenciário v2
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { simularAposentadoria, calcularRMI, calcularGPSAtraso } from "./engine-previdenciario";
import { gerarParecerSimulacao } from "./parecer-previdenciario";
import { registarCalculo, consumirCredito } from "../db";

const periodoSchema = z.object({
  id: z.string(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  tipoAtividade: z.enum(["URBANA_COMUM", "URBANA_ESPECIAL_25", "URBANA_ESPECIAL_20", "URBANA_ESPECIAL_15", "RURAL", "PROFESSOR"]),
  categoriaVinculo: z.enum(["CLT", "CONTRIBUINTE_INDIVIDUAL", "FACULTATIVO", "MEI", "EMPREGADO_DOMESTICO", "AVULSO", "SEGURADO_ESPECIAL"]),
  descricao: z.string().optional(),
  aindaAtivo: z.boolean().optional(),
});

const simulacaoSchema = z.object({
  sexo: z.enum(["M", "F"]),
  dataNascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodos: z.array(periodoSchema).min(1, "Informe ao menos um período de contribuição"),
  continuaContribuindo: z.boolean().optional(),
});

const rmiSchema = z.object({
  sexo: z.enum(["M", "F"]),
  dataNascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dataAposentadoria: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tempoContribuicaoMeses: z.number().int().min(1),
  salariosContribuicao: z.array(z.number().min(0)),
  regraAplicavel: z.enum(["PONTOS", "IDADE_PROGRESSIVA", "PEDAGIO_50", "IDADE_TRANSICAO", "PEDAGIO_100", "PERMANENTE", "ESPECIAL_TRANSICAO", "ESPECIAL_PERMANENTE", "RURAL", "DIREITO_ADQUIRIDO"]),
  aplicarFatorPrevidenciario: z.boolean().optional(),
});

const gpsSchema = z.object({
  categoria: z.enum(["CONTRIBUINTE_INDIVIDUAL", "FACULTATIVO", "MEI"]),
  plano: z.enum(["NORMAL", "SIMPLIFICADO", "MEI", "BAIXA_RENDA"]),
  salarioContribuicao: z.number().positive(),
  competenciasAtrasadas: z.array(z.string().regex(/^\d{4}-\d{2}$/)),
  jaInscritoNoINSS: z.boolean(),
  primeiraContribuicaoEmDia: z.boolean(),
});

export const previdenciarioRouter = router({
  simular: protectedProcedure
    .input(simulacaoSchema)
    .mutation(async ({ input, ctx }) => {
      const temCredito = await consumirCredito(ctx.user.id);
      if (!temCredito) throw new Error("Créditos esgotados.");

      const resultado = simularAposentadoria({ ...input, continuaContribuindo: input.continuaContribuindo ?? true });
      resultado.parecerTecnico = gerarParecerSimulacao(input, resultado);

      const tcInfo = `${Math.floor(resultado.resumoTC.totalMesesBruto / 12)}a${resultado.resumoTC.totalMesesBruto % 12}m`;
      await registarCalculo({
        userId: ctx.user.id,
        tipo: "previdenciario",
        titulo: `Simulação ${input.sexo === "F" ? "Fem" : "Masc"} — ${tcInfo} — ${input.periodos.length} períodos`,
        protocolo: resultado.protocoloCalculo,
        diferencaTotal: resultado.melhorRegra ? "Elegível" : `${resultado.regrasMaisProximas[0]?.mesesRestantes ?? "?"}m`,
        temParecer: true,
        resumo: JSON.stringify({
          sexo: input.sexo,
          periodos: input.periodos.length,
          tcBruto: resultado.resumoTC.totalMesesBruto,
          tcConvertido: resultado.resumoTC.totalMesesConvertido,
          elegivel: !!resultado.melhorRegra,
          melhorRegra: resultado.melhorRegra?.regra,
        }),
      });

      return resultado;
    }),

  calcularRMI: protectedProcedure
    .input(rmiSchema)
    .mutation(async ({ input, ctx }) => {
      const temCredito = await consumirCredito(ctx.user.id);
      if (!temCredito) throw new Error("Créditos esgotados.");
      const resultado = calcularRMI(input);
      await registarCalculo({
        userId: ctx.user.id, tipo: "previdenciario",
        titulo: `RMI — ${input.regraAplicavel}`, protocolo: `RMI-${Date.now()}`,
        diferencaTotal: resultado.rmiLimitada.toString(), temParecer: false,
        resumo: JSON.stringify({ media: resultado.mediaSalarios, rmi: resultado.rmiLimitada }),
      });
      return resultado;
    }),

  calcularGPS: protectedProcedure
    .input(gpsSchema)
    .mutation(async ({ input, ctx }) => {
      const temCredito = await consumirCredito(ctx.user.id);
      if (!temCredito) throw new Error("Créditos esgotados.");
      const resultado = calcularGPSAtraso(input);
      await registarCalculo({
        userId: ctx.user.id, tipo: "previdenciario",
        titulo: `GPS — ${input.competenciasAtrasadas.length} competências`, protocolo: `GPS-${Date.now()}`,
        diferencaTotal: resultado.totalAPagar.toString(), temParecer: false,
        resumo: JSON.stringify({ total: resultado.totalAPagar, comps: input.competenciasAtrasadas.length }),
      });
      return resultado;
    }),
});
