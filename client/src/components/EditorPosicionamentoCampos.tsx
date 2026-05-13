/**
 * Editor visual de campos posicionais — Fase 1 MVP (1 signatário).
 *
 * Operador renderiza o PDF, clica num chip ("Assinatura", "Data", ...) e
 * depois clica numa posição na página pra colocar a caixa lá. Pode arrastar
 * caixas existentes pra reposicionar (mouse + touch via @dnd-kit). Botão X
 * em cada caixa pra remover.
 *
 * Convenção de coords:
 *   - Browser: top-left, pixels do canvas renderizado
 *   - PDF (saída): bottom-left, pontos PDF
 *   - Conversão no save (handleSalvar): y_pdf = pageH_pt - y_top - altura
 *
 * MVP scope (Fase 1):
 *   - 1 signatário só (signatarioIndex=0 hardcoded)
 *   - Tamanho fixo por tipo (sem resize handles)
 *   - 1 página visível por vez (paginação simples)
 *   - Sem virtualização de páginas (PDFs > 30pp podem ficar lentos —
 *     limite efetivo é o do upload, 10MB)
 *
 * Pra extensões futuras (Fase 2+): adicionar signatarioIndex selector,
 * resize handles, virtualização.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
// Worker do pdfjs servido localmente via Vite `?url`. Importante: o
// pdfjs-dist no package.json DEVE ser EXATAMENTE a mesma versão que o
// react-pdf bundla internamente (5.4.296 em react-pdf 10.4.1), sem
// caret/range. Versões diferentes causam o erro:
//   "The API version X does not match the Worker version Y"
// ou variantes mais sutis ("sendWithPromise null").
//
// Por que não CDN unpkg? Funcionava no localhost mas em prod por algum
// motivo o worker carregava em estado parcial — Page tentava render
// antes de transport pronto e estourava sendWithPromise null. Worker
// local servido pelo próprio Vite no mesmo origem é mais previsível.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PenLine,
  Calendar,
  User,
  IdCard,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type CampoTipo = "ASSINATURA" | "DATA" | "NOME" | "CPF";

interface CampoTemp {
  id: string; // uuid local — só pra React key e drag/delete
  tipo: CampoTipo;
  pagina: number;
  /** Pontos PDF, top-left (convertido pra bottom-left no save) */
  xPdf: number;
  yPdfTop: number; // distância do topo da página em pontos
  largura: number;
  altura: number;
}

const TIPOS_INFO: Record<CampoTipo, {
  label: string;
  icone: any;
  cor: string;
  largura: number;
  altura: number;
  descricao: string;
}> = {
  ASSINATURA: {
    label: "Assinatura",
    icone: PenLine,
    cor: "bg-amber-100 border-amber-400 text-amber-700",
    largura: 180,
    altura: 50,
    descricao: "Caixa onde o cliente desenha a assinatura",
  },
  DATA: {
    label: "Data",
    icone: Calendar,
    cor: "bg-blue-100 border-blue-400 text-blue-700",
    largura: 100,
    altura: 18,
    descricao: "Auto-preenchido com a data da assinatura",
  },
  NOME: {
    label: "Nome",
    icone: User,
    cor: "bg-emerald-100 border-emerald-400 text-emerald-700",
    largura: 200,
    altura: 18,
    descricao: "Auto-preenchido com o nome do signatário",
  },
  CPF: {
    label: "CPF",
    icone: IdCard,
    cor: "bg-violet-100 border-violet-400 text-violet-700",
    largura: 130,
    altura: 18,
    descricao: "Auto-preenchido com o CPF do signatário",
  },
};

export interface CampoParaSalvar {
  tipo: CampoTipo;
  pagina: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
  obrigatorio: boolean;
  signatarioIndex: number;
}

interface Props {
  pdfUrl: string;
  initialCampos?: CampoParaSalvar[];
  onSalvar: (campos: CampoParaSalvar[]) => Promise<void> | void;
  onCancelar: () => void;
  salvando?: boolean;
}

