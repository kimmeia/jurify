/**
 * Cron: revalida credenciais ativas do cofre periodicamente.
 *
 * Por que existe: sessões TJCE expiram após ~90min. Quando o cron de
 * monitoramento (pollMonitoramentosNovasAcoes) tenta consultar usando
 * uma sessão expirada, falha com "PDPJ-cloud redirecionou pra login".
 *
 * Solução: a cada 60 minutos, percorre credenciais com status="ativa"
 * cuja última validação foi há mais de 75 minutos, faz login real e
 * salva storage state novo. Mantém sessão sempre fresca.
 *
 * Idempotente: se status virar "erro" (senha mudou, conta caiu),
 * marca a credencial e o cron de monitoramento para de tentar
 * usá-la até admin re-validar manualmente.
 */

import { eq, and, lt, or, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { cofreCredenciais } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";

const log = createLogger("cron-revalidar-cofre");

/** Idade máxima de uma sessão antes de revalidar (75 min — abaixo dos 90 do PJE). */
const IDADE_MAXIMA_MS = 75 * 60 * 1000;

export async function revalidarCofreCredenciais(): Promise<{
  total: number;
  revalidadas: number;
  okeis: number;
  erros: number;
  puladas: number;
}> {
  const db = await getDb();
  if (!db) return { total: 0, revalidadas: 0, okeis: 0, erros: 0, puladas: 0 };

  const corte = new Date(Date.now() - IDADE_MAXIMA_MS);

  // Inclui status="erro" pra recuperação automática: quando o PJe falha
  // temporariamente (instabilidade, timeout) a credencial cai em "erro"
  // — sem este OR, o user precisava revalidar manualmente no Cofre, e
  // o monitoramento parava silenciosamente. Agora o cron tenta de novo
  // a cada 60min até voltar (atualizarStatusAposLogin restaura "ativa"
  // no sucesso). Se a senha mudou de fato, a credencial fica em "erro"
  // (warning logado) até intervenção manual — mas reabre tentativa
  // toda hora. Status "removida" continua sendo excluído.
  const candidatas = await db
    .select()
    .from(cofreCredenciais)
    .where(
      and(
        or(
          eq(cofreCredenciais.status, "ativa"),
          eq(cofreCredenciais.status, "validando"),
          eq(cofreCredenciais.status, "erro"),
        ),
        or(
          isNull(cofreCredenciais.ultimoLoginTentativaEm),
          lt(cofreCredenciais.ultimoLoginTentativaEm, corte),
        ),
      ),
    );

  log.info({ candidatas: candidatas.length, corte: corte.toISOString() }, "[cron-cofre] iniciando revalidação");

  let revalidadas = 0;
  let okeis = 0;
  let erros = 0;
  let puladas = 0;

  for (const c of candidatas) {
    // Hoje só pje_tjce tem adapter de validação real
    if (c.sistema !== "pje_tjce") {
      puladas++;
      continue;
    }

    try {
      const { buscarCredencialDecriptada, atualizarStatusAposLogin, salvarSessao } =
        await import("./cofre-helpers");
      const cred = await buscarCredencialDecriptada(c.id);
      if (!cred) {
        log.warn({ credencialId: c.id }, "[cron-cofre] credencial não pode ser decriptada");
        erros++;
        continue;
      }

      const { PjeTjceScraper } = await import(
        "../../scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce"
      );
      const scraper = new PjeTjceScraper({
        username: cred.username,
        password: cred.password,
        totpSecret: cred.totpSecret,
      });
      const resultado = await scraper.testarLogin();

      await atualizarStatusAposLogin(c.id, {
        ok: resultado.ok,
        mensagemErro: resultado.ok
          ? null
          : `${resultado.mensagem}${resultado.detalhes ? ` (${resultado.detalhes})` : ""}`,
      });

      if (resultado.ok && resultado.storageStateJson) {
        const expira = new Date(Date.now() + 90 * 60 * 1000);
        await salvarSessao(c.id, resultado.storageStateJson, expira);
        okeis++;
        log.info({ credencialId: c.id, escritorioId: c.escritorioId }, "[cron-cofre] sessão renovada");
      } else if (!resultado.ok) {
        erros++;
        log.warn(
          { credencialId: c.id, escritorioId: c.escritorioId, motivo: resultado.mensagem },
          "[cron-cofre] revalidação falhou — credencial marcada como erro",
        );
      }

      revalidadas++;
    } catch (err: any) {
      erros++;
      log.error(
        { credencialId: c.id, err: err?.message ?? String(err) },
        "[cron-cofre] exceção durante revalidação",
      );
    }
  }

  log.info(
    { total: candidatas.length, revalidadas, okeis, erros, puladas },
    "[cron-cofre] revalidação finalizada",
  );

  return { total: candidatas.length, revalidadas, okeis, erros, puladas };
}
