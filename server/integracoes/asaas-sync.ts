/**
 * Asaas Sync Service — Sincronização automática de cobranças.
 *
 * Funções reutilizáveis para sync de cobranças por escritório.
 * Usadas tanto pelo endpoint manual (protectedProcedure) quanto pelo cron job.
 *
 * Fluxo:
 * 1. Para cada escritório com Asaas conectado
 * 2. Para cada cliente vinculado (asaas_clientes)
 * 3. Puxa cobranças do Asaas (GET /payments?customer=X)
 * 4. Upsert local: cria novas, atualiza status das existentes
 */

import { getDb } from "../db";
import { asaasConfig, asaasClientes, asaasCobrancas, contatos, colaboradores, notificacoes } from "../../drizzle/schema";
import { eq, and, inArray, isNull, ne, or, lt, sql } from "drizzle-orm";
import { decrypt } from "../escritorio/crypto-utils";
import { AsaasClient, type AsaasPayment } from "./asaas-client";
import { mapearFormaPagamento } from "./asaas-forma-pagamento";
import { RateLimitError } from "./asaas-rate-guard";
import { createLogger } from "../_core/logger";
import { isDuplicateEntryError } from "../_core/sql-helpers";
import { inferirAtendentePorCobranca, reconciliarCobrancasOrfas } from "../escritorio/db-financeiro";
import {
  STATUS_PENDENTE_ASAAS,
  STATUS_VENCIDO_ASAAS,
} from "../_core/asaas-status";

/** Extrai a "data de pagamento" mais confiável da cobrança Asaas.
 *
 *  O Asaas usa 3 campos com semânticas distintas:
 *   - `paymentDate`: data em que o dinheiro caiu na conta (status RECEIVED)
 *   - `confirmedDate`: data de confirmação (CONFIRMED — PIX confirmado,
 *      cartão autorizado, boleto registrado) — antes do crédito ser
 *      efetivado em conta
 *   - `clientPaymentDate`: data informada pelo cliente como "quando pagou"
 *      (RECEIVED_IN_CASH = pagamento manual em dinheiro/transferência
 *      registrado fora do Asaas, ou fallback informativo)
 *
 *  Pra exibir "Pago em" no app e calcular comissões, queremos a primeira
 *  data disponível nessa ordem: paymentDate > clientPaymentDate >
 *  confirmedDate. Sem fallback, cobranças CONFIRMED ou RECEIVED_IN_CASH
 *  apareciam com "—" (data nula) e o cálculo de comissão não pegava
 *  esses pagamentos no período.
 */
