import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRightFromLine, Check, Copy, Info } from "lucide-react";
import { toast } from "sonner";
import { getGatilhoMeta, type GatilhoSmartflow, type TipoPasso } from "@shared/smartflow-types";

interface VarSaida {
  /** Caminho usado em {{...}} — ex: "respostaIA", "kanbanCardId". */
  path: string;
  /** Rótulo humano — descrição curta. */
  label: string;
  /** Tipo aproximado do valor — só pra orientar o usuário. */
  tipo: "texto" | "número" | "lista" | "objeto" | "booleano" | "link";
}

/**
 * Variáveis que **cada tipo de passo** publica no contexto após executar.
 * Sincronizado com `server/smartflow/engine.ts` (handlers que fazem
 * `{ ...ctx, X: valor }`). Se um handler novo publicar variável, lembrar
 * de adicionar aqui pra manter a aba de Saída útil.
 */
const SAIDA_POR_TIPO: Record<TipoPasso, VarSaida[]> = {
  ia_classificar: [
    { path: "intencao", label: "Categoria detectada pela IA", tipo: "texto" },
  ],
  ia_responder: [
    { path: "respostaIA", label: "Resposta gerada pela IA", tipo: "texto" },
  ],
  // Variáveis publicadas por ia_extrair_campos são dinâmicas (chaves da config).
  // O componente resolve isso especialmente — array vazio aqui só satisfaz o tipo.
  ia_extrair_campos: [],
  crm_buscar_contato: [
    { path: "contatoEncontrado", label: "True se achou o contato, false se não", tipo: "booleano" },
    { path: "contatoId", label: "ID do contato encontrado (substitui o anterior)", tipo: "número" },
    { path: "nomeCliente", label: "Nome do contato", tipo: "texto" },
    { path: "telefoneCliente", label: "Telefone do contato", tipo: "texto" },
    { path: "emailCliente", label: "Email do contato", tipo: "texto" },
    { path: "cliente.campos", label: "Campos personalizados do contato (objeto)", tipo: "objeto" },
  ],
  crm_listar_acoes_cliente: [
    { path: "acoes", label: "Lista de processos do cliente (id, CNJ, classe, polo, tipo, valorCausa)", tipo: "lista" },
    { path: "acoesQuantidade", label: "Quantidade de ações listadas", tipo: "número" },
  ],
  processo_buscar_movimentacoes: [
    { path: "movimentacoes", label: "Lista de eventos (tipo, dataEvento, conteudo, fonte)", tipo: "lista" },
    { path: "movimentacoesQuantidade", label: "Quantidade de eventos retornados", tipo: "número" },
    { path: "movimentacaoMaisRecente", label: "Primeiro evento (mais recente) ou null", tipo: "objeto" },
  ],
  calcom_horarios: [
    { path: "horariosDisponiveis", label: "Lista de horários disponíveis", tipo: "lista" },
  ],
  calcom_agendar: [
    { path: "agendamentoId", label: "ID do agendamento criado", tipo: "texto" },
  ],
  calcom_listar: [
    { path: "bookings", label: "Lista de agendamentos do Cal.com", tipo: "lista" },
    { path: "bookingsQuantidade", label: "Quantidade de agendamentos", tipo: "número" },
  ],
  calcom_cancelar: [
    { path: "bookingCancelado", label: "ID do agendamento cancelado", tipo: "texto" },
  ],
  calcom_remarcar: [
    { path: "horarioEscolhido", label: "Novo horário (sobrescreve o anterior)", tipo: "texto" },
  ],
  whatsapp_enviar: [
    { path: "mensagensEnviadas", label: "Lista de mensagens enviadas", tipo: "lista" },
  ],
  transferir: [
    { path: "transferir", label: "Sinaliza transferência pra humano (encerra)", tipo: "booleano" },
  ],
  condicional: [],
  esperar: [],
  webhook: [
    { path: "webhookResultado", label: "Resposta JSON do webhook chamado", tipo: "objeto" },
  ],
  kanban_criar_card: [
    { path: "kanbanCardId", label: "ID do card criado", tipo: "número" },
  ],
  kanban_mover_card: [
    { path: "kanbanCardId", label: "ID do card movido (preserva)", tipo: "número" },
  ],
  kanban_atribuir_responsavel: [
    { path: "kanbanCardId", label: "ID do card (preserva)", tipo: "número" },
  ],
  kanban_tags: [
    { path: "kanbanCardId", label: "ID do card (preserva)", tipo: "número" },
  ],
  asaas_gerar_cobranca: [
    { path: "pagamentoId", label: "ID da cobrança no Asaas", tipo: "texto" },
    { path: "pagamentoLink", label: "Link de pagamento (fatura)", tipo: "link" },
  ],
  asaas_cancelar_cobranca: [],
  asaas_consultar_valor_aberto: [
    { path: "valorTotalAberto", label: "Total em aberto (pendente + vencido), em reais", tipo: "número" },
    { path: "valorTotalPendente", label: "Apenas pendente (não vencido)", tipo: "número" },
    { path: "valorTotalVencido", label: "Apenas vencido", tipo: "número" },
    { path: "cobrancasAbertasQtd", label: "Quantidade de cobranças em aberto", tipo: "número" },
  ],
  asaas_marcar_recebida: [],
  definir_variavel: [],
  definir_campo_personalizado: [],
};

