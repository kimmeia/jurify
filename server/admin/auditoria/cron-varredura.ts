/**
 * Varredura agendada do robô auditor.
 *
 * Roda de hora em hora e reporta no Sentry — que é o que alimenta
 * /admin/erros. Em shadow mode o robô continua sem escrever no banco:
 * este cron só lê e avisa.
 *
 * O problema real de um job assim não é achar, é **cansar**. Nove achados
 * repetidos toda hora viram ruído em dois dias, e ruído que ninguém lê é
 * pior que silêncio — porque dá a impressão de vigilância. Por isso o
 * alerta sai só quando o quadro PIORA: regra que passou a violar, ou que
 * violava e passou a violar mais. Contagem estável fica no log estruturado
 * e não incomoda ninguém.
 *
 * A memória do que já foi avisado é de processo. Reiniciar o servidor
 * re-alerta uma vez, de propósito: é barato, e é o comportamento certo
 * pra quem subiu deploy novo e quer saber o estado atual.
 */

import { createLogger } from "../../_core/logger";
import { captureError } from "../../_core/sentry";
import { varrer } from "./executor";
import { salvarVarredura } from "./historico";
import type { ResultadoVarredura, Severidade } from "./tipos";

const log = createLogger("robo-auditor-cron");

/** Severidades que merecem alerta. As demais ficam só no painel. */
const SEVERIDADES_ALERTA: Severidade[] = ["critico", "alto"];

/** Contagem de linhas por regra na última varredura deste processo. */
let ultimaContagem: Record<string, number> | null = null;

/** Evita duas varreduras concorrentes se uma demorar mais que o intervalo. */
let emAndamento = false;

/**
 * Decide o que alertar comparando com a varredura anterior.
 *
 * Regra: alerta quando a contagem SOBE (inclusive de zero). Queda e
 * estabilidade não alertam — o painel mostra o estado completo, o alerta
 * existe pra avisar de piora.
 */
export function regrasQuePioraram(
  atual: Record<string, number>,
  anterior: Record<string, number> | null,
): string[] {
  return Object.entries(atual)
    .filter(([id, n]) => n > 0 && n > (anterior?.[id] ?? 0))
    .map(([id]) => id)
    .sort();
}

/** Contagem por regra, incluindo as que estão limpas (zero). */
export function contagemPorRegra(resultado: ResultadoVarredura): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const a of resultado.achados) saida[a.regra.id] = a.total;
  return saida;
}

export async function rodarVarreduraAgendada(): Promise<void> {
  if (!process.env.DATABASE_URL) return;

  if (emAndamento) {
    log.warn("Varredura anterior ainda rodando — ciclo pulado");
    return;
  }
  emAndamento = true;

  try {
    const resultado = await varrer();
    const contagem = contagemPorRegra(resultado);
    const pioraram = regrasQuePioraram(contagem, ultimaContagem);

    // Antes de qualquer alerta: o registro no banco é a única saída que não
    // depende de integração externa estar de pé.
    await salvarVarredura(resultado, "cron");

    log.info(
      {
        runId: resultado.runId,
        achados: resultado.resumo.achados,
        linhas: resultado.resumo.linhasAfetadas,
        erros: resultado.resumo.regrasComErro,
        pioraram,
        latenciaMs: resultado.latenciaMs,
      },
      "Varredura agendada concluída",
    );

    for (const achado of resultado.achados) {
      // Regra que falhou ao executar é bug do robô, não do banco — e
      // enquanto ela falha, aquela invariante não está sendo vigiada.
      if (achado.erro) {
        captureError(new Error(`[robô auditor] regra ${achado.regra.id} falhou: ${achado.erro}`), {
          robo_auditor: true,
          regra: achado.regra.id,
          tabela: achado.regra.tabela,
          tipo: "regra_quebrada",
        });
        continue;
      }

      if (!pioraram.includes(achado.regra.id)) continue;
      if (!SEVERIDADES_ALERTA.includes(achado.regra.severidade)) continue;

      captureError(
        new Error(
          `[robô auditor] ${achado.regra.id}: ${achado.regra.titulo} (${achado.total} linha(s))`,
        ),
        {
          robo_auditor: true,
          regra: achado.regra.id,
          severidade: achado.regra.severidade,
          nivel_correcao: achado.regra.nivel,
          tabela: achado.regra.tabela,
          invariante: achado.regra.invariante,
          linhas: achado.total,
          truncado: achado.truncado,
          // Amostra pequena: o painel tem a lista inteira, o alerta só
          // precisa dar tração pra investigação.
          amostra: achado.linhas.slice(0, 5).map((l) => ({
            alvoId: l.alvoId,
            escritorioId: l.escritorioId,
            descricao: l.descricao,
          })),
        },
      );
    }

    ultimaContagem = contagem;
  } catch (err: any) {
    log.error({ err: err?.message ?? String(err) }, "Varredura agendada falhou");
    captureError(err, { robo_auditor: true, tipo: "varredura_falhou" });
  } finally {
    emAndamento = false;
  }
}

/** Só pra teste: zera a memória de alertas entre casos. */
export function _resetarMemoria(): void {
  ultimaContagem = null;
  emAndamento = false;
}
