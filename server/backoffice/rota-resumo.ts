import { timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { montarResumoBackoffice } from "../../shared/backoffice-contrato";
import { createLogger } from "../_core/logger";

const log = createLogger("backoffice");

/** Quem responde nesta portinha. O Devular responde "devular". */
export const PRODUTO_BACKOFFICE = "juridflow";

/**
 * Chave curta não vale como chave. 32 é o tamanho de um hex de 16 bytes —
 * abaixo disso o valor provavelmente é um placeholder ("mudar", "teste") que
 * alguém colou pra "destravar", e destravar é exatamente o que não pode.
 */
export const TAMANHO_MINIMO_CHAVE = 32;

export type VeredictoChave = "ok" | "servidor_sem_chave" | "chave_invalida";

export function extrairBearer(header: string | undefined): string | null {
  if (!header) return null;
  const casou = /^Bearer[ \t]+(\S.*)$/.exec(header.trim());
  return casou ? casou[1].trim() : null;
}

/**
 * Fail-CLOSED, ao contrário do porteiro de módulos e do HMAC da Meta, que são
 * fail-open de propósito. Aqui a regra se inverte: esta rota é a fronteira
 * entre dois produtos, e configuração ausente NÃO pode virar porta aberta.
 * Sem chave no servidor, ninguém entra — nem quem manda a chave certa.
 */
export function conferirChave(
  recebido: string | undefined,
  esperada: string | undefined,
): VeredictoChave {
  if (!esperada || esperada.length < TAMANHO_MINIMO_CHAVE) return "servidor_sem_chave";

  const oferecida = extrairBearer(recebido);
  if (!oferecida) return "chave_invalida";

  const a = Buffer.from(oferecida, "utf8");
  const b = Buffer.from(esperada, "utf8");
  // timingSafeEqual estoura com tamanhos diferentes. Comparar o tamanho antes
  // vaza só o comprimento da chave, que não é o segredo.
  if (a.length !== b.length) return "chave_invalida";
  return timingSafeEqual(a, b) ? "ok" : "chave_invalida";
}

/**
 * Colunas que a portinha lê de `admin_integracoes`.
 *
 * A tabela guarda `apiKeyEncrypted`/`apiKeyIv`/`apiKeyTag` na mesma linha, e
 * um `select()` sem lista traria os três. A lista é explícita por isso, e há
 * teste conferindo que nenhum nome de campo de segredo aparece na resposta.
 */
async function lerIntegracoes() {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return [];

  const { adminIntegracoes } = await import("../../drizzle/schema");
  return db
    .select({
      provedor: adminIntegracoes.provedor,
      nomeExibicao: adminIntegracoes.nomeExibicao,
      status: adminIntegracoes.status,
      ultimoTeste: adminIntegracoes.ultimoTeste,
    })
    .from(adminIntegracoes);
}

export class BancoIndisponivel extends Error {}

export async function montarResposta() {
  const { getDb, getAdminStats } = await import("../db");

  // Com o banco fora, getAdminStats devolve tudo ZERO em vez de falhar. Servir
  // esses zeros faria o painel anunciar "0 clientes, R$ 0 de MRR" como se
  // fosse notícia — some com a receita na tela sem nada de errado no negócio.
  // Silêncio honesto é melhor que número falso.
  if (!(await getDb())) throw new BancoIndisponivel("banco indisponível");

  const [stats, integracoes] = await Promise.all([getAdminStats(), lerIntegracoes()]);

  return montarResumoBackoffice({
    produto: PRODUTO_BACKOFFICE,
    agora: new Date(),
    stats,
    integracoes,
  });
}

/**
 * Lê a MESMA função que alimenta a tela Clientes do painel admin. Escrever
 * uma consulta própria aqui faria o painel novo e o antigo divergirem no dia
 * em que a regra de "quem é cliente" mudasse num lugar só.
 */
export async function montarContas(pagina: number, busca: string) {
  const { getDb, getAllUsersWithSubscription } = await import("../db");
  if (!(await getDb())) throw new BancoIndisponivel("banco indisponível");

  const { CONTAS_POR_PAGINA, montarListaContas } = await import(
    "../../shared/backoffice-contrato"
  );

  const { itens, total } = await getAllUsersWithSubscription({
    limit: CONTAS_POR_PAGINA,
    offset: (pagina - 1) * CONTAS_POR_PAGINA,
    busca,
    tipo: "cliente",
  });

  return montarListaContas({
    produto: PRODUTO_BACKOFFICE,
    agora: new Date(),
    total,
    pagina,
    linhas: itens,
  });
}

/** Página fora da faixa vira 1: `?pagina=-3` não pode virar OFFSET negativo. */
export function paginaPedida(cru: unknown): number {
  const n = Number(Array.isArray(cru) ? cru[0] : cru);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function buscaPedida(cru: unknown): string {
  const t = Array.isArray(cru) ? cru[0] : cru;
  return typeof t === "string" ? t.slice(0, 120).trim() : "";
}

export function registerBackofficeRoutes(app: Express) {
  app.get("/api/backoffice/resumo", async (req, res) => {
    // Resposta de painel interno nunca é cacheável por intermediário.
    res.setHeader("Cache-Control", "no-store");

    const veredicto = conferirChave(req.headers.authorization, process.env.BACKOFFICE_API_KEY);

    if (veredicto === "servidor_sem_chave") {
      log.warn(
        {},
        "BACKOFFICE_API_KEY ausente ou curta demais — /api/backoffice/resumo recusando tudo",
      );
      res.status(503).json({ erro: "Portinha do backoffice não configurada neste ambiente." });
      return;
    }

    if (veredicto === "chave_invalida") {
      res.status(401).json({ erro: "Chave inválida." });
      return;
    }

    try {
      res.json(await montarResposta());
    } catch (err) {
      if (err instanceof BancoIndisponivel) {
        log.error({}, "Resumo do backoffice pedido com o banco fora");
        res.status(503).json({ erro: "Banco indisponível — nenhum número é confiável agora." });
        return;
      }
      log.error({ err }, "Falha ao montar resumo do backoffice");
      res.status(500).json({ erro: "Não foi possível montar o resumo." });
    }
  });

  app.get("/api/backoffice/contas", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const veredicto = conferirChave(req.headers.authorization, process.env.BACKOFFICE_API_KEY);

    if (veredicto === "servidor_sem_chave") {
      log.warn(
        {},
        "BACKOFFICE_API_KEY ausente ou curta demais — /api/backoffice/contas recusando tudo",
      );
      res.status(503).json({ erro: "Portinha do backoffice não configurada neste ambiente." });
      return;
    }

    if (veredicto === "chave_invalida") {
      res.status(401).json({ erro: "Chave inválida." });
      return;
    }

    try {
      res.json(await montarContas(paginaPedida(req.query.pagina), buscaPedida(req.query.busca)));
    } catch (err) {
      if (err instanceof BancoIndisponivel) {
        log.error({}, "Contas do backoffice pedidas com o banco fora");
        res.status(503).json({ erro: "Banco indisponível — a lista estaria incompleta." });
        return;
      }
      log.error({ err }, "Falha ao montar contas do backoffice");
      res.status(500).json({ erro: "Não foi possível montar a lista." });
    }
  });
}
