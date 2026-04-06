/**
 * Validações brasileiras — CPF, CNPJ, Telefone, Email
 * Usado por frontend (formulários) e backend (mutations)
 */

// ─── CPF ────────────────────────────────────────────────────────────────────

export function validarCPF(cpf: string): boolean {
  const limpo = cpf.replace(/\D/g, "");
  if (limpo.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(limpo)) return false; // todos iguais

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(limpo[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(limpo[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(limpo[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === parseInt(limpo[10]);
}

export function formatarCPF(cpf: string): string {
  const limpo = cpf.replace(/\D/g, "").slice(0, 11);
  if (limpo.length <= 3) return limpo;
  if (limpo.length <= 6) return `${limpo.slice(0, 3)}.${limpo.slice(3)}`;
  if (limpo.length <= 9) return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6)}`;
  return `${limpo.slice(0, 3)}.${limpo.slice(3, 6)}.${limpo.slice(6, 9)}-${limpo.slice(9)}`;
}

// ─── CNPJ ───────────────────────────────────────────────────────────────────

export function validarCNPJ(cnpj: string): boolean {
  const limpo = cnpj.replace(/\D/g, "");
  if (limpo.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(limpo)) return false;

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  let soma = 0;
  for (let i = 0; i < 12; i++) soma += parseInt(limpo[i]) * pesos1[i];
  let resto = soma % 11;
  const d1 = resto < 2 ? 0 : 11 - resto;
  if (d1 !== parseInt(limpo[12])) return false;

  soma = 0;
  for (let i = 0; i < 13; i++) soma += parseInt(limpo[i]) * pesos2[i];
  resto = soma % 11;
  const d2 = resto < 2 ? 0 : 11 - resto;
  return d2 === parseInt(limpo[13]);
}

export function formatarCNPJ(cnpj: string): string {
  const limpo = cnpj.replace(/\D/g, "").slice(0, 14);
  if (limpo.length <= 2) return limpo;
  if (limpo.length <= 5) return `${limpo.slice(0, 2)}.${limpo.slice(2)}`;
  if (limpo.length <= 8) return `${limpo.slice(0, 2)}.${limpo.slice(2, 5)}.${limpo.slice(5)}`;
  if (limpo.length <= 12) return `${limpo.slice(0, 2)}.${limpo.slice(2, 5)}.${limpo.slice(5, 8)}/${limpo.slice(8)}`;
  return `${limpo.slice(0, 2)}.${limpo.slice(2, 5)}.${limpo.slice(5, 8)}/${limpo.slice(8, 12)}-${limpo.slice(12)}`;
}

// ─── CPF ou CNPJ ────────────────────────────────────────────────────────────

export function validarCpfCnpj(valor: string): { valido: boolean; tipo: "cpf" | "cnpj" | null } {
  const limpo = valor.replace(/\D/g, "");
  if (limpo.length === 11) return { valido: validarCPF(limpo), tipo: "cpf" };
  if (limpo.length === 14) return { valido: validarCNPJ(limpo), tipo: "cnpj" };
  return { valido: false, tipo: null };
}

export function formatarCpfCnpj(valor: string): string {
  const limpo = valor.replace(/\D/g, "");
  if (limpo.length <= 11) return formatarCPF(limpo);
  return formatarCNPJ(limpo);
}

// ─── Telefone Brasileiro ────────────────────────────────────────────────────

export function validarTelefone(tel: string): boolean {
  const limpo = tel.replace(/\D/g, "");
  // Aceita: 10 dígitos (fixo) ou 11 dígitos (celular com 9)
  // Com DDI: 12 ou 13 dígitos (55 + DDD + número)
  if (limpo.length === 10 || limpo.length === 11) return true;
  if ((limpo.length === 12 || limpo.length === 13) && limpo.startsWith("55")) return true;
  return false;
}

export function formatarTelefone(tel: string): string {
  let limpo = tel.replace(/\D/g, "");
  // Remove 55 do início se presente
  if (limpo.length >= 12 && limpo.startsWith("55")) limpo = limpo.slice(2);
  if (limpo.length === 11) return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
  if (limpo.length === 10) return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
  return tel; // retorna original se não encaixa
}

// ─── Email ──────────────────────────────────────────────────────────────────

export function validarEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Remove formatação e retorna apenas dígitos */
export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Verifica se string tem conteúdo (não é vazia/whitespace) */
export function temConteudo(valor: string | null | undefined): boolean {
  return !!valor && valor.trim().length > 0;
}
