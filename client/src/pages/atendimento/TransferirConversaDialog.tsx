/**
 * Escolha de quem recebe a conversa.
 *
 * O diálogo antigo listava `listarAtendentes` inteiro — que é todo colaborador
 * ativo do escritório, financeiro e recepção incluídos — em linhas de 56px sem
 * altura máxima. Num escritório de 14 pessoas ele passava da altura da tela e
 * levava o rodapé junto.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRightLeft, Check, Loader2, MessageSquare, Search, UserRound } from "lucide-react";
import { gradientAvatar, gerarIniciais } from "../dashboards/common";

export type AtendenteTransferencia = {
  id: number;
  nome?: string | null;
  email?: string | null;
  cargo?: string | null;
  setorId?: number | null;
  conversasAbertas?: number;
};

/** A partir daqui a pessoa já está cheia — o vermelho é pra pensar duas vezes. */
const CARGA_ALTA = 10;

function nomeDe(a: AtendenteTransferencia): string {
  return a.nome || a.email || `#${a.id}`;
}

function Carga({ n }: { n: number }) {
  if (n === 0) {
    return <span className="text-[10.5px] font-bold text-success-fg shrink-0">livre</span>;
  }
  const cheio = n >= CARGA_ALTA;
  return (
    <span
      className={`text-[10.5px] tabular-nums shrink-0 inline-flex items-center gap-1 ${
        cheio ? "font-bold text-danger-fg" : "text-muted-foreground"
      }`}
    >
      <MessageSquare className="h-3 w-3" />
      {n}
    </span>
  );
}

