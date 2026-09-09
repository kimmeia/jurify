import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import AdminErros from "./AdminErros";
import AdminRoboAuditor from "./AdminRoboAuditor";
import AdminRoboJornada from "./AdminRoboJornada";
import AdminEmailLog from "./AdminEmailLog";
import AdminAuditoria from "./AdminAuditoria";

const ABAS_VALIDAS = ["visao", "erros", "robo-auditor", "robo-jornada", "emails", "auditoria"] as const;
type Aba = (typeof ABAS_VALIDAS)[number];

function abaInicial(): Aba {
  const aba = new URLSearchParams(window.location.search).get("aba");
  return ABAS_VALIDAS.includes(aba as Aba) ? (aba as Aba) : "visao";
}

function tempoRelativo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h}h`;
  return `há ${Math.round(h / 24)}d`;
}

function duracaoCurta(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 120) return `${s}s`;
  return `${Math.round(s / 60)}min`;
}

function SeloStatus({ tom, children }: { tom: "ok" | "atencao" | "erro"; children: React.ReactNode }) {
  const classes = {
    ok: "bg-success-bg text-success-fg border-success/30 dark:text-success",
    atencao: "bg-warning-bg text-warning-fg border-warning/30 dark:text-warning",
    erro: "bg-danger-bg text-danger-fg border-danger/30 dark:text-danger",
  } as const;
  return (
    <Badge variant="outline" className={`text-[10px] font-bold ${classes[tom]}`}>
      {children}
    </Badge>
  );
}

/**
 * Visão rápida: um resumo do que as outras abas detalham. Cada card responde
 * "isso precisa de mim agora?" sem obrigar a abrir aba por aba.
 */
function VisaoRapida({ irParaAba }: { irParaAba: (aba: Aba) => void }) {
  const erros = trpc.adminErros.listar.useQuery(
    { status: "unresolved", limite: 25, pagina: 1 },
    { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: false },
  );
  const auditor = trpc.adminRoboAuditor.historico.useQuery(
    { limite: 4 },
    { staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
  );
  const jornada = trpc.adminJornada.historico.useQuery(
    { limite: 4 },
    { staleTime: 60_000, refetchOnWindowFocus: false, retry: false },
  );
  const emails = trpc.adminEmailLog.resumo.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const issues = erros.data?.issues ?? [];
  const errosAbertos = erros.data?.total ?? 0;
  const ultimoAuditor = (auditor.data?.varreduras ?? [])[0] ?? null;
  const ultimaJornada = (jornada.data?.varreduras ?? []).find((v: any) => v.status !== "rodando") ?? null;
  // Verde rápido demais e verde de verdade são indistinguíveis sem olhar a
  // duração — é a pendência real do robô de jornada, então o card avisa.
  const jornadaSuspeita = ultimaJornada?.duracaoMs != null && ultimaJornada.duracaoMs < 60_000;

  const rondas = [
    ...(auditor.data?.varreduras ?? []).map((v: any) => ({
      tipo: "Robô auditor",
      quando: v.iniciadoEm,
      detalhe: v.achados > 0 ? `${v.achados} achados` : "0 achados",
      alerta: v.achados > 0,
    })),
    ...(jornada.data?.varreduras ?? [])
      .filter((v: any) => v.status !== "rodando")
      .map((v: any) => ({
        tipo: "Robô de jornada",
        quando: v.iniciadoEm,
        detalhe:
          v.status === "falhou"
            ? "falhou"
            : `${v.rotasVisitadas} telas · ${duracaoCurta(v.duracaoMs)}`,
        alerta: v.status === "falhou" || v.rotasComAchado > 0 || (v.duracaoMs != null && v.duracaoMs < 60_000),
      })),
  ]
    .sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime())
    .slice(0, 5);

  const carregando = erros.isLoading || auditor.isLoading || jornada.isLoading || emails.isLoading;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Erros abertos
            </CardTitle>
            {erros.isLoading ? null : errosAbertos > 0 ? (
              <SeloStatus tom="erro">ATENÇÃO</SeloStatus>
            ) : (
              <SeloStatus tom="ok">OK</SeloStatus>
            )}
          </CardHeader>
          <CardContent>
            {erros.isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <p className={`text-2xl font-bold ${errosAbertos > 0 ? "text-danger-fg" : ""}`}>
                  {erros.data?.configurado === false ? "—" : errosAbertos}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {erros.data?.configurado === false
                    ? "Sentry não configurado"
                    : errosAbertos > 0
                      ? "não resolvidos no Sentry"
                      : "nada em aberto"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Robô auditor
            </CardTitle>
            {auditor.isLoading || !ultimoAuditor ? null : ultimoAuditor.achados > 0 ? (
              <SeloStatus tom="atencao">CONFERIR</SeloStatus>
            ) : (
              <SeloStatus tom="ok">OK</SeloStatus>
            )}
          </CardHeader>
          <CardContent>
            {auditor.isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : ultimoAuditor ? (
              <>
                <p className="text-2xl font-bold">{tempoRelativo(ultimoAuditor.iniciadoEm)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  última ronda · {ultimoAuditor.achados > 0 ? `${ultimoAuditor.achados} achados` : "0 achados"}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">nunca rodou</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Robô de jornada
            </CardTitle>
            {jornada.isLoading || !ultimaJornada ? null : ultimaJornada.status === "falhou" ? (
              <SeloStatus tom="erro">FALHOU</SeloStatus>
            ) : jornadaSuspeita || ultimaJornada.rotasComAchado > 0 ? (
              <SeloStatus tom="atencao">CONFERIR</SeloStatus>
            ) : (
              <SeloStatus tom="ok">OK</SeloStatus>
            )}
          </CardHeader>
          <CardContent>
            {jornada.isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : ultimaJornada ? (
              <>
                <p className="text-2xl font-bold">{duracaoCurta(ultimaJornada.duracaoMs)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {jornadaSuspeita
                    ? "rápida demais — telas podem não ter carregado"
                    : `${ultimaJornada.rotasVisitadas} telas · ${ultimaJornada.rotasComAchado} com achado`}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">nunca rodou</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              E-mails · 24h
            </CardTitle>
            {emails.isLoading ? null : (emails.data?.falha24h ?? 0) > 0 ? (
              <SeloStatus tom="erro">FALHAS</SeloStatus>
            ) : (
              <SeloStatus tom="ok">OK</SeloStatus>
            )}
          </CardHeader>
          <CardContent>
            {emails.isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <p className="text-2xl font-bold">{emails.data?.sucesso24h ?? 0}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  enviados
                  {(emails.data?.falha24h ?? 0) > 0 && (
                    <span className="text-danger-fg font-medium">
                      {" "}· {emails.data?.falha24h} falharam
                    </span>
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Últimos erros</CardTitle>
            <button
              className="text-xs font-medium text-info-fg hover:underline"
              onClick={() => irParaAba("erros")}
            >
              abrir aba Erros →
            </button>
          </CardHeader>
          <CardContent className="pt-0">
            {erros.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : issues.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {erros.data?.configurado === false
                  ? "Sentry não configurado — configure em Configurações → Integrações."
                  : "Nenhum erro em aberto. 🎉"}
              </p>
            ) : (
              <div className="divide-y">
                {issues.slice(0, 4).map((i: any) => (
                  <div key={i.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <SeloStatus tom={i.nivel === "error" || i.nivel === "fatal" ? "erro" : "atencao"}>
                      {(i.nivel || "erro").toUpperCase()}
                    </SeloStatus>
                    <span className="flex-1 truncate" title={i.titulo}>
                      {i.titulo}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {i.ultimoVisto ? tempoRelativo(i.ultimoVisto) : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Últimas rondas dos robôs</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {carregando ? (
              <Skeleton className="h-24 w-full" />
            ) : rondas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhuma ronda registrada ainda.</p>
            ) : (
              <div className="divide-y">
                {rondas.map((r, idx) => (
                  <div key={idx} className="flex items-center gap-3 py-2.5 text-sm">
                    <SeloStatus tom={r.alerta ? "atencao" : "ok"}>{r.alerta ? "VER" : "OK"}</SeloStatus>
                    <span className="flex-1 truncate">
                      {r.tipo} · {tempoRelativo(r.quando)}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{r.detalhe}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AdminSaude() {
  const [aba, setAba] = useState<Aba>(abaInicial);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Saúde do sistema</h1>
        <p className="text-muted-foreground mt-1">
          Erros, robôs, e-mails e auditoria num lugar só.
        </p>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="visao">Visão rápida</TabsTrigger>
          <TabsTrigger value="erros">Erros</TabsTrigger>
          <TabsTrigger value="robo-auditor">Robô auditor</TabsTrigger>
          <TabsTrigger value="robo-jornada">Robô de jornada</TabsTrigger>
          <TabsTrigger value="emails">E-mails</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="mt-4">
          <VisaoRapida irParaAba={setAba} />
        </TabsContent>
        <TabsContent value="erros" className="mt-4">
          <AdminErros />
        </TabsContent>
        <TabsContent value="robo-auditor" className="mt-4">
          <AdminRoboAuditor />
        </TabsContent>
        <TabsContent value="robo-jornada" className="mt-4">
          <AdminRoboJornada />
        </TabsContent>
        <TabsContent value="emails" className="mt-4">
          <AdminEmailLog />
        </TabsContent>
        <TabsContent value="auditoria" className="mt-4">
          <AdminAuditoria />
        </TabsContent>
      </Tabs>
    </div>
  );
}
