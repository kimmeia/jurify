import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import AdminDashboard from "./pages/AdminDashboard";
import AdminClients from "./pages/admin/AdminClients";
import AdminSubscriptions from "./pages/admin/AdminSubscriptions";
import AdminReports from "./pages/admin/AdminReports";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminIntegrations from "./pages/admin/AdminIntegrations";
import AdminAuditoria from "./pages/admin/AdminAuditoria";
import AdminInadimplentes from "./pages/admin/AdminInadimplentes";
import AdminPlanos from "./pages/admin/AdminPlanos";
import AdminCupons from "./pages/admin/AdminCupons";
import AdminFinanceiro from "./pages/admin/AdminFinanceiro";
import AdminAgentesIA from "./pages/admin/AdminAgentesIA";
import Plans from "./pages/Plans";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import Bancario from "./pages/calculos/Bancario";
import Imobiliario from "./pages/calculos/Imobiliario";
import Trabalhista from "./pages/calculos/Trabalhista";
import Tributario from "./pages/calculos/Tributario";
import Previdenciario from "./pages/calculos/Previdenciario";
import CalculosDiversos from "./pages/calculos/CalculosDiversos";
import Processos from "./pages/Processos";
import Configuracoes from "./pages/Configuracoes";
import Agendamento from "./pages/Agendamento";
import Atendimento from "./pages/Atendimento";
import AgentesIA from "./pages/AgentesIA";
import SmartFlow from "./pages/SmartFlow";
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
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/assinar/:token">
        {(params: any) => <AssinarDocumento token={params.token} />}
      </Route>
      <Route path="/convite/:token">
        {(params: any) => <AceitarConvite token={params.token} />}
      </Route>

      {/* Plans - accessible inside layout but without subscription guard */}
      <Route path="/plans">
        <ClientAreaNoGuard>
          <Plans />
        </ClientAreaNoGuard>
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
      <Route path="/smartflow">
        <ClientArea>
          <SmartFlow />
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
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
