import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import AdminAgentesIA from "./AdminAgentesIA";
import AdminJurisIa from "./AdminJurisIa";
import BaseJuridicaTab from "./BaseJuridicaTab";

const ABAS_VALIDAS = ["agentes", "base", "jurisia"] as const;
type Aba = (typeof ABAS_VALIDAS)[number];

function abaInicial(): Aba {
  const aba = new URLSearchParams(window.location.search).get("aba");
  return ABAS_VALIDAS.includes(aba as Aba) ? (aba as Aba) : "agentes";
}

/**
 * A linha que devolve o contexto perdido: o dono olhou as 3 abas e disse
 * "não sei mais nem o que eles fazem". Uma frase discreta sempre visível +
 * "entenda como funciona" que expande os passos só pra quem quiser —
 * a versão em quadros grandes foi rejeitada por poluição visual.
 */
function ContextoAba({
  icone,
  titulo,
  resto,
  passos,
}: {
  icone: string;
  titulo: string;
  resto: string;
  passos: Array<{ rotulo: string; desc: string }>;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="mb-4">
      <p className="text-sm text-muted-foreground">
        {icone} <b className="font-semibold text-foreground">{titulo}</b> — {resto}{" "}
        <button
          className="text-xs font-bold text-info-fg underline underline-offset-2 whitespace-nowrap"
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? "fechar ▴" : "entenda como funciona ▾"}
        </button>
      </p>
      {aberto && (
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 rounded-xl border border-dashed border-info/30 bg-info-bg/50 px-4 py-3">
          {passos.map((p, i) => (
            <span key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-info text-[9px] font-extrabold text-info-on">
                {i + 1}
              </span>
              <span>
                <b className="font-semibold text-foreground">{p.rotulo}</b> — {p.desc}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminIA() {
  const [aba, setAba] = useState<Aba>(abaInicial);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">IA</h1>
        <p className="text-muted-foreground mt-1">Os robôs e a inteligência da plataforma.</p>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList>
          <TabsTrigger value="agentes">🤖 Agentes IA</TabsTrigger>
          <TabsTrigger value="base">⚖️ Base Jurídica</TabsTrigger>
          <TabsTrigger value="jurisia">🛰️ JurisIA</TabsTrigger>
        </TabsList>

        <TabsContent value="agentes" className="mt-4">
          <ContextoAba
            icone="🤖"
            titulo="Robôs de conversa da plataforma"
            resto="você cria e treina; o chatbot do Atendimento responde usando eles."
            passos={[
              { rotulo: "Criar", desc: "nome e instruções" },
              { rotulo: "Treinar", desc: "subir documentos e FAQ" },
              { rotulo: "Pronto", desc: "o Atendimento usa nas conversas" },
            ]}
          />
          <AdminAgentesIA />
        </TabsContent>
        <TabsContent value="base" className="mt-4">
          <ContextoAba
            icone="⚖️"
            titulo="A biblioteca do Agente Jurídico"
            resto="leis e súmulas que ele consulta pra redigir peças. Vale pra todos os escritórios."
            passos={[
              { rotulo: "Alimentar", desc: "subir decisão ou criar fonte na mão" },
              { rotulo: "Manter indexada", desc: "o Reindexar quando algo ficar pendente" },
              { rotulo: "Pronto", desc: "o agente passa a citar a fonte nas peças" },
            ]}
          />
          <BaseJuridicaTab />
        </TabsContent>
        <TabsContent value="jurisia" className="mt-4">
          <ContextoAba
            icone="🛰️"
            titulo="O robô que monta o acervo de jurisprudência"
            resto="baixa decisões dos tribunais; é o que o add-on JurisIA vende."
            passos={[
              { rotulo: "Acompanhar", desc: "os números dizem se o acervo está crescendo" },
              { rotulo: "Destravar", desc: "ferramentas técnicas, só quando o robô parar" },
            ]}
          />
          <AdminJurisIa />
        </TabsContent>
      </Tabs>
    </div>
  );
}
