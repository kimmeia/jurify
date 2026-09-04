import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Settings, Heart, Server, CreditCard, Shield, Globe, Clock,
  CheckCircle2, XCircle, AlertTriangle, Cpu, HardDrive,
  MessageSquare, Users, Building2, Radio, Bot, UserCheck,
  Radar, KeyRound, Coins, Activity, Plug, Database, HeartPulse, Wrench,
} from "lucide-react";
import AdminIntegrations from "./AdminIntegrations";
import AdminBackups from "./AdminBackups";
import AdminManutencao from "./AdminManutencao";

function HealthIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-success" />;
  if (status === "erro") return <XCircle className="h-4 w-4 text-destructive" />;
  return <AlertTriangle className="h-4 w-4 text-warning" />;
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function CanalStatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    conectado: { cls: "bg-success/15 text-success-fg border-success/30", label: "Conectado" },
    desconectado: { cls: "bg-muted-foreground/15 text-muted-foreground border-border/25", label: "Desconectado" },
    pendente: { cls: "bg-warning/15 text-warning-fg border-warning/30", label: "Pendente" },
    erro: { cls: "bg-danger/15 text-danger-fg border-danger/30", label: "Erro" },
    banido: { cls: "bg-danger/15 text-danger-fg border-danger/30", label: "Banido" },
  };
  const cfg = map[status] || { cls: "", label: status };
  return <Badge className={`${cfg.cls} hover:${cfg.cls} text-[10px] font-normal`}>{cfg.label}</Badge>;
}

