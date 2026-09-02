import { useEffect, useState } from "react";
import { ArrowLeft, Clock, Eye, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * Faixa fixa no topo enquanto um admin do JuridFlow está vendo a conta de
 * outro usuário.
 *
 * É um aviso de segurança, então fica `sticky` — sair de vista seria pior
 * que ocupar espaço. Em compensação cabe numa linha só: o que não couber
 * some por ordem inversa de importância (auditoria → escritório → relógio),
 * porque duas linhas devolveriam a altura que a faixa antiga tinha.
 */
export function ImpersonationBanner({ alvoNome }: { alvoNome: string }) {
  const contexto = trpc.admin.contextoImpersonacao.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const encerrar = trpc.admin.encerrarImpersonacao.useMutation({
    onSuccess: () => {
      window.location.href = "/admin";
    },
    onError: (err) => {
      toast.error(err.message);
      // O servidor derruba o cookie quando não há admin válido pra onde
      // voltar. Insistir na tela atual só mostraria erro atrás de erro.
      if (err.data?.code === "FORBIDDEN") window.location.href = "/";
    },
  });

  const expiraEm = contexto.data?.expiraEm ?? null;
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!expiraEm) return;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiraEm]);

  const restanteMs = expiraEm === null ? null : expiraEm - agora;
  const expirou = restanteMs !== null && restanteMs <= 0;

  useEffect(() => {
    if (!expirou) return;
    window.location.href = "/admin";
  }, [expirou]);

  const urgente = restanteMs !== null && restanteMs <= 5 * 60_000;
  const nome = contexto.data?.alvoNome || alvoNome;
  const escritorio = contexto.data?.escritorioNome;

  return (
    <div className="flex items-stretch border-b border-warning/30 bg-warning-bg sticky top-0 z-50 dark:border-warning/30">
      <span className="w-1 shrink-0 bg-warning" />
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-x-2.5 px-3 py-1.5">
        <span className="hidden shrink-0 items-center gap-1.5 rounded border border-warning/30 bg-warning-bg px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-warning-fg sm:inline-flex dark:border-warning/30 dark:text-warning">
          <Eye className="h-3 w-3" />
          Vendo como
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-warning-on">
            {iniciais(nome)}
          </span>
          <span className="min-w-0 truncate text-[13px] font-semibold text-warning-fg">
            {nome}
          </span>
          {escritorio && (
            <span className="hidden min-w-0 truncate text-[11.5px] text-warning-fg/70 lg:inline dark:text-warning/60">
              · {escritorio}
            </span>
          )}
        </span>
        {restanteMs !== null && (
          <span
            className={
              urgente
                ? "hidden shrink-0 items-center gap-1.5 text-[11.5px] font-bold tabular-nums text-danger-fg md:inline-flex dark:text-danger"
                : "hidden shrink-0 items-center gap-1.5 text-[11.5px] tabular-nums text-warning-fg md:inline-flex dark:text-warning/80"
            }
          >
            <Clock className="h-3.5 w-3.5" />
            expira em {formatarRestante(restanteMs)}
          </span>
        )}
        <span className="hidden shrink-0 items-center gap-1.5 text-[11.5px] text-warning-fg/80 xl:inline-flex dark:text-warning/70">
          <ShieldCheck className="h-3.5 w-3.5" />
          ações auditadas
        </span>
        <button
          type="button"
          onClick={() => encerrar.mutate()}
          disabled={encerrar.isPending}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-warning px-2.5 text-[12px] font-semibold text-warning-on hover:bg-warning disabled:opacity-60"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {encerrar.isPending ? "Voltando…" : "Voltar ao admin"}
        </button>
      </div>
    </div>
  );
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0]!.charAt(0);
  const ultima = partes.length > 1 ? partes[partes.length - 1]!.charAt(0) : "";
  return (primeira + ultima).toUpperCase();
}

function formatarRestante(ms: number): string {
  const totalSeg = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSeg / 60);
  if (min >= 60) {
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
  }
  return `${min}:${String(totalSeg % 60).padStart(2, "0")}`;
}
