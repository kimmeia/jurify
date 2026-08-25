import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { EnvironmentBanner } from "./components/EnvironmentBanner";
import { InstallPWA } from "./components/InstallPWA";
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
import AdminReports from "./pages/admin/AdminReports";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminSaude from "./pages/admin/AdminSaude";
import AdminIA from "./pages/admin/AdminIA";
import AdminTribunais from "./pages/admin/AdminTribunais";
import AdminFinanceiro from "./pages/admin/AdminFinanceiro";
import AdminPlanoEditor from "./pages/admin/AdminPlanoEditor";
import AdminSmartflow from "./pages/admin/AdminSmartflow";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import Bancario from "./pages/calculos/Bancario";
import Calculos from "./pages/calculos/Calculos";
import Imobiliario from "./pages/calculos/Imobiliario";
import Trabalhista from "./pages/calculos/Trabalhista";
import Tributario from "./pages/calculos/Tributario";
import Previdenciario from "./pages/calculos/Previdenciario";
import CalculosDiversos from "./pages/calculos/CalculosDiversos";
import Processos from "./pages/Processos";
import JurisIa from "./pages/JurisIa";
import Ponto from "./pages/Ponto";
import FichaColaborador from "./pages/ponto/ficha";
import Configuracoes from "./pages/Configuracoes";
import ModelosContrato from "./pages/ModelosContrato";
import Agendamento from "./pages/Agendamento";
import Atendimento from "./pages/Atendimento";
import AgenteChat from "./pages/AgenteChat";
import SmartFlowEditor from "./pages/SmartFlowEditor";
import Automacoes from "./pages/Automacoes";
import Kanban from "./pages/Kanban";
import RestaurarCards from "@/pages/kanban/RestaurarCards";
import Clientes from "./pages/Clientes";
import ClientesEssencial from "./pages/ClientesEssencial";
import Prazos from "./pages/Prazos";
import { useModulosContratados } from "./components/ModuloGuard";
import TermosGate from "./components/TermosGate";
import { contratoLibera } from "@shared/modulos-contratacao";
import Acordos from "./pages/Acordos";
import Relatorios from "./pages/Relatorios";
import Financeiro from "./pages/Financeiro";
import AtribuirCobrancasPage from "./pages/financeiro/AtribuirCobrancasPage";
import RevisarOrfasPage from "./pages/financeiro/RevisarOrfasPage";
import Agenda from "./pages/Agenda";
import Tarefas from "./pages/Tarefas";
import AssinarDocumento from "./pages/AssinarDocumento";
import AceitarConvite from "./pages/AceitarConvite";
import ConfirmarEmail from "./pages/auth/ConfirmarEmail";
import AuthSplitPage from "./pages/auth/AuthSplitPage";
import AppLayout from "./components/AppLayout";
import AdminLayout from "./components/AdminLayout";
import SubscriptionGuard from "./components/SubscriptionGuard";
import ModuloGuard from "./components/ModuloGuard";

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
      {/* Antes do guard de assinatura de propósito: o dono precisa aceitar
          os termos vigentes mesmo se estiver caindo na tela de plano. */}
      <TermosGate />
      <SubscriptionGuard>
        <ModuloGuard>{children}</ModuloGuard>
      </SubscriptionGuard>
    </AppLayout>
  );
}

function ClientAreaNoGuard({ children }: { children: React.ReactNode }) {
  return <AppLayout>{children}</AppLayout>;
}

/**
 * Fase 2 da modularização: /clientes decide entre o CRM completo e o
 * cadastro essencial olhando o CONTRATO (não o cargo). Quem não tem nenhum
 * dos dois nem chega aqui — o ModuloGuard barra antes.
 */
function ClientesPorContrato() {
  const contratados = useModulosContratados();
  return contratoLibera(contratados, ["clientes"]) ? <Clientes /> : <ClientesEssencial />;
}