/** WhatsApp dos botões "Falar com a gente" da LP — editável sem deploy. */
function CardWhatsappComercial() {
  const { data } = trpc.admin.obterWhatsappComercial.useQuery(undefined, { retry: false });
  const [numero, setNumero] = useState("");
  useEffect(() => {
    if (data) setNumero(data.whatsapp);
  }, [data]);
  const salvarMut = trpc.admin.salvarWhatsappComercial.useMutation({
    onSuccess: () => toast.success("WhatsApp comercial salvo — os botões da LP já usam o número novo"),
    onError: (e) => toast.error("Erro ao salvar", { description: e.message }),
  });
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">WhatsApp comercial</CardTitle>
        <CardDescription className="text-xs">
          Destino dos botões "Falar com a gente" e "Agendar demonstração" da landing page.
          Vazio = os botões caem no e-mail de contato.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Input
          className="max-w-xs"
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          placeholder="5585999999999 (DDI+DDD+número)"
          inputMode="numeric"
          maxLength={32}
        />
        <Button size="sm" disabled={salvarMut.isPending} onClick={() => salvarMut.mutate({ whatsapp: numero })}>
          Salvar
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AdminSettings() {
  const { data: health, isLoading: loadHealth } = trpc.admin.systemHealth.useQuery(undefined, { retry: false });
  const { data: ops, isLoading: loadOps } = trpc.admin.operacional.useQuery(undefined, { retry: false });

  const statusGeral = health?.checks?.some((c) => c.status === "erro")
    ? { dot: "bg-danger", label: "Atenção" }
    : health?.checks?.some((c) => c.status !== "ok")
      ? { dot: "bg-warning", label: "Degradado" }
      : { dot: "bg-success", label: "Operacional" };

  return (
    <div className="space-y-5">
      {/* HERO de status do sistema */}
      {/* `from-muted via-muted to-info` pintava de quase-branco até o navy e a
          tinta era branca fixa: no tema claro a metade de cima ficava branco
          sobre branco (1,13:1 medido). A faixa de destaque é escura nos dois
          temas — é a mesma do cabeçalho da ficha do cliente. */}
      <div className="faixa-hero fundo-hero rounded-2xl p-6 text-hero-fg relative overflow-hidden shadow-lg">
        <Server className="absolute -right-8 -bottom-10 w-48 h-48 opacity-10" strokeWidth={1.2} />
        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
            <p className="text-sm text-white/70 mt-0.5">
              Saúde do sistema, integrações, backups, planos e visão operacional.
            </p>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-white/60">Status</p>
              <p className="text-sm font-semibold inline-flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${statusGeral.dot}`} /> {statusGeral.label}
              </p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-white/60">Uptime</p>
              <p className="text-sm font-semibold mt-0.5">{health ? formatUptime(health.uptime) : "—"}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-white/60">Node</p>
              <p className="text-sm font-semibold mt-0.5">{health?.nodeVersion ?? "—"}</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="sistema" className="w-full">
        <div className="bg-muted/80 backdrop-blur-sm border border-border rounded-xl p-1.5 inline-flex dark:bg-foreground/40">
          <TabsList className="bg-transparent gap-1 p-0 h-auto flex-wrap">
            <TabsTrigger value="sistema" className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg dark:data-[state=active]:bg-foreground/80">
              <HeartPulse className="h-3.5 w-3.5" /> Sistema
            </TabsTrigger>
            <TabsTrigger value="integracoes" className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg dark:data-[state=active]:bg-foreground/80">
              <Plug className="h-3.5 w-3.5" /> Integrações
            </TabsTrigger>
            <TabsTrigger value="backups" className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg dark:data-[state=active]:bg-foreground/80">
              <Database className="h-3.5 w-3.5" /> Backups
            </TabsTrigger>
            <TabsTrigger value="manutencao" className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg dark:data-[state=active]:bg-foreground/80">
              <Wrench className="h-3.5 w-3.5" /> Manutenção
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="sistema" className="mt-4 space-y-6">
          <CardWhatsappComercial />
      {/* Saúde do Sistema */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Heart className="h-4 w-4 text-muted-foreground" />
            Saúde do sistema
          </CardTitle>
          <CardDescription>Status de serviços e variáveis de ambiente essenciais.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadHealth ? (
            <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
          ) : health ? (
            <div className="space-y-4">
              {/* System info mini cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Uptime</p>
                    <p className="font-medium">{formatUptime(health.uptime)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Node.js</p>
                    <p className="font-medium">{health.nodeVersion}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Memória</p>
                    <p className="font-medium">{health.memoryMB} MB</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] text-muted-foreground">Planos</p>
                    <p className="font-medium">{health.plansCount}</p>
                  </div>
                </div>
              </div>

              {/* Health checks */}
              <div className="space-y-1.5">
                {health.checks.map((check) => (
                  <div key={check.nome} className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/30">
                    <div className="flex items-center gap-2.5">
                      <HealthIcon status={check.status} />
                      <span className="text-sm font-medium">{check.nome}</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{check.detalhe}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

        {/* Operacional */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              Visão operacional
            </CardTitle>
            <CardDescription>Escritórios, canais, conversas e agentes.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadOps ? (
              <Skeleton className="h-32 w-full" />
            ) : ops ? (
              <div className="space-y-4">
                {/* Counters */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Building2 className="h-4 w-4 text-info" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Escritórios</p>
                      <p className="font-bold">{ops.escritorios}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <UserCheck className="h-4 w-4 text-success" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Colaboradores</p>
                      <p className="font-bold">{ops.colaboradores}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4 text-info" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Contatos</p>
                      <p className="font-bold">{ops.contatos}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <MessageSquare className="h-4 w-4 text-warning" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Conversas</p>
                      <p className="font-bold">{ops.conversas.total}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className="h-4 w-4 text-danger" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Leads</p>
                      <p className="font-bold">{ops.leads.total}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Bot className="h-4 w-4 text-success" />
                    <div>
                      <p className="text-[10px] text-muted-foreground">Agentes IA</p>
                      <p className="font-bold">{ops.agentesIa}</p>
                    </div>
                  </div>
                </div>

                {/* Conversas breakdown */}
                {ops.conversas.total > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Conversas: {ops.conversas.aguardando} aguardando, {ops.conversas.em_atendimento} em atendimento
                  </div>
                )}

                {/* Canais */}
                {ops.canais.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Canais integrados</p>
                    {ops.canais.map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/30">
                        <div className="flex items-center gap-2">
                          <Radio className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{c.nome || c.tipo}</span>
                          {c.telefone && <span className="text-xs text-muted-foreground font-mono">{c.telefone}</span>}
                        </div>
                        <CanalStatusBadge status={c.status} />
                      </div>
                    ))}
                  </div>
                )}

                {/* Leads por etapa */}
                {ops.leads.total > 0 && Object.keys(ops.leads.porEtapa).length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Funil de leads</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(ops.leads.porEtapa).map(([etapa, count]) => (
                        <span key={etapa} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {etapa}: {count as number}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="integracoes" className="mt-4">
          <AdminIntegrations />
        </TabsContent>

        <TabsContent value="manutencao" className="mt-4">
          <AdminManutencao />
        </TabsContent>

        <TabsContent value="backups" className="mt-4">
          <AdminBackups />
        </TabsContent>

      </Tabs>
    </div>
  );
}
