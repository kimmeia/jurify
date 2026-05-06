import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { EnvironmentBanner } from "./components/EnvironmentBanner";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Roadmap from "./pages/Roadmap";
import Termos from "./pages/Termos";
import Privacidade from "./pages/Privacidade";
import EsqueciSenha from "./pages/EsqueciSenha";
import RedefinirSenha from "./pages/RedefinirSenha";
import AdminDashboard from "./pages/AdminDashboard";
import AdminClients from "./pages/admin/AdminClients";
import AdminSubscriptions from "./pages/admin/AdminSubscriptions";
import AdminReports from "./pages/admin/AdminReports";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminIntegrations from "./pages/admin/AdminIntegrations";
import AdminAuditoria from "./pages/admin/AdminAuditoria";
import AdminErros from "./pages/admin/AdminErros";
import AdminBackups from "./pages/admin/AdminBackups";
import AdminInadimplentes from "./pages/admin/AdminInadimplentes";
import AdminPlanos from "./pages/admin/AdminPlanos";
import AdminCupons from "./pages/admin/AdminCupons";
import AdminFinanceiro from "./pages/admin/AdminFinanceiro";
import AdminAgentesIA from "./pages/admin/AdminAgentesIA";
import MotorProprioTeste from "./pages/admin/MotorProprioTeste";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import Bancario from "./pages/calculos/Bancario";
import Imobiliario from "./pages/calculos/Imobiliario";
import Trabalhista from "./pages/calculos/Trabalhista";
import Tributario from "./pages/calculos/Tributario";
import Previdenciario from "./pages/calculos/Previdenciario";
import CalculosDiversos from "./pages/calculos/CalculosDiversos";
import Processos from "./pages/Processos";
import Configuracoes from "./pages/Configuracoes";
import ModelosContrato from "./pages/ModelosContrato";
import Agendamento from "./pages/Agendamento";
import Atendimento from "./pages/Atendimento";
import AgentesIA from "./pages/AgentesIA";
import AgenteChat from "./pages/AgenteChat";
import SmartFlow from "./pages/SmartFlow";
import SmartFlowEditor from "./pages/SmartFlowEditor";
import Kanban from "./pages/Kanban";
import Clientes from "./pages/Clientes";
import Relatorios from "./pages/Relatorios";
import Financeiro from "./pages/Financeiro";
import Agenda from "./pages/Agenda";
import Tarefas from "./pages/Tarefas";
import AssinarDocumento from "./pages/AssinarDocumento";
import AceitarConvite from "./pages/AceitarConvite";
import AppLayout from "./components/AppLayout";
import AdminLayout from "./components/AdminLayout";
import SubscriptionGuard from "./components/SubscriptionGuard";

/**
 * Redireciona /plans (rota antiga) pra /configuracoes?tab=meu-plano,
 * preservando query string (Plans.tsx renderizado dentro da aba lê
 * `window.location.search` no mount pra detectar checkout success).
 */
function RedirectPlansParaConfiguracoes() {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const extra = search.startsWith("?") ? `&${search.slice(1)}` : search ? `&${search}` : "";
  return <Redirect to={`/configuracoes?tab=meu-plano${extra}`} />;
}

function ClientArea({ children }: { children: React.ReactNode }) {
  return (
    <AppLayout>
      <SubscriptionGuard>{children}</SubscriptionGuard>
    </AppLayout>
  );
}

