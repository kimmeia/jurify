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
}

export interface CatalogoGatilho {
  gatilho: string;
  label: string;
  variaveis: CatalogoVariavel[];
}

export const CATALOGO_VARIAVEIS: CatalogoGatilho[] = [
  {
    gatilho: "pagamento_recebido",
    label: "Pagamento recebido (Asaas)",
    variaveis: [
      { path: "nomeCliente", label: "Nome do cliente", exemplo: "João Silva" },
      { path: "telefoneCliente", label: "Telefone do cliente", exemplo: "(11) 99999-0000" },
      { path: "emailCliente", label: "Email do cliente", exemplo: "joao@example.com" },
      { path: "contatoId", label: "ID do contato no CRM", exemplo: "42" },
      { path: "pagamentoValor", label: "Valor do pagamento", exemplo: "1500.00" },
      { path: "pagamentoDescricao", label: "Descrição da cobrança", exemplo: "Honorários" },
      { path: "pagamentoTipo", label: "Tipo (BOLETO/PIX/...)", exemplo: "PIX" },
      { path: "valorTotalCliente", label: "Valor total já pago pelo cliente", exemplo: "5000.00" },
      { path: "percentualPago", label: "Percentual pago do total contratado", exemplo: "50" },
    ],
  },
  {
    gatilho: "pagamento_vencido",
    label: "Pagamento vencido (Asaas)",
    variaveis: [
      { path: "nomeCliente", label: "Nome do cliente", exemplo: "João Silva" },
      { path: "telefoneCliente", label: "Telefone do cliente", exemplo: "(11) 99999-0000" },
      { path: "emailCliente", label: "Email do cliente", exemplo: "joao@example.com" },
      { path: "contatoId", label: "ID do contato no CRM", exemplo: "42" },
      { path: "pagamentoValor", label: "Valor do pagamento vencido", exemplo: "1500.00" },
      { path: "pagamentoDescricao", label: "Descrição da cobrança", exemplo: "Honorários" },
    ],
  },
  {
    gatilho: "mensagem_recebida",
    label: "Mensagem recebida (WhatsApp)",
    variaveis: [
      { path: "nomeCliente", label: "Nome do cliente", exemplo: "João Silva" },
      { path: "telefoneCliente", label: "Telefone do cliente", exemplo: "(11) 99999-0000" },
      { path: "mensagem", label: "Mensagem original do cliente", exemplo: "Quero agendar" },
      { path: "intencao", label: "Intenção detectada (IA)", exemplo: "agendamento" },
      { path: "horarioEscolhido", label: "Horário escolhido (após Cal.com)", exemplo: "10/05 às 14h" },
    ],
  },
];

/**
 * Lista todas as variáveis disponíveis pra um gatilho específico.
 * Retorna array vazio se gatilho não está no catálogo.
 */
export function variaveisPorGatilho(gatilho: string): CatalogoVariavel[] {
  return CATALOGO_VARIAVEIS.find((c) => c.gatilho === gatilho)?.variaveis || [];
}
