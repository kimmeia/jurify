import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Trash2, Loader2 } from "lucide-react";

type Comentario = {
  id: number;
  texto: string;
  createdAt: string | Date;
  autorId: number;
  autorNome: string;
};

export function ComentariosSection({
  cardId,
  comentarios,
  onChange,
}: {
  cardId: number;
  comentarios: Comentario[];
  onChange: () => void;
}) {
  const [texto, setTexto] = useState("");

  const adicionarMut = (trpc as any).kanban.adicionarComentario.useMutation({
    onSuccess: () => {
      setTexto("");
      onChange();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const removerMut = (trpc as any).kanban.removerComentario.useMutation({
    onSuccess: () => onChange(),
    onError: (e: any) => toast.error(e.message),
  });

  const handleAdicionar = () => {
    const t = texto.trim();
    if (!t) return;
    adicionarMut.mutate({ cardId, texto: t });
  };

  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground mb-2 flex items-center gap-1">
        <MessageSquare className="h-3 w-3" />
        COMENTÁRIOS ({comentarios.length})
      </p>

      <div className="space-y-2 mb-3">
        {comentarios.length === 0 && (
          <p className="text-xs text-muted-foreground italic">Nenhum comentário ainda.</p>
        )}
        {comentarios.map((c) => (
          <div key={c.id} className="border rounded-md p-2 bg-muted/30">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-medium">{c.autorNome}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => removerMut.mutate({ id: c.id })}
                  title="Remover (autor ou gestor)"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <p className="text-xs whitespace-pre-wrap break-words">{c.texto}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Adicionar comentário..."
          className="min-h-[60px] text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAdicionar();
            }
          }}
        />
        <Button
          size="sm"
          onClick={handleAdicionar}
          disabled={!texto.trim() || adicionarMut.isPending}
          className="self-end"
        >
          {adicionarMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Adicionar
        </Button>
      </div>
    </div>
  );
}
