import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Zap, BrainCircuit, Lock } from "lucide-react";
import SmartFlow from "./SmartFlow";
import AgentesIA from "./AgentesIA";

/**
 * Automações — fusão de SmartFlow (Fluxos) + Agentes IA (Agentes) numa aba
 * só. Conceitualmente correto: o agente é uma peça que um fluxo aciona.
 *
 * Cada sub-aba é gateada de forma INDEPENDENTE (permissão de cargo + plano
 * diferem: smartflow é do plano intermediário, agentesIa do completo). A aba
 * inteira só aparece no menu se o usuário pode ver ao menos uma; aqui,
 * bloqueamos a sub-aba que ele não pode.
 */
type Sub = "fluxos" | "agentes";

export default function Automacoes() {
  const { user } = useAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();

  const { data: minhasPerms } = (trpc as any).permissoes?.minhasPermissoes?.useQuery?.(
    undefined,
    { retry: false, staleTime: 60_000 },
  ) || { data: null };

  const podeVer = (modulo: string) => {
    if (user?.role === "admin" || minhasPerms?.cargo === "Dono") return true;
    if (!minhasPerms?.permissoes) return true; // carregando → não pisca cadeado
    const p = minhasPerms.permissoes[modulo];
    return !!p && (p.verTodos || p.verProprios);
  };
  const podeFluxos = podeVer("smartflow");
  const podeAgentes = podeVer("agentesIa");

  // Sub-aba inicial: da URL (?tab=), senão a primeira permitida.
  const tabDaUrl = new URLSearchParams(search).get("tab") as Sub | null;
  const inicial: Sub = useMemo(() => {
    if (tabDaUrl === "agentes" && podeAgentes) return "agentes";
    if (tabDaUrl === "fluxos" && podeFluxos) return "fluxos";
    return podeFluxos ? "fluxos" : "agentes";
  }, [tabDaUrl, podeFluxos, podeAgentes]);

  const [sub, setSub] = useState<Sub>(inicial);
  useEffect(() => { setSub(inicial); }, [inicial]);

  const trocar = (s: Sub) => {
    setSub(s);
    // Mantém o deep-link atualizado sem recarregar (replace pra não poluir o histórico).
    setLocation(`/automacoes?tab=${s}`, { replace: true });
  };

  const TabBtn = ({ id, icon, label, liberado }: { id: Sub; icon: React.ReactNode; label: string; liberado: boolean }) => (
    <button
      onClick={() => liberado && trocar(id)}
      disabled={!liberado}
      title={liberado ? undefined : "Disponível em outro plano/cargo"}
      className={
        "px-4 py-2.5 -mb-px border-b-2 text-sm font-medium inline-flex items-center gap-1.5 transition " +
        (sub === id
          ? "border-violet-600 text-violet-700 dark:text-violet-300"
          : liberado
            ? "border-transparent text-muted-foreground hover:text-foreground"
            : "border-transparent text-muted-foreground/40 cursor-not-allowed")
      }
    >
      {icon}{label}{!liberado && <Lock className="h-3 w-3" />}
    </button>
  );

  return (
    <div>
      <div className="border-b px-4 md:px-6 pt-3 flex gap-1 sticky top-0 bg-background z-10">
        <TabBtn id="fluxos" icon={<Zap className="h-4 w-4" />} label="Fluxos" liberado={podeFluxos} />
        <TabBtn id="agentes" icon={<BrainCircuit className="h-4 w-4" />} label="Agentes" liberado={podeAgentes} />
      </div>
      <div>
        {sub === "fluxos" && podeFluxos && <SmartFlow />}
        {sub === "agentes" && podeAgentes && <AgentesIA />}
        {sub === "fluxos" && !podeFluxos && <BloqueadoSub label="Fluxos" />}
        {sub === "agentes" && !podeAgentes && <BloqueadoSub label="Agentes" />}
      </div>
    </div>
  );
}

function BloqueadoSub({ label }: { label: string }) {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <Lock className="h-8 w-8 mx-auto mb-3 opacity-40" />
      <p className="text-sm">{label} não está disponível no seu plano/cargo.</p>
    </div>
  );
}
