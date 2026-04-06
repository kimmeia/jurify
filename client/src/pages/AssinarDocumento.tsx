/**
 * Página pública de assinatura digital.
 * Acessada pelo cliente via link (sem login).
 * URL: /assinar/:token
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PenLine, FileText, CheckCircle, XCircle, Clock, Loader2, ExternalLink, ShieldCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

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
  const [concordo, setConcordo] = useState(false);
  const [assinado, setAssinado] = useState(false);

  const { data: doc, isLoading, error } = (trpc as any).assinaturas.visualizarPorToken.useQuery(
    { token },
    { retry: false }
  );

  const assinarMut = (trpc as any).assinaturas.assinarPorToken.useMutation({
    onSuccess: () => {
      setAssinado(true);
      toast.success("Documento assinado com sucesso!");
    },
    onError: (e: any) => toast.error(e.message),
  });

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
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-950 dark:to-gray-900 p-4 flex items-center justify-center">
      <div className="w-full max-w-lg space-y-4">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center mx-auto shadow-lg">
            <PenLine className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Assinatura Digital</h1>
          <p className="text-sm text-muted-foreground">Revise e assine o documento abaixo</p>
        </div>

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
                  onClick={() => assinarMut.mutate({ token, nomeCompleto, concordo })}
                  disabled={!nomeCompleto || nomeCompleto.length < 3 || !concordo || assinarMut.isPending}
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