export function extrairDataPagamento(
  cob: Pick<AsaasPayment, "paymentDate" | "clientPaymentDate" | "confirmedDate">,
): string | null {
  return cob.paymentDate || cob.clientPaymentDate || cob.confirmedDate || null;
}
const log = createLogger("integracoes-asaas-sync");

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getAsaasClientForEscritorio(escritorioId: number): Promise<AsaasClient | null> {
  const db = await getDb();
  if (!db) return null;

  const [cfg] = await db.select().from(asaasConfig)
    .where(and(eq(asaasConfig.escritorioId, escritorioId), eq(asaasConfig.status, "conectado")))
    .limit(1);

  if (!cfg?.apiKeyEncrypted || !cfg?.apiKeyIv || !cfg?.apiKeyTag) return null;

  try {
    const apiKey = decrypt(cfg.apiKeyEncrypted, cfg.apiKeyIv, cfg.apiKeyTag);
    return new AsaasClient(apiKey, cfg.modo as any);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC DE COBRANÇAS POR CLIENTE VINCULADO
// ═══════════════════════════════════════════════════════════════════════════════

export type SyncCobrancasStats = {
  novas: number;        // Cobranças criadas localmente (não existiam)
  atualizadas: number;  // Mudança real de status/data de pagamento
  removidas: number;    // Deletadas localmente (apagadas/órfãs no Asaas)
};

/**
 * Soma duas stats — útil para agregar resultados de múltiplos clientes.
 */
export function somarStats(a: SyncCobrancasStats, b: SyncCobrancasStats): SyncCobrancasStats {
  return {
    novas: a.novas + b.novas,
    atualizadas: a.atualizadas + b.atualizadas,
    removidas: a.removidas + b.removidas,
  };
}

/**
 * Dedup de vínculos por `asaasCustomerId`. A tabela `asaas_clientes` não
 * tem UNIQUE (escritorioId, asaasCustomerId) — duplicatas podem aparecer
 * por bugs históricos no fluxo de vincular contato ou em data imports.
 *
 * Sem dedup o cron de sync chama a API uma vez por linha duplicada,
 * gastando cota do rate guard à toa. Pior: cada iteração faz UPDATE no
 * `contatoId` das cobranças daquele customer, então cobranças oscilam
 * entre contatos a cada cron.
 *
 * Escolha do "melhor" vínculo por customer: o marcado `primario=true`;
 * empate ou ausência → o de menor `id` (estável e determinístico).
 */
export function deduplicarVinculosPorCustomer<T extends {
  id: number;
  asaasCustomerId: string;
  primario?: boolean | null;
}>(vinculos: T[]): T[] {
  const porCustomer = new Map<string, T>();
  for (const v of vinculos) {
    const atual = porCustomer.get(v.asaasCustomerId);
    if (!atual) {
      porCustomer.set(v.asaasCustomerId, v);
      continue;
    }
    // Prefere primario=true; se ambos primários ou ambos não, menor id.
    const atualPrim = atual.primario === true;
    const novoPrim = v.primario === true;
    if (novoPrim && !atualPrim) {
      porCustomer.set(v.asaasCustomerId, v);
    } else if (novoPrim === atualPrim && v.id < atual.id) {
      porCustomer.set(v.asaasCustomerId, v);
    }
  }
  return Array.from(porCustomer.values());
}

/**
 * Insert idempotente em `asaas_clientes` que sobrevive à UNIQUE
 * `(escritorioId, asaasCustomerId)` (migration 0104).
 *
 * Quando duas requests (ex: webhook CUSTOMER_CREATED concorrente + clique
 * de "Sincronizar" na UI) tentam inserir o mesmo customer, a UNIQUE faz
 * o 2º falhar com ER_DUP_ENTRY. Antes dessa proteção, isso virava 500 no
 * webhook ou TRPCError feio na UI. Agora capturamos:
 *
 *   - Vínculo já existe → atualiza só `sincronizadoEm` (preserva
 *     `contatoId`/`primario` do existente, pra não orfanar cobranças
 *     daquele customer apontando pro contatoId antigo).
 *   - Outro erro → propaga (não engole bugs reais).
 *
 * Retorna `true` se inseriu de fato, `false` se vínculo já existia.
 */
export async function inserirVinculoAsaasIdempotente(
  values: typeof asaasClientes.$inferInsert,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(asaasClientes).values(values);
    return true;
  } catch (err: unknown) {
    if (isDuplicateEntryError(err)) {
      // Race benigna: vínculo já existe. Bump sincronizadoEm pra
      // refletir "vi esse customer agora", sem mexer em contatoId/primario.
      await db
        .update(asaasClientes)
        .set({ sincronizadoEm: new Date() })
        .where(and(
          eq(asaasClientes.escritorioId, values.escritorioId),
          eq(asaasClientes.asaasCustomerId, values.asaasCustomerId),
        ));
      return false;
    }
    throw err;
  }
}

/**
 * Sincroniza cobranças de UM cliente vinculado.
 * Retorna contadores discriminados — permite ao caller saber o que mudou de verdade.
 *
 * Por padrão pega apenas os últimos 90 dias pra proteger contra estouro
 * de rate limit do Asaas (200 req/min, bloqueia 12h). Cliente com
 * histórico longo pode ter centenas de cobranças → puxar tudo a cada
 * sincronização vira munição de DoS contra a própria cota. Cobranças
 * mais antigas vêm via cron de sync histórico throttled (5min entre
 * janelas) ou via webhook em tempo real.
 *
 * Passe `diasHistorico: null` pra desabilitar o limite (uso restrito ao
 * cron histórico que já paga sua throttle).
 */
export async function syncCobrancasDeCliente(
  client: AsaasClient,
  escritorioId: number,
  contatoId: number,
  asaasCustomerId: string,
  opts?: {
    diasHistorico?: number | null;
    /**
     * Quando true, o sync NUNCA chama `db.delete(asaasCobrancas)`:
     * ignora `cob.deleted=true` do Asaas e pula o cleanup de órfãs.
     * Pensado pro botão UI "Sincronizar" do popover Financeiro do
     * cliente — operador esperava só leitura/criação, não deleção.
     * Cron de cleanup usa default (false) pra continuar limpando lixo.
     */
    apenasCriarAtualizar?: boolean;
  },
): Promise<SyncCobrancasStats> {
  const db = await getDb();
  const zero: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  if (!db) return zero;

  const diasHistorico =
    opts?.diasHistorico === undefined ? 90 : opts.diasHistorico;
  const apenasCriarAtualizar = opts?.apenasCriarAtualizar ?? false;
  let dateCreatedGe: string | undefined;
  if (diasHistorico !== null) {
    const dt = new Date();
    dt.setUTCDate(dt.getUTCDate() - diasHistorico);
    dateCreatedGe = dt.toISOString().slice(0, 10);
  }

  const stats: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  let offset = 0;
  let hasMore = true;
  let paginas = 0;
  // Cap defensivo contra runaway (bug no Asaas retornando hasMore=true
  // sempre, base inconsistente). 200 páginas × 100 = 20k cobranças por
  // customer — impossível na prática mesmo pra grandes contas.
  const MAX_PAGINAS = 200;
  const idsAsaas = new Set<string>(); // Track all IDs from Asaas

  while (hasMore && paginas < MAX_PAGINAS) {
    paginas++;
    // Quando `dateCreatedGe` está setado, usa o endpoint por janela
    // (suporta filtro de data + customer). Senão, lista tudo (modo
    // histórico — usado pelo cron throttled, não pelo botão UI).
    const res = dateCreatedGe
      ? await client.listarCobrancasPorJanela({
          dateCreatedGe,
          customer: asaasCustomerId,
          limit: 100,
          offset,
        })
      : await client.listarCobrancas({
          customer: asaasCustomerId,
          limit: 100,
          offset,
        });

    for (const cob of res.data) {
      // Defensivo: descarta cobranças de OUTROS customers caso o endpoint
      // ignore o filtro `customer` (ex: variante por janela do Asaas).
      if (cob.customer && cob.customer !== asaasCustomerId) continue;
      // Se deletada no Asaas, remover localmente (a menos que o caller
      // tenha pedido modo "apenas criar/atualizar").
      if (cob.deleted) {
        if (apenasCriarAtualizar) continue;
        const [local] = await db.select({ id: asaasCobrancas.id }).from(asaasCobrancas)
          .where(eq(asaasCobrancas.asaasPaymentId, cob.id)).limit(1);
        if (local) {
          await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, local.id));
          stats.removidas++;
          log.info(`[Asaas Sync] Cobrança ${cob.id} deletada localmente (excluida no Asaas)`);
        }
        continue;
      }

      idsAsaas.add(cob.id);

      const [local] = await db.select().from(asaasCobrancas)
        .where(eq(asaasCobrancas.asaasPaymentId, cob.id)).limit(1);

      if (local) {
        // Normaliza datas de pagamento (API pode retornar "" / undefined; DB guarda null)
        const localDataPag = local.dataPagamento || null;
        const remotaDataPag = extrairDataPagamento(cob);
        const remotaNetValue = cob.netValue?.toString() || null;
        const mudouStatus = local.status !== cob.status;
        const mudouDataPag = localDataPag !== remotaDataPag;
        const mudouNetValue = (local.valorLiquido || null) !== remotaNetValue;
        // Reconcilia vínculo: cobrança pode ter sido criada órfã (via webhook
        // antes do vínculo) ou associada ao contato antigo (quando o primário
        // do Asaas muda). Aqui reatribuímos contatoId/asaasCustomerId ao caller.
        const mudouContato = local.contatoId !== contatoId;
        const mudouCustomer = local.asaasCustomerId !== asaasCustomerId;

        if (mudouStatus || mudouDataPag || mudouNetValue || mudouContato || mudouCustomer) {
          const setObj: Record<string, unknown> = {
            status: cob.status,
            dataPagamento: remotaDataPag,
            valorLiquido: remotaNetValue,
          };
          if (mudouContato) setObj.contatoId = contatoId;
          if (mudouCustomer) setObj.asaasCustomerId = asaasCustomerId;
          await db.update(asaasCobrancas).set(setObj).where(eq(asaasCobrancas.id, local.id));
          stats.atualizadas++;
        }
      } else {
        // Upsert protege contra race com webhook concorrente: entre o SELECT
        // acima e este INSERT, o webhook pode ter criado a mesma linha (a
        // constraint UNIQUE(escritorioId, asaasPaymentId) impede duplicata).
        // Em caso de duplicata já escrita, atualizamos os campos para refletir
        // o snapshot atual do Asaas — é mais recente que o do webhook.
        const atendenteInferido = await inferirAtendentePorCobranca(
          escritorioId,
          cob.externalReference || null,
          contatoId,
        );
        await db
          .insert(asaasCobrancas)
          .values({
            escritorioId,
            contatoId,
            asaasPaymentId: cob.id,
            asaasCustomerId,
            valor: cob.value.toString(),
            valorLiquido: cob.netValue?.toString() || null,
            vencimento: cob.dueDate,
            formaPagamento: mapearFormaPagamento(cob.billingType),
            status: cob.status,
            descricao: cob.description || null,
            invoiceUrl: cob.invoiceUrl,
            bankSlipUrl: cob.bankSlipUrl || null,
            dataPagamento: extrairDataPagamento(cob),
            externalReference: cob.externalReference || null,
            atendenteId: atendenteInferido,
          })
          .onDuplicateKeyUpdate({
            set: {
              contatoId,
              asaasCustomerId,
              status: cob.status,
              valor: cob.value.toString(),
              valorLiquido: cob.netValue?.toString() || null,
              vencimento: cob.dueDate,
              formaPagamento: mapearFormaPagamento(cob.billingType),
              descricao: cob.description || null,
              invoiceUrl: cob.invoiceUrl,
              bankSlipUrl: cob.bankSlipUrl || null,
              dataPagamento: extrairDataPagamento(cob),
            },
          });
        stats.novas++;
      }
    }

    hasMore = res.hasMore;
    offset += res.limit;
  }
  if (hasMore && paginas >= MAX_PAGINAS) {
    log.error(
      { escritorioId, asaasCustomerId, paginas, MAX_PAGINAS, statsParciais: stats },
      "[Asaas Sync] cap de páginas atingido em syncCobrancasDeCliente — sync ficou parcial. Investigue o customer pode ter cobranças anormais ou bug no Asaas.",
    );
  }

  // Remover cobranças locais que não existem mais no Asaas (orfãs).
  // Filtra origem='asaas' — cobranças manuais não devem ser tocadas
  // pelo sync (não passam pela API Asaas).
  const locais = await db.select({ id: asaasCobrancas.id, asaasPaymentId: asaasCobrancas.asaasPaymentId })
    .from(asaasCobrancas)
    .where(and(
      eq(asaasCobrancas.escritorioId, escritorioId),
      eq(asaasCobrancas.asaasCustomerId, asaasCustomerId),
      eq(asaasCobrancas.origem, "asaas"),
    ));

  // Cleanup de órfãs (apagadas no Asaas mas ainda no DB local) só é
  // SEGURO em sync sem filtro de data — senão cobranças antigas FORA
  // da janela seriam falsamente classificadas como órfãs e perdidas.
  // Com `diasHistorico` setado, pulamos esse passo; cobranças apagadas
  // no Asaas viram cob.deleted=true no próximo sync completo (cron
  // histórico) ou via webhook. Também pula quando `apenasCriarAtualizar`.
  if (diasHistorico === null && !apenasCriarAtualizar) {
    for (const local of locais) {
      if (local.asaasPaymentId && !idsAsaas.has(local.asaasPaymentId)) {
        await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, local.id));
        stats.removidas++;
        log.info(`[Asaas Sync] Cobrança órfã ${local.asaasPaymentId} removida (não existe mais no Asaas)`);
      }
    }
  }

  return stats;
}

