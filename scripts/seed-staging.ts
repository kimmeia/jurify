/**
 * Seed pra ambiente de staging.
 *
 * Cria um conjunto fixo de dados pra que os testes E2E + smoke tRPC
 * tenham contra o que rodar sem depender de ações manuais. Idempotente
 * (UPSERT por email) — pode rodar várias vezes sem duplicar.
 *
 *   pnpm tsx scripts/seed-staging.ts
 *
 * Pra evitar acidente em produção: aborta se `JURIFY_AMBIENTE !== "staging"`
 * E `NODE_ENV !== "test"`. Se quiser forçar (ex: setup local), use
 * `JURIFY_SEED_FORCE=1`.
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { hashPassword } from "../server/_core/password";
import {
  users,
  escritorios,
  colaboradores,
  contatos,
  subscriptions,
} from "../drizzle/schema";

/**
 * A senha das contas de teste.
 *
 * O valor de fábrica só serve pro banco descartável da CI, que nasce e morre
 * dentro do job. Semear um ambiente vivo com uma senha publicada no
 * repositório é plantar credencial conhecida — por isso, em staging, a senha
 * vem de `SMOKE_PASSWORD` e o script recusa rodar sem ela.
 */
const SENHA_CI = "Smoke123!";
const SENHA_PADRAO = process.env.SMOKE_PASSWORD || SENHA_CI;

const SEEDS = [
  { email: "admin-smoke@juridflow.com.br",  name: "Admin Smoke",   role: "admin" as const, cargo: null },
  { email: "dono-smoke@juridflow.com.br",   name: "Dono Smoke",    role: "user"  as const, cargo: "dono" as const },
  { email: "gestor-smoke@juridflow.com.br", name: "Gestor Smoke",  role: "user"  as const, cargo: "gestor" as const },
  { email: "atendente-smoke@juridflow.com.br", name: "Atendente Smoke", role: "user" as const, cargo: "atendente" as const },
];

const CLIENTES_SEED = [
  { nome: "[E2E-SEED] João Silva",   telefone: "(11) 91111-1111", email: "joao.seed@example.com" },
  { nome: "[E2E-SEED] Maria Souza",  telefone: "(11) 92222-2222", email: "maria.seed@example.com" },
  { nome: "[E2E-SEED] Pedro Lima",   telefone: "(11) 93333-3333", email: "pedro.seed@example.com" },
  { nome: "[E2E-SEED] Ana Costa",    telefone: "(11) 94444-4444", email: "ana.seed@example.com" },
  { nome: "[E2E-SEED] Carlos Pinto", telefone: "(11) 95555-5555", email: "carlos.seed@example.com" },
];

function emailToOpenId(email: string): string {
  return `email-${Buffer.from(email.trim().toLowerCase()).toString("base64url")}`;
}

