/**
 * Aba "Relatórios" do módulo Financeiro — DRE por período + export.
 * Receitas e despesas agrupadas por categoria, resultado líquido e margem.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Download,
  FileText,
  Loader2,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "./helpers";

function inicioDoMesIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function fimDoMesIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
}

function presetParaRange(preset: "1m" | "3m" | "6m" | "12m"): {
  inicio: string;
  fim: string;
} {
  const meses = preset === "1m" ? 1 : preset === "3m" ? 3 : preset === "6m" ? 6 : 12;
  const hoje = new Date();
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  return {
    inicio: inicio.toISOString().slice(0, 10),
    fim: fim.toISOString().slice(0, 10),
  };
}

function baixarBlob(content: string | Blob, filename: string, mimeType: string) {
  const blob =
    typeof content === "string" ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

/** Converte base64 → Blob no navegador (sem libs externas). */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function RelatoriosTab() {
  const [preset, setPreset] = useState<"1m" | "3m" | "6m" | "12m" | "custom">("1m");
  const [dataInicio, setDataInicio] = useState(inicioDoMesIso());
  const [dataFim, setDataFim] = useState(fimDoMesIso());

  // Sincroniza datas com preset quando preset muda (não-custom)
  function aplicarPreset(p: typeof preset) {
    setPreset(p);
    if (p !== "custom") {
      const r = presetParaRange(p);
      setDataInicio(r.inicio);
      setDataFim(r.fim);
    }
  }

  const dreQ = (trpc as any).financeiro?.dre?.useQuery?.(
    { dataInicio, dataFim },
    { retry: false, enabled: dataInicio.length === 10 && dataFim.length === 10 },
  );
  const dre = dreQ?.data;

  const csvMut = (trpc as any).financeiro?.exportarDreCsv?.useMutation?.({
    onSuccess: (r: { filename: string; content: string; mimeType: string }) => {
      baixarBlob(r.content, r.filename, r.mimeType);
      toast.success("CSV baixado");
    },
    onError: (err: any) =>
      toast.error("Erro ao exportar CSV", { description: err.message }),
  });
  const pdfMut = (trpc as any).financeiro?.exportarDrePdf?.useMutation?.({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => {
      const blob = base64ToBlob(r.base64, r.mimeType);
      baixarBlob(blob, r.filename, r.mimeType);
      toast.success("PDF baixado");
    },
    onError: (err: any) =>
      toast.error("Erro ao exportar PDF", { description: err.message }),
  });

  const resultado = dre?.resultadoLiquido ?? 0;
  const positivo = resultado >= 0;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-end gap-3 flex-wrap">
            <Tabs value={preset} onValueChange={(v) => aplicarPreset(v as any)}>
              <TabsList className="h-8">
                <TabsTrigger value="1m" className="text-xs px-3">
                  Mês atual
                </TabsTrigger>
                <TabsTrigger value="3m" className="text-xs px-3">
                  3m
                </TabsTrigger>
                <TabsTrigger value="6m" className="text-xs px-3">
                  6m
                </TabsTrigger>
                <TabsTrigger value="12m" className="text-xs px-3">
                  12m
                </TabsTrigger>
                <TabsTrigger value="custom" className="text-xs px-3">
                  Custom
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {preset === "custom" && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">De</Label>
                  <Input
                    type="date"
                    value={dataInicio}
                    onChange={(e) => setDataInicio(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Até</Label>
                  <Input
                    type="date"
                    value={dataFim}
                    onChange={(e) => setDataFim(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </>
            )}
            <div className="flex-1" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => csvMut?.mutate?.({ dataInicio, dataFim })}
              disabled={!dre || csvMut?.isPending}
            >
              {csvMut?.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5 mr-1.5" />
              )}
              CSV
            </Button>
            <Button
              size="sm"
              onClick={() => pdfMut?.mutate?.({ dataInicio, dataFim })}
              disabled={!dre || pdfMut?.isPending}
            >
              {pdfMut?.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5 mr-1.5" />
              )}
              PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {dreQ?.isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {dre && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <DreKpi
              icon={<TrendingUp className="h-4 w-4" />}
              label="Receita total"
              valor={dre.receitas.total}
              accent="text-emerald-600"
            />
            <DreKpi
              icon={<TrendingDown className="h-4 w-4" />}
              label="Despesa total"
              valor={dre.despesas.total}
              accent="text-red-600"
            />
            <DreKpi
              icon={<Wallet className="h-4 w-4" />}
              label="Resultado líquido"
              valor={resultado}
              accent={positivo ? "text-emerald-600" : "text-red-600"}
              destaque
            />
            <DreKpi
              icon={<Receipt className="h-4 w-4" />}
              label="Margem"
              valor={null}
              textoCustom={
                isNaN(dre.margemPercent)
                  ? "—"
                  : `${dre.margemPercent.toFixed(1)}%`
              }
              accent={positivo ? "text-emerald-600" : "text-red-600"}
            />
          </div>

          {/* Tabela receitas */}
          <DreSection
            titulo="Receitas"
            total={dre.receitas.total}
            categorias={dre.receitas.porCategoria}
            accent="emerald"
          />

          {/* Tabela despesas */}
          <DreSection
            titulo="Despesas"
            total={dre.despesas.total}
            categorias={dre.despesas.porCategoria}
            accent="red"
          />
        </>
      )}
    </div>
  );
}

function DreKpi({
  icon,
  label,
  valor,
  accent,
  destaque,
  textoCustom,
}: {
  icon: React.ReactNode;
  label: string;
  valor: number | null;
  accent?: string;
  destaque?: boolean;
  /** Quando preenchido, mostra esse texto em vez de formatBRL(valor). */
  textoCustom?: string;
}) {
  return (
    <Card className={destaque ? "border-primary/40" : ""}>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span className={accent ?? ""}>{icon}</span>
          {label}
        </div>
        <p className={`text-xl font-semibold mt-1 ${accent ?? ""}`}>
          {textoCustom ?? (valor !== null ? formatBRL(valor) : "—")}
        </p>
      </CardContent>
    </Card>
  );
}

function DreSection({
  titulo,
  total,
  categorias,
  accent,
}: {
  titulo: string;
  total: number;
  categorias: Array<{
    categoriaId: number | null;
    categoriaNome: string;
    total: number;
    count: number;
    percentual: number;
  }>;
  accent: "emerald" | "red";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-600"
      : "text-red-600";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className={`text-sm flex items-center gap-2 ${accentClass}`}>
          {accent === "emerald" ? (
            <TrendingUp className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          )}
          {titulo}
          <span className="ml-auto font-mono text-base tabular-nums">
            {formatBRL(total)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {categorias.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">
            Sem lançamentos no período.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Categoria</TableHead>
                <TableHead className="text-xs text-right">Qtd</TableHead>
                <TableHead className="text-xs text-right">% da seção</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categorias.map((cat) => (
                <TableRow key={String(cat.categoriaId ?? "null")}>
                  <TableCell className="text-xs">
                    {cat.categoriaId === null ? (
                      <span className="italic text-muted-foreground">
                        {cat.categoriaNome}
                      </span>
                    ) : (
                      cat.categoriaNome
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {cat.count}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">
                    {cat.percentual.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums font-medium">
                    {formatBRL(cat.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