/**
 * Sincroniza cobranças de TODOS os customers Asaas vinculados a um
 * contato do CRM. Um contato pode ter múltiplos vínculos (duplicatas do
 * Asaas com mesmo CPF) — aqui iteramos sobre todos para consolidar o
 * histórico financeiro num lugar só.
 *
 * `historicoCompleto`: usado pelo PRIMEIRO sync após vincular um contato.
 * Por padrão `syncCobrancasDeCliente` pega só os últimos 90 dias (proteção
 * de rate limit). Mas no momento do vínculo o operador espera ver TODO o
 * histórico de cobranças do cliente no Asaas, não apenas trimestre. Quando
 * true, propaga `diasHistorico: null` pra puxar tudo. Cobranças mais antigas
 * que isso voltariam só por cron histórico (rodando uma vez por dia) — UX
 * ruim ("vincula mas não puxa cobranças").
 */
export async function syncTodasCobrancasDoContato(
  client: AsaasClient,
  escritorioId: number,
  contatoId: number,
  opts?: { apenasCriarAtualizar?: boolean; historicoCompleto?: boolean },
): Promise<SyncCobrancasStats> {
  const db = await getDb();
  const zero: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  if (!db) return zero;

  const vinculos = await db.select({
    asaasCustomerId: asaasClientes.asaasCustomerId,
  }).from(asaasClientes)
    .where(and(
      eq(asaasClientes.contatoId, contatoId),
      eq(asaasClientes.escritorioId, escritorioId),
    ));

  // Adoção bulk: cobranças que entraram no banco sem contatoId (via webhook
  // antes do vínculo) ou apontando para outro contato do mesmo asaasCustomerId
  // são reatribuídas ao contato atual. O sync por-cliente abaixo também
  // reconcilia linha a linha, mas este passo único garante a adoção mesmo
  // quando o pagamento no Asaas não mudou (status/data iguais → o loop
  // interno não disparia UPDATE).
  if (vinculos.length > 0) {
    const customerIds = vinculos.map((v) => v.asaasCustomerId);
    await db
      .update(asaasCobrancas)
      .set({ contatoId })
      .where(
        and(
          eq(asaasCobrancas.escritorioId, escritorioId),
          inArray(asaasCobrancas.asaasCustomerId, customerIds),
          or(isNull(asaasCobrancas.contatoId), ne(asaasCobrancas.contatoId, contatoId)),
        ),
      );

    // Cobranças que ganharam contatoId agora têm "responsavelId do contato"
    // disponível pro inferirAtendente — sem isso, atendenteId fica NULL
    // pra sempre (webhook só seta no insert; UPDATE preserva por design)
    // e some do ranking comercial (filtra inArray atendenteId, que exclui
    // NULL). Caso clássico: PIX recebido avulso → cobrança órfã → vínculo
    // criado depois → Recebido(caixa) do responsável fica zerado.
    try {
      await reconciliarCobrancasOrfas(escritorioId, contatoId);
    } catch (err: any) {
      log.warn(
        { err: err?.message, escritorioId, contatoId },
        "[Asaas Sync] reconciliarCobrancasOrfas falhou após adoção bulk (não bloqueia sync)",
      );
    }
  }

  let totais: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  // Dedup por customerId — mesma razão da `syncCobrancasEscritorio`.
  // Aqui não esperamos duplicatas (já é por-contato), mas defesa
  // barata caso o filtro de vincularContato tenha furo no futuro.
  const customerIdsUnicos = Array.from(new Set(vinculos.map((v) => v.asaasCustomerId)));
  for (const asaasCustomerId of customerIdsUnicos) {
    try {
      const s = await syncCobrancasDeCliente(client, escritorioId, contatoId, asaasCustomerId, {
        apenasCriarAtualizar: opts?.apenasCriarAtualizar,
        diasHistorico: opts?.historicoCompleto ? null : undefined,
      });
      totais = somarStats(totais, s);
    } catch (err: any) {
      // RateLimitError local: aborta a iteração; próximos cairiam no
      // mesmo bloqueio. Caller decide se persiste o erro pra UI.
      if (err instanceof RateLimitError) {
        log.warn(
          { camada: err.camada, waitMs: err.waitMs, contatoId },
          "[Asaas Sync] Rate guard local bloqueou — abortando sync deste contato",
        );
        throw err;
      }
      log.warn(
        { err: err.message, contatoId, asaasCustomerId },
        "[Asaas Sync] Erro ao sincronizar um dos customers vinculados — prossegue com os demais",
      );
    }
  }
  return totais;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC COMPLETO POR ESCRITÓRIO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sincroniza TODAS as cobranças de TODOS os clientes vinculados de um escritório.
 * Retorna contadores discriminados para o caller exibir um toast preciso.
 */
/**
 * Trata vínculo Asaas que retornou 403 em `GET /payments?customer=X`.
 *
 * Antes só desativava cegamente. Agora faz 1 chamada adicional
 * `GET /customers/{id}` pra distinguir 3 cenários:
 *
 *   - 404: customer não existe mais no Asaas → DELETE da row local
 *     (limpa lixo silencioso, sem notif)
 *   - 200: customer existe mas a key não pode ler /payments?customer=X
 *     → mantém desativado + notif com detalhe (provavelmente sub-account
 *     ou scope limitado da key)
 *   - 403 também: key sem acesso geral ao customer → mantém desativado
 *     + notif com mensagem do Asaas (response.data.errors[].description
 *     quando vier)
 *
 * Dedup natural: filtro `ativo=true` em syncCobrancasEscritorio exclui
 * vínculos já desativados — então só roda 1x por vínculo até reativação.
 */
async function desativarVinculoPor403(
  client: AsaasClient,
  escritorioId: number,
  vinculo: typeof asaasClientes.$inferSelect,
  errMensagem: string,
  errData?: unknown,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // Investiga: o customer existe pra essa key?
  type Cenario = "deletado" | "sem_permissao_cobrancas" | "acesso_negado";
  let cenario: Cenario;
  let detalhe: string | null = null;
  try {
    await client.buscarCliente(vinculo.asaasCustomerId);
    // 200: customer existe e a key vê — 403 é específico do endpoint
    // de cobranças (sub-account, scope limitado, etc).
    cenario = "sem_permissao_cobrancas";
    const data = errData as { errors?: { description?: string }[] } | undefined;
    detalhe = data?.errors?.[0]?.description ?? null;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404) {
      cenario = "deletado";
    } else if (status === 403) {
      cenario = "acesso_negado";
      detalhe = err?.response?.data?.errors?.[0]?.description ?? null;
    } else {
      // Outro erro (rede, 5xx) — fallback conservador
      cenario = "sem_permissao_cobrancas";
      detalhe = err?.message ?? null;
    }
  }

  const mensagemFinal = (detalhe ?? errMensagem).slice(0, 255);

  if (cenario === "deletado") {
    // Customer não existe mais → remove a row local. Limpeza
    // silenciosa (sem notif) porque é correção de lixo, não erro
    // que admin precisa tomar ação.
    await db
      .delete(asaasClientes)
      .where(eq(asaasClientes.id, vinculo.id));
    log.warn(
      `[Asaas Sync] Vínculo ${vinculo.asaasCustomerId} REMOVIDO (404 no /customers — customer deletado no Asaas) (escritório ${escritorioId})`,
    );
    return;
  }

  // Sem permissão (sub-account / scope) ou acesso negado geral:
  // mantém vínculo mas inativo, e notifica admin.
  await db
    .update(asaasClientes)
    .set({
      ativo: false,
      ultimoErro403Em: new Date(),
      ultimoErro403Mensagem: mensagemFinal,
    })
    .where(eq(asaasClientes.id, vinculo.id));

  log.warn(
    `[Asaas Sync] Vínculo ${vinculo.asaasCustomerId} desativado: ${cenario} — ${mensagemFinal} (escritório ${escritorioId})`,
  );

  // Notif in-app pra dono+gestores. Mensagem adapta ao cenário pra
  // o admin saber o que verificar no Asaas.
  try {
    const { listarDestinatariosNotificacao } = await import(
      "../_core/cron-comissoes"
    );
    const dests = await listarDestinatariosNotificacao(escritorioId);
    if (dests.length === 0) return;
    const nome = vinculo.nome ?? vinculo.asaasCustomerId;
    const mensagemNotif =
      cenario === "sem_permissao_cobrancas"
        ? `${nome}: customer existe no Asaas mas a API key não pode ler cobranças dele. Pode ser sub-account ou escopo restrito da chave. ${detalhe ? `Detalhe: ${detalhe}.` : ""} Verifique permissão em /admin/integrations e reative quando resolver.`
        : `${nome}: API key sem acesso ao customer (403 geral). ${detalhe ? `Detalhe: ${detalhe}.` : ""} Verifique a chave em /admin/integrations.`;
    await db.insert(notificacoes).values(
      dests.map((userId) => ({
        userId,
        titulo: "Customer Asaas desativado",
        mensagem: mensagemNotif,
        tipo: "sistema" as const,
      })),
    );
  } catch (err: any) {
    log.warn(
      `[Asaas Sync] Falha ao notificar dono+gestores sobre desativação: ${err.message}`,
    );
  }
}

