/**
 * Form dinâmico que renderiza os campos personalizados do escritório
 * (configurados em Configurações > Campos personalizados) pra preencher
 * no cadastro do cliente.
 *
 * Lê definições via `trpc.camposCliente.listar`. Estado é controlado
 * por fora via `value: Record<chave, valor>` + `onChange`. Cada tipo
 * renderiza o input apropriado (text/number/date/textarea/select/switch).
 */

import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sparkles } from "lucide-react";

type ValorCampo = string | number | boolean | null;

interface Props {
  /** Mapa de chave → valor. Mantém todos os campos juntos. */
  value: Record<string, ValorCampo>;
  onChange: (next: Record<string, ValorCampo>) => void;
  /** Quando true, mostra * obrigatório. Default true. */
  destacarObrigatorios?: boolean;
}

export function CamposPersonalizadosForm({ value, onChange, destacarObrigatorios = true }: Props) {
  const { data: campos, isLoading } = (trpc as any).camposCliente.listar.useQuery();

  if (isLoading) return null;
  if (!campos || campos.length === 0) return null;

  function setValor(chave: string, val: ValorCampo) {
    onChange({ ...value, [chave]: val });
  }

  return (
    <div className="space-y-3 pt-3 border-t">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        Campos personalizados
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {campos.map((c: any) => {
          const v = value?.[c.chave];
          return (
            <div
              key={c.id}
              className={c.tipo === "textarea" ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}
            >
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">{c.label}</Label>
                {destacarObrigatorios && c.obrigatorio && (
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                    obrigatório
                  </Badge>
                )}
              </div>

              {c.tipo === "texto" && (
                <Input
                  value={typeof v === "string" ? v : ""}
                  onChange={(e) => setValor(c.chave, e.target.value)}
                  placeholder={c.ajuda || ""}
                />
              )}

              {c.tipo === "numero" && (
                <Input
                  type="number"
                  value={v == null || v === "" ? "" : String(v)}
                  onChange={(e) => {
                    const n = e.target.value;
                    setValor(c.chave, n === "" ? null : Number(n));
                  }}
                  placeholder={c.ajuda || ""}
                />
              )}

              {c.tipo === "data" && (
                <Input
                  type="date"
                  value={typeof v === "string" ? v : ""}
                  onChange={(e) => setValor(c.chave, e.target.value)}
                />
              )}

              {c.tipo === "textarea" && (
                <Textarea
                  value={typeof v === "string" ? v : ""}
                  onChange={(e) => setValor(c.chave, e.target.value)}
                  rows={3}
                  placeholder={c.ajuda || ""}
                />
              )}

              {c.tipo === "select" && (
                <Select
                  value={typeof v === "string" ? v : ""}
                  onValueChange={(novo) => setValor(c.chave, novo === "_none" ? null : novo)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {!c.obrigatorio && <SelectItem value="_none">— Vazio —</SelectItem>}
                    {(c.opcoes || []).map((o: string) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {c.tipo === "boolean" && (
                <div className="flex items-center justify-between p-2 rounded-md border bg-muted/30 h-9">
                  <span className="text-xs text-muted-foreground">
                    {v === true ? "Sim" : v === false ? "Não" : "Não definido"}
                  </span>
                  <Switch
                    checked={v === true}
                    onCheckedChange={(b) => setValor(c.chave, b)}
                  />
                </div>
              )}

              {c.tipo !== "textarea" && c.ajuda && (
                <p className="text-[10px] text-muted-foreground">{c.ajuda}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Valida se todos campos obrigatórios estão preenchidos.
 *  Retorna lista de labels faltando (vazia se OK). */
export function validarCamposObrigatorios(
  valores: Record<string, ValorCampo>,
  campos: { chave: string; label: string; obrigatorio: boolean }[],
): string[] {
  const faltando: string[] = [];
  for (const c of campos) {
    if (!c.obrigatorio) continue;
    const v = valores?.[c.chave];
    if (v === null || v === undefined || v === "") {
      faltando.push(c.label);
    }
  }
  return faltando;
}
