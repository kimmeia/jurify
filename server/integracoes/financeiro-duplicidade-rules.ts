/**
 * Regras puras de decisão pras procedures que tratam o ciclo de duplicidade
 * de cobranças (excluir, vincular beneficiário, resolver par de duplicata,
 * detectar duplicata potencial no submit manual).
 *
 * Mantém o SQL nas procedures, mas extrai a *política* — qual combinação
 * (status × origem × fechamento × beneficiário) é permitida, qual mensagem
 * de erro retornar. Permite testar a matriz de decisão sem mockar o DB.
 *
 * Convenção: as funções recebem o estado já lido (cobrança, fechamentos,
 * etc) e retornam uma resposta `Decision` que a procedure converte pra
 * TRPCError quando `ok=false`.
 */

import { STATUS_PAGO_ASAAS } from "../_core/asaas-status";

/** Resposta padrão das funções de decisão. */
export type Decision<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: "BAD_REQUEST" | "NOT_FOUND" | "FORBIDDEN"; message: string };

/** Subset da row de cobrança que a regra precisa pra decidir. */
export interface CobrancaParaRegra {
  id: number;
  origem: string | null;
  status: string | null;
  asaasPaymentId: string | null;
  contatoId: number | null;
  contatoBeneficiarioId: number | null;
}

/**
 * Sprint 1 — guard de exclusão.
 *
 * Manual pode ser excluída em qualquer status (caso clássico Carlos+esposa:
 * operador lançou manual já-paga por engano e precisa desfazer sem reabrir
 * comissão). Asaas só PENDING (resto cancela no painel — o webhook propaga).
 * Independente da origem, cobrança que já entrou em fechamento de comissão
 * está congelada — primeiro exclui o fechamento.
 */
export function decidirExcluirCobranca(
  cob: CobrancaParaRegra,
  fechamentoComissaoId: number | null,
): Decision<{ ehManual: boolean; precisaCancelarNoAsaas: boolean }> {
  const ehManual = cob.origem === "manual" || !cob.asaasPaymentId;

  if (!ehManual && cob.status !== "PENDING") {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message:
        "Cobrança Asaas só pode ser excluída quando pendente. Para cancelar, faça no painel do Asaas — o webhook propaga.",
    };
  }

  if (fechamentoComissaoId !== null) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: `Esta cobrança já entrou no fechamento de comissão #${fechamentoComissaoId}. Exclua o fechamento (Comissões → Histórico → Detalhar → Excluir) antes de remover a cobrança.`,
    };
  }

  return {
    ok: true,
    data: { ehManual, precisaCancelarNoAsaas: !ehManual },
  };
}

/** Subset do contato beneficiário pra regra de vínculo. */
export interface BeneficiarioParaRegra {
  id: number;
  responsavelId: number | null;
}

/**
 * Sprint 2 — política de vínculo de pagamento de terceiro.
 *
 * Não vincula se: beneficiário == pagador (não há nada pra vincular) ou
 * cobrança já está em fechamento de comissão (snapshot imutável).
 *
 * Quando `reatribuirAtendente` está marcado E o beneficiário tem responsável
 * definido, retorna o novo atendenteId na decisão pra a procedure aplicar.
 */
export function decidirVinculoBeneficiario(args: {
  cob: { id: number; contatoId: number | null };
  benef: BeneficiarioParaRegra;
  fechamentoComissaoId: number | null;
  reatribuirAtendente: boolean;
}): Decision<{
  contatoBeneficiarioId: number;
  novoAtendenteId: number | null;
}> {
  if (args.cob.contatoId !== null && args.cob.contatoId === args.benef.id) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: "O beneficiário é o mesmo pagador. Não há nada pra vincular.",
    };
  }

  if (args.fechamentoComissaoId !== null) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: `Cobrança já está no fechamento de comissão #${args.fechamentoComissaoId}. Exclua o fechamento antes de remarcar o beneficiário.`,
    };
  }

  const novoAtendenteId =
    args.reatribuirAtendente && args.benef.responsavelId
      ? args.benef.responsavelId
      : null;

  return {
    ok: true,
    data: { contatoBeneficiarioId: args.benef.id, novoAtendenteId },
  };
}

