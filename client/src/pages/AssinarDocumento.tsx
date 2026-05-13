/**
 * Página pública de assinatura digital.
 * Acessada pelo cliente via link (sem login).
 * URL: /assinar/:token
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import SignaturePad from "signature_pad";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
// Worker do pdfjs servido localmente via Vite `?url`. Atrelado à mesma
// versão de pdfjs-dist (5.4.296) que o react-pdf bundla — alinhar via
// package.json é crítico, caret/range causa mismatch.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  PenLine, FileText, CheckCircle, XCircle, Clock, Loader2, ExternalLink,
  ShieldCheck, AlertTriangle, Eraser, ChevronLeft, ChevronRight,
  Calendar, User, IdCard,
} from "lucide-react";
import { toast } from "sonner";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type CampoTipo = "ASSINATURA" | "DATA" | "NOME" | "CPF";
const TIPO_ICONE: Record<CampoTipo, any> = {
  ASSINATURA: PenLine, DATA: Calendar, NOME: User, CPF: IdCard,
};
const TIPO_COR: Record<CampoTipo, string> = {
  ASSINATURA: "bg-amber-200/70 border-amber-500 text-amber-900",
  DATA: "bg-blue-200/70 border-blue-500 text-blue-900",
  NOME: "bg-emerald-200/70 border-emerald-500 text-emerald-900",
  CPF: "bg-violet-200/70 border-violet-500 text-violet-900",
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Aguardando", enviado: "Enviado", visualizado: "Visualizado",
  assinado: "Assinado", recusado: "Cancelado", expirado: "Expirado",
};
const STATUS_ICONS: Record<string, any> = {
  pendente: Clock, enviado: Clock, visualizado: FileText,
  assinado: CheckCircle, recusado: XCircle, expirado: AlertTriangle,
};

export default function AssinarDocumento({ token }: { token: string }) {
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [cpf, setCpf] = useState("");
  const [concordo, setConcordo] = useState(false);
  const [assinado, setAssinado] = useState(false);
  const [assinaturaVazia, setAssinaturaVazia] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  const { data: doc, isLoading, error } = (trpc as any).assinaturas.visualizarPorToken.useQuery(
    { token },
    { retry: false }
  );

  // Campos posicionais (Fase 1+). Quando vazio, fluxo legado
  // (assinatura central na última página + página de certificação).
  const { data: campos = [] } = (trpc as any).assinaturas.listarCamposPorToken.useQuery(
    { token },
    { retry: false, enabled: !!doc }
  );

  const assinarMut = (trpc as any).assinaturas.assinarPorToken.useMutation({
    onSuccess: () => {
      setAssinado(true);
      toast.success("Documento assinado com sucesso!");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Inicializa signature_pad. Resize handler mantém ratio em rotação
  // mobile (portrait ↔ landscape) e em zooms variados.
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(ratio, ratio);
    padRef.current?.clear();
    setAssinaturaVazia(true);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, {
      backgroundColor: "rgba(255, 255, 255, 0)",
      penColor: "#1a1a2e",
      minWidth: 1.2,
      maxWidth: 3,
    });
    pad.addEventListener("endStroke", () => setAssinaturaVazia(pad.isEmpty()));
    padRef.current = pad;
    setupCanvas();
    window.addEventListener("resize", setupCanvas);
    return () => {
      window.removeEventListener("resize", setupCanvas);
      pad.off();
    };
    // doc é dep porque o canvas só renderiza quando o card "podeAssinar"
    // aparece; sem isso o pad inicializa antes do canvas existir no DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.status]);

  function handleLimparAssinatura() {
    padRef.current?.clear();
    setAssinaturaVazia(true);
  }

  function handleAssinar() {
    if (!padRef.current || padRef.current.isEmpty()) {
      toast.error("Desenhe sua assinatura no quadro abaixo.");
      return;
    }
    if (!nomeCompleto.trim() || nomeCompleto.length < 3 || !concordo) return;
    const dataUrl = padRef.current.toDataURL("image/png");
    const assinaturaImagemBase64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    assinarMut.mutate({
      token,
      nomeCompleto: nomeCompleto.trim(),
      cpf: cpf.trim() || undefined,
      concordo: true,
      assinaturaImagemBase64,
    });
  }

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-950 dark:to-gray-900">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Não encontrado
  if (!doc || error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-950 dark:to-gray-900 p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8">
            <XCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Documento não encontrado</h2>
            <p className="text-sm text-muted-foreground">O link pode estar incorreto ou o documento foi removido.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const StatusIcon = STATUS_ICONS[doc.status] || Clock;
  const jaAssinado = doc.status === "assinado" || assinado;
  const expirado = doc.status === "expirado";
  const cancelado = doc.status === "recusado";
  const podeAssinar = !jaAssinado && !expirado && !cancelado;

  // Já assinado
  if (jaAssinado) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-950 dark:to-green-950 p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8">
            <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-emerald-600" />
            </div>
            <h2 className="text-xl font-bold text-emerald-800 dark:text-emerald-200 mb-2">Documento Assinado!</h2>
            <p className="text-sm text-muted-foreground mb-4">{doc.titulo}</p>
            <p className="text-xs text-muted-foreground">Sua assinatura digital foi registrada com sucesso. Você pode fechar esta página.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Expirado ou cancelado
  if (expirado || cancelado) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-950 dark:to-gray-900 p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8">
            <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">{expirado ? "Documento Expirado" : "Documento Cancelado"}</h2>
            <p className="text-sm text-muted-foreground">{doc.titulo}</p>
            <p className="text-xs text-muted-foreground mt-2">
              {expirado
                ? "O prazo para assinatura deste documento expirou. Entre em contato com o escritório."
                : "Este documento foi cancelado. Entre em contato com o escritório para mais informações."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Tela de assinatura
  const temCamposPosicionais = (campos as any[]).length > 0;
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-950 dark:to-gray-900 p-4">
      <div className={`mx-auto ${temCamposPosicionais ? "max-w-5xl" : "max-w-lg"} space-y-4`}>
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center mx-auto shadow-lg">
            <PenLine className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Assinatura Digital</h1>
          <p className="text-sm text-muted-foreground">Revise e assine o documento abaixo</p>
        </div>

        {/* PDF preview com caixas posicionais (Fase 1+).
            Só aparece quando temCamposPosicionais — caso contrário,
            a UX legada (botão "Abrir documento" + form) é mantida.
            Usa endpoint dedicado /api/assinatura/pdf/token/:token em
            vez do path estático /uploads/...: passa pelo auth via token,
            seta CORP cross-origin no header, e loga se PDF sumiu. */}
        {temCamposPosicionais && (
          <PreviewPdfComCampos
            documentoUrl={`/api/assinatura/pdf/token/${token}`}
            campos={campos as any[]}
          />
        )}

        {/* Documento */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-blue-500 shrink-0" />
              <div className="flex-1">
                <CardTitle className="text-base">{doc.titulo}</CardTitle>
                {doc.descricao && <p className="text-xs text-muted-foreground mt-0.5">{doc.descricao}</p>}
              </div>
              <Badge className="text-[10px]">{STATUS_LABELS[doc.status]}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Link do documento */}
            {doc.documentoUrl && (
              <Button variant="outline" className="w-full justify-start gap-2 h-10" onClick={() => window.open(doc.documentoUrl, "_blank")}>
                <ExternalLink className="h-4 w-4" />
                <span className="text-sm">Abrir documento para leitura</span>
              </Button>
            )}

            {/* Info de expiração */}
            {doc.expiracaoAt && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Válido até {new Date(doc.expiracaoAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</span>
              </div>
            )}

            {/* Formulário de assinatura */}
            {podeAssinar && (
              <div className="space-y-4 pt-2 border-t">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Nome completo *</Label>
                  <Input
                    value={nomeCompleto}
                    onChange={e => setNomeCompleto(e.target.value)}
                    placeholder="Digite seu nome completo"
                    className="h-10"
                  />
                  {doc.assinantNome && (
                    <p className="text-[10px] text-muted-foreground">Esperado: {doc.assinantNome}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">CPF (opcional)</Label>
                  <Input
                    value={cpf}
                    onChange={e => setCpf(e.target.value)}
                    placeholder="000.000.000-00"
                    className="h-10"
                    inputMode="numeric"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Sua assinatura *</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleLimparAssinatura}
                      className="h-7 text-xs"
                    >
                      <Eraser className="h-3 w-3 mr-1" />
                      Limpar
                    </Button>
                  </div>
                  <div className="rounded-lg border-2 border-dashed bg-white">
                    {/* touch-none é crítico em mobile: sem ele o scroll do
                        navegador captura o gesto e não dá pra desenhar. */}
                    <canvas
                      ref={canvasRef}
                      className="w-full h-[180px] touch-none cursor-crosshair rounded-lg"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Desenhe com o dedo (celular) ou com o mouse (computador).
                    {assinaturaVazia && " A assinatura aparecerá no documento final."}
                  </p>
                </div>

                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border hover:bg-muted/30 transition-colors">
                  <input
                    type="checkbox"
                    checked={concordo}
                    onChange={e => setConcordo(e.target.checked)}
                    className="h-4 w-4 mt-0.5 rounded"
                  />
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    Declaro que li e concordo com o conteúdo do documento acima. Confirmo que minha assinatura
                    digital tem validade jurídica nos termos da Lei 14.063/2020 (Assinatura Eletrônica) e da
                    MP 2.200-2/2001, produzindo os mesmos efeitos de uma assinatura manuscrita.
                  </span>
                </label>

                <Button
                  className="w-full h-11 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 text-white font-semibold"
                  onClick={handleAssinar}
                  disabled={
                    !nomeCompleto ||
                    nomeCompleto.length < 3 ||
                    !concordo ||
                    assinaturaVazia ||
                    assinarMut.isPending
                  }
                >
                  {assinarMut.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PenLine className="h-4 w-4 mr-2" />
                  )}
                  Assinar Documento
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Segurança */}
        <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Assinatura protegida com registro de IP e timestamp</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Preview do PDF com caixas amarelas marcando onde cada campo será
 * carimbado. NÃO é interativo — só visual. O backend carimba
 * automaticamente em cada coord quando o cliente clica "Assinar".
 *
 * Coords vêm do DB em pontos PDF bottom-left. Reconverte pra top-left
 * (que é o que o overlay HTML precisa) no momento do render.
 */
function PreviewPdfComCampos({
  documentoUrl,
  campos,
}: {
  documentoUrl: string;
  campos: Array<{
    id: number; tipo: CampoTipo; pagina: number;
    x: number; y: number; largura: number; altura: number;
  }>;
}) {
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(0);
  const [pageSizePt, setPageSizePt] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoiza options pra Document não recriar transport a cada render
  // (causa "sendWithPromise null" no Page).
  const pdfOptions = useMemo(
    () => ({ withCredentials: true } as any),
    [],
  );

  const camposDaPagina = campos.filter((c) => c.pagina === paginaAtual);
  const paginasComCampos = Array.from(new Set(campos.map((c) => c.pagina))).sort((a, b) => a - b);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-amber-500" />
            Onde sua assinatura vai aparecer
          </CardTitle>
          {totalPaginas > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <Button
                size="sm" variant="outline"
                className="h-7 w-7 p-0"
                onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                disabled={paginaAtual <= 1}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-2 text-muted-foreground min-w-20 text-center">
                {paginaAtual} / {totalPaginas}
              </span>
              <Button
                size="sm" variant="outline"
                className="h-7 w-7 p-0"
                onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}
                disabled={paginaAtual >= totalPaginas}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {campos.length} campo(s) marcado(s). As caixas amarelas indicam onde sua
          assinatura/dados serão inseridos automaticamente. Páginas com campos:{" "}
          {paginasComCampos.join(", ")}.
        </p>
      </CardHeader>
      <CardContent className="bg-muted/20 flex justify-center pt-2">
        <Document
          // key={documentoUrl} força remount limpo se a URL mudar
          key={documentoUrl}
          file={documentoUrl}
          options={pdfOptions}
          onLoadSuccess={({ numPages }) => setTotalPaginas(numPages)}
          onLoadError={(err) => {
            // eslint-disable-next-line no-console
            console.error("[PreviewPdfComCampos] Falha ao carregar PDF", {
              documentoUrl,
              error: err?.message,
              name: err?.name,
            });
          }}
          loading={
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
              Carregando documento...
            </div>
          }
          error={
            <div className="p-12 text-center text-sm text-red-600">
              Não foi possível exibir o documento.
            </div>
          }
        >
          <div ref={containerRef} className="relative inline-block shadow-md bg-white">
            <Page
              pageNumber={paginaAtual}
              width={600}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onLoadSuccess={(p) => setPageSizePt({ w: p.width, h: p.height })}
            />
            {pageSizePt &&
              camposDaPagina.map((c) => {
                // Mede o canvas direto (não o container) — o div externo
                // pode ter dimensões diferentes por causa de
                // border/padding/inline-block fallback. Canvas é fonte
                // única de verdade pro mapeamento px↔pt.
                const canvas = containerRef.current?.querySelector(
                  "canvas.react-pdf__Page__canvas",
                ) as HTMLCanvasElement | null;
                const rect = canvas?.getBoundingClientRect();
                const renderW = rect?.width ?? 600;
                const renderH = rect?.height ?? 800;
                const scaleX = renderW / pageSizePt.w;
                const scaleY = renderH / pageSizePt.h;
                // Backend devolve em PDF bottom-left → converte pra top-left
                const yTop = pageSizePt.h - c.y - c.altura;
                const Icone = TIPO_ICONE[c.tipo];
                return (
                  <div
                    key={c.id}
                    className={`absolute border-2 ${TIPO_COR[c.tipo]} flex items-center justify-center text-[10px] font-medium pointer-events-none`}
                    style={{
                      left: c.x * scaleX,
                      top: yTop * scaleY,
                      width: c.largura * scaleX,
                      height: c.altura * scaleY,
                    }}
                  >
                    <Icone className="h-3 w-3 mr-0.5" />
                    {c.tipo}
                  </div>
                );
              })}
          </div>
        </Document>
      </CardContent>
    </Card>
  );
}