// Função `atualizarCobrancasLocaisDoEscritorio` foi removida: ela fazia
// 1 GET ao Asaas por cobrança local (`buscarCobranca` em loop), gerando
// rajadas de centenas de requests por clique do botão "Sincronizar".
// Substituída pelo pattern `syncCobrancasEscritorio({ diasHistorico: 1 })`
// que usa listagem paginada (~1-2 requests por cliente) e cobre o mesmo
// caso de uso (refresh de status de cobranças recentes).

/**
 * Amarra cobranças órfãs (`contatoId IS NULL`) ao contato dono quando o
 * `asaasCustomerId` já tem vínculo em `asaas_clientes`.
 *
 * Fecha o buraco estrutural: a cobrança pode sincronizar ANTES do cliente
 * estar vinculado ao Asaas → nasce com `contatoId` nulo e o webhook só
 * re-adota no PRÓXIMO evento daquele pagamento (que pode nunca vir). Sem isso,
 * a cobrança fica "órfã" pra sempre no módulo Financeiro mesmo o cliente
 * existindo, e o SmartFlow de cobrança não acha telefone.
 *
 * Idempotente (só toca linhas com `contatoId` nulo). Se o mesmo customer tem
 * mais de um vínculo (a tabela não tem UNIQUE por customer), escolhe de forma
 * determinística: `primario` primeiro, empate pelo menor id.
 */
export async function backfillContatoPorVinculo(escritorioId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const res: any = await db.execute(sql`
    UPDATE asaas_cobrancas c
    SET c.contatoIdAsaasCob = (
      SELECT ac.contatoIdAsaas FROM asaas_clientes ac
      WHERE ac.asaasCustomerId = c.asaasCustomerIdCob
        AND ac.escritorioIdAsaasCli = c.escritorioIdAsaasCob
      ORDER BY ac.primarioAsaasCli DESC, ac.id ASC
      LIMIT 1
    )
    WHERE c.contatoIdAsaasCob IS NULL
      AND c.escritorioIdAsaasCob = ${escritorioId}
      AND EXISTS (
        SELECT 1 FROM asaas_clientes ac2
        WHERE ac2.asaasCustomerId = c.asaasCustomerIdCob
          AND ac2.escritorioIdAsaasCli = c.escritorioIdAsaasCob
      )
  `);
  const n = Number(res?.[0]?.affectedRows ?? res?.affectedRows ?? 0);
  if (n > 0) {
    log.info(`[Asaas Sync] Backfill: ${n} cobrança(s) órfã(s) amarrada(s) ao contato do vínculo (escritório ${escritorioId})`);
  }
  return n;
}

