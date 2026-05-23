/**
 * Input/Textarea com autocomplete de variáveis `{{...}}`.
 *
 * Quando o usuário digita `{{`, abre dropdown filtrável com a lista de
 * variáveis disponíveis (passada via prop `variaveis`). Selecionar
 * insere `{{path}}` na posição do cursor.
 *
 * Botão `{x}` ao lado do label abre o mesmo dropdown — pra usuários que
 * não conhecem o atalho.
 *
 * Suporta tanto `<Input>` (single-line) quanto `<Textarea>` (multi-line)
 * via prop `as`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Braces } from "lucide-react";

export interface Variavel {
  path: string;
  label: string;
  exemplo: string;
  /** Categoria semântica pra agrupar no drawer "Informações". Opcional. */
  categoria?: string;
}

/** Label humano de cada categoria — usado pra agrupar o dropdown de variáveis. */
const CATEGORIA_LABEL: Record<string, string> = {
  passos: "Resultados de passos anteriores",
  cliente: "Dados do cliente",
  campos_personalizados: "Campos personalizados",
  mensagem: "Mensagem / conversa",
  pagamento: "Pagamento / cobrança",
  acao: "Ação / processo",
  agendamento: "Agendamento",
  ia: "Resultados da IA",
  outros: "Outras informações",
};

const CATEGORIA_ORDEM = [
  "passos", "cliente", "campos_personalizados", "mensagem",
  "pagamento", "acao", "agendamento", "ia", "outros",
];

/** Agrupa variáveis por categoria, na ordem canônica, pra render em seções. */
function agruparPorCategoria(vars: Variavel[]): Array<{ categoria: string; label: string; itens: Variavel[] }> {
  const mapa = new Map<string, Variavel[]>();
  for (const v of vars) {
    const cat = v.categoria || "outros";
    const lista = mapa.get(cat) ?? [];
    lista.push(v);
    mapa.set(cat, lista);
  }
  const out: Array<{ categoria: string; label: string; itens: Variavel[] }> = [];
  for (const cat of CATEGORIA_ORDEM) {
    const itens = mapa.get(cat);
    if (itens && itens.length > 0) {
      out.push({ categoria: cat, label: CATEGORIA_LABEL[cat] || cat, itens });
    }
  }
  // Categorias desconhecidas (não na ordem) vão no fim.
  for (const [cat, itens] of mapa) {
    if (!CATEGORIA_ORDEM.includes(cat) && itens.length > 0) {
      out.push({ categoria: cat, label: CATEGORIA_LABEL[cat] || cat, itens });
    }
  }
  return out;
}

interface VariableInputProps {
  value: string;
  onChange: (value: string) => void;
  variaveis: Variavel[];
  placeholder?: string;
  className?: string;
  /** "input" (default, single-line) ou "textarea" (multi-line) */
  as?: "input" | "textarea";
  /** rows pro textarea */
  rows?: number;
  /** maxLength */
  maxLength?: number;
  /** id do input pra label associar */
  id?: string;
}

/**
 * Botão pequeno `{x}` que abre o dropdown manualmente. Renderize
 * próximo ao Label do campo. Use o mesmo `id` que o input pra que o
 * usuário entenda a relação (clicar no botão foca o input).
 */
