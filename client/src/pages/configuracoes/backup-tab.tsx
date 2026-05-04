/**
 * Aba "Backup" das Configurações do escritório. Visível apenas pra
 * cargo "dono". Gera ZIP/SQL filtrado por escritorioId, sem armazenamento
 * server-side: o servidor monta, retorna em base64, navegador baixa.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  RadioGroup, RadioGroupItem,
} from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, CheckCircle2, Database, Download, FileJson,
  FileText, Loader2, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

type Formato = "json" | "sql" | "ambos";

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function baixarBase64(base64: string, nome: string, mime: string) {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BackupTab() {
  const [formato, setFormato] = useState<Formato>("ambos");
  const preview = (trpc as any).backup.previewEscopo.useQuery(undefined, {
    retry: false,
  });
  const gerar = (trpc as any).backup.gerar.useMutation({
    onSuccess: (data: any) => {
      baixarBase64(data.base64, data.nomeArquivo, data.mime);
      toast.success(`Backup baixado (${formatarTamanho(data.tamanhoBytes)})`);
    },
    onError: (err: any) => toast.error(`Falhou: ${err.message}`),
  });

  if (preview.isLoading) return <Skeleton className="h-64 w-full" />;
  if (preview.error) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" /> Acesso negado
          </CardTitle>
          <CardDescription>
            Apenas o dono do escritório pode gerar backup. Peça ao dono pra rodar.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const data = preview.data;
  if (!data) return null;
  const dados = data.incluidas.filter((t: any) => t.categoria === "dados");
  const configs = data.incluidas.filter((t: any) => t.categoria === "configs");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" /> Backup do escritório
          </CardTitle>
          <CardDescription>
            Exporta todos os dados do <strong>{data.escritorioNome}</strong>{" "}
            ({data.totalLinhas.toLocaleString("pt-BR")} registros). O backup é
            gerado e baixado direto pelo navegador — não fica armazenado nos
            nossos servidores.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-semibold">Formato</Label>
            <RadioGroup
              value={formato}
              onValueChange={(v) => setFormato(v as Formato)}
              className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2"
            >
              <Label
                htmlFor="fmt-ambos"
                className={`border rounded-md p-3 cursor-pointer hover:bg-muted/30 ${formato === "ambos" ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="ambos" id="fmt-ambos" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <Download className="h-3.5 w-3.5" /> Completo (recomendado)
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      ZIP com JSONs + SQL.gz + manifesto. Mais flexível.
                    </p>
                  </div>
                </div>
              </Label>
              <Label
                htmlFor="fmt-json"
                className={`border rounded-md p-3 cursor-pointer hover:bg-muted/30 ${formato === "json" ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="json" id="fmt-json" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <FileJson className="h-3.5 w-3.5" /> Apenas JSON
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      ZIP com 1 arquivo por tabela. Fácil de inspecionar.
                    </p>
                  </div>
                </div>
              </Label>
              <Label
                htmlFor="fmt-sql"
                className={`border rounded-md p-3 cursor-pointer hover:bg-muted/30 ${formato === "sql" ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="sql" id="fmt-sql" className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> Apenas SQL.gz
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Dump filtrado, restore via mysql CLI.
                    </p>
                  </div>
                </div>
              </Label>
            </RadioGroup>
          </div>

          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1">
            <p className="font-semibold text-amber-700 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Aviso LGPD
            </p>
            <p className="text-amber-800/90">
              O arquivo gerado contém dados pessoais (nomes, CPF/CNPJ, telefones,
              conversas). Armazene em local seguro — sob a LGPD, o escritório é
              responsável pelo tratamento desses dados.
            </p>
          </div>

          <Button
            onClick={() => gerar.mutate({ formato })}
            disabled={gerar.isPending}
            className="w-full"
          >
            {gerar.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Gerando backup...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Gerar e baixar backup
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que entra no backup</CardTitle>
          <CardDescription>
            {dados.length} tabelas de dados + {configs.length} de configurações.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Dados operacionais
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dados.map((t: any) => (
                <Badge key={t.nome} variant="secondary" className="font-mono text-[10px]">
                  {t.nome} ({t.linhas})
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Configurações do escritório
            </p>
            <div className="flex flex-wrap gap-1.5">
              {configs.map((t: any) => (
                <Badge key={t.nome} variant="secondary" className="font-mono text-[10px]">
                  {t.nome} ({t.linhas})
                  {t.colunasOmitidas?.length > 0 && (
                    <span className="ml-1 text-amber-600" title={`Colunas omitidas: ${t.colunasOmitidas.join(", ")}`}>
                      *
                    </span>
                  )}
                </Badge>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              <span className="text-amber-600">*</span> tabela tem colunas com chaves API
              omitidas (segredos não vão pro backup).
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> O que NÃO entra (segredos)
          </CardTitle>
          <CardDescription>
            Pra evitar vazamento de credenciais, estas tabelas ficam de fora.
            No restore, reconfigure as integrações manualmente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {data.excluidasPorSegredo.map((t: any) => (
            <div key={t.nomeBanco} className="flex items-start gap-2 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <code className="font-mono text-[11px]">{t.nomeBanco}</code>
                <span className="text-muted-foreground"> — {t.motivo}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
