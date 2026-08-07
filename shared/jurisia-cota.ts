/**
 * Cota mensal de mensagens do JurisIA.
 *
 * A competência é calculada no FUSO DO ESCRITÓRIO, não em UTC: às 22h de
 * Fortaleza no dia 31 já é dia 1 em UTC, e o escritório veria a cota virar um
 * dia antes — reclamação difícil de reproduzir e fácil de evitar.
 */

export interface EstadoCota {
  limite: number;
  usadas: number;
  restantes: number;
  /** false quando o plano não vende o módulo (limite 0) ou a cota acabou. */
  pode: boolean;
  /** true só quando o plano não inclui JurisIA — a tela oferece upgrade. */
  semPlano: boolean;
}

/** 'YYYY-MM' no fuso informado. */
export function competenciaDe(agora: Date, fusoHorario: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: fusoHorario,
    year: "numeric",
    month: "2-digit",
  });
  // en-CA devolve "2026-08"; normaliza caso o runtime insira o dia.
  return fmt.format(agora).slice(0, 7);
}

export function avaliarCota(args: { limite: number; usadas: number }): EstadoCota {
  const limite = Number.isFinite(args.limite) ? Math.max(0, Math.trunc(args.limite)) : 0;
  const usadas = Number.isFinite(args.usadas) ? Math.max(0, Math.trunc(args.usadas)) : 0;
  const restantes = Math.max(0, limite - usadas);
  return {
    limite,
    usadas,
    restantes,
    pode: limite > 0 && restantes > 0,
    semPlano: limite === 0,
  };
}