export function VariableTrigger({
  variaveis,
  inputId,
  onInsert,
}: {
  variaveis: Variavel[];
  inputId: string;
  onInsert: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filtro, setFiltro] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current && !triggerRef.current.parentElement?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const grupos = useMemo(() => {
    const f = filtro.toLowerCase();
    const filtrados = variaveis.filter(
      (v) => v.path.toLowerCase().includes(f) || v.label.toLowerCase().includes(f),
    );
    return agruparPorCategoria(filtrados);
  }, [variaveis, filtro]);

  const total = grupos.reduce((s, g) => s + g.itens.length, 0);

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setFiltro("");
        }}
        title="Inserir informação"
        className="inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-medium text-violet-600 hover:bg-violet-100 dark:hover:bg-violet-950/30 transition-colors"
      >
        <Braces className="h-3 w-3" />
        Inserir
      </button>
      {open && (
        <div className="absolute z-50 right-0 top-full mt-1 w-72 max-h-80 overflow-auto rounded-md border bg-popover shadow-lg">
          <div className="sticky top-0 bg-popover border-b p-2 z-10">
            <input
              autoFocus
              type="text"
              placeholder="Buscar informação (ex: nome, cpf...)"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              className="w-full text-xs px-2 py-1 rounded border bg-background outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          {total === 0 ? (
            <p className="text-xs text-muted-foreground p-3 text-center">Nenhuma informação encontrada.</p>
          ) : (
            grupos.map((g) => (
              <div key={g.categoria}>
                <p className="px-3 py-1 text-[9px] uppercase tracking-wider font-bold text-muted-foreground bg-muted/40 sticky top-[41px]">
                  {g.label}
                </p>
                {g.itens.map((v) => (
                  <button
                    key={v.path}
                    type="button"
                    onClick={() => {
                      onInsert(v.path);
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
                  >
                    <p className="text-[11.5px] text-foreground font-medium">{v.label}</p>
                    {v.exemplo && <p className="text-[10px] text-muted-foreground italic">ex: {v.exemplo}</p>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function VariableInput({
  value,
  onChange,
  variaveis,
  placeholder,
  className,
  as = "input",
  rows = 3,
  maxLength,
  id,
}: VariableInputProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteFiltro, setAutocompleteFiltro] = useState("");
  const [posicaoCaret, setPosicaoCaret] = useState(0);

  // Detecta `{{...` na posição atual do caret pra abrir autocomplete.
  function detectarTrigger(novoValor: string, posCaret: number) {
    // Olha pra trás do caret procurando o `{{` mais próximo até espaço
    // ou início da string. Se encontrar, abre autocomplete com filtro.
    const ate = novoValor.slice(0, posCaret);
    const idx = ate.lastIndexOf("{{");
    if (idx === -1) {
      setAutocompleteOpen(false);
      return;
    }
    const trecho = ate.slice(idx + 2);
    // Se já tem `}}` no trecho, autocomplete já foi fechado — ignora.
    if (trecho.includes("}}") || trecho.includes(" ") || trecho.includes("\n")) {
      setAutocompleteOpen(false);
      return;
    }
    setAutocompleteFiltro(trecho);
    setAutocompleteOpen(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const novoValor = e.target.value;
    onChange(novoValor);
    setPosicaoCaret(e.target.selectionStart || 0);
    detectarTrigger(novoValor, e.target.selectionStart || 0);
  }

  function handleKeyUp(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement;
    setPosicaoCaret(target.selectionStart || 0);
    detectarTrigger(target.value, target.selectionStart || 0);
  }

  function inserirVariavel(path: string) {
    const elem = inputRef.current;
    if (!elem) return;
    const cur = elem.value;
    const idxBraces = cur.slice(0, posicaoCaret).lastIndexOf("{{");
    let novo: string;
    let novaPos: number;
    if (idxBraces !== -1 && autocompleteOpen) {
      // Substitui o trecho `{{<filtro>` pelo `{{path}}` completo.
      novo = cur.slice(0, idxBraces) + `{{${path}}}` + cur.slice(posicaoCaret);
      novaPos = idxBraces + path.length + 4; // após }}
    } else {
      // Inserção via botão {x} — insere na posição atual do caret.
      novo = cur.slice(0, posicaoCaret) + `{{${path}}}` + cur.slice(posicaoCaret);
      novaPos = posicaoCaret + path.length + 4;
    }
    onChange(novo);
    setAutocompleteOpen(false);
    requestAnimationFrame(() => {
      elem.focus();
      elem.setSelectionRange(novaPos, novaPos);
    });
  }

  const filtrados = variaveis.filter(
    (v) => v.path.toLowerCase().includes(autocompleteFiltro.toLowerCase()) ||
           v.label.toLowerCase().includes(autocompleteFiltro.toLowerCase()),
  );

  return (
    <div className="relative">
      {as === "textarea" ? (
        <Textarea
          ref={inputRef as any}
          id={id}
          value={value}
          onChange={handleChange}
          onKeyUp={handleKeyUp}
          onBlur={() => setTimeout(() => setAutocompleteOpen(false), 150)}
          placeholder={placeholder}
          className={className}
          rows={rows}
          maxLength={maxLength}
        />
      ) : (
        <Input
          ref={inputRef as any}
          id={id}
          value={value}
          onChange={handleChange}
          onKeyUp={handleKeyUp}
          onBlur={() => setTimeout(() => setAutocompleteOpen(false), 150)}
          placeholder={placeholder}
          className={className}
          maxLength={maxLength}
        />
      )}

      {autocompleteOpen && filtrados.length > 0 && (
        <div className="absolute z-50 left-0 top-full mt-1 w-full max-h-48 overflow-auto rounded-md border bg-popover shadow-md">
          <div className="py-1">
            {filtrados.slice(0, 8).map((v) => (
              <button
                key={v.path}
                type="button"
                onMouseDown={(e) => e.preventDefault()} // evita blur do input
                onClick={() => inserirVariavel(v.path)}
                className="w-full text-left px-3 py-1.5 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
              >
                <p className="text-[11.5px] text-foreground font-medium">{v.label}</p>
                {v.exemplo && <p className="text-[10px] text-muted-foreground italic">ex: {v.exemplo}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Função pública pra trigger externo (botão {x}) chamar via ref ou prop callback */}
    </div>
  );
}
