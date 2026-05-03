/**
 * Demo — captura grande mostrando o produto em ação.
 *
 * Mockup detalhado do módulo de modelos de contrato (placeholder
 * {{1}}, {{2}}) que é o diferencial mais "visual" do produto.
 */

import { Badge } from "@/components/ui/badge";
import { FileText, Variable, ArrowRight } from "lucide-react";

export function Demo() {
  return (
    <section id="demo" className="max-w-6xl mx-auto px-4 py-20 lg:py-28">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        {/* Coluna esquerda: copy */}
        <div>
          <p className="text-sm font-semibold text-primary uppercase tracking-wide mb-3">
            Em ação
          </p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">
            Contrato pronto em <span className="text-primary">15 segundos</span>.
            Não em 15 minutos.
          </h2>
          <p className="text-lg text-muted-foreground mb-6">
            Sobe um <code className="text-sm bg-muted px-1.5 py-0.5 rounded font-mono">.docx</code>{" "}
            com <code className="text-sm bg-muted px-1.5 py-0.5 rounded font-mono">{"{{1}}"}</code>,{" "}
            <code className="text-sm bg-muted px-1.5 py-0.5 rounded font-mono">{"{{2}}"}</code>...
            estilo template do WhatsApp. Cada placeholder vira um campo:
          </p>
          <ul className="space-y-3 mb-8">
            <li className="flex items-start gap-3">
              <div className="h-6 w-6 rounded-full bg-info-bg text-info-fg flex items-center justify-center flex-shrink-0 mt-0.5">
                <Variable className="h-3.5 w-3.5" />
              </div>
              <div>
                <strong>Variável</strong> — preenche automático do cadastro
                (nome, CPF, profissão, endereço completo)
              </div>
            </li>
            <li className="flex items-start gap-3">
              <div className="h-6 w-6 rounded-full bg-warning-bg text-warning-fg flex items-center justify-center flex-shrink-0 mt-0.5">
                <FileText className="h-3.5 w-3.5" />
              </div>
              <div>
                <strong>Manual</strong> — você preenche na hora (valor da causa,
                foro, nº do processo)
              </div>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground italic">
            "Levei 15 contratos pra entender que era óbvio fazer assim."
            <br />— provavelmente você, depois de testar.
          </p>
        </div>

        {/* Coluna direita: mockup */}
        <div className="relative">
          <div className="absolute -inset-4 bg-gradient-to-br from-info/15 to-accent-purple/10 blur-2xl rounded-3xl opacity-60" />
          <div className="relative rounded-2xl border bg-card shadow-2xl overflow-hidden">
            <div className="bg-muted/30 border-b px-4 py-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-info" />
              <span className="text-sm font-semibold">
                Contrato de Honorários — Trabalhista
              </span>
              <Badge variant="secondary" className="ml-auto text-[10px]">
                3 placeholders
              </Badge>
            </div>

            <div className="p-5 space-y-3">
              {/* Placeholder 1: variável */}
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-info-bg text-info-fg border-0 font-mono text-xs">
                    {"{{1}}"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    <Variable className="h-2.5 w-2.5 mr-1" /> Variável
                  </Badge>
                </div>
                <div className="text-xs flex items-center gap-2">
                  <span className="text-muted-foreground">Mapeado pra:</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                    cliente.nome
                  </code>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">"Maria da Silva"</span>
                </div>
              </div>

              {/* Placeholder 2: manual */}
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-info-bg text-info-fg border-0 font-mono text-xs">
                    {"{{2}}"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] bg-warning-bg text-warning-fg border-0">
                    Manual
                  </Badge>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Pergunta:</span>{" "}
                  <span className="font-medium">"Valor da causa"</span>
                </div>
                <input
                  type="text"
                  defaultValue="R$ 28.500,00"
                  readOnly
                  className="w-full text-xs px-2 py-1 rounded border bg-background"
                />
              </div>

              {/* Placeholder 3: variável (data) */}
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-info-bg text-info-fg border-0 font-mono text-xs">
                    {"{{3}}"}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    <Variable className="h-2.5 w-2.5 mr-1" /> Variável
                  </Badge>
                </div>
                <div className="text-xs flex items-center gap-2">
                  <span className="text-muted-foreground">Mapeado pra:</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                    data.hoje
                  </code>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">"30 de outubro de 2026"</span>
                </div>
              </div>

              {/* Botão final */}
              <div className="pt-2">
                <div className="w-full bg-primary text-primary-foreground text-sm font-medium py-2 rounded-md text-center">
                  Gerar e baixar (.docx)
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
