import { trpc } from "@/lib/trpc";
import { Sparkles, ChevronRight, ScrollText, Heart } from "lucide-react";
import { useState } from "react";
import { CustomerPanel } from "./customer-panel";

/**
 * AI Rail — barra lateral direita do Atendimento.
 *
 * Estados:
 *   - "rail"      → 64px, mostra ícones + indicadores ao vivo (Health/Risk)
 *   - "panel"     → 320px, mostra Customer 360° (perfil cliente, processos, $$)
 *
 * Foi pensada pra dar protagonismo ao chat: rail por padrão deixa o chat
 * gigante, e quando o atendente precisar do contexto cliente abre o painel.
 */
type Modo = "rail" | "panel";

export function AIRail({
  conversaId,
  contatoId,
  onAbrirLinhaTempo,
  onOpenWhatsapp,
}: {
  conversaId: number | null;
  contatoId: number | null;
  onAbrirLinhaTempo: () => void;
  onOpenWhatsapp?: (p?: string) => void;
}) {
  const [modo, setModo] = useState<Modo>("rail");

  if (modo === "panel" && contatoId) {
    return (
      <div className="border-l bg-card flex flex-col w-[340px] max-w-[340px]">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-gradient-to-r from-violet-50/40 to-indigo-50/40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <div>
              <p className="text-xs font-bold">Customer 360°</p>
              <p className="text-[10px] text-muted-foreground">Perfil completo</p>
            </div>
          </div>
          <button
            className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground"
            onClick={() => setModo("rail")}
            title="Colapsar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <CustomerPanel
            contatoId={contatoId}
            conversaId={conversaId ?? undefined}
            onOpenWhatsapp={onOpenWhatsapp}
          />
        </div>
      </div>
    );
  }

  // RAIL colapsado
  return (
    <div className="border-l bg-gradient-to-b from-violet-50/30 via-background to-background flex flex-col items-center py-3 w-[64px]">
      <button
        onClick={() => contatoId && setModo("panel")}
        disabled={!contatoId}
        className={
          "w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-sm hover:shadow-md transition mb-3 relative " +
          (!contatoId ? "opacity-40 cursor-not-allowed" : "cursor-pointer")
        }
        title="Abrir Customer 360°"
      >
        <Sparkles className="h-4 w-4 text-white" />
      </button>
      <div className="w-8 h-px bg-border mb-3" />

      <RailButton
        icon={<ScrollText className="h-4 w-4 text-violet-600" />}
        label="Linha do tempo"
        onClick={onAbrirLinhaTempo}
        disabled={!contatoId}
      />
      {/* "Ações IA", "Templates" e "Histórico" foram removidos: eram botões
          desabilitados que só ocupavam espaço (placeholders mortos). Quando
          essas ações forem implementadas, devolva os RailButton aqui. */}

      <div className="flex-1" />

      {/* Health + Risk gauges (ao vivo) */}
      {conversaId && <RiskMiniGauge conversaId={conversaId} />}
    </div>
  );
}

function RailButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center mb-2 transition " +
        (disabled
          ? "opacity-40 cursor-not-allowed"
          : "hover:border-violet-300 hover:bg-violet-50/40 cursor-pointer")
      }
      title={label}
    >
      {icon}
    </button>
  );
}

function RiskMiniGauge({ conversaId }: { conversaId: number }) {
  const { data } = trpc.atendimentoIa.riskScore.useQuery(
    { conversaId },
    { staleTime: 60_000, retry: false },
  );

  if (!data) return null;
  const corBg =
    data.nivel === "saudavel"
      ? "from-emerald-50 to-emerald-100 border-emerald-200"
      : data.nivel === "atenção"
        ? "from-amber-50 to-amber-100 border-amber-200"
        : data.nivel === "risco"
          ? "from-orange-50 to-orange-100 border-orange-200"
          : "from-rose-50 to-rose-100 border-rose-200";
  const corText =
    data.nivel === "saudavel"
      ? "text-emerald-700"
      : data.nivel === "atenção"
        ? "text-amber-700"
        : data.nivel === "risco"
          ? "text-orange-700"
          : "text-rose-700";

  return (
    <div className="flex flex-col items-center gap-1" title={data.sinais.length ? data.sinais.join(" · ") : "Cliente saudável"}>
      <span className="text-[9px] font-bold text-muted-foreground uppercase">Health</span>
      <div className={"w-10 h-10 rounded-full bg-gradient-to-br border flex items-center justify-center " + corBg}>
        <span className={"text-[11px] font-black " + corText}>{data.score}</span>
      </div>
      {data.sinais.length > 0 && (
        <Heart className="h-3 w-3 text-rose-500 mt-1" />
      )}
    </div>
  );
}