/**
 * Variáveis disponíveis "de cara" (já no contexto inicial) por gatilho —
 * usuário pode usá-las em qualquer passo do fluxo. Espelha o catálogo
 * em `server/smartflow/interpolar.ts`, mas mantido no client pra evitar
 * round-trip pro autocomplete.
 */
const ENTRADA_POR_GATILHO: Partial<Record<GatilhoSmartflow, VarSaida[]>> = {
  whatsapp_mensagem: [
    { path: "mensagem", label: "Mensagem original do cliente", tipo: "texto" },
    { path: "nomeCliente", label: "Nome do cliente", tipo: "texto" },
    { path: "telefoneCliente", label: "Telefone do cliente", tipo: "texto" },
    { path: "contatoId", label: "ID do contato no CRM", tipo: "número" },
  ],
  mensagem_canal: [
    { path: "mensagem", label: "Mensagem original do cliente", tipo: "texto" },
    { path: "nomeCliente", label: "Nome do cliente", tipo: "texto" },
    { path: "telefoneCliente", label: "Telefone do cliente", tipo: "texto" },
    { path: "contatoId", label: "ID do contato no CRM", tipo: "número" },
    { path: "canalTipo", label: "Tipo do canal (whatsapp_qr · instagram · ...)", tipo: "texto" },
  ],
  novo_lead: [
    { path: "nomeCliente", label: "Nome do lead", tipo: "texto" },
    { path: "telefoneCliente", label: "Telefone do lead", tipo: "texto" },
    { path: "emailCliente", label: "Email do lead", tipo: "texto" },
    { path: "contatoId", label: "ID do contato criado", tipo: "número" },
    { path: "origemLead", label: "Origem (site · whatsapp · ...)", tipo: "texto" },
  ],
  pagamento_recebido: [
    { path: "pagamentoId", label: "ID da cobrança no Asaas", tipo: "texto" },
    { path: "pagamentoValor", label: "Valor pago (em centavos)", tipo: "número" },
    { path: "pagamentoDescricao", label: "Descrição da cobrança", tipo: "texto" },
    { path: "pagamentoTipo", label: "Tipo (BOLETO/PIX/CREDIT_CARD)", tipo: "texto" },
    { path: "nomeCliente", label: "Nome do cliente", tipo: "texto" },
    { path: "contatoId", label: "ID do contato no CRM", tipo: "número" },
    { path: "primeiraCobrancaDoCliente", label: "Primeira cobrança paga do cliente?", tipo: "booleano" },
    { path: "primeiraCobrancaDaAcao", label: "Primeira cobrança paga desta ação?", tipo: "booleano" },
    { path: "valorTotalCliente", label: "Total já pago pelo cliente (centavos)", tipo: "número" },
    { path: "percentualPago", label: "Percentual pago do contratado (0-100)", tipo: "número" },
    { path: "acaoId", label: "ID da ação vinculada (quando há)", tipo: "número" },
    { path: "acaoApelido", label: "Apelido da ação", tipo: "texto" },
  ],
  pagamento_vencido: [
    { path: "pagamentoId", label: "ID da cobrança no Asaas", tipo: "texto" },
    { path: "pagamentoValor", label: "Valor da cobrança (centavos)", tipo: "número" },
    { path: "vencimento", label: "Data de vencimento (YYYY-MM-DD)", tipo: "texto" },
    { path: "diasAtraso", label: "Dias de atraso", tipo: "número" },
    { path: "nomeCliente", label: "Nome do cliente", tipo: "texto" },
  ],
  pagamento_proximo_vencimento: [
    { path: "pagamentoId", label: "ID da cobrança no Asaas", tipo: "texto" },
    { path: "pagamentoValor", label: "Valor da cobrança (centavos)", tipo: "número" },
    { path: "vencimento", label: "Data de vencimento (YYYY-MM-DD)", tipo: "texto" },
    { path: "diasAteVencer", label: "Dias até vencer", tipo: "número" },
  ],
  agendamento_criado: [
    { path: "agendamentoId", label: "ID do booking Cal.com", tipo: "texto" },
    { path: "horarioEscolhido", label: "Início do agendamento (ISO)", tipo: "texto" },
  ],
  agendamento_lembrete: [
    { path: "agendamentoId", label: "ID do booking", tipo: "texto" },
    { path: "horarioEscolhido", label: "Início do agendamento", tipo: "texto" },
    { path: "nomeCliente", label: "Nome do participante", tipo: "texto" },
  ],
  manual: [],
};

