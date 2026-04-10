/**
 * SmartFlow — Automações inteligentes.
 *
 * Cenários de automação que conectam WhatsApp + IA + Cal.com.
 * Fase 1: gestão de cenários + template de atendimento.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Zap, Plus, Trash2, Loader2, MessageCircle, Calendar, Brain,
  ArrowRight, Play, Pause, Bot, PhoneCall, Clock, GitBranch,
  Webhook, Users, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

const TIPO_PASSO_LABELS: Record<string, { label: string; icon: any; cor: string }> = {
  ia_classificar: { label: "Classificar intenção", icon: Brain, cor: "bg-violet-100 text-violet-700" },
  ia_responder: { label: "Responder com IA", icon: Bot, cor: "bg-blue-100 text-blue-700" },
  calcom_horarios: { label: "Buscar horários", icon: Calendar, cor: "bg-emerald-100 text-emerald-700" },
  calcom_agendar: { label: "Criar agendamento", icon: CheckCircle2, cor: "bg-green-100 text-green-700" },
  whatsapp_enviar: { label: "Enviar mensagem", icon: MessageCircle, cor: "bg-teal-100 text-teal-700" },
  transferir: { label: "Transferir p/ humano", icon: PhoneCall, cor: "bg-amber-100 text-amber-700" },
  condicional: { label: "Condição (if/else)", icon: GitBranch, cor: "bg-orange-100 text-orange-700" },
  esperar: { label: "Esperar (delay)", icon: Clock, cor: "bg-gray-100 text-gray-700" },
  webhook: { label: "Webhook externo", icon: Webhook, cor: "bg-pink-100 text-pink-700" },
};

const GATILHO_LABELS: Record<string, { label: string; icon: any }> = {
  whatsapp_mensagem: { label: "Nova mensagem WhatsApp", icon: MessageCircle },
  novo_lead: { label: "Novo lead no CRM", icon: Users },
  agendamento_criado: { label: "Agendamento criado", icon: Calendar },
  manual: { label: "Acionado manualmente", icon: Play },
};

export default function SmartFlow() {
  const { data: cenarios, isLoading, refetch } = (trpc as any).smartflow.listar.useQuery();
  const criarTemplateMut = (trpc as any).smartflow.criarTemplateAtendimento.useMutation({
    onSuccess: () => { toast.success("Cenário de atendimento criado!"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const toggleMut = (trpc as any).smartflow.toggleAtivo.useMutation({
    onSuccess: () => refetch(),
  });
  const deletarMut = (trpc as any).smartflow.deletar.useMutation({
    onSuccess: () => { toast.success("Cenário removido"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const lista = cenarios || [];

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 dark:from-amber-900/40 dark:to-orange-900/40">
          <Zap className="h-6 w-6 text-amber-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">SmartFlow</h1>
          <p className="text-sm text-muted-foreground">
            Automações inteligentes — conecte WhatsApp, IA e agendamento.
          </p>
        </div>
      </div>

      {/* Templates prontos */}
      <Card className="border-amber-200/50 bg-gradient-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-950/10 dark:to-orange-950/10">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Zap className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="font-semibold text-sm">Comece com um template</p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-lg">
                  Crie cenários prontos com um clique. O template de Atendimento + Agendamento
                  responde clientes via WhatsApp com IA e agenda reuniões pelo Cal.com automaticamente.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => criarTemplateMut.mutate()}
              disabled={criarTemplateMut.isPending}
            >
              {criarTemplateMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5 mr-1" />
              )}
              Atendimento + Agendamento
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista de cenários */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : lista.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Zap className="h-12 w-12 text-muted-foreground/20 mb-4" />
            <h3 className="text-lg font-semibold">Nenhum cenário criado</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              Crie seu primeiro cenário de automação usando o template acima
              ou construa um do zero.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {lista.map((cenario: any) => {
            const gatilho = GATILHO_LABELS[cenario.gatilho] || { label: cenario.gatilho, icon: Play };
            const GatilhoIcon = gatilho.icon;
            const passos = cenario.passos || [];

            return (
              <Card key={cenario.id} className="hover:shadow-sm transition-all">
                <CardContent className="pt-4 pb-4">
                  {/* Header do cenário */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500/10 to-indigo-500/10 flex items-center justify-center shrink-0">
                      <Zap className="h-5 w-5 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{cenario.nome}</p>
                        <Badge variant="outline" className="text-[9px] gap-1">
                          <GatilhoIcon className="h-2.5 w-2.5" />
                          {gatilho.label}
                        </Badge>
                        {cenario.ativo ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30 text-[9px]">Ativo</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] text-muted-foreground">Inativo</Badge>
                        )}
                      </div>
                      {cenario.descricao && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{cenario.descricao}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={cenario.ativo}
                        onCheckedChange={(v: boolean) => toggleMut.mutate({ id: cenario.id, ativo: v })}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive"
                        onClick={() => {
                          if (confirm("Excluir este cenário?")) deletarMut.mutate({ id: cenario.id });
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Timeline de passos */}
                  {passos.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {passos.map((passo: any, i: number) => {
                        const info = TIPO_PASSO_LABELS[passo.tipo] || { label: passo.tipo, icon: Zap, cor: "bg-gray-100 text-gray-700" };
                        const Icon = info.icon;
                        return (
                          <div key={passo.id} className="flex items-center gap-1.5">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium ${info.cor}`}>
                              <Icon className="h-3 w-3" />
                              {info.label}
                            </div>
                            {i < passos.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
