/**
 * Histórico de buscas e alertas inteligentes para a tela de Processos.
 *
 * Armazenamento local (localStorage) — os dados não saem do navegador.
 * Isso evita complexidade de backend e é a abordagem preferida para
 * features de conveniência do usuário.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Clock, X, Bell, Plus, Star, StarOff, History, Bookmark, BellRing,
} from "lucide-react";
import { toast } from "sonner";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface SearchHistoryItem {
  id: string;
  tipo: string;
  valor: string;
  timestamp: number;
  favorito?: boolean;
  nome?: string; // nome amigável para saved search
}

export interface KeywordAlert {
  id: string;
  palavra: string;
  notificacoes: boolean;
  createdAt: number;
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

const HISTORY_KEY = "jurify:processos:history";
const ALERTS_KEY = "jurify:processos:alerts";
const MAX_HISTORY = 20;

function loadHistory(): SearchHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: SearchHistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

function loadAlerts(): KeywordAlert[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAlerts(items: KeywordAlert[]) {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

// ─── Hooks exportados ────────────────────────────────────────────────────────

export function useSearchHistory() {
  const [items, setItems] = useState<SearchHistoryItem[]>([]);

  useEffect(() => {
    setItems(loadHistory());
  }, []);

  const add = (tipo: string, valor: string) => {
    setItems((prev) => {
      // Remove duplicata exata (mesmo tipo+valor) mantendo favoritos no topo
      const filtered = prev.filter((p) => !(p.tipo === tipo && p.valor === valor));
      const novo: SearchHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tipo,
        valor,
        timestamp: Date.now(),
      };
      const next = [novo, ...filtered];
      saveHistory(next);
      return next;
    });
  };

  const remove = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveHistory(next);
      return next;
    });
  };

  const toggleFavorito = (id: string, nome?: string) => {
    setItems((prev) => {
      const next = prev.map((p) =>
        p.id === id ? { ...p, favorito: !p.favorito, nome: p.favorito ? undefined : nome || p.valor } : p,
      );
      saveHistory(next);
      return next;
    });
  };

  const clear = () => {
    setItems((prev) => {
      const next = prev.filter((p) => p.favorito);
      saveHistory(next);
      return next;
    });
  };

  return { items, add, remove, toggleFavorito, clear };
}

export function useKeywordAlerts() {
  const [items, setItems] = useState<KeywordAlert[]>([]);

  useEffect(() => {
    setItems(loadAlerts());
  }, []);

  const add = (palavra: string) => {
    const trimmed = palavra.trim().toLowerCase();
    if (!trimmed) return;
    setItems((prev) => {
      if (prev.some((p) => p.palavra === trimmed)) return prev;
      const novo: KeywordAlert = {
        id: `alert-${Date.now()}`,
        palavra: trimmed,
        notificacoes: true,
        createdAt: Date.now(),
      };
      const next = [novo, ...prev];
      saveAlerts(next);
      return next;
    });
  };

  const remove = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveAlerts(next);
      return next;
    });
  };

  return { items, add, remove };
}

/** Verifica se um texto contém alguma palavra-chave monitorada (case insensitive) */
export function checkKeywords(texto: string, alerts: KeywordAlert[]): string[] {
  if (!texto) return [];
  const low = texto.toLowerCase();
  return alerts.filter((a) => low.includes(a.palavra)).map((a) => a.palavra);
}

// ─── Componente: Histórico + Favoritos (sidebar) ─────────────────────────────

export function SearchHistorySidebar({
  onSelect,
}: {
  onSelect: (tipo: string, valor: string) => void;
}) {
  const { items, remove, toggleFavorito, clear } = useSearchHistory();

  const favoritos = items.filter((i) => i.favorito);
  const recentes = items.filter((i) => !i.favorito).slice(0, 10);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center">
          <History className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            Suas buscas aparecerão aqui.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Favoritos */}
      {favoritos.length > 0 && (
        <Card>
          <CardContent className="pt-3 pb-3 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
              <Bookmark className="h-3 w-3" />
              Buscas salvas
            </p>
            {favoritos.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/40 group cursor-pointer"
                onClick={() => onSelect(f.tipo, f.valor)}
              >
                <Star className="h-3 w-3 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate">{f.nome || f.valor}</p>
                  <Badge variant="outline" className="text-[9px] px-1 py-0">
                    {f.tipo.replace("lawsuit_cnj", "CNJ")}
                  </Badge>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorito(f.id);
                  }}
                  className="opacity-0 group-hover:opacity-100"
                >
                  <StarOff className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Histórico recente */}
      {recentes.length > 0 && (
        <Card>
          <CardContent className="pt-3 pb-3 space-y-1">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Histórico
              </p>
              <button
                className="text-[9px] text-muted-foreground hover:text-foreground"
                onClick={clear}
              >
                Limpar
              </button>
            </div>
            {recentes.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/40 group cursor-pointer"
                onClick={() => onSelect(h.tipo, h.valor)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate font-mono">{h.valor}</p>
                  <Badge variant="outline" className="text-[9px] px-1 py-0">
                    {h.tipo.replace("lawsuit_cnj", "CNJ")}
                  </Badge>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorito(h.id);
                  }}
                  className="opacity-0 group-hover:opacity-100"
                  title="Favoritar"
                >
                  <Star className="h-3 w-3 text-muted-foreground hover:text-amber-500" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(h.id);
                  }}
                  className="opacity-0 group-hover:opacity-100"
                  title="Remover"
                >
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Componente: Gerenciar alertas de palavras-chave ─────────────────────────

export function KeywordAlertsButton() {
  const { items, add, remove } = useKeywordAlerts();
  const [nova, setNova] = useState("");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs relative">
          <Bell className="h-3.5 w-3.5 mr-1" />
          Alertas
          {items.length > 0 && (
            <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] bg-blue-500 border-0">
              {items.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="end">
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <BellRing className="h-3.5 w-3.5" />
            Alertas inteligentes
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Você será notificado quando uma movimentação contiver estas palavras.
          </p>
        </div>

        <div className="flex gap-1">
          <Input
            placeholder='Ex: "sentença", "audiência", "penhora"'
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && nova.trim()) {
                add(nova);
                setNova("");
                toast.success("Alerta adicionado");
              }
            }}
          />
          <Button
            size="sm"
            className="h-8 px-2"
            onClick={() => {
              if (nova.trim()) {
                add(nova);
                setNova("");
                toast.success("Alerta adicionado");
              }
            }}
            disabled={!nova.trim()}
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="space-y-1">
            {items.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 px-2 py-1 rounded bg-muted/40"
              >
                <Bell className="h-3 w-3 text-blue-500" />
                <span className="text-xs flex-1">{a.palavra}</span>
                <button
                  onClick={() => remove(a.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground text-center py-2">
            Nenhum alerta configurado.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