export async function syncCobrancasEscritorio(
  escritorioId: number,
  opts?: {
    /** Override do `diasHistorico` propagado pra cada
     *  `syncCobrancasDeCliente`. Default 90 (compat retroativa pro botão
     *  manual). Cron diário usa 1 — webhook é fonte primária. */
    diasHistorico?: number | null;
    /** Override do throttle entre vínculos. Default 1000ms (rate-safe).
     *  500ms é o "turbo" — só usar quando rate-limit-remaining > 30,
     *  caso contrário a Camada 1 do guard local aborta o tick. */
    delayMs?: number;
  },
): Promise<{ clientes: number } & SyncCobrancasStats> {
  const zero = { clientes: 0, novas: 0, atualizadas: 0, removidas: 0 };
  const client = await getAsaasClientForEscritorio(escritorioId);
  if (!client) return zero;

  const db = await getDb();
  if (!db) return zero;

  // Filtra ativo=true: customers que deram 403 sistemicamente (sem
  // permissão da API key) ficam fora do polling automático. Admin pode
  // reativar manualmente quando resolver permissão no painel Asaas.
  const vinculosRaw = await db.select().from(asaasClientes)
    .where(and(
      eq(asaasClientes.escritorioId, escritorioId),
      eq(asaasClientes.ativo, true),
    ));

  // Dedup por asaasCustomerId: a tabela não tem UNIQUE (escritorioId,
  // asaasCustomerId), então o mesmo customer pode aparecer N vezes (em
  // contatos diferentes ou no mesmo contato via bugs históricos). Sem
  // dedup, o sync chama a API N vezes pro mesmo customer — duplica
  // consumo de cota do rate guard e provoca oscilação de contatoId nas
  // cobranças (cada iteração faz UPDATE pro contatoId daquela row).
  // Preferimos vinculos primario=true e, como tiebreak, o de menor id.
  const vinculos = deduplicarVinculosPorCustomer(vinculosRaw);

  let totais: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };

  // Throttle entre requests: o /payments do Asaas tipicamente tolera
  // ~60 req/min antes de Camada 1 estourar. 200ms (= 300/min) sustentava
  // 5x do limite e disparava o guard local em escritórios com 200+
  // customers — primeiro vínculo passava, depois Camada 1 marcava
  // remaining≤10 e os próximos abortavam o tick (visto em produção em
  // 2026-05-14). 1000ms (= 60/min) deixa o sync abaixo do teto típico
  // e o webhook continua sendo a fonte primária em tempo real.
  // Caller pode reduzir pra 500ms ("turbo") via opts.delayMs quando a
  // janela é curta (sync sob-demanda de 3 dias), assumindo o risco de
  // hit no rate guard em troca de UI responsiva.
  const DELAY_ENTRE_REQUESTS_MS = opts?.delayMs ?? 1_000;

  for (let i = 0; i < vinculos.length; i++) {
    const vinculo = vinculos[i];
    if (i > 0) {
      await new Promise((r) => setTimeout(r, DELAY_ENTRE_REQUESTS_MS));
    }
    try {
      const s = await syncCobrancasDeCliente(
        client,
        escritorioId,
        vinculo.contatoId,
        vinculo.asaasCustomerId,
        opts?.diasHistorico !== undefined
          ? { diasHistorico: opts.diasHistorico }
          : undefined,
      );
      totais = somarStats(totais, s);
    } catch (err: any) {
      const status = err?.response?.status ?? err?.cause?.response?.status;

      // RateLimitError local (Camadas 1/2/4 do guard): NÃO é erro Asaas
      // — é bloqueio preemptivo. Continuar iterando vai disparar a mesma
      // exception em cada vínculo restante, poluindo logs e atrasando o
      // tick à toa. Aborta igual ao 429. Não muda status pra
      // aguardando_validacao porque o guard libera sozinho quando o
      // reset do endpoint chega (Camada 1) ou a janela rola (2/4).
      if (err instanceof RateLimitError) {
        log.warn(
          { camada: err.camada, waitMs: err.waitMs, escritorioId },
          `[Asaas Sync] Rate guard local bloqueou no vínculo ${vinculo.asaasCustomerId} — abortando tick (próximos vínculos cairiam no mesmo bloqueio)`,
        );
        return { clientes: vinculos.length, ...totais };
      }

      // 429: rate limit estourado. Continuar tentando agrava o problema
      // (Asaas pode escalar pra 12h de bloqueio). Aborta o tick desse
      // escritório, marca aguardando_validacao — cron
      // validarConexoesAsaasPendentes (a cada 30min) re-testa e volta
      // pra "conectado" quando passar.
      if (status === 429) {
        log.warn(
          `[Asaas Sync] Rate limit 429 no escritório ${escritorioId} — abortando tick e marcando aguardando_validacao (vínculo ${vinculo.asaasCustomerId} foi onde estourou)`,
        );
        await db
          .update(asaasConfig)
          .set({
            status: "aguardando_validacao",
            ultimoTeste: new Date(),
          })
          .where(eq(asaasConfig.escritorioId, escritorioId));
        return { clientes: vinculos.length, ...totais };
      }

      // 403/404: vínculo "zumbi" — customer não acessível ou deletado no
      // Asaas. Cron iterava infinitamente nessas linhas, queimando ~1
      // request/cron/customer-zumbi até estourar a cota 12h. Soft-disable
      // (ou remoção em caso de deleção) elimina esse desperdício.
      // O helper investiga via GET /customers/{id} adicional e decide:
      //  - 404 confirmado → remove vínculo local
      //  - 200 (existe mas sem permissão de cobrança) → desativa + notif
      //  - 403 geral → desativa + notif
      if (status === 403 || status === 404) {
        const errData = err?.response?.data ?? err?.cause?.response?.data;
        await desativarVinculoPor403(
          client,
          escritorioId,
          vinculo,
          err?.message ?? `HTTP ${status}`,
          errData,
        );
        continue;
      }
      log.warn(`[Asaas Sync] Erro ao sincronizar cobranças de ${vinculo.asaasCustomerId}: ${err.message}`);
    }
  }

  // Atualizar saldo
  try {
    const saldo = await client.obterSaldo();
    await db.update(asaasConfig)
      .set({ saldo: saldo.balance.toString(), ultimoTeste: new Date() })
      .where(eq(asaasConfig.escritorioId, escritorioId));
  } catch {}

  // Amarra órfãs cujo customer já tem vínculo (cobrança que sincronizou antes
  // do cliente ser vinculado). Non-fatal — não derruba o sync se falhar.
  await backfillContatoPorVinculo(escritorioId).catch((err) =>
    log.warn(`[Asaas Sync] Backfill de órfãs falhou (escritório ${escritorioId}): ${err?.message || err}`),
  );

  return { clientes: vinculos.length, ...totais };
}

/**
 * Sweep por VENCIMENTO — passada complementar ao sync por cliente.
 *
 * O sync regular filtra por `dateCreated` nos últimos N dias e perde
 * cobranças antigas que continuam pendentes/vencidas. Esta função pega
 * tudo que vence entre `(hoje - diasParaTras)` e `(hoje + diasParaFrente)`,
 * sem filtro de customer (1 paginação por escritório), e faz upsert
 * resolvendo o vínculo customer→contatoId localmente.
 *
 * Defaults: 180d para trás + 30d para frente — cobre inadimplência crônica
 * típica de escritório jurídico e vencimentos futuros próximos.
 *
 * NÃO deleta órfãs: cobrança que existe local mas sumiu do Asaas fica.
 * Limpeza de fantasmas é do cron mensal de reconciliação (caro: GET por
 * cobrança).
 */
