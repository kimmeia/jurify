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

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Braces } from "lucide-react";

export interface Variavel {
  path: string;
  label: string;
  exemplo: string;
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

  const filtrados = variaveis.filter(
    (v) => v.path.toLowerCase().includes(filtro.toLowerCase()) ||
           v.label.toLowerCase().includes(filtro.toLowerCase()),
  );

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setFiltro("");
        }}
        title="Inserir variável"
        className="inline-flex items-center justify-center h-5 w-5 rounded text-violet-600 hover:bg-violet-100 dark:hover:bg-violet-950/30 transition-colors"
      >
        <Braces className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute z-50 right-0 top-full mt-1 w-72 max-h-64 overflow-auto rounded-md border bg-popover shadow-md">
          <div className="sticky top-0 bg-popover border-b p-2">
            <input
              autoFocus
              type="text"
              placeholder="Filtrar..."
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              className="w-full text-xs px-2 py-1 rounded border bg-background outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          {filtrados.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3 text-center">Nenhuma variável encontrada.</p>
          ) : (
            <div className="py-1">
              {filtrados.map((v) => (
                <button
                  key={v.path}
                  type="button"
                  onClick={() => {
                    onInsert(v.path);
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
                >
                  <code className="text-[11px] text-violet-600 font-mono">{`{{${v.path}}}`}</code>
                  <p className="text-[11px] text-foreground mt-0.5">{v.label}</p>
                  <p className="text-[10px] text-muted-foreground italic">ex: {v.exemplo}</p>
                </button>
              ))}
            </div>
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
                className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors"
              >
                <code className="text-[11px] text-violet-600 font-mono">{v.path}</code>
                <p className="text-[10px] text-muted-foreground">{v.label}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Função pública pra trigger externo (botão {x}) chamar via ref ou prop callback */}
    </div>
  );
}
