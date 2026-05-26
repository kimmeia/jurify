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
import { configPorSistema } from "../processos/tribunais-pdpj";

const log = createLogger("cron-revalidar-cofre");

/** Idade máxima de uma sessão antes de revalidar (75 min — abaixo dos 90 do PJE). */
const IDADE_MAXIMA_MS = 75 * 60 * 1000;

export async function revalidarCofreCredenciais(
  options: { force?: boolean } = {},
): Promise<{
  total: number;
  revalidadas: number;
  okeis: number;
  erros: number;
  puladas: number;
}> {
  const db = await getDb();
  if (!db) return { total: 0, revalidadas: 0, okeis: 0, erros: 0, puladas: 0 };

  const corte = new Date(Date.now() - IDADE_MAXIMA_MS);

  // Inclui status="erro" E status="expirada" pra recuperação automática:
  // quando o PJe falha temporariamente (instabilidade, timeout) a credencial
  // cai em "erro"; quando a sessão expira durante consulta vai pra "expirada".
  // Sem este OR, o user precisava revalidar manualmente no Cofre, e o
  // monitoramento parava silenciosamente. O cron tenta de novo a cada 60min
  // até voltar (atualizarStatusAposLogin restaura "ativa" no sucesso).
  // Se a senha mudou de fato, a credencial fica em "erro" (warning logado)
  // até intervenção manual — mas reabre tentativa toda hora. Status
  // "removida" continua sendo excluído.
  //
  // BUG histórico (corrigido 22/05/2026): "expirada" estava de fora do filtro.
  // Quando motor-proprio detectava sessão caída marcava "expirada" e o cron
  // nunca mais tocava nela — credencial ficava presa sem revalidação até o
  // user manualmente apertar "Validar".
  //
  // `force: true` ignora o filtro de idade — usado no boot pós-deploy
  // pra garantir que TODAS as sessões PJe TJCE são renovadas, mesmo as
  // validadas há <75min (que podem ter caído durante o downtime do deploy).
  const filtroIdade = options.force
    ? undefined
    : or(
        isNull(cofreCredenciais.ultimoLoginTentativaEm),
        lt(cofreCredenciais.ultimoLoginTentativaEm, corte),
      );

  const filtroStatus = or(
    eq(cofreCredenciais.status, "ativa"),
    eq(cofreCredenciais.status, "validando"),
    eq(cofreCredenciais.status, "erro"),
    eq(cofreCredenciais.status, "expirada"),
  );

  const candidatas = await db
    .select()
    .from(cofreCredenciais)
    .where(filtroIdade ? and(filtroStatus, filtroIdade) : filtroStatus);

  log.info(
    { candidatas: candidatas.length, corte: corte.toISOString(), force: !!options.force },
    "[cron-cofre] iniciando revalidação",
  );

  let revalidadas = 0;
  let okeis = 0;
  let erros = 0;
  let puladas = 0;

  for (const c of candidatas) {
    // Login usa o portal do estado da credencial (config por sistema).
    const cfgTribunal = configPorSistema(c.sistema);
    if (!cfgTribunal) {
      puladas++;
      continue;
    }

    const statusAnterior = c.status;
    try {
      const { buscarCredencialDecriptada, atualizarStatusAposLogin, salvarSessao, notificarCredencialCaiu, notificarCredencialRecuperada } =
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
      const scraper = new PjeTjceScraper(
        {
          username: cred.username,
          password: cred.password,
          totpSecret: cred.totpSecret,
        },
        cfgTribunal,
      );
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

        // Transição "expirada"/"erro" → "ativa" = recuperação automática
        // bem-sucedida. Notifica o user pra fechar o loop (ele viu o
        // alerta de queda e agora vê que voltou sozinho).
        if (statusAnterior === "expirada" || statusAnterior === "erro") {
          await notificarCredencialRecuperada({
            credencialId: c.id,
            userId: c.criadoPor,
            apelido: c.apelido,
            sistema: c.sistema,
          });
        }
      } else if (!resultado.ok) {
        erros++;
        log.warn(
          { credencialId: c.id, escritorioId: c.escritorioId, motivo: resultado.mensagem },
          "[cron-cofre] revalidação falhou — credencial marcada como erro",
        );

        // Transição "ativa"/"validando" → "erro" = credencial acaba de cair
        // (durante o cron, ainda não havia consulta do user). Notifica
        // ANTES que o user tente consultar e veja erro vermelho sem aviso
        // prévio. Em transições "erro"→"erro" não notifica de novo (ruído).
        if (statusAnterior === "ativa" || statusAnterior === "validando") {
          await notificarCredencialCaiu({
            credencialId: c.id,
            userId: c.criadoPor,
            apelido: c.apelido,
            sistema: c.sistema,
            motivo: `${resultado.mensagem}${resultado.detalhes ? ` (${resultado.detalhes})` : ""}`,
            novoStatus: "erro",
          });
        }
      }

      revalidadas++;
    } catch (err: any) {
      erros++;
      const msg = err?.message ?? String(err);
      log.error(
        { credencialId: c.id, err: msg },
        "[cron-cofre] exceção durante revalidação",
      );
      // Exceção técnica (Playwright/Chromium indisponível, timeout, crash do
      // browser) NÃO pode morrer só no log: marca a credencial como caída,
      // grava o motivo em ultimoErro e notifica o dono. Sem isso o
      // monitoramento para em silêncio e ninguém percebe até os processos
      // pararem de atualizar — exatamente o cenário que não pode acontecer.
      try {
        const { marcarCredencialExpirada } = await import("./cofre-helpers");
        await marcarCredencialExpirada(
          c.id,
          `Erro técnico na revalidação automática: ${msg.slice(0, 300)}`,
        );
      } catch (persistErr: any) {
        log.error(
          { credencialId: c.id, err: persistErr?.message ?? String(persistErr) },
          "[cron-cofre] falha ao persistir erro técnico de revalidação",
        );
      }
    }
  }

  log.info(
    { total: candidatas.length, revalidadas, okeis, erros, puladas },
    "[cron-cofre] revalidação finalizada",
  );

  return { total: candidatas.length, revalidadas, okeis, erros, puladas };
}
