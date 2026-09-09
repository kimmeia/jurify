import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Shield, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Compliance Guard — verifica rascunho contra heurísticas de violação
 * ética OAB (promessa de resultado, concorrência por preço, etc).
 *
 * Inédito no nicho jurídico — outros SaaS oferecem template, este intercepta
 * promessas antes que o advogado leve um TED.
 */
export function ComplianceGuard({
  rascunho,
  onAplicarSugestao,
  onIgnorar,
}: {
  rascunho: string;
  onAplicarSugestao: (sugestao: string) => void;
  onIgnorar: () => void;
}) {
  const [resultado, setResultado] = useState<{
    ok: boolean;
    problemas?: string[];
    sugestao?: string;
    trechosFlag?: string[];
  } | null>(null);
  const [ignorado, setIgnorado] = useState(false);
  const mut = trpc.atendimentoIa.complianceCheck.useMutation();

  useEffect(() => {
    setIgnorado(false);
    if (!rascunho || rascunho.trim().length < 12) {
      setResultado(null);
      return;
    }
    const t = setTimeout(() => {
      mut.mutate(
        { rascunho },
        {
          onSuccess: (data) => setResultado(data),
        },
      );
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho]);

  if (!resultado || resultado.ok || ignorado) return null;

  return (
    <div className="mx-4 mb-2 rounded-xl border-2 border-danger/30 bg-gradient-to-br from-danger-bg to-danger-bg/50 p-2.5">
      <div className="flex items-start gap-2">
        <div className="w-6 h-6 rounded-md bg-danger flex items-center justify-center flex-shrink-0">
          <ShieldAlert className="h-3 w-3 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] font-black text-danger-fg uppercase tracking-wide">
              Compliance Guard
            </span>
            <span className="text-[9px] px-1 py-0 rounded bg-danger-bg text-danger-fg font-bold">
              ⚠️ Atenção OAB
            </span>
          </div>
          {resultado.problemas && resultado.problemas.length > 0 && (
            <p className="text-xs text-danger-fg font-medium mb-1">{resultado.problemas[0]}</p>
          )}
          {resultado.trechosFlag && resultado.trechosFlag.length > 0 && (
            <p className="text-[10px] text-danger-fg italic mb-1.5">
              Trecho problemático: <span className="bg-danger-bg/60 px-1 rounded">"{resultado.trechosFlag[0]}"</span>
            </p>
          )}
          {resultado.sugestao && (
            <div className="bg-card border border-success/30 rounded-md p-2 mb-2">
              <p className="text-[9px] font-bold text-success-fg uppercase mb-0.5">✓ Sugestão segura</p>
              <p className="text-xs text-foreground italic leading-snug">"{resultado.sugestao}"</p>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {resultado.sugestao && (
              <Button
                size="sm"
                className="h-6 text-[10px] px-2 bg-success hover:bg-success"
                onClick={() => onAplicarSugestao(resultado.sugestao!)}
              >
                Usar sugestão
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2"
              onClick={() => {
                setIgnorado(true);
                onIgnorar();
              }}
            >
              Ignorar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Badge compacto no header do composer, mostrando que o Guard está ativo.
 */
export function ComplianceGuardBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-danger-fg font-bold">
      <Shield className="h-3 w-3" />
      Compliance ON
    </span>
  );
}
