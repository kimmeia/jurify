/**
 * Drizzle aplica adapter de coluna declarada (timestamp() vira Date no JS),
 * mas em `sql<Date>\`MAX(col)\`` o tipo é só hint — o mysql2 entrega o valor
 * cru, que pode vir como string 'YYYY-MM-DD HH:MM:SS'. `(x as Date).toISOString()`
 * quebra em runtime nesse caminho.
 */
export function toIsoString(
  v: Date | string | number | null | undefined,
): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
