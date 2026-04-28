/**
 * Input de mensagem com autocomplete de Respostas Rápidas.
 *
 * Quando o usuário digita `/` (no início ou após espaço), abre um dropdown
 * listando os templates com `atalho` preenchido, filtrados pelo texto
 * digitado após a barra. Navega com ↑/↓, confirma com Enter/Tab, cancela
 * com ESC. Enter sem dropdown aberto envia a mensagem normalmente.
 *
 * A lógica de parsing (detectar atalho, aplicar substituição, filtrar
 * templates) vive em `@shared/atalho-templates` — este componente só
 * cuida da UI e dos eventos.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  aplicarAtalho,
  detectarAtalhoAtivo,
  filtrarTemplatesParaAtalho,
} from "@shared/atalho-templates";

export interface TemplateRespostaRapida {
  id: number;
  titulo: string;
  conteudo: string;
  atalho: string | null;
  categoria?: string | null;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  templates: TemplateRespostaRapida[];
  onEnter: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function RespostaRapidaAutocomplete({
  value,
  onChange,
  templates,
  onEnter,
  placeholder,
  disabled,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const [cursorPendente, setCursorPendente] = useState<number | null>(null);

  // Sincroniza posição do cursor do DOM → state a cada renderização que o
  // usuário dispara (teclado/clique). O dropdown depende do cursor, então
  // precisa reagir a mudanças também por seleção sem digitar.
  const atualizarCursor = () => {
    const el = inputRef.current;
    if (!el) return;
    const p = el.selectionStart ?? el.value.length;
    setCursor(p);
  };

  // Reposiciona o cursor depois que o React aplicar o `value` novo (após
  // aplicarAtalho). `setSelectionRange` precisa do DOM atualizado.
  useEffect(() => {
    if (cursorPendente == null) return;
    const el = inputRef.current;
    if (el) {
      el.setSelectionRange(cursorPendente, cursorPendente);
      setCursor(cursorPendente);
    }
    setCursorPendente(null);
  }, [cursorPendente, value]);

  const atalhoAtivo = useMemo(
    () => detectarAtalhoAtivo(value, cursor),
    [value, cursor],
  );

  const sugestoes = useMemo(() => {
    if (!atalhoAtivo) return [];
    return filtrarTemplatesParaAtalho(templates, atalhoAtivo.filtro);
  }, [atalhoAtivo, templates]);

  const aberto = atalhoAtivo !== null && sugestoes.length > 0;

  // Mantém o índice ativo dentro dos limites quando a lista muda.
  useEffect(() => {
    if (indiceAtivo >= sugestoes.length) setIndiceAtivo(0);
  }, [sugestoes, indiceAtivo]);

  const confirmarSelecao = (tpl: TemplateRespostaRapida) => {
    if (!atalhoAtivo) return;
    const { valor: novo, cursor: novoCursor } = aplicarAtalho(
      value,
      atalhoAtivo.inicio,
      cursor,
      tpl.conteudo,
    );
    onChange(novo);
    setCursorPendente(novoCursor);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (aberto) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndiceAtivo((i) => (i + 1) % sugestoes.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndiceAtivo((i) => (i - 1 + sugestoes.length) % sugestoes.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        confirmarSelecao(sugestoes[indiceAtivo]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // Força descoberta do fechamento empurrando o cursor pra fora:
        // basta digitar espaço — mas aqui só "fechamos" no próximo render,
        // sem mexer no valor. Re-foca e deixa o usuário continuar.
        inputRef.current?.focus();
        // Trick: move cursor para antes do "/" para que detectarAtalhoAtivo
        // devolva null na próxima iteração.
        const posAntes = atalhoAtivo?.inicio ?? cursor;
        inputRef.current?.setSelectionRange(posAntes, posAntes);
        setCursor(posAntes);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEnter();
    }
  };

  return (
    <div className="relative w-full">
      {aberto && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-popover border rounded-md shadow-lg overflow-hidden"
          role="listbox"
          aria-label="Respostas rápidas"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
            Respostas rápidas
            <span className="normal-case tracking-normal ml-2 text-muted-foreground/70">
              (↑↓ navegar · Enter/Tab selecionar · Esc cancelar)
            </span>
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {sugestoes.map((t, i) => (
              <li
                key={t.id}
                role="option"
                aria-selected={i === indiceAtivo}
                onMouseEnter={() => setIndiceAtivo(i)}
                onMouseDown={(e) => {
                  // mouseDown em vez de click: evita o input perder foco
                  // antes do React atualizar state.
                  e.preventDefault();
                  confirmarSelecao(t);
                }}
                className={`px-3 py-2 cursor-pointer flex items-start gap-3 text-sm ${
                  i === indiceAtivo ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <span className="font-mono text-xs text-primary shrink-0 min-w-[50px]">
                  {t.atalho}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-sm">{t.titulo}</span>
                  <span className="block text-xs text-muted-foreground line-clamp-1">
                    {t.conteudo.split("\n")[0]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          atualizarCursor();
          setIndiceAtivo(0);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={atualizarCursor}
        onClick={atualizarCursor}
        onSelect={atualizarCursor}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        autoComplete="off"
      />
    </div>
  );
}
