/**
 * Dashboard — dispatcher por setor.
 *
 * Decide qual painel mostrar com base em:
 *   - `meuEscritorio.colaborador.setorTipo` (comercial / operacional / financeiro / suporte / outro / null)
 *   - Permissão `dashboard` (verTodos = pode alternar entre painéis via tabs)
 *
 * Comportamento:
 *   - Admin do sistema (role=admin) ou Dono do escritório → tabs com Geral + 3 setores.
 *   - Gestor com `verTodos` no módulo dashboard → mesmas tabs.
 *   - Setor=comercial → DashboardComercial direto.
 *   - Setor=operacional → DashboardOperacional direto.
 *   - Setor=financeiro → DashboardFinanceiro direto.
 *   - Setor=suporte/outro/null → DashboardGeral + banner "configure seu setor".
 */

import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { LayoutDashboard, Wallet, Handshake, Briefcase } from "lucide-react";
import DashboardGeral from "./dashboards/DashboardGeral";
import DashboardComercial from "./dashboards/DashboardComercial";
import DashboardFinanceiro from "./dashboards/DashboardFinanceiro";
import DashboardOperacional from "./dashboards/DashboardOperacional";
import { AvisoBanner } from "./dashboards/common";

type SetorTipo = "comercial" | "operacional" | "suporte" | "financeiro" | "outro";
type Aba = "geral" | "comercial" | "operacional" | "financeiro";

export default function Dashboard() {
  const { user } = useAuth();
  const [, nav] = useLocation();

  const { data: meuEsc, isLoading: meuEscLoading } = (trpc as any).configuracoes?.meuEscritorio?.useQuery?.(
    undefined,
    { enabled: !!user, retry: false, refetchOnWindowFocus: false },
  ) || { data: null, isLoading: false };

  const { data: minhasPerms, isLoading: permsLoading } = (trpc as any).permissoes?.minhasPermissoes?.useQuery?.(
    undefined,
    { enabled: !!user, retry: false, refetchInterval: 5 * 60_000 },
  ) || { data: null, isLoading: false };

  // ─── Decisão: quem vê tabs (visão multi-setor)? ─────────────────────────
  // APENAS dono do escritório e admin do sistema veem todos os painéis.
  // Gestor de um setor específico (mesmo com `verTodos` na matriz de
  // permissões) vê APENAS o painel do próprio setor — ele continua sendo
  // "gestor" dentro daquele painel (com ranking + visão da equipe),
  // mas não atravessa pra outros setores.
  const isAdminSistema = user?.role === "admin";
  const isDono = meuEsc?.colaborador?.cargo === "dono";
  const podeMultiPainel = isAdminSistema || isDono;

  // Setor do colaborador (ou null pra dono/admin sem setor)
  const setorTipo: SetorTipo | null = meuEsc?.colaborador?.setorTipo ?? null;
  const setorNome: string | null = meuEsc?.colaborador?.setorNome ?? null;

  // ─── Loading state ──────────────────────────────────────────────────────
  if (meuEscLoading || permsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }

  // ─── Sem escritório (admin do sistema, trial recém-criado) ──────────────
  // Cai direto pro geral, que tem tratamento robusto pra esses casos.
  if (!meuEsc) {
    return <DashboardGeral />;
  }

  // ─── Modo multi-painel: tabs no topo ────────────────────────────────────
  if (podeMultiPainel) {
    return <DashboardComTabs setorTipoInicial={setorTipo} setorNome={setorNome} />;
  }

  // ─── Setor específico do colaborador ────────────────────────────────────
  if (setorTipo === "comercial") return <DashboardComercial />;
  if (setorTipo === "operacional") return <DashboardOperacional />;
  if (setorTipo === "financeiro") return <DashboardFinanceiro />;

  // ─── Sem setor configurado ou setor=suporte/outro ───────────────────────
  // Mostra banner pedindo pro admin configurar + painel "Geral" como fallback.
  const cargo = meuEsc?.colaborador?.cargoPersonalizadoNome
    || meuEsc?.colaborador?.cargo
    || "Colaborador";
  return (
    <div className="space-y-4">
      <AvisoBanner
        titulo={
          setorTipo == null
            ? "Setor não configurado"
            : `Setor "${setorNome}" não tem painel personalizado`
        }
        descricao={
          setorTipo == null
            ? `Você está cadastrado como ${cargo}, mas ainda não foi vinculado a um setor (Comercial, Operacional ou Financeiro). Peça pro administrador atribuir um setor pra ver o painel personalizado.`
            : "Setores do tipo Suporte ou Outro ainda não têm dashboard dedicado — mostrando visão geral."
        }
        acao={
          isDono ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => nav("/configuracoes?tab=equipe")}
            >
              Configurar setores
            </Button>
          ) : undefined
        }
      />
      <DashboardGeral />
    </div>
  );
}

// ─── Versão com tabs (dono/gestor/admin) ─────────────────────────────────────

function DashboardComTabs({
  setorTipoInicial,
  setorNome,
}: {
  setorTipoInicial: SetorTipo | null;
  setorNome: string | null;
}) {
  // Default da aba: o setor do gestor (se for comercial/operacional/financeiro)
  // ou Geral nos demais casos. Permite ao dono começar onde fica mais útil.
  const abaDefault: Aba =
    setorTipoInicial === "comercial"
      ? "comercial"
      : setorTipoInicial === "operacional"
        ? "operacional"
        : setorTipoInicial === "financeiro"
          ? "financeiro"
          : "geral";

  const [aba, setAba] = useState<Aba>(abaDefault);

  return (
    <div className="space-y-4">
      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)} className="w-full">
        <div className="bg-slate-50/80 backdrop-blur-sm border border-slate-200 rounded-xl p-1.5 inline-flex">
          <TabsList className="bg-transparent gap-1 p-0 h-auto">
            <TabsTrigger
              value="geral"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Geral
            </TabsTrigger>
            <TabsTrigger
              value="comercial"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <Handshake className="h-3.5 w-3.5" />
              Comercial
            </TabsTrigger>
            <TabsTrigger
              value="operacional"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <Briefcase className="h-3.5 w-3.5" />
              Operacional
            </TabsTrigger>
            <TabsTrigger
              value="financeiro"
              className="text-xs gap-1.5 px-3 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm rounded-lg"
            >
              <Wallet className="h-3.5 w-3.5" />
              Financeiro
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="geral" className="mt-5">
          <DashboardGeral />
        </TabsContent>
        <TabsContent value="comercial" className="mt-5">
          <DashboardComercial />
        </TabsContent>
        <TabsContent value="operacional" className="mt-5">
          <DashboardOperacional />
        </TabsContent>
        <TabsContent value="financeiro" className="mt-5">
          <DashboardFinanceiro />
        </TabsContent>
      </Tabs>

      {setorNome && (
        <p className="text-[11px] text-muted-foreground text-center">
          Seu setor: <span className="font-medium">{setorNome}</span>
        </p>
      )}
    </div>
  );
}