/**
 * Aba "Saída" do painel — lista as variáveis disponíveis pra usar em
 * passos subsequentes (via {{path}} no template). Mostra:
 *   1. **Deste passo**: o que o passo selecionado adiciona ao contexto
 *      depois de executar.
 *   2. **Do gatilho**: variáveis que já estão no contexto inicial
 *      (disponíveis em qualquer passo).
 *
 * Botão "copiar" coloca `{{path}}` no clipboard pro usuário colar.
 */
export function EditorPainelSaida({
  tipoPasso,
  gatilho,
  configPasso,
}: {
  /** Tipo do passo selecionado. `null` quando o nó selecionado é o gatilho. */
  tipoPasso: TipoPasso | null;
  gatilho: GatilhoSmartflow;
  /** Config do passo — usada pra resolver `chave` em definir_variavel. */
  configPasso?: Record<string, unknown>;
}) {
  const variaveisDoPasso = useMemo(() => {
    if (!tipoPasso) return [];
    if (tipoPasso === "definir_variavel") {
      const chave = String(configPasso?.chave || "").trim();
      if (!chave) return [];
      return [{ path: chave, label: `Variável customizada definida no passo`, tipo: "texto" as const }];
    }
    if (tipoPasso === "definir_campo_personalizado") {
      const chave = String(configPasso?.chave || "").trim();
      if (!chave) return [];
      return [
        { path: `cliente.campos.${chave}`, label: "Campo personalizado salvo no cadastro", tipo: "texto" as const },
      ];
    }
    if (tipoPasso === "ia_extrair_campos") {
      // Variáveis vêm dinamicamente da config — cada campo extraído gera
      // `{{extracao.<chave>}}`; quando `persistir=true`, também publica
      // `{{cliente.campos.<chave>}}` (porque o handler espelha no contexto).
      const campos = Array.isArray(configPasso?.campos)
        ? (configPasso!.campos as Array<{ chave: string; tipo?: string; persistir?: boolean }>)
        : [];
      const out: VarSaida[] = [];
      for (const c of campos) {
        const chave = String(c.chave || "").trim();
        if (!chave) continue;
        out.push({
          path: `extracao.${chave}`,
          label: `Valor extraído (${c.tipo || "texto"})`,
          tipo: mapearTipo(c.tipo),
        });
        if (c.persistir) {
          out.push({
            path: `cliente.campos.${chave}`,
            label: "Persistido no cadastro do cliente",
            tipo: mapearTipo(c.tipo),
          });
        }
      }
      return out;
    }
    return SAIDA_POR_TIPO[tipoPasso] || [];
  }, [tipoPasso, configPasso]);

  const variaveisDoGatilho = ENTRADA_POR_GATILHO[gatilho] || [];
  const metaGatilho = getGatilhoMeta(gatilho);

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-3 flex items-start gap-2">
        <Info className="h-3.5 w-3.5 text-blue-700 dark:text-blue-300 shrink-0 mt-0.5" />
        <p className="text-[11px] text-blue-900 dark:text-blue-200 leading-snug">
          Estas são as variáveis que você pode usar em <strong>passos seguintes</strong>.
          Cole o nome com <code className="bg-blue-100 dark:bg-blue-900/60 px-1 rounded font-mono">{`{{`}path{`}}`}</code> em
          qualquer template (texto WhatsApp, descrição de card, etc.).
        </p>
      </div>

      {tipoPasso && (
        <SecaoVariaveis
          titulo="📤 Adicionadas por este passo"
          subtitulo={variaveisDoPasso.length === 0
            ? "Este passo não adiciona variáveis novas — só executa ação."
            : "Disponíveis depois que este passo rodar."}
          variaveis={variaveisDoPasso}
        />
      )}

      <SecaoVariaveis
        titulo={`🎯 Disponíveis desde o gatilho`}
        subtitulo={`${metaGatilho.label} — já estão no contexto desde o início.`}
        variaveis={variaveisDoGatilho}
      />

      <p className="text-[10px] text-muted-foreground italic px-1 leading-snug">
        💡 Use <code className="font-mono">{`{{cliente.campos.minhaChave}}`}</code> pra
        ler campos personalizados do cliente — disponíveis em todos os gatilhos
        que têm <code className="font-mono">contatoId</code>.
      </p>
    </div>
  );
}

