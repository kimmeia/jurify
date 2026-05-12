/**
 * `seedTestEscritorio(runId)` — cria um escritório isolado pra um teste
 * E2E rodar sem disputar estado com outros testes.
 *
 * Cada chamada cria: 1 escritório, 5 users (1 por cargo legado), 5
 * colaboradores, 1 subscription ativa pro dono, 5 contatos (prefixados
 * com `[E2E]` pra teardown). Tudo o que for criado leva o `runId` no
 * nome/email pra facilitar limpeza posterior.
 *
 * `teardownTestEscritorio(runId)` desfaz na ordem inversa de FK lógica.
 * `teardownStaleTestEscritorios(maxAgeMs)` é o varredor de zumbis pra
 * runs interrompidos — chamar no globalTeardown do Playwright.
 */

import { and, eq, like, lt } from "drizzle-orm";
import { getDb } from "../../../server/db";
import { hashPassword } from "../../../server/_core/password";
import {
  colaboradores,
  contatos,
  escritorios,
  subscriptions,
  users,
} from "../../../drizzle/schema";
import {
  TEST_CARGOS,
  type TestEscritorio,
  type TestRole,
  type TestUser,
} from "./types";

export const TEST_PASSWORD = "Smoke123!";

const ESCRITORIO_PREFIX = "test-runner-";

function emailFor(runId: string, cargo: TestRole): string {
  return `${cargo}-${runId}@jurify.test`;
}

function openIdFor(email: string): string {
  return `email-${Buffer.from(email.trim().toLowerCase()).toString("base64url")}`;
}

function genRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function seedTestEscritorio(
  runId: string = genRunId(),
): Promise<TestEscritorio> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível pra seed.");

  const passwordHash = await hashPassword(TEST_PASSWORD);

  const created: Partial<Record<TestRole, TestUser>> = {};
  for (const cargo of TEST_CARGOS) {
    const email = emailFor(runId, cargo);
    const name = `${cargo[0]!.toUpperCase()}${cargo.slice(1)} ${runId}`;
    const [insertion] = await db.insert(users).values({
      openId: openIdFor(email),
      name,
      email,
      passwordHash,
      loginMethod: "email",
      role: "user",
    });
    const id = (insertion as { insertId: number }).insertId;
    created[cargo] = { id, email, name, cargo };
  }

  const dono = created.dono!;

  const escritorioNome = `${ESCRITORIO_PREFIX}${runId}`;
  const [escritorioInsert] = await db.insert(escritorios).values({
    nome: escritorioNome,
    email: `escritorio-${runId}@jurify.test`,
    ownerId: dono.id,
    maxColaboradores: 10,
  });
  const escritorioId = (escritorioInsert as { insertId: number }).insertId;

  for (const cargo of TEST_CARGOS) {
    const user = created[cargo]!;
    await db.insert(colaboradores).values({
      escritorioId,
      userId: user.id,
      cargo,
      ativo: true,
    });
  }

  await db.insert(subscriptions).values({
    userId: dono.id,
    planId: "test-plan",
    status: "active",
    currentPeriodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
    creditsLimit: 99999,
    creditsUsed: 0,
  });

  const clientesData = [
    { nome: `[E2E] João ${runId}`, telefone: "(11) 91111-0001", email: `joao-${runId}@jurify.test` },
    { nome: `[E2E] Maria ${runId}`, telefone: "(11) 92222-0002", email: `maria-${runId}@jurify.test` },
    { nome: `[E2E] Pedro ${runId}`, telefone: "(11) 93333-0003", email: `pedro-${runId}@jurify.test` },
    { nome: `[E2E] Ana ${runId}`, telefone: "(11) 94444-0004", email: `ana-${runId}@jurify.test` },
    { nome: `[E2E] Carlos ${runId}`, telefone: "(11) 95555-0005", email: `carlos-${runId}@jurify.test` },
  ];
  for (const c of clientesData) {
    await db.insert(contatos).values({
      escritorioId,
      nome: c.nome,
      telefone: c.telefone,
      email: c.email,
      origem: "manual",
      responsavelId: null as unknown as number,
    });
  }

  return {
    id: escritorioId,
    nome: escritorioNome,
    runId,
    users: created as Record<TestRole, TestUser>,
  };
}

export async function teardownTestEscritorio(runId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const escritorioNome = `${ESCRITORIO_PREFIX}${runId}`;
  const [escritorio] = await db
    .select()
    .from(escritorios)
    .where(eq(escritorios.nome, escritorioNome))
    .limit(1);
  if (!escritorio) return;

  const colabs = await db
    .select()
    .from(colaboradores)
    .where(eq(colaboradores.escritorioId, escritorio.id));
  const userIds = colabs.map((c) => c.userId);

  await db.delete(contatos).where(eq(contatos.escritorioId, escritorio.id));
  await db.delete(colaboradores).where(eq(colaboradores.escritorioId, escritorio.id));
  await db.delete(escritorios).where(eq(escritorios.id, escritorio.id));

  for (const userId of userIds) {
    await db.delete(subscriptions).where(eq(subscriptions.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
}

export async function teardownStaleTestEscritorios(
  maxAgeMs: number = 24 * 60 * 60 * 1000,
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await db
    .select()
    .from(escritorios)
    .where(
      and(
        like(escritorios.nome, `${ESCRITORIO_PREFIX}%`),
        lt(escritorios.createdAt, cutoff),
      ),
    );

  for (const e of stale) {
    const runId = e.nome.slice(ESCRITORIO_PREFIX.length);
    await teardownTestEscritorio(runId);
  }
  return stale.length;
}
