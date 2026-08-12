/**
 * O caso em análise, na coluna da direita.
 *
 * Escolher um caso não é obrigatório e nunca foi: perguntar como um tribunal
 * decide não exige cliente cadastrado. O que o caso faz é ampliar o que a
 * conversa consegue ler — dossiê, movimentação com teor das decisões,
 * documentos anexados — e definir o recorte do acervo quando a pergunta não o
 * define.
 *
 * Por isso ele vive aqui e não numa etapa anterior: é contexto que se liga e
 * desliga no meio da conversa, não um formulário a preencher antes de começar.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Search } from "lucide-react";

export interface CasoEscolhido {
  contatoId: number;
  nome: string;
  processoId: number | null;
}

export function SeletorCaso({
  caso,
  onCaso,
}: {
  caso: CasoEscolhido | null;
  onCaso: (c: CasoEscolhido | null) => void;
}) {
  const [busca, setBusca] = useState("");

  const clientesQ = (trpc as any).clientes.listar.useQuery(
    { busca, estagio: "cliente", limite: 8 },
    { enabled: busca.trim().length >= 2, retry: false },
  );
  const processosQ = (trpc as any).clienteProcessos.listar.useQuery(
    { contatoId: caso?.contatoId ?? 0 },
    { enabled: !!caso, retry: false },
  );
  const dossieQ = (trpc as any).juridico.contextoDoCliente.useQuery(
    { contatoId: caso?.contatoId ?? 0, processoId: caso?.processoId ?? undefined },
    { enabled: !!caso, retry: false },
  );

  if (!caso) {
    return (
      <div className="rounded-xl border bg-card p-3.5">
        <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
          Caso em análise
        </p>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8 text-xs"
            placeholder="Buscar cliente…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        {busca.trim().length >= 2 && (
          <div className="mt-2 max-h-56 divide-y overflow-y-auto rounded-lg border bg-background">
            {clientesQ.isLoading && <p className="p-2 text-xs text-muted-foreground">Buscando…</p>}
            {(clientesQ.data?.clientes ?? []).map((c: { id: number; nome: string }) => (
              <button
                key={c.id}
                type="button"
                className="w-full px-2.5 py-2 text-left text-xs hover:bg-muted"
                onClick={() => {
                  onCaso({ contatoId: c.id, nome: c.nome, processoId: null });
                  setBusca("");
                }}
              >
                {c.nome}
              </button>
            ))}
            {!clientesQ.isLoading && (clientesQ.data?.clientes?.length ?? 0) === 0 && (
              <p className="p-2 text-xs text-muted-foreground">Nada encontrado.</p>
            )}
          </div>
        )}
        <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
          Escolha um caso pra ela ler o processo e os documentos. Sem caso ela responde do mesmo
          jeito — só não terá os autos.
        </p>
      </div>
    );
  }

  const processos: Array<{ id: number; apelido?: string; numeroCnj?: string }> = processosQ.data ?? [];

  // Reabrir uma conversa gravada traz só o id do cliente — o nome vem do
  // dossiê, que é a mesma fonte que a IA lê. Enquanto ele não chega, o rótulo
  // que veio da busca segura o lugar.
  const nome =
    String(dossieQ.data?.qualificacao ?? "").split("\n")[0]?.replace(/^Nome:\s*/i, "").trim() ||
    caso.nome;

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3.5 dark:border-violet-900 dark:bg-violet-950/25">
      <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-violet-700 dark:text-violet-300">
        Caso em análise
      </p>
      <div className="mt-1.5 flex items-start justify-between gap-2">
        <p className="text-[13px] font-bold leading-tight">{nome}</p>
        <button
          type="button"
          className="shrink-0 text-[11px] font-semibold text-violet-600 dark:text-violet-300"
          onClick={() => onCaso(null)}
        >
          tirar
        </button>
      </div>
      {dossieQ.data?.processo && (
        <p className="mt-1.5 whitespace-pre-line text-[11px] text-foreground/75">
          {dossieQ.data.processo}
        </p>
      )}
      {processos.length > 1 && (
        <Select
          value={caso.processoId ? String(caso.processoId) : ""}
          onValueChange={(v) => onCaso({ ...caso, processoId: v ? Number(v) : null })}
        >
          <SelectTrigger className="mt-2 h-8 text-[11px]">
            <SelectValue placeholder="Trocar processo" />
          </SelectTrigger>
          <SelectContent>
            {processos.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.apelido || p.numeroCnj || `Processo ${p.id}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {(dossieQ.data?.documentos?.length ?? 0) > 0 && (
        <div className="mt-2.5 border-t border-violet-200/70 pt-2 dark:border-violet-900">
          <p className="text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
            Documentos anexados
          </p>
          {(dossieQ.data.documentos ?? []).slice(0, 6).map((d: { id: number; nome: string }) => (
            <div
              key={d.id}
              className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{d.nome}</span>
            </div>
          ))}
          {(dossieQ.data.documentos?.length ?? 0) > 6 && (
            <p className="text-[10.5px] text-muted-foreground">
              + {dossieQ.data.documentos.length - 6} arquivos
            </p>
          )}
        </div>
      )}
    </div>
  );
}