function ClientAreaNoGuard({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}

function AdminArea({ children }: { children: React.ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Home} />
      <Route path="/termos" component={Termos} />
      <Route path="/privacidade" component={Privacidade} />
      <Route path="/esqueci-senha" component={EsqueciSenha} />
      <Route path="/redefinir-senha" component={RedefinirSenha} />
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/assinar/:token">
        {(params: any) => <AssinarDocumento token={params.token} />}
      </Route>
      <Route path="/convite/:token">
        {(params: any) => <AceitarConvite token={params.token} />}
      </Route>

      {/* Plans foi unificado como aba "Meu Plano" em Configurações.
          Mantemos /plans funcional via redirect — preserva deep links
          em e-mails de billing, /termos, e qualquer flow que aponte aqui.
          Query string original (ex: ?success=true&plano=...) é repassada
          pra Plans renderizado dentro da aba ler do window.location. */}
      <Route path="/plans">
        <RedirectPlansParaConfiguracoes />
      </Route>

      {/* Admin routes - separate layout, no Cálculos menu */}
      <Route path="/admin">
        <AdminArea>
          <AdminDashboard />
        </AdminArea>
      </Route>
      <Route path="/admin/clients">
        <AdminArea>
          <AdminClients />
        </AdminArea>
      </Route>
      <Route path="/admin/subscriptions">
        <AdminArea>
          <AdminSubscriptions />
        </AdminArea>
      </Route>
      <Route path="/admin/inadimplentes">
        <AdminArea>
          <AdminInadimplentes />
        </AdminArea>
      </Route>
      <Route path="/admin/planos">
        <AdminArea>
          <AdminPlanos />
        </AdminArea>
      </Route>
      <Route path="/admin/cupons">
        <AdminArea>
          <AdminCupons />
        </AdminArea>
      </Route>
      <Route path="/admin/financeiro">
        <AdminArea>
          <AdminFinanceiro />
        </AdminArea>
      </Route>
      <Route path="/admin/agentes-ia">
        <AdminArea>
          <AdminAgentesIA />
        </AdminArea>
      </Route>
      <Route path="/admin/motor-proprio-teste">
        <AdminArea>
          <MotorProprioTeste />
        </AdminArea>
      </Route>
      <Route path="/admin/reports">
        <AdminArea>
          <AdminReports />
        </AdminArea>
      </Route>
      <Route path="/admin/auditoria">
        <AdminArea>
          <AdminAuditoria />
        </AdminArea>
      </Route>
      <Route path="/admin/erros">
        <AdminArea>
          <AdminErros />
        </AdminArea>
      </Route>
      <Route path="/admin/backups">
        <AdminArea>
          <AdminBackups />
        </AdminArea>
      </Route>
      <Route path="/roadmap">
        <ClientAreaNoGuard>
          <Roadmap />
        </ClientAreaNoGuard>
      </Route>
      <Route path="/admin/integrations">
        <AdminArea>
          <AdminIntegrations />
        </AdminArea>
      </Route>
      <Route path="/admin/settings">
        <AdminArea>
          <AdminSettings />
        </AdminArea>
      </Route>

      {/* Client protected routes - require subscription */}
      <Route path="/dashboard">
        <ClientArea>
          <Dashboard />
        </ClientArea>
      </Route>
      <Route path="/calculos/bancario">
        <ClientArea>
          <Bancario />
        </ClientArea>
      </Route>
      <Route path="/calculos/imobiliario">
        <ClientArea>
          <Imobiliario />
        </ClientArea>
      </Route>
      <Route path="/calculos/trabalhista">
        <ClientArea>
          <Trabalhista />
        </ClientArea>
      </Route>
      <Route path="/calculos/tributario">
        <ClientArea>
          <Tributario />
        </ClientArea>
      </Route>
      <Route path="/calculos/previdenciario">
        <ClientArea>
          <Previdenciario />
        </ClientArea>
      </Route>
      <Route path="/calculos/atualizacao-monetaria">
        <ClientArea>
          <CalculosDiversos />
        </ClientArea>
      </Route>
      <Route path="/processos">
        <ClientArea>
          <Processos />
        </ClientArea>
      </Route>
      <Route path="/financeiro">
        <ClientArea>
          <Financeiro />
        </ClientArea>
      </Route>
      <Route path="/configuracoes">
        <ClientArea>
          <Configuracoes />
        </ClientArea>
      </Route>
      <Route path="/modelos-contrato">
        <ClientArea>
          <ModelosContrato />
        </ClientArea>
      </Route>
      <Route path="/agenda">
        <ClientArea>
          <Agenda />
        </ClientArea>
      </Route>
      <Route path="/agendamento">
        <ClientArea>
          <Agenda />
        </ClientArea>
      </Route>
      <Route path="/atendimento">
        <ClientArea>
          <Atendimento />
        </ClientArea>
      </Route>
      <Route path="/agentes-ia">
        <ClientArea>
          <AgentesIA />
        </ClientArea>
      </Route>
      <Route path="/agentes-ia/:id/chat">
        <ClientArea>
          <AgenteChat />
        </ClientArea>
      </Route>
      <Route path="/smartflow">
        <ClientArea>
          <SmartFlow />
        </ClientArea>
      </Route>
      <Route path="/smartflow/novo">
        <ClientArea>
          <SmartFlowEditor />
        </ClientArea>
      </Route>
      <Route path="/smartflow/:id/editar">
        <ClientArea>
          <SmartFlowEditor />
        </ClientArea>
      </Route>
      <Route path="/kanban">
        <ClientArea>
          <Kanban />
        </ClientArea>
      </Route>
      <Route path="/clientes">
        <ClientArea>
          <Clientes />
        </ClientArea>
      </Route>
      <Route path="/relatorios">
        <ClientArea>
          <Relatorios />
        </ClientArea>
      </Route>
      {/* Módulo fundido: Métricas foi incorporado a Relatórios */}
      <Route path="/metricas">
        <Redirect to="/relatorios" />
      </Route>

      <Route path="/tarefas">
        <ClientArea>
          <Tarefas />
        </ClientArea>
      </Route>

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <EnvironmentBanner />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
