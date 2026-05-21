/**
 * Aba "Despesas & Comissões" — lista unificada sem sub-abas.
 *
 * Despesas operacionais e fechamentos de comissão aparecem no mesmo grid
 * (comissão fechada já cria row em `despesas` com `origem='comissao'`,
 * destacada com badge rosa via TipoBadge). Ações de comissão ficam em
 * dialogs/sheets disparados pelos botões do topo:
 *  - Calcular comissão → modal (max-w-4xl)
 *  - Histórico de fechamentos → painel lateral (Sheet)
 *
 * Atribuir cobranças saiu daqui — agora vive dentro da aba Cobranças
 * (onde o objeto sendo atribuído realmente está).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Calculator, History } from "lucide-react";
import { DespesasTab } from "./Despesas";
import { CalcularSection, HistoricoSection } from "./Comissoes";

export function DespesasWrapper() {
  const [calcularAberto, setCalcularAberto] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCalcularAberto(true)}
          className="h-9 gap-1.5"
        >
          <Calculator className="h-3.5 w-3.5" />
          Calcular comissão
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHistoricoAberto(true)}
          className="h-9 gap-1.5 text-pink-700 hover:text-pink-900 hover:bg-pink-50"
        >
          <History className="h-3.5 w-3.5" />
          Histórico de fechamentos
        </Button>
      </div>

      <DespesasTab />

      <Dialog open={calcularAberto} onOpenChange={setCalcularAberto}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-pink-600" />
              Calcular comissão
            </DialogTitle>
          </DialogHeader>
          <CalcularSection />
        </DialogContent>
      </Dialog>

      <Sheet open={historicoAberto} onOpenChange={setHistoricoAberto}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-pink-600" />
              Histórico de fechamentos de comissão
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <HistoricoSection />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