export function TransferirConversaDialog({
  open,
  onClose,
  clienteNome,
  atendentes,
  setores,
  atendenteAtualId,
  meuColaboradorId,
  transferindo,
  onTransferir,
}: {
  open: boolean;
  onClose: () => void;
  clienteNome: string;
  atendentes: AtendenteTransferencia[];
  setores: Array<{ id: number; nome: string }>;
  atendenteAtualId: number | null;
  meuColaboradorId: number | null;
  transferindo: boolean;
  onTransferir: (atendenteId: number) => void;
}) {
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const aberto = useRef(false);

  // Só na transição de abertura. A lista chega de uma query que revalida, e
  // limpar a escolha a cada refetch faria a seleção sumir sozinha.
  useEffect(() => {
    if (!open) {
      aberto.current = false;
      return;
    }
    if (aberto.current) return;
    aberto.current = true;
    setBusca("");
    setEscolhido(null);
  }, [open]);

  const nomeSetor = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of setores) m.set(s.id, s.nome);
    return m;
  }, [setores]);

  const atual = atendentes.find((a) => a.id === atendenteAtualId) ?? null;
  const eu = atendentes.find((a) => a.id === meuColaboradorId) ?? null;
  const posso = !!eu && eu.id !== atendenteAtualId;

  /** Busca casa nome, cargo e setor — é por onde se procura na prática. */
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return atendentes;
    return atendentes.filter((a) => {
      const setor = a.setorId != null ? nomeSetor.get(a.setorId) ?? "" : "";
      return `${nomeDe(a)} ${a.cargo ?? ""} ${setor}`.toLowerCase().includes(q);
    });
  }, [atendentes, busca, nomeSetor]);

  // Agrupa por setor mantendo a ordem em que os setores foram cadastrados;
  // quem não tem setor cai num bloco final em vez de sumir.
  const grupos = useMemo(() => {
    const porSetor = new Map<number | null, AtendenteTransferencia[]>();
    for (const a of filtrados) {
      const k = a.setorId ?? null;
      const lista = porSetor.get(k);
      if (lista) lista.push(a);
      else porSetor.set(k, [a]);
    }
    const saida: Array<{ nome: string; gente: AtendenteTransferencia[] }> = [];
    for (const s of setores) {
      const gente = porSetor.get(s.id);
      if (gente?.length) {
        saida.push({ nome: s.nome, gente });
        porSetor.delete(s.id);
      }
    }
    const resto = [...porSetor.values()].flat();
    if (resto.length) saida.push({ nome: "Sem setor", gente: resto });
    return saida;
  }, [filtrados, setores]);

  const alvo = atendentes.find((a) => a.id === escolhido) ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b space-y-0.5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
            Transferir conversa
          </DialogTitle>
          <DialogDescription className="text-[12px] truncate">
            <b className="text-foreground">{clienteNome}</b>
            {atual ? ` · hoje com ${nomeDe(atual)}` : " · sem atendente"}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 space-y-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, cargo ou setor…"
              className="pl-9 h-9"
            />
          </div>

          {/* Pegar pra si é o caso mais frequente e não deveria exigir caçar o
              próprio nome no meio da equipe. */}
          {posso && (
            <button
              type="button"
              onClick={() => setEscolhido(eu!.id)}
              className={`w-full h-10 rounded-lg border-2 border-dashed flex items-center gap-2.5 px-3 transition-colors ${
                escolhido === eu!.id
                  ? "border-info/30 bg-info-bg"
                  : "hover:bg-muted/50"
              }`}
            >
              <UserRound className="h-4 w-4 text-info-fg shrink-0" />
              <span className="text-[12.5px] font-bold flex-1 text-left">Assumir eu mesmo</span>
              <span className="text-[10.5px] text-muted-foreground truncate max-w-[140px]">
                {nomeDe(eu!)}
              </span>
            </button>
          )}
        </div>

        <div className="border-t overflow-y-auto max-h-[264px]">
          {grupos.length === 0 ? (
            <p className="text-[12px] text-muted-foreground text-center py-8">
              Ninguém bate com essa busca.
            </p>
          ) : (
            grupos.map((g) => (
              <div key={g.nome}>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/60 border-y sticky top-0">
                  <span className="text-[9.5px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">
                    {g.nome}
                  </span>
                  <span className="text-[9.5px] font-bold text-muted-foreground/70 tabular-nums">
                    {g.gente.length}
                  </span>
                </div>
                {g.gente.map((a) => {
                  const nome = nomeDe(a);
                  const ehAtual = a.id === atendenteAtualId;
                  const sel = a.id === escolhido;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={ehAtual}
                      onClick={() => setEscolhido(a.id)}
                      className={`w-full h-11 flex items-center gap-2.5 px-3 text-left transition-colors ${
                        ehAtual
                          ? "opacity-55 cursor-default"
                          : sel
                            ? "bg-info-bg"
                            : "hover:bg-muted/50"
                      }`}
                    >
                      <span
                        className="h-[30px] w-[30px] rounded-full shrink-0 flex items-center justify-center text-white text-[10.5px] font-bold"
                        style={{ background: gradientAvatar(nome) }}
                      >
                        {gerarIniciais(nome)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span
                          className={`block text-[12.5px] font-semibold truncate ${
                            sel ? "text-info-fg" : ""
                          }`}
                        >
                          {nome}
                        </span>
                        <span className="block text-[10px] text-muted-foreground truncate">
                          {a.cargo || "—"}
                        </span>
                      </span>
                      {ehAtual ? (
                        <span className="text-[10px] font-bold text-muted-foreground border rounded px-1.5 py-0.5 shrink-0">
                          já é o responsável
                        </span>
                      ) : (
                        <>
                          <Carga n={a.conversasAbertas ?? 0} />
                          {sel && (
                            <span className="h-[18px] w-[18px] rounded-full bg-info text-info-on flex items-center justify-center shrink-0">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t bg-muted/40 sm:justify-start gap-3">
          <p className="text-[12px] flex-1 min-w-0 truncate">
            {alvo ? (
              <>
                Para <b>{nomeDe(alvo)}</b>
              </>
            ) : (
              <span className="text-muted-foreground">Escolha quem vai receber</span>
            )}
          </p>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {/* Confirmação em passo separado: no diálogo antigo o clique já
              transferia, e numa lista que rola um toque errado manda a
              conversa pra outra pessoa na frente da equipe. */}
          <Button disabled={!alvo || transferindo} onClick={() => alvo && onTransferir(alvo.id)}>
            {transferindo ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <ArrowRightLeft className="h-4 w-4 mr-1.5" />
            )}
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
