/**
 * Interpolação de variáveis em templates do SmartFlow.
 *
 * Sintaxe nova: `{{path.com.pontos}}` — resolve via lookup recursivo no
 * contexto. Ex: `{{cliente.nome}}` → ctx.cliente.nome.
 *
 * Compatibilidade com formato legado: `{nome}`, `{intencao}`,
 * `{horario}`, `{cobrancasAbertas}` continuam funcionando (mapeados pra
 * caminhos do contexto que o engine usa).
 *
 * Strings não encontradas viram string vazia (não falha) — preferimos
 * mensagem com pedaço faltando do que crashar o fluxo.
 */

/**
 * Resolve um path tipo "cliente.nome" no objeto ctx.
 * Caminho não encontrado retorna `""` (não undefined nem null).
 */
function resolverCaminho(ctx: Record<string, any>, caminho: string): string {
  const partes = caminho.split(".");
  let valor: any = ctx;
  for (const p of partes) {
    if (valor == null || typeof valor !== "object") return "";
    valor = valor[p];
  }
  if (valor == null) return "";
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  if (typeof valor !== "string") return "";
  return valor;
}

/**
 * Mapa de aliases legado → caminho canônico no contexto.
 * Mantém retrocompatibilidade com cenários criados antes do `{{...}}`.
 */
const ALIASES_LEGADO: Record<string, string> = {
  nome: "nomeCliente",
  intencao: "intencao",
  horario: "horarioEscolhido",
  // cobrancasAbertas é tratado ANTES (bloco multi-linha) — não cai aqui.
};

/**
 * Interpola um template substituindo variáveis pelo conteúdo do contexto.
 *
 * Ordem:
 *  1. `{{...}}` — formato novo, lookup por path.
 *  2. `{...}` — formato legado, alias mapeia pra caminho.
 *  3. Texto literal preservado.
 *
 * Não recursiva (variável dentro de variável vira texto literal).
 */
export function interpolarVariaveis(
  template: string,
  ctx: Record<string, any>,
): string {
  if (!template) return "";

  // 1) Novo formato {{path.com.pontos}} — ganancia (matches dentro de
  //    legado também). Aceita letras, números, ponto, underscore. Não
  //    aceita espaço pra não casar `{{ algum texto }}` por engano.
  let out = template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_, path: string) => {
    return resolverCaminho(ctx, path);
  });

  // 2) Legado {nome}, {intencao}, {horario} — só letras/_, sem ponto
  //    (pra não conflitar com texto que tenha {algo} qualquer não-tag).
  out = out.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (full, nome: string) => {
    const caminho = ALIASES_LEGADO[nome];
    if (!caminho) return full; // não é alias conhecido, mantém literal
    return resolverCaminho(ctx, caminho);
  });

  return out;
}

/**
 * Catálogo de variáveis disponíveis por tipo de gatilho.
 * Usado pelo frontend pra alimentar o autocomplete `{{`.
 *
 * Variáveis listadas aqui DEVEM existir no contexto montado pelo
 * dispatcher.ts pra cada tipo de gatilho — caso contrário a interpolação
 * silenciosamente vira "". Se adicionar variável aqui, ajuste também o
 * dispatcher.ts pra populá-la no contexto.
 */
export interface CatalogoVariavel {
  path: string;
  label: string;
  exemplo: string;
  /**
   * Categoria semântica pra agrupar no drawer "Informações" do editor.
   * Opcional pra compat com código que monta variáveis sem categoria.
   */
  categoria?: CategoriaVariavel;
}

/**
 * Categorias semânticas das variáveis — usadas pra agrupar visualmente no
 * drawer do editor. Cada uma tem um label humano + ícone (no frontend).
 */
export type CategoriaVariavel =
  | "cliente"
  | "campos_personalizados"
  | "mensagem"
  | "pagamento"
  | "acao"
  | "agendamento"
  | "ia"
  | "passos";

export interface CatalogoGatilho {
  gatilho: string;
  label: string;
  variaveis: CatalogoVariavel[];
}

// ─── Blocos reusáveis (compostos por gatilho abaixo) ────────────────────────

const VARS_CLIENTE: CatalogoVariavel[] = [
  { path: "nomeCliente", label: "Nome do cliente", exemplo: "João Silva", categoria: "cliente" },
  { path: "telefoneCliente", label: "Telefone do cliente", exemplo: "(11) 99999-0000", categoria: "cliente" },
  { path: "emailCliente", label: "Email do cliente", exemplo: "joao@example.com", categoria: "cliente" },
  { path: "contatoId", label: "ID interno do contato", exemplo: "42", categoria: "cliente" },
  { path: "atendenteResponsavelId", label: "Atendente responsável", exemplo: "7", categoria: "cliente" },
];

const VARS_MENSAGEM: CatalogoVariavel[] = [
  { path: "mensagem", label: "Mensagem original do cliente", exemplo: "Quero agendar", categoria: "mensagem" },
  { path: "respostaUsuario", label: "Resposta do cliente (após aguardar)", exemplo: "Sim, pode ser 14h", categoria: "mensagem" },
  { path: "canalTipo", label: "Canal de origem", exemplo: "whatsapp_qr", categoria: "mensagem" },
];

const VARS_PAGAMENTO_RECEBIDO: CatalogoVariavel[] = [
  { path: "pagamentoValor", label: "Valor do pagamento", exemplo: "1500.00", categoria: "pagamento" },
  { path: "pagamentoDescricao", label: "Descrição da cobrança", exemplo: "Honorários", categoria: "pagamento" },
  { path: "pagamentoTipo", label: "Forma de pagamento", exemplo: "PIX", categoria: "pagamento" },
  { path: "valorTotalCliente", label: "Total já pago pelo cliente", exemplo: "5000.00", categoria: "pagamento" },
  { path: "percentualPago", label: "Percentual quitado do contrato", exemplo: "50", categoria: "pagamento" },
  { path: "primeiraCobrancaDoCliente", label: "É a primeira cobrança do cliente?", exemplo: "true", categoria: "pagamento" },
];

