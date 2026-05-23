import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import type { GatilhoSmartflow, TipoPasso } from "@shared/smartflow-types";

export type SeveridadeValidacao = "erro" | "aviso" | "info";

export interface ItemValidacao {
  severidade: SeveridadeValidacao;
  /** Texto curto em pt-BR, voz ativa, foco no problema. */
  mensagem: string;
}

/**
 * Variáveis que cada gatilho coloca no contexto inicial. Espelha o que
 * o dispatcher (`server/smartflow/dispatcher.ts`) popula em cada caso.
 *
 * Mantém em sincronia com o dispatcher quando adicionar gatilho novo —
 * senão a validação ou marca falso positivo (chave existe lá mas não aqui)
 * ou esconde problema real (chave não existe lá mas validador diz que sim).
 */
const VARS_DO_GATILHO: Record<GatilhoSmartflow, string[]> = {
  // `respostaUsuario` aparece quando o fluxo é retomado por uma execução
  // que estava em `whatsapp_aguardar_resposta` — não é variável "do gatilho"
  // estrito senso, mas o validador trata como tal pra evitar falso positivo
  // em fluxos que usam isso.
  whatsapp_mensagem: ["mensagem", "contatoId", "telefoneCliente", "canalId", "conversaId", "canalTipo", "respostaUsuario"],
  mensagem_canal: ["mensagem", "contatoId", "telefoneCliente", "canalId", "conversaId", "canalTipo", "respostaUsuario"],
  novo_lead: ["contatoId", "nomeCliente", "telefoneCliente", "emailCliente", "origemLead"],
  pagamento_recebido: ["pagamentoId", "contatoId", "nomeCliente", "telefoneCliente", "emailCliente", "pagamentoValor", "primeiraCobrancaDoCliente"],
  pagamento_vencido: ["pagamentoId", "contatoId", "nomeCliente", "telefoneCliente", "pagamentoValor", "vencimento", "diasAtraso"],
  pagamento_proximo_vencimento: ["pagamentoId", "contatoId", "nomeCliente", "telefoneCliente", "pagamentoValor", "vencimento", "diasAteVencer"],
  agendamento_criado: ["agendamentoId", "horarioEscolhido", "nomeCliente", "emailCliente"],
  agendamento_cancelado: ["agendamentoId", "horarioEscolhido", "nomeCliente", "motivoCancelamento"],
  agendamento_remarcado: ["agendamentoId", "horarioEscolhido", "horarioAnterior", "nomeCliente"],
  agendamento_lembrete: ["agendamentoId", "horarioEscolhido", "nomeCliente", "emailCliente"],
  // Gatilho manual: usuário injeta o que quiser via "Testar" — não dá pra
  // garantir nada. Validador trata "manual" como permissivo (não mostra erro
  // de variável faltando).
  manual: [],
};

/**
 * Avalia se o passo configurado vai funcionar em runtime, considerando
 * o gatilho do cenário e as variáveis que ele popula. Retorna lista de
 * problemas — erro bloqueia conceitualmente (execução vai falhar),
 * aviso é heurístico (pode funcionar se ctx for enriquecido).
 *
 * `tipoPasso=null` significa que o gatilho está selecionado — só validamos
 * o passo aqui, gatilho tem painel próprio.
 */
