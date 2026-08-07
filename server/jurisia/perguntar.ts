/**
 * Uma pergunta do JurisIA sobre um processo.
 *
 * O desenho tem uma inversão importante: o prompt NÃO é a garantia. Ele pede
 * o formato, mas quem decide se a resposta vale é `validarResposta`, que
 * confere cada id citado contra as fontes efetivamente entregues. Já apanhamos
 * de confiar em instrução de prompt uma vez — o filtro anti-enchimento das
 * movimentações proibia frase de enchimento e o modelo produzia mesmo assim.
 */

import { chamarIA } from "../_core/ai-call";
import { montarContextoProcesso, type EventoContexto } from "../../shared/jurisia-contexto";
import { validarResposta, type RespostaJurisIA } from "../../shared/jurisia-resposta";

const SYSTEM = `Você é um assistente jurídico que responde SOBRE UM PROCESSO ESPECÍFICO, para o advogado que cuida dele.

Você recebe um conjunto de movimentações marcadas como [FONTE <id>]. Essas são as ÚNICAS coisas que você sabe sobre este processo.

Responda em JSON:
{
  "achou": true|false,
  "afirmacoes": [{ "texto": "...", "fontes": [<id>, ...] }],
  "conclusao": "..." | null
}

Regras:
- Cada item de "afirmacoes" é um fato do processo e PRECISA citar os ids das fontes de onde saiu.
- Use apenas ids que aparecem no contexto. Nunca invente um id, nunca cite lei, súmula ou acórdão que não esteja nas fontes.
- Se o contexto não responde a pergunta, devolva "achou": false e explique em "conclusao" o que faltou. Isso é uma resposta boa, não uma falha.
- "conclusao" é sua leitura ou recomendação — o único trecho que pode não ter fonte.
- Português do Brasil, direto, sem saudação e sem repetir a pergunta. Fale como quem conversa com um advogado, não como quem redige parecer.`;

export interface ResultadoPergunta {
  ok: boolean;
  resposta: RespostaJurisIA | null;
  /** Preenchido quando a trava barrou — vai pro banco pra poder auditar. */
  recusa: string | null;
  fontes: Array<{ id: number; rotulo: string; data: string }>;
}

export async function perguntarSobreProcesso(args: {
  escritorioId: number;
  eventos: EventoContexto[];
  pergunta: string;
  /** Turnos anteriores (papel + texto), do mais antigo pro mais recente. */
  historico?: Array<{ papel: "usuario" | "assistente"; texto: string }>;
}): Promise<ResultadoPergunta> {
  const ctx = montarContextoProcesso(args.eventos);

  // Processo sem nenhuma movimentação: não vale gastar chamada pra o modelo
  // dizer que não sabe — a trava recusaria qualquer coisa que ele inventasse.
  if (ctx.fontes.length === 0) {
    return {
      ok: true,
      recusa: null,
      fontes: [],
      resposta: {
        achou: false,
        afirmacoes: [],
        conclusao: "Este processo ainda não tem movimentação capturada, então não há o que consultar.",
        fontesUsadas: [],
      },
    };
  }

  const conversa = (args.historico ?? [])
    .slice(-6)
    .map((m) => `${m.papel === "usuario" ? "Advogado" : "Você"}: ${m.texto}`)
    .join("\n");

  const user = [
    "MOVIMENTAÇÕES DESTE PROCESSO:",
    ctx.texto,
    conversa ? `\nCONVERSA ATÉ AQUI:\n${conversa}` : "",
    `\nPERGUNTA DO ADVOGADO:\n${args.pergunta}`,
  ]
    .filter(Boolean)
    .join("\n");

  const bruto = await chamarIA({
    escritorioId: args.escritorioId,
    system: SYSTEM,
    user,
    json: true,
    maxTokens: 1600,
    temperature: 0.2,
    timeoutMs: 45_000,
  });

  const v = validarResposta(bruto, ctx.fontes.map((f) => f.id));
  if (!v.ok) {
    return { ok: false, resposta: null, recusa: v.motivo, fontes: ctx.fontes };
  }

  // Só devolve as fontes que a resposta de fato usou — a coluna da direita
  // lista o que sustenta o texto, não o que foi oferecido ao modelo.
  const usadas = new Set(v.resposta.fontesUsadas);
  return {
    ok: true,
    resposta: v.resposta,
    recusa: null,
    fontes: ctx.fontes.filter((f) => usadas.has(f.id)),
  };
}
