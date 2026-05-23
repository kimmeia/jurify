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
  /**
   * Destaca as variáveis `{{...}}` com pill colorida no próprio campo
   * (overlay sobre o textarea). Só funciona com `as="textarea"`.
   */
  highlight?: boolean;
  /**
   * Mostra abaixo do campo um preview do texto com as variáveis trocadas
   * pelos exemplos — ajuda o usuário a ver como a mensagem real vai sair.
   */
  preview?: boolean;
}

/** Quebra o texto em partes, marcando os trechos `{{...}}` como variável. */
function partesComVariaveis(texto: string): Array<{ tipo: "texto" | "var"; valor: string }> {
  const out: Array<{ tipo: "texto" | "var"; valor: string }> = [];
  const re = /\{\{[^}]+\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    if (m.index > last) out.push({ tipo: "texto", valor: texto.slice(last, m.index) });
    out.push({ tipo: "var", valor: m[0] });
    last = m.index + m[0].length;
  }
  if (last < texto.length) out.push({ tipo: "texto", valor: texto.slice(last) });
  return out;
}

/**
 * Substitui `{{path}}` pelo exemplo da variável (ou pelo label) — usado no
 * preview ao vivo. Variável desconhecida fica como está.
 */
function montarPreview(texto: string, variaveis: Variavel[]): string {
  return texto.replace(/\{\{([^}]+)\}\}/g, (full, path: string) => {
    const v = variaveis.find((x) => x.path === path.trim());
    if (!v) return full;
    return v.exemplo || v.label;
  });
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
  highlight = false,
  preview = false,
}: VariableInputProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteFiltro, setAutocompleteFiltro] = useState("");
  const [posicaoCaret, setPosicaoCaret] = useState(0);

  // Highlight só faz sentido em textarea. Métricas idênticas às do
  // componente Textarea (px-3 py-2 text-base md:text-sm) garantem que o
  // texto do backdrop alinhe exatamente com o do textarea por cima.
  const usarHighlight = highlight && as === "textarea";
  const metricasTextarea = "min-h-16 w-full rounded-md border px-3 py-2 text-base md:text-sm leading-normal";

  // Mantém o scroll do backdrop sincronizado com o textarea (texto longo).
  function syncScroll() {
    if (backdropRef.current && inputRef.current) {
      backdropRef.current.scrollTop = inputRef.current.scrollTop;
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }

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

  const temVariavel = /\{\{[^}]+\}\}/.test(value);

  return (
    <div className="relative">
      {as === "textarea" ? (
        usarHighlight ? (
          <div className="relative">
            {/* Backdrop: mesmo texto do textarea, mas com {{...}} em pill.
                Mantém os MESMOS caracteres (não troca {{x}} por label) pra
                não desalinhar o caret do textarea por cima. */}
            <div
              ref={backdropRef}
              aria-hidden
              className={`${metricasTextarea} ${className ?? ""} absolute inset-0 overflow-auto whitespace-pre-wrap break-words pointer-events-none border-transparent text-foreground`}
            >
              {partesComVariaveis(value).map((p, i) =>
                p.tipo === "var" ? (
                  <span
                    key={i}
                    className="rounded bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300 ring-1 ring-violet-300/50"
                  >
                    {p.valor}
                  </span>
                ) : (
                  <span key={i}>{p.valor}</span>
                ),
              )}
              {/* newline final pra altura bater quando texto termina em \n */}
              {"\n"}
            </div>
            <Textarea
              ref={inputRef as any}
              id={id}
              value={value}
              onChange={handleChange}
              onKeyUp={handleKeyUp}
              onScroll={syncScroll}
              onBlur={() => setTimeout(() => setAutocompleteOpen(false), 150)}
              placeholder={placeholder}
              className={`${className ?? ""} relative bg-transparent text-transparent caret-foreground selection:bg-violet-200/40`}
              rows={rows}
              maxLength={maxLength}
            />
          </div>
        ) : (
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
        )
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

      {preview && temVariavel && (
        <div className="mt-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-muted/40 px-2.5 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold mb-0.5">
            👁 Como vai sair pro cliente
          </p>
          <p className="text-[11px] text-foreground/80 italic leading-snug whitespace-pre-wrap">
            {montarPreview(value, variaveis)}
          </p>
        </div>
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