export function validarPasso(
  tipoPasso: TipoPasso | null,
  gatilho: GatilhoSmartflow,
  config: Record<string, unknown>,
): ItemValidacao[] {
  if (!tipoPasso) return [];
  const itens: ItemValidacao[] = [];
  const varsGatilho = new Set(VARS_DO_GATILHO[gatilho] || []);
  const gatilhoIsManual = gatilho === "manual";

  // Helper: requer uma variável no ctx. Se o gatilho é manual, vira aviso
  // (usuário pode injetar via "Testar"). Pra outros gatilhos, vira erro.
  const requerVar = (chave: string, motivo: string) => {
    if (varsGatilho.has(chave)) return;
    if (gatilhoIsManual) {
      itens.push({ severidade: "aviso", mensagem: `${motivo} — injete \`${chave}\` no contexto do teste manual.` });
    } else {
      itens.push({ severidade: "erro", mensagem: `${motivo} — o gatilho atual não popula \`${chave}\`. Esse passo vai falhar.` });
    }
  };

  switch (tipoPasso) {
    case "definir_campo_personalizado": {
      const chave = String(config.chave || "").trim();
      if (!chave) itens.push({ severidade: "erro", mensagem: "Escolha qual campo personalizado salvar." });
      requerVar("contatoId", "Pra salvar no cadastro, precisa do contato vinculado");
      break;
    }

    case "ia_extrair_campos": {
      const campos = Array.isArray(config.campos) ? (config.campos as Array<{ chave?: string; persistir?: boolean }>) : [];
      if (campos.length === 0) {
        itens.push({ severidade: "erro", mensagem: "Adicione pelo menos 1 campo a extrair." });
      } else {
        const semChave = campos.filter((c) => !String(c.chave || "").trim());
        if (semChave.length > 0) {
          itens.push({ severidade: "erro", mensagem: `${semChave.length} campo(s) sem chave definida.` });
        }
        const algumPersistir = campos.some((c) => c.persistir);
        if (algumPersistir) {
          requerVar("contatoId", 'Algum campo está marcado como "Salvar no cadastro"');
        }
      }
      // Fonte da mensagem (default 'mensagem')
      const fonte = String(config.fonteMensagem || "mensagem").trim();
      if (fonte === "mensagem" && !varsGatilho.has("mensagem")) {
        itens.push({
          severidade: "aviso",
          mensagem: `O gatilho atual não tem "mensagem" no contexto. Configure "De onde vem a mensagem?" pra apontar pra outra variável (ex: respostaUsuario).`,
        });
      }
      break;
    }

    case "ia_classificar":
      requerVar("mensagem", "Precisa de uma mensagem pra classificar");
      break;

    case "whatsapp_aguardar_resposta": {
      requerVar("contatoId", "Pra aguardar resposta, precisa do contato");
      if (!varsGatilho.has("canalId") && !varsGatilho.has("telefoneCliente")) {
        itens.push({
          severidade: gatilhoIsManual ? "aviso" : "erro",
          mensagem: "Sem canal nem telefone no contexto — não há onde enviar a pergunta.",
        });
      }
      const tpl = String((config as any).template || "").trim();
      const opcs = Array.isArray((config as any).opcoes) ? ((config as any).opcoes as string[]) : [];
      if (!tpl && opcs.filter((o) => o.trim()).length === 0) {
        itens.push({ severidade: "erro", mensagem: "Configure a mensagem ou pelo menos 1 opção." });
      }
      break;
    }

    case "whatsapp_enviar": {
      // Funciona com canalId OU telefoneCliente. Pra gatilhos que não têm
      // nenhum dos dois (ex: agendamento_*), aviso pra usuário considerar.
      if (!varsGatilho.has("canalId") && !varsGatilho.has("telefoneCliente")) {
        itens.push({
          severidade: gatilhoIsManual ? "aviso" : "erro",
          mensagem: `Sem canal nem telefone no contexto — o envio não tem destino. Use um passo "Buscar contato" antes pra resolver o telefone.`,
        });
      }
      const template = String(config.template || "").trim();
      if (!template) {
        itens.push({ severidade: "aviso", mensagem: "Template vazio — vai usar `{{respostaIA}}` se houver, senão envia mensagem em branco." });
      }
      break;
    }

    case "asaas_gerar_cobranca":
    case "asaas_consultar_valor_aberto": {
      requerVar("contatoId", "Asaas precisa do contato pra resolver o cliente vinculado");
      if (tipoPasso === "asaas_gerar_cobranca") {
        const valor = String((config as any).valor || "").trim();
        if (!valor) itens.push({ severidade: "erro", mensagem: "Valor da cobrança vazio." });
      }
      break;
    }

    case "asaas_cancelar_cobranca":
    case "asaas_marcar_recebida": {
      const pagId = String((config as any).pagamentoId || "").trim();
      if (!pagId && !varsGatilho.has("pagamentoId")) {
        itens.push({
          severidade: "erro",
          mensagem: "Sem `pagamentoId` no contexto nem na config — não tem como identificar a cobrança.",
        });
      }
      break;
    }

    case "kanban_criar_card": {
      const titulo = String((config as any).titulo || "").trim();
      const funilId = (config as any).funilId;
      const colunaId = (config as any).colunaId;
      if (!titulo) {
        itens.push({
          severidade: "aviso",
          mensagem: "Sem título configurado — vai usar `{{pagamentoDescricao}}` ou `{{nomeCliente}}` como fallback.",
        });
      }
      if (!funilId && !colunaId) {
        itens.push({
          severidade: "aviso",
          mensagem: "Sem funil/coluna específicos — vai usar o primeiro funil do escritório.",
        });
      }
      break;
    }

    case "calcom_remarcar":
    case "calcom_cancelar": {
      const bookingId = String((config as any).bookingId || "").trim();
      if (!bookingId && !varsGatilho.has("agendamentoId")) {
        itens.push({
          severidade: "erro",
          mensagem: "Sem `bookingId` na config nem `agendamentoId` no contexto — não dá pra saber qual booking mexer.",
        });
      }
      break;
    }

    case "para_cada_item": {
      const caminho = String((config as any).caminhoLista || "").trim();
      if (!caminho) {
        itens.push({
          severidade: "aviso",
          mensagem: "Caminho da lista vazio — vai usar `acoes` por default; se a lista não existir, loop não executa.",
        });
      }
      const limite = Number((config as any).limite || 0);
      if (limite > 50) {
        itens.push({
          severidade: "aviso",
          mensagem: `Limite alto (${limite}) — cuidado pra não estourar MAX_PASSOS_EXECUCAO (50) se o corpo for grande.`,
        });
      }
      break;
    }

    case "esperar": {
      const delay = Number((config as any).delayMinutos || 0);
      if (delay <= 0) {
        itens.push({
          severidade: "aviso",
          mensagem: "Delay zero ou vazio — passo não vai pausar nada.",
        });
      }
      break;
    }

    case "condicional": {
      const cs = (config as any).condicoes;
      const legadoCampo = (config as any).campo;
      const temCondicoes = Array.isArray(cs) && cs.length > 0;
      if (!temCondicoes && !legadoCampo) {
        itens.push({
          severidade: "erro",
          mensagem: "Nenhuma condição configurada — adicione pelo menos uma.",
        });
      }
      break;
    }
  }

  return itens;
}

