import { trpc } from "@/lib/trpc";
import { Sparkles, ChevronRight, ScrollText, Heart, Bot } from "lucide-react";
import { useState } from "react";
import { CustomerPanel } from "./customer-panel";
import { useBotToggle, botStatusInfo } from "./use-bot-toggle";

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
  conversaStatus,
  onUpdate,
  onAbrirLinhaTempo,
  onOpenWhatsapp,
}: {
  conversaId: number | null;
  contatoId: number | null;
  conversaStatus?: string;
  onUpdate?: () => void;
  onAbrirLinhaTempo: () => void;
  onOpenWhatsapp?: (p?: string) => void;
}) {
  const [modo, setModo] = useState<Modo>("rail");
  const bot = botStatusInfo(conversaStatus);
  const botToggle = useBotToggle(onUpdate);
  const handleToggleBot = () => conversaId && botToggle.toggle(conversaId, bot.pausado);

  if (modo === "panel" && contatoId) {
    return (
      <div className="border-l bg-card flex flex-col w-[340px] max-w-[340px]">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-info-bg/40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-info flex items-center justify-center">
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
            botManaged={bot.managed}
            botPausado={bot.pausado}
            togglingBot={botToggle.pending}
            onToggleBot={handleToggleBot}
          />
        </div>
      </div>
    );
  }

  // RAIL colapsado
  return (
    <div className="border-l bg-gradient-to-b from-info-bg/30 via-background to-background flex flex-col items-center py-3 w-[64px]">
      <button
        onClick={() => contatoId && setModo("panel")}
        disabled={!contatoId}
        className={
          "w-10 h-10 rounded-xl bg-info flex items-center justify-center shadow-sm hover:shadow-md transition mb-3 relative " +
          (!contatoId ? "opacity-40 cursor-not-allowed" : "cursor-pointer")
        }
        title="Abrir Customer 360°"
      >
        <Sparkles className="h-4 w-4 text-white" />
      </button>
      <div className="w-8 h-px bg-border mb-3" />

      {/* Toggle do bot — visível mesmo com o painel colapsado (o controle
          completo, com texto, vive no Customer 360 expandido). */}
      {bot.managed && conversaId && (
        <button
          onClick={handleToggleBot}
          disabled={botToggle.pending}
          title={bot.pausado ? "Bot pausado — clique para reativar" : "Bot ativo — clique para pausar e assumir"}
          className={
            "relative w-10 h-10 rounded-xl border flex items-center justify-center mb-2 transition disabled:opacity-50 " +
            (bot.pausado
              ? "bg-warning-bg border-warning/30 text-warning-fg hover:bg-warning-bg dark:border-warning/30"
              : "bg-success-bg border-success/30 text-success-fg hover:bg-success-bg dark:border-success/30")
          }
        >
          <Bot className="h-4 w-4" />
          <span
            className={
              "absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-card " +
              (bot.pausado ? "bg-warning" : "bg-success")
            }
          />
        </button>
      )}

      <RailButton
        icon={<ScrollText className="h-4 w-4 text-info-fg" />}
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
          : "hover:border-info/30 hover:bg-info-bg/40 cursor-pointer")
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
      ? "from-success-bg to-success-bg border-success/30"
      : data.nivel === "atenção"
        ? "from-warning-bg to-warning-bg border-warning/30"
        : data.nivel === "risco"
          ? "from-warning-bg to-warning-bg border-warning/30"
          : "from-danger-bg to-danger-bg border-danger/30";
  const corText =
    data.nivel === "saudavel"
      ? "text-success-fg"
      : data.nivel === "atenção"
        ? "text-warning-fg"
        : data.nivel === "risco"
          ? "text-warning-fg"
          : "text-danger-fg";

  return (
    <div className="flex flex-col items-center gap-1" title={data.sinais.length ? data.sinais.join(" · ") : "Cliente saudável"}>
      <span className="text-[9px] font-bold text-muted-foreground uppercase">Health</span>
      <div className={"w-10 h-10 rounded-full bg-gradient-to-br border flex items-center justify-center " + corBg}>
        <span className={"text-[11px] font-black " + corText}>{data.score}</span>
      </div>
      {data.sinais.length > 0 && (
        <Heart className="h-3 w-3 text-danger mt-1" />
      )}
    </div>
  );
}
