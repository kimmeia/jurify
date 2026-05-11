/**
 * Aba "Origens" em Configurações: gerencia as opções do dropdown
 * "Origem" no cadastro de cliente (e qualquer outro lugar que vincule
 * lead → origem).
 *
 * - Lista origens (ativas e inativas)
 * - Criar nova
 * - Renomear inline
 * - Desativar (soft-delete preserva histórico de leads antigos)
 * - Reordenar (botões cima/baixo — drag-and-drop ficaria pra v2)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Tag as TagIcon,
} from "lucide-react";
import { toast } from "sonner";

interface OrigemRow {
  id: number;
  nome: string;
  ordem: number;
  ativo: boolean;
}

export function OrigensLeadTab() {
  const [novoNome, setNovoNome] = useState("");
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [editandoNome, setEditandoNome] = useState("");

  const utils = trpc.useUtils();
  const invalidate = () => (utils as any).origensLead?.listar?.invalidate?.();

  const { data: origens = [], isLoading } = (trpc as any).origensLead.listar.useQuery(
    { incluirInativas: true },
    { retry: false },
  );

  const criarMut = (trpc as any).origensLead.criar.useMutation({
    onSuccess: () => {
      setNovoNome("");
      invalidate();
      toast.success("Origem adicionada");
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  const atualizarMut = (trpc as any).origensLead.atualizar.useMutation({
    onSuccess: () => {
      setEditandoId(null);
      invalidate();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  const desativarMut = (trpc as any).origensLead.desativar.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Origem desativada");
    },
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  const reordenarMut = (trpc as any).origensLead.reordenar.useMutation({
    onSuccess: () => invalidate(),
    onError: (err: any) => toast.error("Erro", { description: err.message }),
  });

  function mover(indice: number, direcao: -1 | 1) {
    const ativas = origens.filter((o: OrigemRow) => o.ativo);
    const novaPosicao = indice + direcao;
    if (novaPosicao < 0 || novaPosicao >= ativas.length) return;
    const nova = [...ativas];
    [nova[indice], nova[novaPosicao]] = [nova[novaPosicao], nova[indice]];
    reordenarMut.mutate({ idsEmOrdem: nova.map((o) => o.id) });
  }

  const ativas = origens.filter((o: OrigemRow) => o.ativo);
  const inativas = origens.filter((o: OrigemRow) => !o.ativo);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Origens de lead</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Estas opções aparecem no dropdown <b>Origem</b> ao cadastrar um cliente
          que já fechou contrato. Cada escritório customiza as suas.
        </p>
      </div>

      {/* Criar nova */}
      <div className="flex gap-2">
        <Input
          placeholder='Nova origem (ex: "Instagram", "BNI", "Google Ads")'
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && novoNome.trim()) {
              criarMut.mutate({ nome: novoNome.trim() });
            }
          }}
          className="h-9 text-sm flex-1"
          maxLength={80}
        />
        <Button
          size="sm"
          onClick={() => criarMut.mutate({ nome: novoNome.trim() })}
          disabled={!novoNome.trim() || criarMut.isPending}
        >
          {criarMut.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5 mr-1.5" />
          )}
          Adicionar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {ativas.length === 0 && (
              <p className="text-xs text-muted-foreground italic py-3 text-center">
                Sem origens ativas. Adicione a primeira acima.
              </p>
            )}
            {ativas.map((o: OrigemRow, i: number) => (
              <div
                key={o.id}
                className="flex items-center gap-2 rounded border p-2 bg-card"
              >
                <TagIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {editandoId === o.id ? (
                  <Input
                    value={editandoNome}
                    onChange={(e) => setEditandoNome(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && editandoNome.trim()) {
                        atualizarMut.mutate({
                          id: o.id,
                          nome: editandoNome.trim(),
                        });
                      }
                      if (e.key === "Escape") setEditandoId(null);
                    }}
                    onBlur={() => {
                      if (
                        editandoNome.trim() &&
                        editandoNome.trim() !== o.nome
                      ) {
                        atualizarMut.mutate({
                          id: o.id,
                          nome: editandoNome.trim(),
                        });
                      } else {
                        setEditandoId(null);
                      }
                    }}
                    autoFocus
                    className="h-7 text-sm flex-1"
                    maxLength={80}
                  />
                ) : (
                  <span className="text-sm flex-1">{o.nome}</span>
                )}
                <div className="flex gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={() => mover(i, -1)}
                    disabled={i === 0 || reordenarMut.isPending}
                    title="Mover pra cima"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={() => mover(i, 1)}
                    disabled={
                      i === ativas.length - 1 || reordenarMut.isPending
                    }
                    title="Mover pra baixo"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    onClick={() => {
                      setEditandoId(o.id);
                      setEditandoNome(o.nome);
                    }}
                    title="Renomear"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-destructive"
                    onClick={() => desativarMut.mutate({ id: o.id })}
                    disabled={desativarMut.isPending}
                    title="Desativar (some do select sem apagar dados antigos)"
                  >
                    <EyeOff className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {inativas.length > 0 && (
            <div className="pt-3 border-t">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Desativadas
              </p>
              <div className="space-y-1">
                {inativas.map((o: OrigemRow) => (
                  <div
                    key={o.id}
                    className="flex items-center gap-2 rounded border border-dashed p-2 bg-muted/30 opacity-60"
                  >
                    <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm flex-1">{o.nome}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px]"
                      onClick={() =>
                        atualizarMut.mutate({ id: o.id, ativo: true })
                      }
                      disabled={atualizarMut.isPending}
                    >
                      <Eye className="h-3 w-3 mr-1" /> Reativar
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