/**
 * Sprint 3 — política de resolver par duplicado (wizard).
 *
 * Diferente do guard de exclusão simples: o auto-fix tem regras adicionais
 * porque envolve duas cobranças em uma transação:
 *  - manter e remover têm que ser diferentes
 *  - se a "remover" está em fechamento → bloqueia tudo
 *  - se a "manter" está em fechamento E `vincularBeneficiario=true` →
 *    bloqueia o vínculo (pode resolver com vincular=false)
 *  - "remover" Asaas só PENDING (igual exclusão normal)
 *  - "remover" manual qualquer status
 *  - auto-fix NÃO chama API Asaas (simplicidade — operador remove Asaas
 *    PENDING pelo botão normal de cancelar)
 */
export function decidirResolverPar(args: {
  manter: CobrancaParaRegra;
  remover: CobrancaParaRegra;
  manterEmFechamento: boolean;
  removerEmFechamento: boolean;
  vincularBeneficiario: boolean;
}): Decision<{
  vincularBeneficiarioPara: number | null;
  removerEhManual: boolean;
}> {
  if (args.manter.id === args.remover.id) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message: "Cobranças manter e remover não podem ser a mesma.",
    };
  }

  if (args.removerEmFechamento) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message:
        "A cobrança a remover já está em fechamento de comissão. Exclua o fechamento primeiro (Comissões → Histórico).",
    };
  }

  if (args.vincularBeneficiario && args.manterEmFechamento) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message:
        "A cobrança a manter já está em fechamento de comissão — não pode remarcar beneficiário. Tente com vincular=false ou exclua o fechamento.",
    };
  }

  const removerEhManual =
    args.remover.origem === "manual" || !args.remover.asaasPaymentId;
  if (!removerEhManual && args.remover.status !== "PENDING") {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message:
        "A cobrança a remover é Asaas e não está pendente. Cancele no painel do Asaas — o webhook propaga.",
    };
  }

  if (!removerEhManual) {
    return {
      ok: false,
      code: "BAD_REQUEST",
      message:
        "Auto-fix só remove cobrança manual. Pra remover Asaas PENDING, use o botão de cancelar normal.",
    };
  }

  const vincularBeneficiarioPara =
    args.vincularBeneficiario && args.remover.contatoId !== null
      ? args.remover.contatoId
      : null;

  return {
    ok: true,
    data: {
      vincularBeneficiarioPara,
      removerEhManual,
    },
  };
}

/**
 * Sprint 4 — scoring de duplicata potencial.
 *
 * Pontua quanto uma cobrança Asaas existente parece ser a mesma que o
 * operador está prestes a lançar manual (mesma faixa de valor + data
 * próxima). Pura — espelha em JS a lógica que o SQL aplica pra ranking,
 * mas o filtro SQL grosso já elimina candidatas óbvias (valor fora,
 * data fora da janela, beneficiário não-NULL, pagador == beneficiário).
 *
 *  - 100: valor exato + mesma data
 *  -  80: valor exato + data próxima (1-7 dias)
 *  -  50: valor exato + data próxima (8+ dias)
 *  -   0: valor diferente OU já tem beneficiário OU mesmo contato OU status não-pago
 */
export interface CobrancaParaScore extends CobrancaParaRegra {
  valor: number;
  dataPagamento: string | null;
  vencimento: string | null;
}

export function pontuarDuplicataPotencial(args: {
  cob: CobrancaParaScore;
  valorAlvo: number;
  dataReferencia: string;
  janelaDias: number;
  contatoBeneficiarioAlvo: number;
}): number {
  if (args.cob.contatoBeneficiarioId !== null) return 0;
  if (
    args.cob.contatoId !== null &&
    args.cob.contatoId === args.contatoBeneficiarioAlvo
  ) {
    return 0;
  }
  if (!STATUS_PAGO_ASAAS.includes(args.cob.status as never)) return 0;

  const valorCentsCob = Math.round(args.cob.valor * 100);
  const valorCentsAlvo = Math.round(args.valorAlvo * 100);
  if (Math.abs(valorCentsCob - valorCentsAlvo) > 1) return 0;

  const dataCobStr = args.cob.dataPagamento ?? args.cob.vencimento;
  if (!dataCobStr) return 0;
  const diasDelta = Math.abs(diffEmDias(dataCobStr, args.dataReferencia));
  if (diasDelta > args.janelaDias) return 0;

  if (diasDelta === 0) return 100;
  if (diasDelta <= 7) return 80;
  return 50;
}

/** Diff em dias (signed). Trata datas ISO "YYYY-MM-DD". */
export function diffEmDias(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.POSITIVE_INFINITY;
  return Math.round((ta - tb) / 86_400_000);
}
