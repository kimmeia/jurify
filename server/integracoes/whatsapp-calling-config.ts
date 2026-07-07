/**
 * Config de ligação por escritório (definida pelo dono/gestor).
 *   transbordoAtivo: chamada não atendida pelo responsável transborda pros
 *     disponíveis (default false — sem escalonamento automático).
 *   modoJanela: 'overlay' (pop-up) | 'discreto' (widget pisca + som).
 */

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { chamadaConfig } from "../../drizzle/schema";

export type ModoJanela = "overlay" | "discreto";
export interface ConfigChamada {
  transbordoAtivo: boolean;
  modoJanela: ModoJanela;
  /** Aviso automático de "chamada perdida" por WhatsApp. Default false. */
  avisoPerdidaAtivo: boolean;
}

const PADRAO: ConfigChamada = { transbordoAtivo: false, modoJanela: "overlay", avisoPerdidaAtivo: false };

export async function obterConfigChamada(escritorioId: number): Promise<ConfigChamada> {
  const db = await getDb();
  if (!db) return PADRAO;
  const [row] = await db
    .select()
    .from(chamadaConfig)
    .where(eq(chamadaConfig.escritorioId, escritorioId))
    .limit(1);
  if (!row) return PADRAO;
  return {
    transbordoAtivo: !!row.transbordoAtivo,
    modoJanela: row.modoJanela === "discreto" ? "discreto" : "overlay",
    avisoPerdidaAtivo: !!row.avisoPerdidaAtivo,
  };
}

export async function salvarConfigChamada(
  escritorioId: number,
  patch: Partial<ConfigChamada>,
): Promise<ConfigChamada> {
  const db = await getDb();
  if (!db) return { ...PADRAO, ...patch };
  const novo = { ...(await obterConfigChamada(escritorioId)), ...patch };
  const [existe] = await db
    .select({ id: chamadaConfig.id })
    .from(chamadaConfig)
    .where(eq(chamadaConfig.escritorioId, escritorioId))
    .limit(1);
  if (existe) {
    await db
      .update(chamadaConfig)
      .set({ transbordoAtivo: novo.transbordoAtivo, modoJanela: novo.modoJanela, avisoPerdidaAtivo: novo.avisoPerdidaAtivo })
      .where(eq(chamadaConfig.escritorioId, escritorioId));
  } else {
    await db
      .insert(chamadaConfig)
      .values({ escritorioId, transbordoAtivo: novo.transbordoAtivo, modoJanela: novo.modoJanela, avisoPerdidaAtivo: novo.avisoPerdidaAtivo });
  }
  return novo;
}
