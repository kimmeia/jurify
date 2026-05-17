/**
 * Wrapper da aba "Despesas" no Financeiro.
 *
 * Junta a lista de despesas com o workflow de comissões (Calcular,
 * Atribuir, Histórico) que antes vivia em aba top-level separada. A
 * agenda de comissões foi pra Configurações → Financeiro porque é
 * configuração do negócio, não operação.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calculator, History, List, Tags } from "lucide-react";
import { DespesasTab } from "./Despesas";
import {
  AtribuirSection,
  CalcularSection,
  HistoricoSection,
} from "./Comissoes";

export function DespesasWrapper() {
  return (
    <Tabs defaultValue="lista" className="space-y-4">
      <TabsList>
        <TabsTrigger value="lista" className="gap-1.5">
          <List className="h-3.5 w-3.5" />
          Lista
        </TabsTrigger>
        <TabsTrigger value="calcular" className="gap-1.5">
          <Calculator className="h-3.5 w-3.5" />
          Calcular comissão
        </TabsTrigger>
        <TabsTrigger value="atribuir" className="gap-1.5">
          <Tags className="h-3.5 w-3.5" />
          Atribuir cobranças
        </TabsTrigger>
        <TabsTrigger value="historico" className="gap-1.5">
          <History className="h-3.5 w-3.5" />
          Histórico de comissões
        </TabsTrigger>
      </TabsList>
      <TabsContent value="lista">
        <DespesasTab />
      </TabsContent>
      <TabsContent value="calcular">
        <CalcularSection />
      </TabsContent>
      <TabsContent value="atribuir">
        <AtribuirSection />
      </TabsContent>
      <TabsContent value="historico">
        <HistoricoSection />
      </TabsContent>
    </Tabs>
  );
}