export async function syncCobrancasPorVencimentoEscritorio(
  escritorioId: number,
  opts?: {
    diasParaTras?: number;
    diasParaFrente?: number;
  },
): Promise<SyncCobrancasStats> {
  const zero: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  const client = await getAsaasClientForEscritorio(escritorioId);
  if (!client) return zero;

  const db = await getDb();
  if (!db) return zero;

  const diasParaTras = opts?.diasParaTras ?? 180;
  const diasParaFrente = opts?.diasParaFrente ?? 30;
  const hoje = new Date();
  const ge = new Date(hoje);
  ge.setUTCDate(ge.getUTCDate() - diasParaTras);
  const le = new Date(hoje);
  le.setUTCDate(le.getUTCDate() + diasParaFrente);
  const dueDateGe = ge.toISOString().slice(0, 10);
  const dueDateLe = le.toISOString().slice(0, 10);

  // Carrega vínculos customerId→contatoId localmente — uma query, não
  // 100 GETs no Asaas. Cobranças com customerId fora do mapa entram
  // como órfãs (contatoId=null) e aparecem na tela de órfãs do app.
  const vinculos = await db
    .select({
      asaasCustomerId: asaasClientes.asaasCustomerId,
      contatoId: asaasClientes.contatoId,
      primario: asaasClientes.primario,
    })
    .from(asaasClientes)
    .where(and(
      eq(asaasClientes.escritorioId, escritorioId),
      eq(asaasClientes.ativo, true),
    ));
  const vinculosDedup = deduplicarVinculosPorCustomer(
    vinculos.map((v, idx) => ({ ...v, id: idx })),
  );
  const customerToContato = new Map<string, number>();
  for (const v of vinculosDedup) {
    customerToContato.set(v.asaasCustomerId, v.contatoId);
  }

  const stats: SyncCobrancasStats = { novas: 0, atualizadas: 0, removidas: 0 };
  let offset = 0;
  let hasMore = true;
  let paginas = 0;
  // Cap defensivo: 500 páginas × 100 = 50k cobranças por sweep. Escritório
  // com mais que isso em 180+30 dias é absurdo — provavelmente bug.
  const MAX_PAGINAS = 500;

  while (hasMore && paginas < MAX_PAGINAS) {
    paginas++;
    let res;
    try {
      res = await client.listarCobrancasPorJanela({
        dueDateGe,
        dueDateLe,
        limit: 100,
        offset,
      });
    } catch (err: any) {
      const status = err?.response?.status ?? err?.cause?.response?.status;
      if (err instanceof RateLimitError || status === 429) {
        log.warn(
          { escritorioId, offset, dueDateGe, dueDateLe },
          "[Asaas Sync Vencimento] Rate limit — abortando sweep parcial",
        );
        return stats;
      }
      log.warn(
        { escritorioId, err: err?.message },
        "[Asaas Sync Vencimento] Erro inesperado — abortando sweep",
      );
      return stats;
    }

    for (const cob of res.data) {
      if (cob.deleted) continue;
      const contatoId = customerToContato.get(cob.customer) ?? null;

      const [local] = await db
        .select()
        .from(asaasCobrancas)
        .where(and(
          eq(asaasCobrancas.escritorioId, escritorioId),
          eq(asaasCobrancas.asaasPaymentId, cob.id),
        ))
        .limit(1);

      if (local) {
        const localDataPag = local.dataPagamento || null;
        const remotaDataPag = extrairDataPagamento(cob);
        const remotaNetValue = cob.netValue?.toString() || null;
        const mudouStatus = local.status !== cob.status;
        const mudouDataPag = localDataPag !== remotaDataPag;
        const mudouNetValue = (local.valorLiquido || null) !== remotaNetValue;
        const mudouContato = contatoId !== null && local.contatoId !== contatoId;

        if (mudouStatus || mudouDataPag || mudouNetValue || mudouContato) {
          const setObj: Record<string, unknown> = {
            status: cob.status,
            dataPagamento: remotaDataPag,
            valorLiquido: remotaNetValue,
          };
          if (mudouContato) setObj.contatoId = contatoId;
          await db.update(asaasCobrancas).set(setObj).where(eq(asaasCobrancas.id, local.id));
          stats.atualizadas++;
        }
      } else {
        const atendenteInferido = contatoId
          ? await inferirAtendentePorCobranca(escritorioId, cob.externalReference || null, contatoId)
          : null;
        try {
          await db
            .insert(asaasCobrancas)
            .values({
              escritorioId,
              contatoId,
              asaasPaymentId: cob.id,
              asaasCustomerId: cob.customer,
              valor: cob.value.toString(),
              valorLiquido: cob.netValue?.toString() || null,
              vencimento: cob.dueDate,
              formaPagamento: mapearFormaPagamento(cob.billingType),
              status: cob.status,
              descricao: cob.description || null,
              invoiceUrl: cob.invoiceUrl,
              bankSlipUrl: cob.bankSlipUrl || null,
              dataPagamento: extrairDataPagamento(cob),
              externalReference: cob.externalReference || null,
              atendenteId: atendenteInferido,
            })
            .onDuplicateKeyUpdate({
              set: {
                status: cob.status,
                valor: cob.value.toString(),
                valorLiquido: cob.netValue?.toString() || null,
                vencimento: cob.dueDate,
                formaPagamento: mapearFormaPagamento(cob.billingType),
                descricao: cob.description || null,
                invoiceUrl: cob.invoiceUrl,
                bankSlipUrl: cob.bankSlipUrl || null,
                dataPagamento: extrairDataPagamento(cob),
              },
            });
          stats.novas++;
        } catch (err) {
          if (isDuplicateEntryError(err)) continue;
          throw err;
        }
      }
    }

    hasMore = res.hasMore;
    offset += res.limit;
  }
  if (hasMore && paginas >= MAX_PAGINAS) {
    log.error(
      { escritorioId, dueDateGe, dueDateLe, paginas, MAX_PAGINAS, statsParciais: stats },
      "[Asaas Sync Vencimento] cap de páginas atingido — sweep ficou parcial.",
    );
  }

  log.info(
    { escritorioId, dueDateGe, dueDateLe, ...stats },
    "[Asaas Sync Vencimento] sweep concluído",
  );
  return stats;
}

/**
 * Reconcilia cobranças "fantasmas": locais com status PENDING/OVERDUE
 * (status pendentes/vencidos do Asaas) que foram apagadas no Asaas e o
 * webhook PAYMENT_DELETED não chegou — race condition, downtime curto
 * do webhook ou conta sem webhook configurado.
 *
 * Estratégia (segura por design):
 *  1. Lista TUDO do Asaas no range generoso (5 anos retro + 1 ano futuro)
 *  2. Constrói Set de IDs visíveis
 *  3. Lista locais PENDING/OVERDUE de origem=asaas
 *  4. Deleta apenas os que não aparecem no Set
 *
 * Aborta em qualquer erro no passo 1 — Set incompleto produziria falsos
 * positivos massivos. NÃO mexe em cobranças pagas (RECEIVED/CONFIRMED) —
 * essas não vão sumir do Asaas, e se sumissem o operador precisaria
 * decidir manualmente o que fazer (auditoria).
 *
 * Cobranças com `origem != 'asaas'` (criadas manualmente no JuridFlow) são
 * intocadas: nunca passaram pela API do Asaas, então não estão no Set
 * e seriam falsamente classificadas como fantasmas.
 */
