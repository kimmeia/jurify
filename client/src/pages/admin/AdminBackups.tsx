/**
 * AdminBackups — gerenciamento de backups globais do banco.
 *
 * Lista os dumps em S3 (gerados pelo cron diário ou sob demanda),
 * permite gerar agora + baixar via URL pré-assinada. Restore não é
 * automatizado — mostra script bash pronto pra rodar manualmente.
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
  AlertTriangle, CheckCircle2, Database, Download, Loader2, Play, Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function AdminBackups() {
  const utils = trpc.useUtils();
  const status = (trpc as any).adminBackup.status.useQuery();
  const lista = (trpc as any).adminBackup.listar.useQuery(
    { limite: 50 },
    { enabled: status.data?.configurado === true },
  );
  const gerarMut = (trpc as any).adminBackup.gerarAgora.useMutation({
    onSuccess: () => {
      toast.success("Backup gerado com sucesso");
      utils.adminBackup.listar.invalidate();
    },
    onError: (err: any) => toast.error(`Falhou: ${err.message}`),
  });
  const utilsAny: any = utils;

  const baixar = async (key: string) => {
    try {
      const res = await utilsAny.adminBackup.urlDownload.fetch({ key });
      window.open(res.url, "_blank");
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    }
  };

  const [chaveSelecionada, setChaveSelecionada] = useState<string | null>(null);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6" /> Backups do banco
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Backups completos do MySQL armazenados em S3 (lifecycle 30d).
            Cron diário + geração sob demanda.
          </p>
        </div>
        <Button
          onClick={() => gerarMut.mutate()}
          disabled={!status.data?.configurado || gerarMut.isPending}
        >
          {gerarMut.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Gerar agora
        </Button>
      </div>

      {status.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !status.data?.configurado ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" /> Backup não configurado
            </CardTitle>
            <CardDescription>
              Defina <code>BACKUP_BUCKET</code>, <code>BACKUP_BUCKET_ENDPOINT</code>,{" "}
              <code>BACKUP_BUCKET_REGION</code>, <code>BACKUP_ACCESS_KEY</code> e{" "}
              <code>BACKUP_SECRET_KEY</code> no <code>.env</code> do servidor.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Backups disponíveis</CardTitle>
              <CardDescription>
                {lista.data?.length ?? 0} arquivo(s) encontrado(s) — clique pra baixar
                (URL válida por 15min).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {lista.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : lista.data && lista.data.length > 0 ? (
                <div className="border rounded-md divide-y">
                  {lista.data.map((b: any) => (
                    <div
                      key={b.key}
                      className="flex items-center gap-3 p-3 hover:bg-muted/30"
                    >
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-mono truncate">{b.key}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(b.criadoEm), {
                            addSuffix: true, locale: ptBR,
                          })}{" "}
                          · {formatarTamanho(b.tamanhoBytes)}
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {b.database}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => baixar(b.key)}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" /> Baixar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setChaveSelecionada(b.key)}
                      >
                        <Terminal className="h-3.5 w-3.5 mr-1" /> Restaurar
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhum backup ainda. Clique em <strong>Gerar agora</strong> pra criar o primeiro.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Terminal className="h-5 w-5" /> Como restaurar
              </CardTitle>
              <CardDescription>
                Restore é manual — operação destrutiva que sobrescreve o banco. Pare o
                app antes, rode num servidor com acesso ao MySQL.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ol className="text-sm space-y-2 list-decimal list-inside">
                <li>
                  Pare a aplicação (PM2/systemd) pra evitar writes durante o restore.
                </li>
                <li>
                  Baixe o arquivo <code>.sql.gz</code> escolhido pelo botão{" "}
                  <strong>Baixar</strong>.
                </li>
                <li>Rode o script abaixo no servidor (ajuste os parâmetros).</li>
                <li>Reinicie a aplicação.</li>
              </ol>
              <pre className="text-xs bg-muted/50 p-3 rounded-md overflow-x-auto font-mono">
{`# 1) extrai o dump
gunzip ${chaveSelecionada ? chaveSelecionada.split("/").pop() : "BACKUP.sql.gz"}

# 2) (opcional) renomeia a versão atual antes de sobrescrever
mysqldump -u USUARIO -p NOME_DO_BANCO > pre-restore-$(date +%s).sql

# 3) restaura
mysql -u USUARIO -p NOME_DO_BANCO < ${chaveSelecionada ? chaveSelecionada.split("/").pop()?.replace(".gz", "") : "BACKUP.sql"}

# 4) verifica contagens
mysql -u USUARIO -p -e "SELECT COUNT(*) FROM contatos" NOME_DO_BANCO`}
              </pre>
              <p className="text-xs text-amber-700">
                <strong>Atenção:</strong> dumps são do banco completo — restaurar joga
                fora dados criados depois da hora do dump. Use só pra disaster recovery.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
