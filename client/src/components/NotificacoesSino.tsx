/**
 * Componente de sino de notificações in-app.
 * Mostra badge com contagem de não lidas e dropdown com lista de notificações.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  FileSearch,
  Info,
  CreditCard,
  Loader2,
  Siren,
} from "lucide-react";
import { useLocation } from "wouter";

const tipoIconMap: Record<string, React.ReactNode> = {
  movimentacao: <FileSearch className="h-4 w-4 text-blue-500" />,
  nova_acao: <Siren className="h-4 w-4 text-red-500" />,
  sistema: <Info className="h-4 w-4 text-amber-500" />,
  plano: <CreditCard className="h-4 w-4 text-emerald-500" />,
};

const tipoLabelMap: Record<string, string> = {
  movimentacao: "Processo",
  nova_acao: "Nova Ação",
  sistema: "Sistema",
  plano: "Plano",
};

export default function NotificacoesSino() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const contarQuery = trpc.notificacoes.contarNaoLidas.useQuery(undefined, {
    refetchInterval: 60_000, // Verificar a cada 60 segundos
    refetchOnWindowFocus: true,
  });

  const listarQuery = trpc.notificacoes.listar.useQuery(
    { limit: 20 },
    {
      enabled: open,
      refetchOnWindowFocus: false,
    }
  );

  const marcarLidaMutation = trpc.notificacoes.marcarLida.useMutation({
    onSuccess: () => {
      utils.notificacoes.listar.invalidate();
      utils.notificacoes.contarNaoLidas.invalidate();
    },
  });

  const marcarTodasMutation = trpc.notificacoes.marcarTodasLidas.useMutation({
    onSuccess: () => {
      toast.success("Todas as notificações marcadas como lidas.");
      utils.notificacoes.listar.invalidate();
      utils.notificacoes.contarNaoLidas.invalidate();
    },
  });

  const apagarMutation = trpc.notificacoes.apagar.useMutation({
    onSuccess: () => {
      utils.notificacoes.listar.invalidate();
      utils.notificacoes.contarNaoLidas.invalidate();
    },
  });

  const count = contarQuery.data?.count ?? 0;
  const notificacoes = listarQuery.data ?? [];

  const handleClickNotificacao = (notif: any) => {
    if (!notif.lida) {
      marcarLidaMutation.mutate({ notificacaoId: notif.id });
    }
    // Abre direto na tab certa em /processos: movimentacoes pra movs
    // detectadas em CNJs monitorados, novas-acoes pra processos novos
    // contra clientes monitorados por CPF/CNPJ.
    if (notif.tipo === "movimentacao") {
      setOpen(false);
      setLocation("/processos?tab=movimentacoes");
    }
    if (notif.tipo === "nova_acao") {
      setOpen(false);
      setLocation("/processos?tab=novas-acoes");
    }
    if (notif.tipo === "plano") {
      setOpen(false);
      setLocation("/plans");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 w-9 p-0"
          aria-label="Notificações"
        >
          <Bell className="h-4.5 w-4.5" />
          {count > 0 && (
            <Badge
              className="absolute -top-0.5 -right-0.5 h-4.5 min-w-[18px] px-1 text-[10px] font-bold bg-destructive text-destructive-foreground border-2 border-background"
            >
              {count > 99 ? "99+" : count}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="font-semibold text-sm">Notificações</h3>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => marcarTodasMutation.mutate()}
              disabled={marcarTodasMutation.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Marcar todas
            </Button>
          )}
        </div>
        <Separator />

        {/* Lista */}
        <div className="max-h-80 overflow-y-auto">
          {listarQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : notificacoes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Bell className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Nenhuma notificação
              </p>
            </div>
          ) : (
            notificacoes.map((notif: any) => (
              <div
                key={notif.id}
                className={`flex items-start gap-3 px-4 py-3 hover:bg-accent/50 cursor-pointer transition-colors border-b border-border/50 last:border-b-0 ${
                  !notif.lida ? "bg-primary/5" : ""
                }`}
                onClick={() => handleClickNotificacao(notif)}
              >
                <div className="shrink-0 mt-0.5">
                  {tipoIconMap[notif.tipo] || <Info className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm truncate ${!notif.lida ? "font-semibold" : "font-medium"}`}>
                      {notif.titulo}
                    </p>
                    {!notif.lida && (
                      <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {notif.mensagem}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {tipoLabelMap[notif.tipo] || notif.tipo}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(notif.createdAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 flex gap-0.5">
                  {!notif.lida && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        marcarLidaMutation.mutate({ notificacaoId: notif.id });
                      }}
                      title="Marcar como lida"
                    >
                      <Check className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      apagarMutation.mutate({ notificacaoId: notif.id });
                    }}
                    title="Apagar"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
