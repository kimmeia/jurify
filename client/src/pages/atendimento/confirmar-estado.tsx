/**
 * O estado do contato, confirmável em um clique.
 *
 * O relatório de Atendimento separa o estado que alguém confirmou do que foi
 * deduzido do DDD do telefone, e a segunda fatia domina — o endereço só é
 * preenchido no formulário de qualificação, que normalmente só é aberto quando
 * o caso já virou peça. Enquanto isso, o painel inteiro se apoia numa
 * aproximação.
 *
 * Aqui é o momento mais barato de corrigir isso: o atendente está falando com
 * a pessoa. Ele vê o que o sistema deduziu e diz sim ou troca — e a partir daí
 * aquele lead conta como fato no relatório.
 *
 * Um cuidado deliberado: confirmar é um ATO, não um efeito colateral. Nada
 * aqui promove a dedução sozinho, nem "confirma" ao abrir a tela. Se
 * bastasse abrir, o painel encheria de "confirmado" sem ninguém ter
 * confirmado nada, e a distinção que ele existe pra mostrar viraria decoração.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, MapPin } from "lucide-react";
import { toast } from "sonner";
import { UFS, type OrigemUf } from "@shared/leads-uf";

export function ConfirmarEstado({
  contatoId,
  estado,
  onConfirmado,
}: {
  contatoId: number;
  /** O que o servidor deduziu ou leu do cadastro. null = não deu pra saber. */
  estado: { uf: string; origem: OrigemUf } | null;
  onConfirmado: () => void;
}) {
  const [corrigindo, setCorrigindo] = useState(false);

  const mut = trpc.customer360.confirmarEstado.useMutation({
    onSuccess: (r) => {
      setCorrigindo(false);
      toast.success(`Estado confirmado: ${r.uf}`);
      onConfirmado();
    },
    onError: (e) => toast.error("Não deu pra salvar o estado", { description: e.message }),
  });

  const confirmado = estado?.origem === "cadastro";

  return (
    <div className="rounded-lg border px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          Estado
        </span>
        {confirmado && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
            <Check className="h-3 w-3" />
            confirmado
          </span>
        )}
      </div>

      {corrigindo || !estado ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Select
            defaultValue={estado?.uf}
            onValueChange={(uf) => mut.mutate({ contatoId, uf: uf as (typeof UFS)[number] })}
            disabled={mut.isPending}
          >
            <SelectTrigger className="h-7 text-[11px]">
              <SelectValue placeholder="Escolher…" />
            </SelectTrigger>
            <SelectContent>
              {UFS.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {estado && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-[11px]"
              onClick={() => setCorrigindo(false)}
            >
              Cancelar
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[13px] font-bold">{estado.uf}</span>
          {confirmado ? (
            <button
              type="button"
              className="text-[10.5px] text-muted-foreground hover:text-violet-600"
              onClick={() => setCorrigindo(true)}
            >
              corrigir
            </button>
          ) : (
            <>
              <span className="text-[10.5px] text-muted-foreground">deduzido pelo DDD</span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={mut.isPending}
                  onClick={() =>
                    mut.mutate({ contatoId, uf: estado.uf as (typeof UFS)[number] })
                  }
                  title="Confirmar que o cliente é mesmo deste estado"
                >
                  Confirmar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setCorrigindo(true)}
                >
                  outro
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {!estado && (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
          Sem telefone com DDD reconhecível — escolha o estado se souber.
        </p>
      )}
    </div>
  );
}