async function seed() {
  // Guard rail: nunca roda em produção.
  const ambiente = process.env.JURIFY_AMBIENTE || process.env.NODE_ENV;
  const forcado = process.env.JURIFY_SEED_FORCE === "1";
  if (ambiente === "production" && !forcado) {
    throw new Error("Seed bloqueado em produção. Use JURIFY_SEED_FORCE=1 se for muito necessário.");
  }
  if (ambiente === "staging" && !process.env.SMOKE_PASSWORD) {
    throw new Error(
      "SMOKE_PASSWORD não definida. Em staging a senha das contas de teste vem de secret: " +
        "a senha de fábrica está publicada no repositório e não pode virar credencial de ambiente vivo.",
    );
  }
  console.log(`[seed] Ambiente: ${ambiente || "(não definido)"}`);
  console.log(`[seed] Senha das contas: ${process.env.SMOKE_PASSWORD ? "de SMOKE_PASSWORD" : "de fábrica (só CI)"}`);

  const db = await getDb();
  if (!db) throw new Error("Database indisponível.");

  const passwordHash = await hashPassword(SENHA_PADRAO);

  // 1. Users — UPSERT manual (Drizzle MySQL não tem onConflictUpdate
  // direto; checa, depois INSERT/UPDATE).
  const userIds: Record<string, number> = {};
  for (const s of SEEDS) {
    const [existing] = await db.select().from(users).where(eq(users.email, s.email)).limit(1);
    if (existing) {
      userIds[s.email] = existing.id;
      // A senha é reescrita a cada execução, e não só na criação. Sem isso,
      // girar o secret não teria efeito nenhum: as contas continuariam com o
      // hash antigo e o smoke seguiria barrado no login sem nenhuma pista.
      await db
        .update(users)
        .set({ passwordHash, emailVerificado: true, emailVerificadoEm: new Date() })
        .where(eq(users.id, existing.id));
      console.log(`[seed] user existente: ${s.email} (id=${existing.id}) — senha reescrita`);
      continue;
    }
    const [inserido] = await db.insert(users).values({
      openId: emailToOpenId(s.email),
      name: s.name,
      email: s.email,
      role: s.role,
      loginMethod: "email",
      passwordHash,
      // Seed precisa pular o gate da Fase 2 (login bloqueia user com
      // emailVerificado=false). Conta seed nunca passa pelo fluxo de
      // confirmação por email — é criada direto pelo script.
      emailVerificado: true,
      emailVerificadoEm: new Date(),
    });
    const id = (inserido as { insertId: number }).insertId;
    userIds[s.email] = id;
    console.log(`[seed] user criado: ${s.email} (id=${id})`);
  }

  // 2. Escritório — 1 só, owner = dono-smoke.
  const ownerId = userIds["dono-smoke@juridflow.com.br"];
  if (!ownerId) throw new Error("Owner do escritório não foi criado.");

  let [escritorio] = await db
    .select()
    .from(escritorios)
    .where(eq(escritorios.ownerId, ownerId))
    .limit(1);

  if (!escritorio) {
    const [inserido] = await db.insert(escritorios).values({
      nome: "Escritório Smoke",
      email: "contato-smoke@juridflow.com.br",
      ownerId,
      maxColaboradores: 5,
    });
    const id = (inserido as { insertId: number }).insertId;
    [escritorio] = await db.select().from(escritorios).where(eq(escritorios.id, id)).limit(1);
    console.log(`[seed] escritório criado: id=${id}`);
  } else {
    console.log(`[seed] escritório existente: id=${escritorio.id}`);
  }

  // 3. Colaboradores — vincula dono/gestor/atendente.
  for (const s of SEEDS) {
    if (!s.cargo) continue;
    const userId = userIds[s.email];
    const [existente] = await db
      .select()
      .from(colaboradores)
      .where(eq(colaboradores.userId, userId))
      .limit(1);
    if (existente) {
      console.log(`[seed] colaborador existente: ${s.email}`);
      continue;
    }
    await db.insert(colaboradores).values({
      escritorioId: escritorio.id,
      userId,
      cargo: s.cargo,
      ativo: true,
    });
    console.log(`[seed] colaborador criado: ${s.email} (cargo=${s.cargo})`);
  }

  // 3.5. Subscription ativa pro dono — sem isso o SubscriptionGuard
  //      redireciona pra /plans e os testes E2E que dependem de
  //      /dashboard, /clientes, /financeiro, etc. dão timeout.
  const [subExistente] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, ownerId))
    .limit(1);

  if (!subExistente) {
    await db.insert(subscriptions).values({
      userId: ownerId,
      planId: "smoke-test-plan",
      status: "active",
      currentPeriodEnd: Date.now() + 365 * 24 * 60 * 60 * 1000,
      creditsLimit: 999999,
      creditsUsed: 0,
    });
    console.log(`[seed] subscription ativa criada pro dono (userId=${ownerId})`);
  } else {
    // Idempotente — força status active mesmo se já existia (caso o
    // estado tenha sido alterado por algum teste anterior).
    if (subExistente.status !== "active") {
      await db
        .update(subscriptions)
        .set({ status: "active" })
        .where(eq(subscriptions.id, subExistente.id));
      console.log(`[seed] subscription do dono reativada`);
    } else {
      console.log(`[seed] subscription ativa do dono já existia`);
    }
  }

  // 4. Contatos — clientes seed pra testes não começarem do zero.
  for (const c of CLIENTES_SEED) {
    const [existente] = await db
      .select()
      .from(contatos)
      .where(eq(contatos.email, c.email))
      .limit(1);
    if (existente) {
      console.log(`[seed] cliente existente: ${c.nome}`);
      continue;
    }
    await db.insert(contatos).values({
      escritorioId: escritorio.id,
      nome: c.nome,
      telefone: c.telefone,
      email: c.email,
      origem: "manual",
      responsavelId: null as any,
    });
    console.log(`[seed] cliente criado: ${c.nome}`);
  }

  console.log(`\n[seed] OK. ${SEEDS.length} contas prontas.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] FALHOU:", err);
    process.exit(1);
  });