/** /prazos: com Agenda contratada o destino certo é o calendário completo. */
function PrazosPorContrato() {
  const contratados = useModulosContratados();
  return contratoLibera(contratados, ["agenda"]) ? <Redirect to="/agenda" /> : <Prazos />;
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
      <Route path="/login">
        <AuthSplitPage modo="login" />
      </Route>
      <Route path="/cadastro">
        <AuthSplitPage modo="signup" />
      </Route>
      <Route path="/esqueci-senha" component={EsqueciSenha} />
      <Route path="/redefinir-senha" component={RedefinirSenha} />
      <Route path="/confirmar-email/:token" component={ConfirmarEmail} />
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
      {/* Assinaturas deixou de ser aba própria — agora vive dentro do
          cadastro do cliente (/admin/clients). Redireciona links antigos. */}
      <Route path="/admin/subscriptions">
        <Redirect to="/admin/clients" />
      </Route>
      <Route path="/admin/financeiro">
        <AdminArea>
          <AdminFinanceiro />
        </AdminArea>
      </Route>
      {/* Editor de plano em tela cheia — sem sidebar de propósito (o gate
          de admin é do próprio componente). */}
      <Route path="/admin/planos/:slug">
        {(params) => <AdminPlanoEditor slug={params.slug} />}
      </Route>
      <Route path="/admin/ia">
        <AdminArea>
          <AdminIA />
        </AdminArea>
      </Route>
      <Route path="/admin/smartflow">
        <AdminArea>
          <AdminSmartflow />
        </AdminArea>
      </Route>
      <Route path="/admin/reports">
        <AdminArea>
          <AdminReports />
        </AdminArea>
      </Route>
      <Route path="/admin/saude">
        <AdminArea>
          <AdminSaude />
        </AdminArea>
      </Route>
      {/* Erros, robôs, e-mails e auditoria viraram abas de Saúde do sistema;
          Agentes IA e JurisIA viraram abas de IA. Links antigos redirecionam. */}
      <Route path="/admin/agentes-ia">
        <Redirect to="/admin/ia?aba=agentes" />
      </Route>
      <Route path="/admin/jurisia">
        <Redirect to="/admin/ia?aba=jurisia" />
      </Route>
      <Route path="/admin/auditoria">
        <Redirect to="/admin/saude?aba=auditoria" />
      </Route>
      <Route path="/admin/robo-auditor">
        <Redirect to="/admin/saude?aba=robo-auditor" />
      </Route>
      <Route path="/admin/robo-jornada">
        <Redirect to="/admin/saude?aba=robo-jornada" />
      </Route>
      <Route path="/admin/erros">
        <Redirect to="/admin/saude?aba=erros" />
      </Route>
      <Route path="/admin/email-log">
        <Redirect to="/admin/saude?aba=emails" />
      </Route>
      <Route path="/admin/tribunais">
        <AdminArea>
          <AdminTribunais />
        </AdminArea>
      </Route>
      {/* Integrações e Backups foram absorvidos por Configurações (abas).
          Redireciona links antigos. */}
      <Route path="/admin/backups">
        <Redirect to="/admin/settings" />
      </Route>
      <Route path="/admin/integrations">
        <Redirect to="/admin/settings" />
      </Route>
      <Route path="/roadmap">
        <ClientAreaNoGuard>
          <Roadmap />
        </ClientAreaNoGuard>
      </Route>
      <Route path="/admin/roadmap">
        <AdminArea>
          <Roadmap />
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
      <Route path="/calculos">
        <ClientArea>
          <Calculos />
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
      {/* A central virou a aba default de /processos; a rota antiga segue
          válida pra bookmarks e notificações já enviadas. */}
      <Route path="/movimentacoes">
        <ClientArea>
          <Processos />
        </ClientArea>
      </Route>
      <Route path="/ponto">
        <ClientArea>
          <Ponto />
        </ClientArea>
      </Route>
      <Route path="/ponto/:id">
        <ClientArea>
          <FichaColaborador />
        </ClientArea>
      </Route>
      <Route path="/jurisia">
        <ClientArea>
          <JurisIa />
        </ClientArea>
      </Route>
      <Route path="/financeiro/atribuir">
        <ClientArea>
          <AtribuirCobrancasPage />
        </ClientArea>
      </Route>
      <Route path="/financeiro/revisar-orfas">
        <ClientArea>
          <RevisarOrfasPage />
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
      {/* O redator não é módulo à parte — vive no modo "Redigir peça" do
          JurisIA. Link antigo continua chegando lá. */}
      <Route path="/agente-juridico">
        <Redirect to="/jurisia" />
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
      {/* Automações — fusão de Fluxos (SmartFlow) + Agentes (Agentes IA). */}
      <Route path="/automacoes">
        <ClientArea>
          <Automacoes />
        </ClientArea>
      </Route>
      {/* Deep-links preservados (chat do agente + editor de fluxo full-screen). */}
      <Route path="/agentes-ia/:id/chat">
        <ClientArea>
          <AgenteChat />
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
      {/* Telas de lista antigas → redirect pra sub-aba correspondente
          (preserva links salvos, o card "Agente Jurídico" e o dropdown
          "escolher agente" do editor de fluxo). */}
      <Route path="/agentes-ia">
        <Redirect to="/automacoes?tab=agentes" />
      </Route>
      <Route path="/smartflow">
        <Redirect to="/automacoes?tab=fluxos" />
      </Route>
      <Route path="/kanban">
        <ClientArea>
          <Kanban />
        </ClientArea>
      </Route>
      <Route path="/kanban/restaurar">
        <ClientArea>
          <RestaurarCards />
        </ClientArea>
      </Route>
      <Route path="/clientes">
        <ClientArea>
          <ClientesPorContrato />
        </ClientArea>
      </Route>
      <Route path="/prazos">
        <ClientArea>
          <PrazosPorContrato />
        </ClientArea>
      </Route>
      <Route path="/acordos">
        <ClientArea>
          <Acordos />
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
      <ThemeProvider defaultTheme="claro">
        <TooltipProvider>
          <Toaster />
          <EnvironmentBanner />
          <Router />
          <InstallPWA />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
