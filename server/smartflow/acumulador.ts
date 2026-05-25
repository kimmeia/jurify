/**
 * Acumulador de mensagens recebidas (janela deslizante).
 *
 * Junta mensagens "picadas" do cliente (ex: "oi" / "queria agendar" / "sobre
 * um processo") numa só antes de processar o fluxo. A cada mensagem nova o
 * cronômetro reinicia; quando o cliente fica `janelaSegundos` quieto, dispara
 * `run(mensagemCombinada)` UMA vez com tudo junto.
 *
 * Buffer EM MEMÓRIA — pressupõe instância única (caso do deploy atual). Se um
 * dia rodar em múltiplas instâncias, trocar por buffer no banco (a chave já é
 * estável: `${canalId}:${conversaId}`).
 */
import { createLogger } from "../_core/logger";

const log = createLogger("smartflow-acumulador");

interface Pendente {
  timer: ReturnType<typeof setTimeout>;
  mensagens: string[];
  run: (combinada: string) => Promise<void>;
}

const buffers = new Map<string, Pendente>();

/**
 * Bufferiza `mensagem` sob `chave` e (re)agenda o disparo pra daqui
 * `janelaSegundos`. Cada chamada reinicia o cronômetro (deslizante). Quando
 * dispara, chama o `run` MAIS RECENTE com todas as mensagens unidas por "\n".
 */
export function acumularMensagem(
  chave: string,
  janelaSegundos: number,
  mensagem: string,
  run: (combinada: string) => Promise<void>,
): void {
  const prev = buffers.get(chave);
  const mensagens = prev ? prev.mensagens : [];
  mensagens.push(mensagem);
  if (prev) clearTimeout(prev.timer);

  const ms = Math.max(1, janelaSegundos) * 1000;
  const timer = setTimeout(() => {
    buffers.delete(chave);
    const combinada = mensagens.join("\n").trim();
    void run(combinada).catch((err) => {
      log.error({ err: err?.message || String(err), chave }, "acumulador: run falhou");
    });
  }, ms);
  // Não segura o processo vivo só por causa do timer (relevante em testes/boot).
  if (typeof (timer as any).unref === "function") (timer as any).unref();

  buffers.set(chave, { timer, mensagens, run });
}

// ─── Helpers de teste ───────────────────────────────────────────────────────
export function _resetAcumulador(): void {
  for (const p of buffers.values()) clearTimeout(p.timer);
  buffers.clear();
}
export function _pendentesAcumulador(): number {
  return buffers.size;
}
