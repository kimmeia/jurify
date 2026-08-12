/**
 * Executor da varredura do robô auditor.
 *
 * Roda as regras de `regras.ts` em sequência e junta o resultado. Duas
 * decisões que valem explicação:
 *
 *  1. **Sequencial, não paralelo.** A varredura roda contra o banco de
 *     produção enquanto gente está usando o sistema. Nove queries em
 *     paralelo economizam segundos e custam pico de carga — a troca não
 *     compensa para um job que roda de hora em hora.
 *
 *  2. **Falha de regra não derruba a varredura.** Uma regra com SQL
 *     inválido vira um achado com `erro` preenchido e o resto continua.
 *     Em shadow mode isso importa mais do que parece: a regra quebrada
 *     aparece no painel como quebrada, em vez de sumir e passar a
 *     impressão de que a invariante está saudável.
 *
 * Nada aqui escreve no banco.
 */

import { getDb } from "../../db";
import { createLogger } from "../../_core/logger";
import { listarRegras, REGRAS } from "./regras";
import {
  ORDEM_SEVERIDADE,
  type AchadoRegra,
  type Regra,
  type ResultadoVarredura,
  type ResumoVarredura,
  type Severidade,
} from "./tipos";

const log = createLogger("robo-auditor");

/**
 * Teto de linhas por regra. Uma invariante violada em 10 mil linhas não é
 * dado sujo, é bug de código — e listar tudo só entope o painel. O que
 * importa é o `truncado` avisando que tem mais.
 */
export const LIMITE_LINHAS_PADRAO = 50;

export interface OpcoesVarredura {
  /** Roda só estas regras (por id). Vazio/ausente = todas. */
  ids?: string[];
  limiteLinhas?: number;
}

function regrasSelecionadas(ids?: string[]): Regra[] {
  if (!ids || ids.length === 0) return REGRAS;
  const alvo = new Set(ids);
  return REGRAS.filter((r) => alvo.has(r.id));
}

function resumir(achados: AchadoRegra[]): ResumoVarredura {
  const porSeveridade: Record<Severidade, number> = {
    critico: 0,
    alto: 0,
    medio: 0,
    baixo: 0,
  };

  let comErro = 0;
  let comAchado = 0;
  let linhasAfetadas = 0;
  let emShadow = 0;

  for (const a of achados) {
    if (a.erro) comErro++;
    if (a.ok) continue;
    comAchado++;
    linhasAfetadas += a.total;
    porSeveridade[a.regra.severidade]++;
    if (a.regra.shadow) emShadow++;
  }

  return {
    regrasExecutadas: achados.length,
    regrasComErro: comErro,
    achados: comAchado,
    linhasAfetadas,
    porSeveridade,
    emShadow,
  };
}

async function executarRegra(
  regra: Regra,
  db: Awaited<ReturnType<typeof getDb>>,
  limite: number,
): Promise<AchadoRegra> {
  const { detectar: _detectar, ...meta } = regra;
  const inicio = Date.now();

  try {
    const linhas = await regra.detectar(db!, limite);
    return {
      regra: meta,
      ok: linhas.length === 0,
      linhas,
      total: linhas.length,
      truncado: linhas.length >= limite,
      latenciaMs: Date.now() - inicio,
    };
  } catch (err: any) {
    // Regra quebrada é problema do robô, não do banco — precisa aparecer
    // como falha explícita, nunca como invariante saudável.
    const mensagem = err?.message ? String(err.message) : String(err);
    log.error({ regra: regra.id, err: mensagem }, "Regra falhou durante a varredura");
    return {
      regra: meta,
      ok: false,
      linhas: [],
      total: 0,
      truncado: false,
      erro: mensagem,
      latenciaMs: Date.now() - inicio,
    };
  }
}

export async function varrer(opcoes: OpcoesVarredura = {}): Promise<ResultadoVarredura> {
  const iniciadoEm = new Date();
  const inicio = Date.now();
  const limite = opcoes.limiteLinhas ?? LIMITE_LINHAS_PADRAO;
  const runId = `${iniciadoEm.toISOString().replace(/[-:.]/g, "").slice(0, 15)}`;

  const db = await getDb();
  if (!db) {
    throw new Error("Banco indisponível — varredura não executada");
  }

  const achados: AchadoRegra[] = [];
  for (const regra of regrasSelecionadas(opcoes.ids)) {
    achados.push(await executarRegra(regra, db, limite));
  }

  achados.sort(
    (a, b) =>
      Number(a.ok) - Number(b.ok) ||
      ORDEM_SEVERIDADE[a.regra.severidade] - ORDEM_SEVERIDADE[b.regra.severidade] ||
      a.regra.id.localeCompare(b.regra.id),
  );

  const resumo = resumir(achados);
  const latenciaMs = Date.now() - inicio;

  log.info(
    {
      runId,
      regras: resumo.regrasExecutadas,
      achados: resumo.achados,
      linhas: resumo.linhasAfetadas,
      erros: resumo.regrasComErro,
      latenciaMs,
    },
    "Varredura do robô auditor concluída",
  );

  return {
    runId,
    iniciadoEm: iniciadoEm.toISOString(),
    latenciaMs,
    resumo,
    achados,
  };
}

export { listarRegras };