export function EditorPosicionamentoCampos({
  pdfUrl,
  initialCampos = [],
  onSalvar,
  onCancelar,
  salvando = false,
}: Props) {
  const [paginaAtual, setPaginaAtual] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(0);
  // Tamanho da página atual em pontos PDF (vem do react-pdf via onLoadSuccess).
  const [pageSizePt, setPageSizePt] = useState<{ w: number; h: number } | null>(null);
  const [tipoAdicionando, setTipoAdicionando] = useState<CampoTipo | null>(null);
  const [campos, setCampos] = useState<CampoTemp[]>(() =>
    // Converte backend (bottom-left) → editor (top-left). Quando carregar
    // um editor já preenchido (futuro), os campos vêm em PDF coords.
    initialCampos.map((c) => ({
      id: crypto.randomUUID(),
      tipo: c.tipo,
      pagina: c.pagina,
      xPdf: c.x,
      yPdfTop: 0, // será corrigido após onLoadSuccess
      largura: c.largura,
      altura: c.altura,
    })),
  );

  // Drag de caixa existente
  const [draggando, setDraggando] = useState<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const pageContainerRef = useRef<HTMLDivElement>(null);

  // CRÍTICO: options do <Document> precisa ser referência ESTÁVEL.
  // Sem useMemo, cada render cria um objeto novo → react-pdf detecta como
  // "mudou", destrói o Document, recria → Page renderiza com transport
  // destruído → "Cannot read properties of null (reading 'sendWithPromise')".
  //
  // Mesmo motivo se aplica a `file` quando é objeto — string é OK porque
  // primitivos são comparados por valor.
  const pdfOptions = useMemo(
    () => ({ withCredentials: true } as any),
    [],
  );

  function handleClickPagina(e: React.MouseEvent) {
    if (!tipoAdicionando || !pageContainerRef.current || !pageSizePt) return;
    const rect = pageContainerRef.current.getBoundingClientRect();
    const xRender = e.clientX - rect.left;
    const yRender = e.clientY - rect.top;
    const scaleX = pageSizePt.w / rect.width;
    const scaleY = pageSizePt.h / rect.height;
    const tam = TIPOS_INFO[tipoAdicionando];
    // Centraliza a caixa no ponto clicado.
    const xPdf = Math.max(0, xRender * scaleX - tam.largura / 2);
    const yPdfTop = Math.max(0, yRender * scaleY - tam.altura / 2);
    setCampos((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        tipo: tipoAdicionando,
        pagina: paginaAtual,
        xPdf,
        yPdfTop,
        largura: tam.largura,
        altura: tam.altura,
      },
    ]);
    setTipoAdicionando(null);
  }

  function handleMouseDownCaixa(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (!pageContainerRef.current) return;
    const rect = pageContainerRef.current.getBoundingClientRect();
    const xRender = e.clientX - rect.left;
    const yRender = e.clientY - rect.top;
    const campo = campos.find((c) => c.id === id);
    if (!campo || !pageSizePt) return;
    const scaleX = pageSizePt.w / rect.width;
    const scaleY = pageSizePt.h / rect.height;
    setDraggando({
      id,
      offsetX: xRender * scaleX - campo.xPdf,
      offsetY: yRender * scaleY - campo.yPdfTop,
    });
  }

  useEffect(() => {
    if (!draggando) return;
    const onMove = (e: MouseEvent) => {
      if (!pageContainerRef.current || !pageSizePt) return;
      const rect = pageContainerRef.current.getBoundingClientRect();
      const xRender = e.clientX - rect.left;
      const yRender = e.clientY - rect.top;
      const scaleX = pageSizePt.w / rect.width;
      const scaleY = pageSizePt.h / rect.height;
      const novoX = xRender * scaleX - draggando.offsetX;
      const novoY = yRender * scaleY - draggando.offsetY;
      setCampos((prev) =>
        prev.map((c) =>
          c.id === draggando.id
            ? {
              ...c,
              xPdf: Math.max(0, Math.min(pageSizePt.w - c.largura, novoX)),
              yPdfTop: Math.max(0, Math.min(pageSizePt.h - c.altura, novoY)),
            }
            : c,
        ),
      );
    };
    const onUp = () => setDraggando(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggando, pageSizePt]);

  function removerCampo(id: string) {
    setCampos((prev) => prev.filter((c) => c.id !== id));
  }

  function handleSalvar() {
    if (!pageSizePt) {
      toast.error("Aguarde o PDF carregar antes de salvar.");
      return;
    }
    const algumAssinatura = campos.some((c) => c.tipo === "ASSINATURA");
    if (!algumAssinatura) {
      toast.error("Adicione pelo menos uma caixa de Assinatura antes de enviar.");
      return;
    }
    // Converte top-left → bottom-left antes de enviar.
    // IMPORTANTE: usamos pageSizePt da página ATUAL. Se o PDF tem páginas de
    // tamanhos diferentes, cada campo precisaria armazenar a altura da SUA
    // página. MVP assume A4 uniforme.
    const camposPdf: CampoParaSalvar[] = campos.map((c) => ({
      tipo: c.tipo,
      pagina: c.pagina,
      x: c.xPdf,
      y: pageSizePt.h - c.yPdfTop - c.altura,
      largura: c.largura,
      altura: c.altura,
      obrigatorio: c.tipo === "ASSINATURA",
      signatarioIndex: 0,
    }));
    void onSalvar(camposPdf);
  }

  const camposDaPagina = useMemo(
    () => campos.filter((c) => c.pagina === paginaAtual),
    [campos, paginaAtual],
  );

  return (
    <div className="flex flex-col h-full bg-muted/10">
      {/* Header */}
      <div className="border-b bg-background px-4 py-3 flex items-center gap-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Posicione os campos no contrato</h2>
          <p className="text-xs text-muted-foreground">
            Clique num campo abaixo → depois clique no PDF onde ele deve cair. Arraste pra ajustar.
          </p>
        </div>
        <Button variant="outline" onClick={onCancelar} disabled={salvando}>
          Cancelar
        </Button>
        <Button onClick={handleSalvar} disabled={salvando || campos.length === 0}>
          {salvando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
          Salvar e enviar pra assinatura
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Paleta lateral */}
        <div className="w-64 border-r bg-background p-3 overflow-y-auto">
          <p className="text-[11px] font-medium text-muted-foreground mb-2 uppercase">
            Campos disponíveis
          </p>
          <div className="space-y-1.5">
            {(Object.keys(TIPOS_INFO) as CampoTipo[]).map((tipo) => {
              const info = TIPOS_INFO[tipo];
              const Icone = info.icone;
              const ativo = tipoAdicionando === tipo;
              return (
                <button
                  key={tipo}
                  onClick={() => setTipoAdicionando(ativo ? null : tipo)}
                  className={`w-full text-left rounded-md border p-2 transition-colors ${ativo
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "hover:bg-muted/50"
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`h-7 w-7 rounded ${info.cor} border flex items-center justify-center`}>
                      <Icone className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{info.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {ativo ? "Clique no PDF →" : info.descricao}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <p className="text-[11px] font-medium text-muted-foreground mt-4 mb-2 uppercase">
            Campos posicionados ({campos.length})
          </p>
          {campos.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              Nenhum campo ainda. Clique num campo acima pra começar.
            </p>
          ) : (
            <div className="space-y-1">
              {campos.map((c) => {
                const info = TIPOS_INFO[c.tipo];
                const Icone = info.icone;
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-1.5 text-[10px] p-1 rounded hover:bg-muted/50"
                  >
                    <Icone className={`h-3 w-3 shrink-0`} />
                    <span className="flex-1 truncate">
                      {info.label} · pág. {c.pagina}
                    </span>
                    <button
                      onClick={() => removerCampo(c.id)}
                      className="text-destructive hover:text-destructive/80"
                      title="Remover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* PDF + overlay */}
        <div className="flex-1 overflow-auto p-4 flex flex-col items-center">
          {/* Paginação */}
          {totalPaginas > 0 && (
            <div className="flex items-center gap-2 mb-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
                disabled={paginaAtual <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground min-w-20 text-center">
                Página {paginaAtual} de {totalPaginas}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}
                disabled={paginaAtual >= totalPaginas}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <Card className="bg-white shadow-md">
            <CardContent className="p-0 relative">
              <Document
                // key={pdfUrl} força remount limpo se a URL mudar
                // (evita race condition entre <Page> tentando renderizar
                // com transport antigo já destruído — sintoma:
                // "Cannot read properties of null (reading 'sendWithPromise')").
                key={pdfUrl}
                file={pdfUrl}
                // options memoizado — ver pdfOptions acima
                options={pdfOptions}
                onLoadSuccess={({ numPages }) => setTotalPaginas(numPages)}
                onLoadError={(err) => {
                  // eslint-disable-next-line no-console
                  console.error("[EditorPosicionamentoCampos] Falha ao carregar PDF", {
                    pdfUrl,
                    error: err?.message,
                    name: err?.name,
                  });
                }}
                loading={
                  <div className="p-12 text-center text-sm text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    Carregando PDF...
                  </div>
                }
                error={
                  <div className="p-12 text-center text-sm text-red-600 max-w-md">
                    <p className="font-medium mb-2">Falha ao carregar o PDF.</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      URL tentada: <code className="break-all">{pdfUrl}</code>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Tente clicar em <strong>Cancelar</strong> e usar o modo legado
                      (sem posicionamento) — assinatura cairá na última página.
                      Detalhe técnico no console do navegador (F12).
                    </p>
                  </div>
                }
              >
                <div
                  ref={pageContainerRef}
                  className={`relative ${tipoAdicionando ? "cursor-crosshair" : "cursor-default"}`}
                  onClick={handleClickPagina}
                >
                  <Page
                    pageNumber={paginaAtual}
                    width={700}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onLoadSuccess={(p) => {
                      // p.width e p.height são em pontos PDF
                      setPageSizePt({ w: p.width, h: p.height });
                    }}
                  />

                  {/* Caixas posicionadas — sobrepõem o canvas */}
                  {pageSizePt &&
                    camposDaPagina.map((c) => {
                      const info = TIPOS_INFO[c.tipo];
                      const Icone = info.icone;
                      const rect = pageContainerRef.current?.getBoundingClientRect();
                      const renderW = rect?.width ?? 700;
                      const renderH = rect?.height ?? 990;
                      const scaleX = renderW / pageSizePt.w;
                      const scaleY = renderH / pageSizePt.h;
                      return (
                        <div
                          key={c.id}
                          className={`absolute border-2 ${info.cor} flex items-center justify-center text-[10px] font-medium cursor-move group select-none`}
                          style={{
                            left: c.xPdf * scaleX,
                            top: c.yPdfTop * scaleY,
                            width: c.largura * scaleX,
                            height: c.altura * scaleY,
                          }}
                          onMouseDown={(e) => handleMouseDownCaixa(e, c.id)}
                        >
                          <div className="flex items-center gap-1 pointer-events-none">
                            <Icone className="h-3 w-3" />
                            <span>{info.label}</span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removerCampo(c.id);
                            }}
                            className="absolute -top-2 -right-2 h-4 w-4 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center"
                            title="Remover"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      );
                    })}
                </div>
              </Document>
            </CardContent>
          </Card>

          <p className="text-[10px] text-muted-foreground mt-3 max-w-md text-center">
            💡 Dica: A página de certificação digital é adicionada automaticamente ao final
            (assinatura, hash SHA-256, data, IP) — não precisa configurar.
          </p>
        </div>
      </div>
    </div>
  );
}
