/**
 * Demo — showcase do módulo de modelos de contrato (placeholders
 * {{1}}, {{2}}), o diferencial mais "visual" do produto.
 */

import { Badge } from "@/components/ui/badge";
import { FileText, Variable, CheckCircle2, ArrowRight } from "lucide-react";

export function Demo() {
  return (
    <section id="demo" className="border-y bg-white">
      <div className="mx-auto max-w-6xl px-4 py-24">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          {/* Copy */}
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.08em] text-violet-600">Contratos</p>
            <h2 className="font-display mt-3 text-3xl font-extrabold leading-tight tracking-tight md:text-[38px]">
              Contrato pronto em 15 segundos. Não em 15 minutos.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Sobe um{" "}
              <code className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-sm text-violet-700">.docx</code>{" "}
              com placeholders{" "}
              <code className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-sm text-violet-700">{"{{1}}"}</code>,{" "}
              <code className="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-sm text-violet-700">{"{{2}}"}</code>…
              e cada um vira um campo.
            </p>
            <ul className="mt-6 space-y-3.5">
              <li className="flex gap-3 text-[15px]">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <span>
                  <strong>Variável</strong> — preenche automático do cadastro (nome, CPF,
                  profissão, endereço).
                </span>
              </li>
              <li className="flex gap-3 text-[15px]">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <span>
                  <strong>Manual</strong> — você preenche na hora (valor da causa, foro, nº do
                  processo).
                </span>
              </li>
              <li className="flex gap-3 text-[15px]">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                <span>
                  <strong>Assinatura eletrônica</strong> — envia, o cliente assina pelo link e o
                  PDF volta carimbado.
                </span>
              </li>
            </ul>
          </div>

          {/* Mockup */}
          <div className="overflow-hidden rounded-2xl border bg-white shadow-2xl">
            <div className="flex h-9 items-center gap-2 border-b bg-slate-100 px-4">
              <span className="flex gap-1.5">
                <i className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <i className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <i className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              <span className="flex-1 text-center font-mono text-[11px] text-slate-400">
                app.juridflow.com.br/modelos-contrato
              </span>
            </div>
            <div className="space-y-3 bg-[#fafaff] p-5">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-violet-600" />
                <span className="text-sm font-bold">Contrato de Honorários — Trabalhista</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">3 placeholders</Badge>
              </div>

              {/* {{1}} variável */}
              <div className="space-y-2 rounded-lg border bg-white p-3">
                <div className="flex items-center gap-2">
                  <Badge className="border-0 bg-violet-100 font-mono text-xs text-violet-700">{"{{1}}"}</Badge>
                  <Badge variant="outline" className="text-[10px]">
                    <Variable className="mr-1 h-2.5 w-2.5" /> Variável
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Mapeado pra</span>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">cliente.nome</code>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">Maria da Silva</span>
                </div>
              </div>

              {/* {{2}} manual */}
              <div className="space-y-2 rounded-lg border bg-white p-3">
                <div className="flex items-center gap-2">
                  <Badge className="border-0 bg-violet-100 font-mono text-xs text-violet-700">{"{{2}}"}</Badge>
                  <Badge className="border-0 bg-amber-100 text-[10px] text-amber-700">Manual</Badge>
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Pergunta:</span>{" "}
                  <span className="font-medium">"Valor da causa"</span>
                </div>
                <input
                  type="text"
                  defaultValue="R$ 28.500,00"
                  readOnly
                  className="w-full rounded border bg-background px-2 py-1.5 text-xs"
                />
              </div>

              <div className="rounded-md bg-violet-600 py-2 text-center text-sm font-medium text-white">
                Gerar e baixar (.docx)
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
