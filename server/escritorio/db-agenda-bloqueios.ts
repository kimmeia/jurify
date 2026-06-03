import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { agendaBloqueios, type AgendaBloqueio } from "../../drizzle/schema";
import { feriadosNacionaisBR } from "../_core/feriados-br";

export async function listarBloqueios(escritorioId: number): Promise<AgendaBloqueio[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(agendaBloqueios)
    .where(eq(agendaBloqueios.escritorioId, escritorioId))
    .orderBy(agendaBloqueios.data);
}

export async function criarBloqueio(input: {
  escritorioId: number;
  data: string; // YYYY-MM-DD
  horaInicio?: string | null; // null = dia inteiro
  horaFim?: string | null;
  motivo?: string | null;
  recorrenteAnual?: boolean;
  criadoPorId?: number | null;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const [r] = await db.insert(agendaBloqueios).values({
    escritorioId: input.escritorioId,
    data: input.data,
    horaInicio: input.horaInicio || null,
    horaFim: input.horaFim || null,
    motivo: input.motivo || null,
    recorrenteAnual: input.recorrenteAnual ?? false,
    criadoPorId: input.criadoPorId ?? null,
  });
  return (r as { insertId: number }).insertId;
}

export async function excluirBloqueio(escritorioId: number, id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  await db.delete(agendaBloqueios)
    .where(and(eq(agendaBloqueios.id, id), eq(agendaBloqueios.escritorioId, escritorioId)));
}

// Importa os 12 feriados nacionais do ano como bloqueios recorrentes
// anuais. Ignora os que já existem na mesma data (idempotente — chamar
// duas vezes não cria duplicado). Retorna quantos foram efetivamente
// criados.
export async function importarFeriadosNacionais(input: {
  escritorioId: number;
  ano: number;
  criadoPorId?: number | null;
}): Promise<{ criados: number; jaExistiam: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database indisponível");
  const feriados = feriadosNacionaisBR(input.ano);
  const datas = feriados.map((f) => f.data);
  const existentes = await db.select({ data: agendaBloqueios.data })
    .from(agendaBloqueios)
    .where(and(
      eq(agendaBloqueios.escritorioId, input.escritorioId),
      inArray(agendaBloqueios.data, datas),
    ));
  const jaTem = new Set(existentes.map((e) => e.data));
  const aInserir = feriados.filter((f) => !jaTem.has(f.data));
  if (aInserir.length === 0) return { criados: 0, jaExistiam: feriados.length };
  await db.insert(agendaBloqueios).values(aInserir.map((f) => ({
    escritorioId: input.escritorioId,
    data: f.data,
    horaInicio: null,
    horaFim: null,
    motivo: f.motivo,
    recorrenteAnual: true,
    criadoPorId: input.criadoPorId ?? null,
  })));
  return { criados: aInserir.length, jaExistiam: feriados.length - aInserir.length };
}

// Avalia se uma data específica (YYYY-MM-DD) está bloqueada considerando
// recorrência anual. Retorna a lista de bloqueios que se aplicam — vazio
// = dia livre. Usado pelo gerador de slots livres pra pular o dia ou
// excluir intervalos.
export function bloqueiosAplicaveis(data: string, todos: AgendaBloqueio[]): AgendaBloqueio[] {
  const [, mes, dia] = data.split("-");
  return todos.filter((b) => {
    if (b.data === data) return true;
    if (b.recorrenteAnual) {
      const [, bMes, bDia] = b.data.split("-");
      return bMes === mes && bDia === dia;
    }
    return false;
  });
}
