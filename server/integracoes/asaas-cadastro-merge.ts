/**
 * Política de merge cadastral CRM ← Asaas (vínculo, sync e webhook CUSTOMER_*).
 *
 * Nome e CPF/CNPJ vêm do Asaas quando presentes — cadastro de faturamento é
 * fonte de verdade pra esses campos. Telefone e email NUNCA sobrescrevem o
 * que o CRM já tem: telefone é identidade de canal de conversa (WhatsApp) —
 * trocá-lo pelo do Asaas (outro número, ou formato sem DDI 55) redireciona
 * mensagens pro destino errado e a Meta rejeita o envio. O Asaas só PREENCHE
 * telefone/email quando o CRM está vazio, e valor ausente no Asaas nunca
 * apaga valor existente no CRM.
 */

export interface CadastroAtualCrm {
  nome: string;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
}

export interface CustomerAsaasCadastro {
  name?: string | null;
  cpfCnpj?: string | null;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
}

export function mesclarCadastroDoAsaas(
  atual: CadastroAtualCrm,
  customer: CustomerAsaasCadastro,
): { nome: string; cpfCnpj: string | null; email: string | null; telefone: string | null } {
  const cpfAsaas = (customer.cpfCnpj || "").replace(/\D/g, "");
  return {
    nome: customer.name || atual.nome,
    cpfCnpj: cpfAsaas || atual.cpfCnpj || null,
    email: atual.email || customer.email || null,
    telefone: atual.telefone || customer.mobilePhone || customer.phone || null,
  };
}
