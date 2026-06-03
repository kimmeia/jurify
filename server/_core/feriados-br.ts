// Calcula os feriados nacionais brasileiros de um ano. Cobre os 8 fixos
// federais + 3 móveis derivados da Páscoa (Carnaval = Páscoa - 47 dias,
// Sexta-feira Santa = Páscoa - 2, Corpus Christi = Páscoa + 60).
//
// Páscoa é calculada via algoritmo de Gauss/Computus Gregoriano —
// determinístico, sem depender de biblioteca externa.

export type FeriadoBR = {
  data: string; // YYYY-MM-DD
  motivo: string;
};

// Computus Gregoriano (algoritmo "anonymous Gregorian", do Wikipédia/Knuth).
// Retorna a data do Domingo de Páscoa pro ano dado.
export function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const mes = Math.floor((h + L - 7 * m + 114) / 31);
  const dia = ((h + L - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function deslocar(base: Date, dias: number): Date {
  return new Date(base.getTime() + dias * 86400000);
}

export function feriadosNacionaisBR(ano: number): FeriadoBR[] {
  const pascoa = calcularPascoa(ano);
  return [
    { data: `${ano}-01-01`, motivo: "Confraternização Universal" },
    { data: isoDate(deslocar(pascoa, -47)), motivo: "Carnaval" },
    { data: isoDate(deslocar(pascoa, -2)), motivo: "Sexta-feira Santa" },
    { data: `${ano}-04-21`, motivo: "Tiradentes" },
    { data: `${ano}-05-01`, motivo: "Dia do Trabalho" },
    { data: isoDate(deslocar(pascoa, 60)), motivo: "Corpus Christi" },
    { data: `${ano}-09-07`, motivo: "Independência do Brasil" },
    { data: `${ano}-10-12`, motivo: "Nossa Senhora Aparecida" },
    { data: `${ano}-11-02`, motivo: "Finados" },
    { data: `${ano}-11-15`, motivo: "Proclamação da República" },
    { data: `${ano}-11-20`, motivo: "Consciência Negra" }, // virou nacional em 2024 (Lei 14.759/2023)
    { data: `${ano}-12-25`, motivo: "Natal" },
  ];
}
