/**
 * Agente Jurídico (Fase 1 — Revisional): avalia a chance de sucesso e redige a
 * peça, fundamentado na base curada (RAG). A IA usa o modelo que o escritório
 * escolher; toda citação é verificada (grounding) e o advogado revisa/assina.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Scale, Target, Sparkles, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { base64ToBlob, baixarBlob } from "@/pages/financeiro/helpers";

const MODELOS = [
  { v: "gpt-4o", label: "gpt-4o (OpenAI)", rec: true },
  { v: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Anthropic)", rec: true },
  { v: "gpt-4o-mini", label: "gpt-4o-mini (OpenAI — barato)", rec: false },
  { v: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (Anthropic)", rec: false },
];

const NOTA_INFO: Record<string, { label: string; cls: string }> = {
  alta: { label: "Alta", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  media: { label: "Média", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  baixa: { label: "Baixa", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

export default function AgenteJuridico() {
  const [fatos, setFatos] = useState("");
  const [tesesTxt, setTesesTxt] = useState("");
  const [modelo, setModelo] = useState("gpt-4o");
  const [tipo, setTipo] = useState<string>("");
  const [avaliacao, setAvaliacao] = useState<any | null>(null);
  const [pecaTexto, setPecaTexto] = useState<string>("");
  const [verificacao, setVerificacao] = useState<{ fontesUsadas: string[]; suspeitas: string[] } | null>(null);

  const { data: tipos } = (trpc as any).juridico.tiposPeca.useQuery(undefined, { retry: false });
  const tipoSel = tipo || tipos?.[0]?.id || "peticao_inicial_revisional";
  const teses = useMemo(() => tesesTxt.split(/[;\n]/).map((s) => s.trim()).filter(Boolean), [tesesTxt]);

  const avaliarMut = (trpc as any).juridico.avaliarSucesso.useMutation({
    onSuccess: (r: any) => {
      if (!r.disponivel) { toast.error("Não deu pra avaliar", { description: r.motivo }); setAvaliacao(null); return; }
      setAvaliacao(r.avaliacao);
      toast.success("Avaliação pronta");
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  const gerarMut = (trpc as any).juridico.gerarPeca.useMutation({
    onSuccess: (r: any) => {
      if (!r.disponivel || !r.texto) { toast.error("Não deu pra gerar", { description: r.motivo }); return; }
      setPecaTexto(r.texto);
      setVerificacao(r.verificacao);
      if (r.verificacao?.suspeitas?.length) {
        toast.warning(`${r.verificacao.suspeitas.length} citação(ões) sem respaldo — revise antes de usar`);
      } else {
        toast.success("Peça gerada");
      }
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  const exportMut = (trpc as any).juridico.exportarPecaDocx.useMutation({
    onSuccess: (r: { filename: string; base64: string; mimeType: string }) => {
      baixarBlob(base64ToBlob(r.base64, r.mimeType), r.filename, r.mimeType);
      toast.success("DOCX exportado");
    },
    onError: (e: any) => toast.error("Erro", { description: e.message }),
  });

  const podeRodar = fatos.trim().length >= 10;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Scale className="h-5 w-5 text-violet-600" /> Agente Jurídico
          <Badge className="bg-violet-600 text-white">Revisional</Badge>
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Avalie a chance de sucesso e gere a peça — fundamentado, citado e verificado. Você revisa e assina.
        </p>
      </div>

      {/* 1 · Caso */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tipo de peça</Label>
              <Select value={tipoSel} onValueChange={setTipo}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(tipos ?? [{ id: "peticao_inicial_revisional", label: "Petição inicial — Revisional" }]).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Modelo de IA <span className="text-muted-foreground">(do seu escritório)</span></Label>
              <Select value={modelo} onValueChange={setModelo}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODELOS.map((m) => (
                    <SelectItem key={m.v} value={m.v}>{m.label}{m.rec ? " ★" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Fatos do caso</Label>
            <Textarea
              className="mt-1 min-h-[110px]"
              value={fatos}
              onChange={(e) => setFatos(e.target.value)}
              placeholder="Descreva os fatos: tipo de contrato, encargos questionados, valores, cálculo em anexo…"
            />
          </div>
          <div>
            <Label className="text-xs">Teses (uma por linha ou separadas por ;)</Label>
            <Textarea
              className="mt-1 min-h-[56px]"
              value={tesesTxt}
              onChange={(e) => setTesesTxt(e.target.value)}
              placeholder="Capitalização indevida; Juros abusivos; Repetição de indébito"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!podeRodar || avaliarMut.isPending}
              onClick={() => avaliarMut.mutate({ fatos, teses, modelo })}
            >
              {avaliarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Target className="h-4 w-4 mr-2" />}
              Avaliar viabilidade
            </Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!podeRodar || gerarMut.isPending}
              onClick={() => gerarMut.mutate({ fatos, teses, tipo: tipoSel, modelo, resumoAvaliacao: avaliacao?.resumo })}
            >
              {gerarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Gerar peça
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2 · Avaliação */}
      {avaliacao && (
        <Card>
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Viabilidade:</span>
              <span className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-bold border ${NOTA_INFO[avaliacao.nota]?.cls ?? ""}`}>
                {NOTA_INFO[avaliacao.nota]?.label ?? avaliacao.nota}
              </span>
            </div>
            {avaliacao.resumo && <p className="text-sm text-muted-foreground">{avaliacao.resumo}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FatoresBox titulo="✓ A favor" cor="emerald" itens={avaliacao.fatoresFavor} />
              <FatoresBox titulo="✕ Contra / atenção" cor="rose" itens={avaliacao.fatoresContra} />
            </div>
            {Array.isArray(avaliacao.teses) && avaliacao.teses.length > 0 && (
              <div className="rounded-lg border">
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground border-b">Força por tese</div>
                {avaliacao.teses.map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-sm border-b last:border-0">
                    <span>{t.nome}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${NOTA_INFO[t.forca]?.cls ?? ""}`}>{NOTA_INFO[t.forca]?.label ?? t.forca}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 3 · Peça + fontes */}
      {pecaTexto && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-4">
          <Card>
            <CardContent className="pt-5 space-y-3">
              <Label className="text-xs">Peça (edite antes de exportar)</Label>
              <Textarea className="min-h-[320px] font-mono text-[12.5px] leading-relaxed" value={pecaTexto} onChange={(e) => setPecaTexto(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={exportMut.isPending}
                  onClick={() => exportMut.mutate({ texto: pecaTexto, nomeArquivo: tipoSel })}
                >
                  {exportMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  Exportar DOCX
                </Button>
              </div>
              <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                ⚠️ Minuta gerada por IA. <b>Revisão e assinatura do advogado são obrigatórias</b> antes de protocolar.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Fontes usadas · {verificacao?.fontesUsadas?.length ?? 0}
                </p>
                <div className="space-y-1">
                  {(verificacao?.fontesUsadas ?? []).map((f) => (
                    <div key={f} className="text-xs flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" /> {f}
                    </div>
                  ))}
                  {(verificacao?.fontesUsadas?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">—</p>}
                </div>
              </div>
              {(verificacao?.suspeitas?.length ?? 0) > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-600 mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" /> Alertas de citação · {verificacao!.suspeitas.length}
                  </p>
                  <div className="space-y-1">
                    {verificacao!.suspeitas.map((s, i) => (
                      <div key={i} className="text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-md px-2 py-1.5">
                        <b>{s}</b> — sem respaldo na base. Possível invenção; confira ou remova.
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function FatoresBox({ titulo, cor, itens }: { titulo: string; cor: "emerald" | "rose"; itens: any[] }) {
  const head = cor === "emerald" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className={`px-3 py-2 text-[11px] font-bold ${head}`}>{titulo}</div>
      {(Array.isArray(itens) ? itens : []).map((f: any, i: number) => (
        <div key={i} className="px-3 py-2 text-xs border-t first:border-t-0">
          {f.texto}
          {f.fonte && (
            <span className={`ml-1.5 inline-block text-[9.5px] font-bold rounded-full px-1.5 border ${f.fonteVerificada ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-rose-50 text-rose-600 border-rose-200"}`}>
              {f.fonte}{f.fonteVerificada ? "" : " ⚠"}
            </span>
          )}
        </div>
      ))}
      {(!Array.isArray(itens) || itens.length === 0) && <div className="px-3 py-2 text-xs text-muted-foreground">—</div>}
    </div>
  );
}
