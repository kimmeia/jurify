/**
 * Adoção de cobranças órfãs do Asaas.
 *
 * Cobrança órfã = `asaas_cobrancas.contatoId IS NULL` mas com
 * `asaasCustomerId` preenchido. Acontece quando uma cobrança é importada
 * (sync histórico ou webhook) e o `customer` do Asaas nunca foi vinculado
 * a um contato local — caso clássico é PIX recebido avulso.
 *
 * O fluxo:
 *  1. Listar customers Asaas únicos que têm cobrança órfã
 *  2. Pra cada um, buscar dados no Asaas (`buscarCliente`)
 *  3. Match por CPF: se já existe contato no CRM com mesmo CPF, vincula;
 *     senão, cria novo contato com `origem='asaas'`
 *  4. Cria entrada em `asaas_clientes` (asaasCustomerId ↔ contatoId)
 *  5. Próximo "Sincronizar Cobranças" passa a achar o contatoId via mapa
 *
 * Originalmente esse código estava inline em `sincronizarClientes`
 * (router-asaas.ts). Extraído pra ser reusado pelo cron de sync histórico
 * (rodar adoção automaticamente ao final do sync).
 *
 * Proteções contra estouro de rate limit:
 *  - THROTTLE_MS=350 entre customers (~170 req/min, abaixo de 200/min real)
 *  - Rate guard do AsaasClient (4 camadas) cobre todas as requests
 *  - 429 aborta a operação graciosamente (não retenta no loop)
 *  - Hard cap MAX_ADOTAR_POR_RUN limita N customers por execução; o que
 *    sobrar fica pra próxima rodada (sync histórico futuro ou clique
 *    manual em "Sincronizar Clientes")
 */

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { asaasClientes, asaasCobrancas, contatos } from "../../drizzle/schema";
import { createLogger } from "../_core/logger";
import type { AsaasClient } from "./asaas-client";
import { inserirVinculoAsaasIdempotente } from "./asaas-sync";

const log = createLogger("asaas-adocao-orfas");

const THROTTLE_MS = 350;

/**
 * Cap por execução: evita rodar 30min seguidos consumindo cota quando
 * o escritório tem muitas órfãs (cenário de primeira importação grande).
 * Sobras ficam pra próxima rodada.
 */
const MAX_ADOTAR_POR_RUN = 200;

export interface AdocaoOrfasResultado {
  /** Contatos novos criados no CRM (origem='asaas'). */
  novosContatos: number;
  /** Contatos pré-existentes (match por CPF) que ganharam vínculo. */
  vinculadosExistentes: number;
  /** Customers Asaas que não puderam ser adotados (deletados, sem nome, 404, etc). */
  customersFalhados: number;
  /** True se a operação parou no meio (429 ou hard cap atingido). */
  parcial: boolean;
  /** Quantos órfãos restam após esta execução (estimativa local). */
  restantesEstimado: number;
}

export async function adotarCobrancasOrfas(
  escritorioId: number,
  client: AsaasClient,
): Promise<AdocaoOrfasResultado> {
  const db = await getDb();
  if (!db) {
    return {
      novosContatos: 0,
      vinculadosExistentes: 0,
      customersFalhados: 0,
      parcial: false,
      restantesEstimado: 0,
    };
  }

  const orfas = await db
    .selectDistinct({ customerId: asaasCobrancas.asaasCustomerId })
    .from(asaasCobrancas)
    .where(
      and(
        eq(asaasCobrancas.escritorioId, escritorioId),
        isNull(asaasCobrancas.contatoId),
      ),
    );

  const customersOrfaos = orfas
    .map((o) => o.customerId)
    .filter((c): c is string => !!c);

  const totalOrfaos = customersOrfaos.length;
  const aProcessar = customersOrfaos.slice(0, MAX_ADOTAR_POR_RUN);
  let novosContatos = 0;
  let vinculadosExistentes = 0;
  let customersFalhados = 0;
  let parcial = totalOrfaos > MAX_ADOTAR_POR_RUN;
  let processados = 0;

  for (let i = 0; i < aProcessar.length; i++) {
    const customerId = aProcessar[i];
    if (i > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS));

    const [jaTem] = await db
      .select({ id: asaasClientes.id })
      .from(asaasClientes)
      .where(
        and(
          eq(asaasClientes.escritorioId, escritorioId),
          eq(asaasClientes.asaasCustomerId, customerId),
        ),
      )
      .limit(1);
    if (jaTem) {
      processados++;
      continue;
    }

    try {
      const cli = await client.buscarCliente(customerId);
      if (cli.deleted || !cli.name?.trim()) {
        customersFalhados++;
        processados++;
        continue;
      }

      const cpfLimpo = cli.cpfCnpj ? cli.cpfCnpj.replace(/\D/g, "") : null;

      let contatoIdAlvo: number | null = null;
      if (cpfLimpo) {
        const [contatoExistente] = await db
          .select({ id: contatos.id })
          .from(contatos)
          .where(
            and(
              eq(contatos.escritorioId, escritorioId),
              eq(contatos.cpfCnpj, cpfLimpo),
            ),
          )
          .limit(1);
        contatoIdAlvo = contatoExistente?.id ?? null;
      }

      if (contatoIdAlvo === null) {
        const [novoContato] = await db
          .insert(contatos)
          .values({
            escritorioId,
            nome: cli.name,
            cpfCnpj: cpfLimpo,
            email: cli.email ?? null,
            telefone: cli.mobilePhone ?? cli.phone ?? null,
            origem: "asaas",
          })
          .$returningId();
        contatoIdAlvo = novoContato.id;
        novosContatos++;
      } else {
        vinculadosExistentes++;
      }

      await inserirVinculoAsaasIdempotente({
        escritorioId,
        contatoId: contatoIdAlvo,
        asaasCustomerId: customerId,
        cpfCnpj: cpfLimpo ?? "",
        nome: cli.name,
      });
      processados++;
    } catch (err: any) {
      const status = err?.response?.status ?? err?.cause?.response?.status;
      if (status === 429) {
        log.warn(
          { escritorioId, processados, restantes: aProcessar.length - i },
          "[adocao-orfas] Rate limit 429 — abortando graciosamente",
        );
        parcial = true;
        break;
      }
      customersFalhados++;
      processados++;
    }
  }

  const restantesEstimado = Math.max(0, totalOrfaos - processados);

  return {
    novosContatos,
    vinculadosExistentes,
    customersFalhados,
    parcial,
    restantesEstimado,
  };
}
