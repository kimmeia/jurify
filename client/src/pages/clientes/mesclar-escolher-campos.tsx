/**
 * Passo "o que fica na ficha final" — usado pelas DUAS telas que mesclam um par
 * por vez: o "Mesclar com outro cliente" da ficha e o "Mesclar" da linha na
 * Conferência de cadastros. O lote ("Mesclar todos") não passa por aqui de
 * propósito: perguntar campo a campo cinquenta vezes seguidas não é opção.
 *
 * As linhas saem do MESMO módulo compartilhado que o servidor usa pra aplicar
 * as escolhas — se a conta morasse só aqui, a tela prometeria uma coisa e o
 * banco gravaria outra.
 */

import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import {
  AVISO_RESPONSAVEL, ROTULO_CAMPO,
  type EscolhasMesclagem, type LadoMesclagem, type LinhaMesclagem,
  escolhasPadrao, escolhasQueMudam, linhasDaMesclagem, quantasEscolhas,
} from "@shared/mesclar-campos";

export function useEscolhasMesclagem(
  principalId: number | undefined,
  duplicadoId: number | undefined,
  ativo: boolean,
) {
  const pronto = ativo && !!principalId && !!duplicadoId;
  const { data, isLoading } = (trpc as any).clientes.camposParaMesclar.useQuery(
    { principalId: principalId ?? 0, duplicadoId: duplicadoId ?? 0 },
    { enabled: pronto, retry: false, staleTime: 30_000 },
  );

  const linhas: LinhaMesclagem[] = useMemo(
    () => (data ? linhasDaMesclagem(data.principal, data.duplicado) : []),
    [data],
  );
  const [escolhas, setEscolhas] = useState<EscolhasMesclagem>({});

  // Recomeça do padrão a cada par novo: sem isso a escolha de um cliente
  // vazaria pro próximo que a pessoa abrisse.
  useEffect(() => {
    setEscolhas(linhas.length > 0 ? escolhasPadrao(linhas) : {});
  }, [principalId, duplicadoId, linhas]);

  return {
    carregando: pronto && isLoading,
    principal: data?.principal ?? null,
    duplicado: data?.duplicado ?? null,
    linhas,
    escolhas,
    setEscolha: (campo: string, lado: LadoMesclagem) =>
      setEscolhas((e) => ({ ...e, [campo]: lado })),
    /** Só o que difere do padrão — é o que vai pro servidor. */
    mudancas: escolhasQueMudam(linhas, escolhas),
    /** O passo só aparece quando há decisão de verdade a tomar. */
    precisaEscolher: quantasEscolhas(linhas) > 0,
  };
}

function Celula({
  valor, marcado, escolhivel, onClick,
}: {
  valor: string | null; marcado: boolean; escolhivel: boolean; onClick?: () => void;
}) {
  if (valor === null) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/60 px-2.5 py-2 text-[11px] italic text-muted-foreground">
        vazio
      </div>
    );
  }
  const base = "w-full text-left rounded-lg border px-2.5 py-2 text-[11px] leading-snug flex items-start gap-2";
  const cor = marcado
    ? "border-primary bg-primary/10 text-primary font-semibold"
    : "border-border bg-background text-foreground";
  if (!escolhivel) {
    return <div className={`${base} ${cor}`}><span className="break-words">{valor}</span></div>;
  }
  return (
    <button type="button" onClick={onClick} className={`${base} ${cor} hover:bg-accent`}>
      <span
        className={
          "mt-0.5 h-3 w-3 shrink-0 rounded-full border " +
          (marcado ? "border-4 border-primary bg-background" : "border-muted-foreground/50 bg-background")
        }
      />
      <span className="break-words">{valor}</span>
    </button>
  );
}

export function TabelaEscolhaCampos({
  linhas, escolhas, setEscolha, nomePrincipal, nomeDuplicado,
}: {
  linhas: LinhaMesclagem[];
  escolhas: EscolhasMesclagem;
  setEscolha: (campo: string, lado: LadoMesclagem) => void;
  nomePrincipal: string;
  nomeDuplicado: string;
}) {
  const mostraAvisoResponsavel = linhas.some(
    (l) => l.campo === "responsavelId" && escolhas.responsavelId === "duplicado",
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[88px_1fr_1fr] gap-2 px-0.5 pb-1">
        <span />
        <span className="text-[10px] font-bold uppercase tracking-wide text-danger-fg">
          {nomeDuplicado}
          <span className="block font-semibold normal-case tracking-normal text-muted-foreground">será absorvida</span>
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-success">
          {nomePrincipal}
          <span className="block font-semibold normal-case tracking-normal text-muted-foreground">fica</span>
        </span>
      </div>

      {linhas.map((l) => {
        const escolhivel = l.tipo !== "somam";
        const lado = escolhas[l.campo as keyof EscolhasMesclagem];
        return (
          <div key={l.campo} className="grid grid-cols-[88px_1fr_1fr] items-start gap-2" data-testid={`linha-${l.campo}`}>
            <div className="pt-2">
              <div className="text-[11px] font-bold">{ROTULO_CAMPO[l.campo]}</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                {l.tipo === "escolha" ? "escolha" : l.tipo === "um_lado" ? "só um lado tem" : "os dois ficam"}
              </div>
            </div>
            {l.tipo === "somam" ? (
              <div className="col-span-2 rounded-lg border border-success/40 bg-success-bg px-2.5 py-2 text-[11px] font-semibold text-success">
                {[l.duplicado, l.principal].filter(Boolean).join("  +  ")}
                <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                  {l.campo === "telefone" ? "o segundo vira telefone secundário" : "as duas tags ficam"}
                </span>
              </div>
            ) : (
              <>
                <Celula
                  valor={l.duplicado}
                  marcado={lado === "duplicado"}
                  escolhivel={escolhivel && l.duplicado !== null}
                  onClick={() => setEscolha(l.campo, "duplicado")}
                />
                <Celula
                  valor={l.principal}
                  marcado={lado === "principal"}
                  escolhivel={escolhivel && l.principal !== null}
                  onClick={() => setEscolha(l.campo, "principal")}
                />
              </>
            )}
          </div>
        );
      })}

      {mostraAvisoResponsavel && (
        <div className="rounded-lg border-2 border-warning/40 bg-warning-bg p-2.5" data-testid="aviso-responsavel">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-warning-fg">
            <AlertTriangle className="h-3.5 w-3.5" />
            Esse campo não é só cadastro
          </p>
          <p className="mt-1 text-[11px] leading-snug text-warning-fg">{AVISO_RESPONSAVEL}</p>
        </div>
      )}

      <p className="rounded-lg bg-primary/5 px-2.5 py-2 text-[11px] leading-snug text-primary">
        <b>Já vem marcado o que o sistema faria sozinho.</b> Quem não mexer em nada tem exatamente o
        resultado de sempre, com a diferença de ter visto o que ia acontecer.
      </p>
    </div>
  );
}

export function EsqueletoEscolhaCampos() {
  return (
    <div className="space-y-2 py-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
