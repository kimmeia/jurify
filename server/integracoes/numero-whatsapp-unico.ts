/**
 * Um número de WhatsApp pertence a um escritório só.
 *
 * O webhook da Meta chega sem inquilino: quem decide pra quem vai a
 * conversa é o `phoneNumberId`. Se o mesmo número estiver conectado em dois
 * escritórios, não existe resposta certa — e o erro não é sutil, é a
 * mensagem do cliente de uma banca caindo na caixa de entrada de outra.
 *
 * A checagem era feita só DENTRO do escritório ("já tenho este número?"),
 * o que dedupla a reconexão mas não impede o mesmo número de entrar em dois
 * lugares. Esta é a metade que faltava.
 *
 * Só barra o que está NO AR em outro escritório. Número abandonado lá
 * (desconectado, erro, banido) libera: é a migração legítima de quem trocou
 * de sistema, e recusar travaria cliente novo na porta.
 */

import { and, eq, ne } from "drizzle-orm";
import { canaisIntegrados } from "../../drizzle/schema";
import { decryptConfig } from "../escritorio/crypto-utils";

export async function canalConectadoEmOutroEscritorio(
  db: any,
  escritorioId: number,
  phoneNumberId: string,
): Promise<{ canalId: number; escritorioId: number } | null> {
  if (!phoneNumberId) return null;

  const canais = await db
    .select()
    .from(canaisIntegrados)
    .where(
      and(
        eq(canaisIntegrados.tipo, "whatsapp_api"),
        eq(canaisIntegrados.status, "conectado"),
        ne(canaisIntegrados.escritorioId, escritorioId),
      ),
    );

  for (const canal of canais) {
    if (!canal.configEncrypted || !canal.configIv || !canal.configTag) continue;
    try {
      const cfg = decryptConfig(canal.configEncrypted, canal.configIv, canal.configTag);
      if (cfg.phoneNumberId === phoneNumberId) {
        return { canalId: canal.id, escritorioId: canal.escritorioId };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export const MENSAGEM_NUMERO_EM_OUTRA_CONTA =
  "Este número de WhatsApp já está conectado em outra conta do JuridFlow. " +
  "Desconecte-o lá antes de conectar aqui, ou fale com o suporte.";