/** Heurística pra mapear tipo lógico do campo extraído → tipo de exibição. */
function mapearTipo(tipo?: string): VarSaida["tipo"] {
  if (tipo === "numero") return "número";
  if (tipo === "boolean") return "booleano";
  if (tipo === "lista_texto") return "lista";
  return "texto";
}

function SecaoVariaveis({
  titulo,
  subtitulo,
  variaveis,
}: {
  titulo: string;
  subtitulo: string;
  variaveis: VarSaida[];
}) {
  return (
    <div>
      <p className="text-xs font-bold mb-1">{titulo}</p>
      <p className="text-[10px] text-muted-foreground mb-2 leading-snug">{subtitulo}</p>
      {variaveis.length === 0 ? null : (
        <div className="space-y-1">
          {variaveis.map((v) => (
            <VariavelChip key={v.path} variavel={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function VariavelChip({ variavel }: { variavel: VarSaida }) {
  const [copiado, setCopiado] = useState(false);
  const expr = `{{${variavel.path}}}`;
  const handleCopiar = async () => {
    try {
      await navigator.clipboard.writeText(expr);
      setCopiado(true);
      toast.success(`Copiado: ${expr}`);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      toast.error("Não foi possível copiar — selecione manualmente.");
    }
  };
  return (
    <button
      onClick={handleCopiar}
      className="w-full group flex items-start gap-2 px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-card hover:border-violet-300 dark:hover:border-violet-800 hover:shadow-sm transition-all text-left"
      title={`Clique pra copiar ${expr}`}
    >
      <ArrowRightFromLine className="h-3 w-3 text-violet-600 shrink-0 mt-1" />
      <div className="flex-1 min-w-0">
        <code className="text-[11px] font-mono font-semibold text-violet-700 dark:text-violet-300 truncate block">
          {expr}
        </code>
        <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
          {variavel.label} <span className="text-muted-foreground/60">· {variavel.tipo}</span>
        </p>
      </div>
      <span className="shrink-0 mt-0.5 text-muted-foreground opacity-0 group-hover:opacity-100">
        {copiado ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      </span>
    </button>
  );
}
