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

export default function AdminIA() {
  const [aba, setAba] = useState<Aba>(abaInicial);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">IA</h1>
        <p className="text-muted-foreground mt-1">
          Agentes treináveis dos escritórios, a base do Agente Jurídico e o robô do JurisIA.
        </p>
      </div>

      <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
        <TabsList>
          <TabsTrigger value="agentes">Agentes IA</TabsTrigger>
          <TabsTrigger value="base">Base Jurídica</TabsTrigger>
          <TabsTrigger value="jurisia">JurisIA</TabsTrigger>
        </TabsList>

        <TabsContent value="agentes" className="mt-4">
          <AdminAgentesIA />
        </TabsContent>
        <TabsContent value="base" className="mt-4">
          <BaseJuridicaTab />
        </TabsContent>
        <TabsContent value="jurisia" className="mt-4">
          <AdminJurisIa />
        </TabsContent>
      </Tabs>
    </div>
  );
}