const VARS_PAGAMENTO_VENCIDO: CatalogoVariavel[] = [
  { path: "pagamentoValor", label: "Valor da cobrança vencida", exemplo: "1500.00", categoria: "pagamento" },
  { path: "pagamentoDescricao", label: "Descrição da cobrança", exemplo: "Honorários", categoria: "pagamento" },
  { path: "vencimento", label: "Data de vencimento", exemplo: "2026-04-01", categoria: "pagamento" },
  { path: "diasAtraso", label: "Dias de atraso", exemplo: "5", categoria: "pagamento" },
];

const VARS_PAGAMENTO_PROXIMO: CatalogoVariavel[] = [
  { path: "pagamentoValor", label: "Valor da cobrança", exemplo: "1500.00", categoria: "pagamento" },
  { path: "pagamentoDescricao", label: "Descrição da cobrança", exemplo: "Honorários", categoria: "pagamento" },
  { path: "vencimento", label: "Data de vencimento", exemplo: "2026-05-25", categoria: "pagamento" },
  { path: "diasAteVencer", label: "Dias até vencer", exemplo: "3", categoria: "pagamento" },
];

const VARS_ACAO: CatalogoVariavel[] = [
  { path: "acaoApelido", label: "Apelido da ação", exemplo: "Revisional Banco X", categoria: "acao" },
  { path: "acaoNumeroCnj", label: "Número CNJ", exemplo: "0000001-00.2024.8.05.0001", categoria: "acao" },
  { path: "acaoClasse", label: "Classe processual", exemplo: "Reclamação Trabalhista", categoria: "acao" },
  { path: "acaoTipo", label: "Tipo (litigioso/extrajudicial)", exemplo: "litigioso", categoria: "acao" },
  { path: "acaoPolo", label: "Polo do cliente", exemplo: "ativo", categoria: "acao" },
  { path: "acaoValorCausa", label: "Valor da causa", exemplo: "50000", categoria: "acao" },
];

const VARS_AGENDAMENTO: CatalogoVariavel[] = [
  { path: "horarioEscolhido", label: "Horário do agendamento", exemplo: "10/05 às 14h", categoria: "agendamento" },
  { path: "agendamentoFim", label: "Fim do agendamento", exemplo: "10/05 às 15h", categoria: "agendamento" },
  { path: "emailCliente", label: "Email do participante", exemplo: "joao@example.com", categoria: "agendamento" },
  { path: "nomeCliente", label: "Nome do participante", exemplo: "João Silva", categoria: "cliente" },
];

export const CATALOGO_VARIAVEIS: CatalogoGatilho[] = [
  {
    gatilho: "mensagem_canal",
    label: "Mensagem recebida (qualquer canal)",
    variaveis: [...VARS_CLIENTE, ...VARS_MENSAGEM],
  },
  {
    gatilho: "whatsapp_mensagem",
    label: "Mensagem WhatsApp (legado)",
    variaveis: [...VARS_CLIENTE, ...VARS_MENSAGEM],
  },
  {
    gatilho: "novo_lead",
    label: "Novo lead no CRM",
    variaveis: [
      ...VARS_CLIENTE,
      { path: "origemLead", label: "Origem do lead", exemplo: "site", categoria: "mensagem" },
    ],
  },
  {
    gatilho: "pagamento_recebido",
    label: "Pagamento recebido (Asaas)",
    variaveis: [...VARS_CLIENTE, ...VARS_PAGAMENTO_RECEBIDO, ...VARS_ACAO],
  },
  {
    gatilho: "pagamento_vencido",
    label: "Pagamento vencido (Asaas)",
    variaveis: [...VARS_CLIENTE, ...VARS_PAGAMENTO_VENCIDO],
  },
  {
    gatilho: "pagamento_proximo_vencimento",
    label: "Vencimento próximo (Asaas)",
    variaveis: [...VARS_CLIENTE, ...VARS_PAGAMENTO_PROXIMO],
  },
  {
    gatilho: "agendamento_criado",
    label: "Agendamento criado (Cal.com)",
    variaveis: VARS_AGENDAMENTO,
  },
  {
    gatilho: "agendamento_cancelado",
    label: "Agendamento cancelado (Cal.com)",
    variaveis: [
      ...VARS_AGENDAMENTO,
      { path: "motivoCancelamento", label: "Motivo do cancelamento", exemplo: "Cliente pediu", categoria: "agendamento" },
    ],
  },
  {
    gatilho: "agendamento_remarcado",
    label: "Agendamento remarcado (Cal.com)",
    variaveis: [
      ...VARS_AGENDAMENTO,
      { path: "horarioAnterior", label: "Horário antigo (antes de remarcar)", exemplo: "08/05 às 10h", categoria: "agendamento" },
    ],
  },
  {
    gatilho: "agendamento_lembrete",
    label: "Lembrete de agendamento (Cal.com)",
    variaveis: VARS_AGENDAMENTO,
  },
  {
    gatilho: "manual",
    label: "Acionado manualmente",
    variaveis: [...VARS_CLIENTE],
  },
];

/**
 * Lista todas as variáveis disponíveis pra um gatilho específico.
 * Retorna array vazio se gatilho não está no catálogo.
 */
export function variaveisPorGatilho(gatilho: string): CatalogoVariavel[] {
  return CATALOGO_VARIAVEIS.find((c) => c.gatilho === gatilho)?.variaveis || [];
}
