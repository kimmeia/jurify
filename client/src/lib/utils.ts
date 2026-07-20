import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Chave de idempotência pra operações de criação no backend (ex.: cobrança
 * Asaas). Gerada 1× por sessão de criação (abertura de dialog) — reclique
 * após timeout reusa a MESMA chave e o backend devolve o recurso já criado
 * em vez de duplicar. Só [A-Za-z0-9-] (compatível com o gate do servidor).
 */
export function gerarIdemKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
