/**
 * Os botões do WhatsApp dentro da conversa.
 *
 * Eles saem para o cliente pela Cloud API, mas quem atende via só o texto da
 * pergunta — e a escolha do cliente chegava com a mesma cara de mensagem
 * digitada. Aqui o registro fica completo: o que foi oferecido, e o que ele
 * clicou.
 *
 * Os botões são desenhados DESATIVADOS de propósito: é o registro de um envio
 * que já aconteceu, não um controle. Quem clica é o cliente, no WhatsApp dele.
 */
import { MousePointerClick } from "lucide-react";

import { cliqueDoPayload, envioInterativoDoPayload } from "@shared/mensagem-interativa";

export function OpcoesEnviadas({ payload }: { payload: unknown }) {
  const envio = envioInterativoDoPayload(payload);
  if (!envio) return null;
  const rotulo = envio.template
    ? "Botões do template"
    : envio.modo === "lista"
      ? `Lista enviada${envio.drawerLabel ? ` · ${envio.drawerLabel}` : ""}`
      : "Botões enviados";
  return (
    <div className="mt-1.5 border-t border-current/20 pt-1.5" data-testid="opcoes-enviadas">
      <p className="text-micro font-bold uppercase tracking-wide opacity-60">{rotulo}</p>
      <div className="mt-1 flex flex-col gap-1">
        {envio.opcoes.map((o) => (
          <span
            key={o.id}
            className="rounded-md border border-current/30 bg-background/70 px-2 py-1 text-center text-micro font-semibold text-foreground/80"
          >
            {o.titulo}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CliqueEmBotao({ payload }: { payload: unknown }) {
  const clique = cliqueDoPayload(payload);
  if (!clique) return null;
  return (
    <span
      className="mb-1 inline-flex items-center gap-1 rounded-full border border-info/30 bg-info-bg px-2 py-0.5 text-micro font-bold uppercase tracking-wide text-info-fg"
      data-testid="clicou-no-botao"
    >
      <MousePointerClick className="h-3 w-3" />
      clicou no botão
    </span>
  );
}
