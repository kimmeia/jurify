/**
 * Helpers puros usados pelo dispatcher do SmartFlow. Separados em arquivo
 * próprio pra poderem ser testados sem precisar mockar `getDb` nem puxar
 * o schema do drizzle.
 */

import type {
  ConfigGatilhoMensagemCanal,
  ConfigGatilhoPagamentoVencido,
  ConfigGatilhoPagamentoProximoVencimento,
  TipoCanalMensagem,
} from "../../shared/smartflow-types";

/**
 * Retorna `true` se o cenário (com gatilho `mensagem_canal`) aceita o canal
 * informado. Config vazia = aceita qualquer canal.
 */
export function aceitaCanal(cfg: ConfigGatilhoMensagemCanal | undefined, canalTipo: TipoCanalMensagem): boolean {
  const canais = Array.isArray(cfg?.canais) ? cfg!.canais : [];
  if (canais.length === 0) return true;
  return canais.includes(canalTipo);
}

/**
 * Dispara `pagamento_vencido`?
 * Só se o atraso atual for >= `diasAtraso` configurado (default 0).
 */
export function deveDispararVencido(
  cfg: ConfigGatilhoPagamentoVencido | undefined,
  diasAtrasoAtual: number,
): boolean {
  const min = Math.max(0, Number(cfg?.diasAtraso ?? 0));
  return diasAtrasoAtual >= min;
}

/**
 * Dispara `pagamento_proximo_vencimento`?
 * Só se faltar no máximo `diasAntes` (default 3) dias para o vencimento,
 * e o pagamento ainda não tiver vencido.
 */
export function deveDispararProximo(
  cfg: ConfigGatilhoPagamentoProximoVencimento | undefined,
  diasAteVencer: number,
): boolean {
  if (diasAteVencer < 0) return false;
  const max = Math.max(0, Number(cfg?.diasAntes ?? 3));
  return diasAteVencer <= max;
}

/**
 * Dedupe: retorna `true` se o JSON `contextoSerializado` referencia o
 * `pagamentoId` informado. O dispatcher usa isso pra pular execuções
 * duplicadas na janela de 24h.
 */
export function contextoContemPagamento(contextoSerializado: string | null | undefined, pagamentoId: string): boolean {
  if (!contextoSerializado || !pagamentoId) return false;
  return contextoSerializado.includes(`"pagamentoId":"${pagamentoId}"`);
}

export function diasEntre(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export function parseVencimento(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}
