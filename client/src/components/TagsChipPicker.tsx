/**
 * Picker de tags por chips. Lista as tags configuradas no escritório
 * (com cor) + permite digitar tag nova (cria ao apertar Enter ou
 * vírgula). Renderiza chips das tags selecionadas que dá pra remover.
 *
 * Diferente do `VariableInput`: tags são valores literais (não usa
 * `{{...}}`). Persiste como string vírgula-separada (formato existente
 * em `kanbanCards.tags` e `contatos.tags`).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { X, Plus, Loader2 } from "lucide-react";

interface Props {
  value: string; // "VIP, Trabalhista"
  onChange: (value: string) => void;
  /** Mostra botão "Criar tag" inline ao digitar nome novo. Default true. */
  permitirCriar?: boolean;
  placeholder?: string;
}

function parseTags(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function joinTags(tags: string[]): string {
  return tags.join(", ");
}

export function TagsChipPicker({ value, onChange, permitirCriar = true, placeholder }: Props) {
  const [input, setInput] = useState("");
  const tagsSelecionadas = parseTags(value);

  const { data: tagsEscritorio, refetch } = (trpc as any).kanban.listarTags.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const criarTag = (trpc as any).kanban.criarTag.useMutation({
    onSuccess: () => refetch(),
  });

  const todasTags: { id: number; nome: string; cor: string }[] = tagsEscritorio || [];
  const naoSelecionadas = todasTags.filter((t) => !tagsSelecionadas.includes(t.nome));

  // Tag digitada que ainda não existe no catálogo nem está selecionada
  const inputTrim = input.trim();
  const podeCriar =
    permitirCriar &&
    inputTrim.length > 0 &&
    inputTrim.length <= 32 &&
    !tagsSelecionadas.includes(inputTrim) &&
    !todasTags.some((t) => t.nome.toLowerCase() === inputTrim.toLowerCase());

  function adicionar(nome: string) {
    if (!nome) return;
    if (tagsSelecionadas.includes(nome)) return;
    onChange(joinTags([...tagsSelecionadas, nome]));
    setInput("");
  }

  function remover(nome: string) {
    onChange(joinTags(tagsSelecionadas.filter((t) => t !== nome)));
  }

  async function criarECselectionar() {
    const nome = inputTrim;
    if (!nome) return;
    try {
      await criarTag.mutateAsync({ nome, cor: "#6366f1" });
      adicionar(nome);
    } catch {
      // se falhar, ainda assim adiciona como tag livre — backend aceita
      adicionar(nome);
    }
  }

  function corTag(nome: string): string | undefined {
    return todasTags.find((t) => t.nome === nome)?.cor;
  }

  return (
    <div className="space-y-2">
      {/* Chips das tags já selecionadas */}
      {tagsSelecionadas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tagsSelecionadas.map((nome) => {
            const cor = corTag(nome);
            return (
              <span
                key={nome}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-white"
                style={{ background: cor || "#6b7280" }}
              >
                {nome}
                <button
                  type="button"
                  onClick={() => remover(nome)}
                  className="hover:bg-white/20 rounded-full p-0.5"
                  title="Remover"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Input de busca/criação */}
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && inputTrim) {
            e.preventDefault();
            const existente = todasTags.find((t) => t.nome.toLowerCase() === inputTrim.toLowerCase());
            if (existente) {
              adicionar(existente.nome);
            } else if (podeCriar) {
              void criarECselectionar();
            }
          } else if (e.key === "Backspace" && !input && tagsSelecionadas.length > 0) {
            // Backspace em campo vazio remove última tag — UX comum em pickers
            remover(tagsSelecionadas[tagsSelecionadas.length - 1]);
          }
        }}
        placeholder={placeholder || "Digite pra buscar ou criar tag..."}
        className="h-8 text-xs"
      />

      {/* Sugestões: tags existentes não selecionadas que casam com o input */}
      {input.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {naoSelecionadas
            .filter((t) => t.nome.toLowerCase().includes(input.toLowerCase()))
            .slice(0, 8)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => adicionar(t.nome)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-white opacity-70 hover:opacity-100 transition-opacity"
                style={{ background: t.cor }}
              >
                <Plus className="h-2.5 w-2.5" /> {t.nome}
              </button>
            ))}
          {podeCriar && (
            <button
              type="button"
              onClick={criarECselectionar}
              disabled={criarTag.isPending}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border border-dashed border-violet-400 text-violet-600 hover:bg-violet-50 transition-colors"
            >
              {criarTag.isPending ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Plus className="h-2.5 w-2.5" />
              )}
              Criar &ldquo;{inputTrim}&rdquo;
            </button>
          )}
        </div>
      )}

      {/* Quando vazio, mostra todas as tags do escritório como sugestão */}
      {input.length === 0 && naoSelecionadas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {naoSelecionadas.slice(0, 12).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => adicionar(t.nome)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-white opacity-50 hover:opacity-100 transition-opacity"
              style={{ background: t.cor }}
            >
              <Plus className="h-2.5 w-2.5" /> {t.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
