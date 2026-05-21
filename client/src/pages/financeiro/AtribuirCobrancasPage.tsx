/**
 * Página standalone /financeiro/atribuir — abraça AtribuirSection com
 * header próprio + suporte a query params pra filtros pré-aplicados
 * vindos dos banners de pendência da aba Cobranças:
 *  - ?filtro=semCategoria  → liga incluirSemCategoria + apenasSemAtribuicao
 *  - ?filtro=semAtendente  → liga incluirSemAtendente + apenasSemAtribuicao
 *
 * A AtribuirSection original (em Comissoes.tsx) continua exportada — só
 * mudou de lugar. Quando a edição inline na lista de cobranças cobrir
 * o caso simples (Sprint 3), essa página fica como ferramenta de bulk.
 */

import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AtribuirSection } from "./Comissoes";

export default function AtribuirCobrancasPage() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const filtro = sp.get("filtro");
    if (filtro !== "semCategoria" && filtro !== "semAtendente") return;
    try {
      const raw = localStorage.getItem("jurify:financeiro:atribuir:filtros:v1");
      const atual = raw ? JSON.parse(raw) : {};
      const patch = {
        ...atual,
        apenasSemAtribuicao: true,
        incluirSemCategoria: filtro === "semCategoria",
        incluirSemAtendente: filtro === "semAtendente",
      };
      localStorage.setItem(
        "jurify:financeiro:atribuir:filtros:v1",
        JSON.stringify(patch),
      );
    } catch {
      /* localStorage inacessível — ignora, default ainda funciona */
    }
  }, []);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 space-y-4 max-w-7xl">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (window.location.href = "/financeiro")}
          className="h-8"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Voltar pro Financeiro
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">
          Atribuir &amp; categorizar cobranças
        </h1>
      </div>
      <AtribuirSection />
    </div>
  );
}