export async function reconciliarCobrancasFantasmasEscritorio(
  escritorioId: number,
): Promise<{ ok: boolean; verificadas: number; fantasmas: number; motivo?: string }> {
  const client = await getAsaasClientForEscritorio(escritorioId);
  if (!client) return { ok: false, verificadas: 0, fantasmas: 0, motivo: "sem credenciais" };

  const db = await getDb();
  if (!db) return { ok: false, verificadas: 0, fantasmas: 0, motivo: "db indisponível" };

  const hoje = new Date();
  const ge = new Date(hoje);
  ge.setUTCDate(ge.getUTCDate() - 365 * 5);
  const le = new Date(hoje);
  le.setUTCDate(le.getUTCDate() + 365);
  const dueDateGe = ge.toISOString().slice(0, 10);
  const dueDateLe = le.toISOString().slice(0, 10);

  const idsAsaas = new Set<string>();
  let offset = 0;
  let hasMore = true;
  let paginas = 0;
  // 5 anos retro + 1 ano frente = base inteira do escritório. 1000 × 100
  // = 100k cobranças — cobre até as maiores contas Asaas conhecidas.
  const MAX_PAGINAS = 1000;
  while (hasMore && paginas < MAX_PAGINAS) {
    paginas++;
    let res;
    try {
      res = await client.listarCobrancasPorJanela({
        dueDateGe,
        dueDateLe,
        limit: 100,
        offset,
      });
    } catch (err: any) {
      const status = err?.response?.status ?? err?.cause?.response?.status;
      const motivo = status === 429 || err instanceof RateLimitError
        ? "rate limit durante sweep — aborta"
        : `erro durante sweep: ${err?.message ?? "desconhecido"}`;
      log.warn({ escritorioId, motivo }, "[Asaas Reconciliação] sweep abortado");
      return { ok: false, verificadas: 0, fantasmas: 0, motivo };
    }
    for (const c of res.data) {
      if (!c.deleted) idsAsaas.add(c.id);
    }
    hasMore = res.hasMore;
    offset += res.limit;
  }
  if (hasMore && paginas >= MAX_PAGINAS) {
    log.error(
      { escritorioId, paginas, MAX_PAGINAS, idsAsaasCount: idsAsaas.size },
      "[Asaas Reconciliação] cap de páginas atingido — Set incompleto, abortando reconciliação pra não gerar falsos positivos.",
    );
    return { ok: false, verificadas: 0, fantasmas: 0, motivo: "Set incompleto (cap atingido)" };
  }

  const candidatos = await db
    .select({
      id: asaasCobrancas.id,
      asaasPaymentId: asaasCobrancas.asaasPaymentId,
    })
    .from(asaasCobrancas)
    .where(and(
      eq(asaasCobrancas.escritorioId, escritorioId),
      eq(asaasCobrancas.origem, "asaas"),
      inArray(
        asaasCobrancas.status,
        [...STATUS_PENDENTE_ASAAS, ...STATUS_VENCIDO_ASAAS] as unknown as string[],
      ),
    ));

  let fantasmas = 0;
  for (const c of candidatos) {
    if (c.asaasPaymentId && !idsAsaas.has(c.asaasPaymentId)) {
      await db.delete(asaasCobrancas).where(eq(asaasCobrancas.id, c.id));
      fantasmas++;
    }
  }

  log.info(
    { escritorioId, verificadas: candidatos.length, fantasmas, idsAsaasCount: idsAsaas.size },
    "[Asaas Reconciliação] concluída",
  );
  return { ok: true, verificadas: candidatos.length, fantasmas };
}

/**
 * Orquestrador da reconciliação SEMANAL — itera escritórios conectados e
 * roda `reconciliarCobrancasFantasmasEscritorio` em cada um onde já
 * passaram 7 dias desde a última rodada (ou nunca rodou).
 *
 * Antes era mensal (30d). Subiu pra semanal porque fantasma 30d divergia
 * demais com o painel Asaas — caso típico: cobrança deletada no Asaas
 * dia 1 só era apagada no JuridFlow dia 31. Painel financeiro mostrava
 * "a receber" estagnado por um mês.
 *
 * Roda só 1 escritório por chamada — distribui custo no tempo. Cron
 * diário chama essa função; com 7+ escritórios, todos rodam dentro da
 * semana.
 */