/**
 * Renderiza a lista de validações como cards coloridos. Quando lista vazia,
 * renderiza nada (limpa). Caller decide onde encaixar (topo ou fim do painel).
 */
export function ValidacaoPassoPanel({ itens }: { itens: ItemValidacao[] }) {
  if (itens.length === 0) return null;
  const erros = itens.filter((i) => i.severidade === "erro");
  const avisos = itens.filter((i) => i.severidade === "aviso");
  const infos = itens.filter((i) => i.severidade === "info");

  return (
    <div className="space-y-1.5">
      {erros.map((i, idx) => (
        <div
          key={`e-${idx}`}
          className="flex items-start gap-1.5 text-[11px] rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-2 py-1.5 text-red-900 dark:text-red-200"
        >
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="leading-snug">{i.mensagem}</span>
        </div>
      ))}
      {avisos.map((i, idx) => (
        <div
          key={`a-${idx}`}
          className="flex items-start gap-1.5 text-[11px] rounded-md border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="leading-snug">{i.mensagem}</span>
        </div>
      ))}
      {infos.map((i, idx) => (
        <div
          key={`i-${idx}`}
          className="flex items-start gap-1.5 text-[11px] rounded-md border border-blue-300 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-2 py-1.5 text-blue-900 dark:text-blue-200"
        >
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="leading-snug">{i.mensagem}</span>
        </div>
      ))}
    </div>
  );
}
