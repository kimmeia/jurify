/**
 * Fila de "Avisar quando chegar" — o que o painel admin lê e o que ele faz.
 *
 * O interessado digita o tribunal como quiser ("TJSP", "tj-sp", "TRT 7");
 * a fila agrupa pela forma normalizada e o aviso vai pra todo mundo do grupo
 * que ainda não recebeu (`avisadoEm` nulo). Uma ficha por escritório: o
 * e-mail é do DONO, e dois pedidos do mesmo escritório rendem UM e-mail —
 * mas as duas linhas ficam marcadas.
 *
 * A orquestração recebe as dependências (leitura, e-mail, marcação) em vez
 * de tocar o banco: é o que deixa a regra "só avisa quem não foi avisado"
 * testável sem drizzle.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { escritorios, interesseTribunais, users } from "../../drizzle/schema";
import { enviarEmailTribunalDisponivel } from "../_core/email";

export type InteresseRow = {
  id: number;
  escritorioId: number;
  userId: number;
  tribunal: string;
  criadoEm: Date | string;
  avisadoEm: Date | string | null;
};

/** "tj-sp" / "TJ SP" / "Tribunal TJSP" → "TJSP". Só letras e dígitos, maiúsculas. */
export function normalizarTribunalInteresse(texto: string): string {
  return (texto ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type GrupoInteresse = {
  tribunal: string;
  pedidos: number;
  avisados: number;
  pendentes: number;
  escritorios: number;
  /** Como as pessoas escreveram — a grafia mais frequente primeiro. */
  grafias: string[];
};

/** Agrupa a fila por tribunal normalizado; pendentes primeiro. */
export function agruparInteresses(rows: InteresseRow[]): GrupoInteresse[] {
  const grupos = new Map<
    string,
    { pedidos: number; avisados: number; escritorios: Set<number>; grafias: Map<string, number> }
  >();
  for (const r of rows) {
    const chave = normalizarTribunalInteresse(r.tribunal);
    if (!chave) continue;
    const g = grupos.get(chave) ?? { pedidos: 0, avisados: 0, escritorios: new Set<number>(), grafias: new Map() };
    g.pedidos += 1;
    if (r.avisadoEm) g.avisados += 1;
    g.escritorios.add(r.escritorioId);
    const grafia = r.tribunal.trim();
    g.grafias.set(grafia, (g.grafias.get(grafia) ?? 0) + 1);
    grupos.set(chave, g);
  }
  return [...grupos.entries()]
    .map(([tribunal, g]) => ({
      tribunal,
      pedidos: g.pedidos,
      avisados: g.avisados,
      pendentes: g.pedidos - g.avisados,
      escritorios: g.escritorios.size,
      grafias: [...g.grafias.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t),
    }))
    .sort((a, b) => b.pendentes - a.pendentes || b.pedidos - a.pedidos || a.tribunal.localeCompare(b.tribunal));
}

export type DepsAvisar = {
  listarInteresses: () => Promise<InteresseRow[]>;
  emailDoDono: (escritorioId: number) => Promise<{ email: string; nome: string | null; userId: number } | null>;
  enviar: (params: { email: string; nome: string | null; sigla: string; escritorioId: number; userId: number }) => Promise<{ success: boolean; error?: string }>;
  marcarAvisados: (ids: number[], quando: Date) => Promise<void>;
  agora?: () => Date;
};

export type ResultadoAvisar = {
  tribunal: string;
  enviados: number;
  falhas: Array<{ escritorioId: number; erro: string }>;
  jaAvisados: number;
  semEmail: number;
};

/**
 * Manda o aviso pra fila de um tribunal. Quem já tem `avisadoEm` fica de
 * fora (é o que impede o segundo clique de mandar tudo de novo); quem falha
 * no envio NÃO é marcado, pra entrar na próxima tentativa.
 */
export async function avisarInteressados(deps: DepsAvisar, tribunal: string): Promise<ResultadoAvisar> {
  const chave = normalizarTribunalInteresse(tribunal);
  const doTribunal = (await deps.listarInteresses()).filter(
    (r) => normalizarTribunalInteresse(r.tribunal) === chave,
  );
  const jaAvisados = doTribunal.filter((r) => !!r.avisadoEm).length;
  const pendentes = doTribunal.filter((r) => !r.avisadoEm);

  const porEscritorio = new Map<number, InteresseRow[]>();
  for (const r of pendentes) {
    porEscritorio.set(r.escritorioId, [...(porEscritorio.get(r.escritorioId) ?? []), r]);
  }

  const quando = (deps.agora ?? (() => new Date()))();
  const resultado: ResultadoAvisar = { tribunal: chave, enviados: 0, falhas: [], jaAvisados, semEmail: 0 };
  const idsAvisados: number[] = [];

  for (const [escritorioId, linhas] of porEscritorio) {
    const dono = await deps.emailDoDono(escritorioId);
    if (!dono?.email) {
      resultado.semEmail += 1;
      continue;
    }
    const envio = await deps.enviar({ email: dono.email, nome: dono.nome, sigla: chave, escritorioId, userId: dono.userId });
    if (!envio.success) {
      resultado.falhas.push({ escritorioId, erro: envio.error ?? "falha no envio" });
      continue;
    }
    resultado.enviados += 1;
    idsAvisados.push(...linhas.map((l) => l.id));
  }

  if (idsAvisados.length > 0) await deps.marcarAvisados(idsAvisados, quando);
  return resultado;
}

type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

/** Dependências reais, sobre o drizzle. */
export function depsInteresseTribunais(db: Db): DepsAvisar {
  return {
    listarInteresses: async () =>
      db
        .select({
          id: interesseTribunais.id,
          escritorioId: interesseTribunais.escritorioId,
          userId: interesseTribunais.userId,
          tribunal: interesseTribunais.tribunal,
          criadoEm: interesseTribunais.criadoEm,
          avisadoEm: interesseTribunais.avisadoEm,
        })
        .from(interesseTribunais),
    emailDoDono: async (escritorioId) => {
      const [dono] = await db
        .select({ email: users.email, nome: users.name, userId: users.id })
        .from(escritorios)
        .innerJoin(users, eq(users.id, escritorios.ownerId))
        .where(eq(escritorios.id, escritorioId))
        .limit(1);
      return dono?.email ? { email: dono.email, nome: dono.nome ?? null, userId: dono.userId } : null;
    },
    enviar: (p) => enviarEmailTribunalDisponivel(p),
    marcarAvisados: async (ids, quando) => {
      await db
        .update(interesseTribunais)
        .set({ avisadoEm: quando })
        .where(and(inArray(interesseTribunais.id, ids), isNull(interesseTribunais.avisadoEm)));
    },
  };
}