export async function executarReconciliacaoFantasmasJob(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const seteDiasAtras = new Date();
  seteDiasAtras.setUTCDate(seteDiasAtras.getUTCDate() - 7);

  const candidatos = await db
    .select({
      escritorioId: asaasConfig.escritorioId,
      ultima: asaasConfig.ultimaReconciliacaoFantasmasEm,
    })
    .from(asaasConfig)
    .where(and(
      eq(asaasConfig.status, "conectado"),
      or(
        isNull(asaasConfig.ultimaReconciliacaoFantasmasEm),
        lt(asaasConfig.ultimaReconciliacaoFantasmasEm, seteDiasAtras),
      ),
    ));

  if (candidatos.length === 0) return;

  // Roda 1 escritório por tick pra distribuir custo no tempo.
  // Prioriza quem nunca rodou (NULL).
  candidatos.sort((a, b) => {
    if (a.ultima === null && b.ultima !== null) return -1;
    if (a.ultima !== null && b.ultima === null) return 1;
    if (a.ultima === null && b.ultima === null) return 0;
    return (a.ultima!.getTime() ?? 0) - (b.ultima!.getTime() ?? 0);
  });

  const escolhido = candidatos[0];
  try {
    const r = await reconciliarCobrancasFantasmasEscritorio(escolhido.escritorioId);
    if (r.ok) {
      await db
        .update(asaasConfig)
        .set({ ultimaReconciliacaoFantasmasEm: new Date() })
        .where(eq(asaasConfig.escritorioId, escolhido.escritorioId));
      if (r.fantasmas > 0) {
        log.info(
          { escritorioId: escolhido.escritorioId, ...r },
          `[Asaas Reconciliação] Escritório ${escolhido.escritorioId}: ${r.fantasmas} fantasmas removidos de ${r.verificadas} verificadas`,
        );
      }
    } else {
      log.warn(
        { escritorioId: escolhido.escritorioId, ...r },
        "[Asaas Reconciliação] sweep parcial — tenta de novo no próximo tick",
      );
    }
  } catch (err: any) {
    log.error(
      { escritorioId: escolhido.escritorioId, err: err?.message },
      "[Asaas Reconciliação] falha inesperada",
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGREGAÇÃO N:1 — vários asaas_clientes por contato do CRM
// ═══════════════════════════════════════════════════════════════════════════════

export type VinculoLinha = {
  id: number;
  contatoId: number;
  asaasCustomerId: string;
  cpfCnpj: string | null;
  nome: string | null;
  primario: boolean | null;
};

export type CobrancaAgg = {
  asaasCustomerId: string;
  valor: string;
  status: string;
  vencimento: string | null;
};

export type ContatoMeta = {
  nome: string;
  telefone: string | null;
  email: string | null;
};

export type ClienteAgregado = {
  /** ID do vínculo primário (compatibilidade com o frontend que usa como key). */
  id: number;
  contatoId: number;
  /** Todos os asaasCustomerIds vinculados a este contato (N:1 do Asaas). */
  asaasCustomerIds: string[];
  /** ID do primário — usado pelo frontend e para criar novas cobranças. */
  asaasCustomerId: string;
  cpfCnpj: string;
  nome: string;
  contatoNome: string;
  contatoTelefone: string | null;
  contatoEmail: string | null;
  totalCobrancas: number;
  pendente: number;
  vencido: number;
  pago: number;
  /** Maior atraso (em dias) entre as cobranças vencidas em aberto.
   *  null quando o cliente não tem nada vencido. */
  diasAtrasoMax: number | null;
};

/**
 * Agrupa múltiplos vínculos do mesmo contato em UM item. O Asaas permite
 * cadastros duplicados com o mesmo CPF (ids diferentes) e o CRM referência
 * todos como secundários. A tela de Clientes agrega tudo sob o contato do
 * CRM; as cobranças de cada customer secundário entram no agregado.
 *
 * Escolha do "primário" na saída (para usar como id na UI e como alvo
 * padrão ao criar cobranças): o marcado com `primario=true` se houver;
 * caso contrário, o vínculo mais antigo (menor id) por estabilidade.
 */
export function agregarVinculosPorContato(
  vinculos: VinculoLinha[],
  cobrancas: CobrancaAgg[],
  contatosMeta: Record<number, ContatoMeta>,
): ClienteAgregado[] {
  const porContato = new Map<number, VinculoLinha[]>();
  for (const v of vinculos) {
    const arr = porContato.get(v.contatoId);
    if (arr) arr.push(v);
    else porContato.set(v.contatoId, [v]);
  }

  const result: ClienteAgregado[] = [];
  for (const [contatoId, vs] of porContato) {
    const primario =
      vs.find((v) => v.primario === true) ??
      vs.slice().sort((a, b) => a.id - b.id)[0];
    const asaasCustomerIds = vs.map((v) => v.asaasCustomerId);
    const setIds = new Set(asaasCustomerIds);

    let pendente = 0;
    let vencido = 0;
    let pago = 0;
    let total = 0;
    // "Dias em atraso" = maior diferença em dias entre hoje e o vencimento das
    // cobranças em aberto que já passaram. Considera OVERDUE explícito + PENDING
    // com vencimento < hoje (Asaas demora pra mover pra OVERDUE em alguns casos).
    const hojeMs = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    let diasAtrasoMax: number | null = null;
    for (const c of cobrancas) {
      if (!setIds.has(c.asaasCustomerId)) continue;
      total++;
      const val = parseFloat(c.valor) || 0;
      if (c.status === "PENDING") pendente += val;
      else if (c.status === "OVERDUE") vencido += val;
      else if (c.status === "RECEIVED" || c.status === "CONFIRMED" || c.status === "RECEIVED_IN_CASH") pago += val;

      // Atraso: olha vencimento de OVERDUE OR (PENDING com venc < hoje)
      if (c.vencimento && (c.status === "OVERDUE" || c.status === "PENDING")) {
        const partes = c.vencimento.split("-");
        if (partes.length === 3) {
          const vencMs = Date.UTC(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
          const dias = Math.floor((hojeMs - vencMs) / 86_400_000);
          if (dias > 0) {
            diasAtrasoMax = diasAtrasoMax == null ? dias : Math.max(diasAtrasoMax, dias);
          }
        }
      }
    }

    const meta = contatosMeta[contatoId];
    const nomeResolvido = primario.nome ?? "";
    result.push({
      id: primario.id,
      contatoId,
      asaasCustomerIds,
      asaasCustomerId: primario.asaasCustomerId,
      cpfCnpj: primario.cpfCnpj || "",
      nome: nomeResolvido,
      contatoNome: meta?.nome ?? nomeResolvido,
      contatoTelefone: meta?.telefone ?? null,
      contatoEmail: meta?.email ?? null,
      totalCobrancas: total,
      pendente,
      vencido,
      pago,
      diasAtrasoMax,
    });
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC DE TODOS OS ESCRITÓRIOS (chamado pelo cron)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sincroniza cobranças de TODOS os escritórios conectados ao Asaas.
 * Chamado pelo cron job a cada 10 minutos.
 */
/**
 * Cron: re-tenta validar configs Asaas em estado "aguardando_validacao".
 *
 * Quando user conecta Asaas e a API retorna 429 (rate limit 12h),
 * salvamos a key como "aguardando_validacao". Esta função roda a cada
 * 30min e retesta. Se passar, vira "conectado". Se ainda 429, mantém
 * pendente. Se outro erro (chave inválida etc), vira "erro".
 *
 * Faz no máximo 1 request por config — não faz pool agressivo. 6 escritórios
 * pendentes = 6 requests em 30min, longe do limite Asaas.
 */
export async function validarConexoesAsaasPendentes(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const pendentes = await db.select()
    .from(asaasConfig)
    .where(eq(asaasConfig.status, "aguardando_validacao"));

  if (pendentes.length === 0) return;

  log.info(`[Asaas Validação] Retentando ${pendentes.length} config(s) em rate limit...`);

  const { AsaasClient } = await import("./asaas-client");
  const { decrypt } = await import("../escritorio/crypto-utils");

  for (const cfg of pendentes) {
    if (!cfg.apiKeyEncrypted) continue;
    let apiKey: string;
    try {
      apiKey = decrypt(cfg.apiKeyEncrypted, cfg.apiKeyIv ?? "", cfg.apiKeyTag ?? "");
    } catch {
      log.warn(`[Asaas Validação] Escritório ${cfg.escritorioId}: falha ao descriptografar`);
      continue;
    }

    const client = new AsaasClient(apiKey);
    const teste = await client.testarConexao();

    const haystack = `${teste.mensagem} ${teste.detalhes ?? ""}`;
    const isRateLimit =
      !teste.ok &&
      /HTTP 429|rate.?limit|cota.*(?:requisi[çc][õo]es|12h|pr[óo]xima)/i.test(haystack);

    if (teste.ok) {
      await db.update(asaasConfig).set({
        status: "conectado",
        ultimoTeste: new Date(),
        mensagemErro: null,
        saldo: teste.saldo?.toString() || null,
      }).where(eq(asaasConfig.id, cfg.id));
      log.info(`[Asaas Validação] Escritório ${cfg.escritorioId}: validado, agora "conectado"`);
    } else if (isRateLimit) {
      await db.update(asaasConfig).set({
        ultimoTeste: new Date(),
        mensagemErro: "rate_limit_429: ainda bloqueado, retentando em 30min",
      }).where(eq(asaasConfig.id, cfg.id));
      // mantém status="aguardando_validacao"
    } else {
      // 401 etc — chave realmente inválida agora
      await db.update(asaasConfig).set({
        status: "erro",
        ultimoTeste: new Date(),
        mensagemErro: teste.mensagem + (teste.detalhes ? ` (${teste.detalhes})` : ""),
      }).where(eq(asaasConfig.id, cfg.id));
      log.warn(`[Asaas Validação] Escritório ${cfg.escritorioId}: erro real → ${teste.mensagem}`);
    }
  }
}

export async function syncTodosEscritorios(opts?: {
  /** Janela de história a sincronizar pra cada cliente vinculado.
   *  Default 90 (preserva compat com chamadas manuais). Cron diário
   *  usa 1 — webhook cobre eventos em tempo real, esta job só pega o
   *  catch-up de 0.5% que o webhook perdeu. */
  diasHistorico?: number | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const escritorios = await db.select({ escritorioId: asaasConfig.escritorioId })
    .from(asaasConfig)
    .where(eq(asaasConfig.status, "conectado"));

  if (escritorios.length === 0) return;

  log.info(`[Asaas Sync] Iniciando sync de ${escritorios.length} escritório(s)...`);

  for (const { escritorioId } of escritorios) {
    try {
      const result = await syncCobrancasEscritorio(escritorioId, opts);
      const total = result.novas + result.atualizadas + result.removidas;
      if (total > 0) {
        log.info(
          `[Asaas Sync] Escritório ${escritorioId}: ${result.novas} novas, ${result.atualizadas} atualizadas, ${result.removidas} removidas`,
        );
      }

      const sweep = await syncCobrancasPorVencimentoEscritorio(escritorioId);
      const sweepTotal = sweep.novas + sweep.atualizadas;
      if (sweepTotal > 0) {
        log.info(
          `[Asaas Sync Vencimento] Escritório ${escritorioId}: ${sweep.novas} novas, ${sweep.atualizadas} atualizadas (sweep 180d retro + 30d futuro)`,
        );
      }
    } catch (err: any) {
      log.warn(`[Asaas Sync] Erro no escritório ${escritorioId}: ${err.message}`);
    }
  }
}
