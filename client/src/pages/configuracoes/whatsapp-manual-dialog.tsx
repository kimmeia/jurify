/**
 * Dialog de cadastro MANUAL de canal WhatsApp Cloud API.
 *
 * Alternativa ao Embedded Signup pra casos onde o OAuth está bloqueado
 * (App Review pendente, Tech Provider não aprovado, BM dona do app = mesma
 * BM dos números, etc). O operador cola accessToken + phoneNumberId + wabaId
 * já obtidos do Meta Business Manager, e o backend valida na Graph API
 * antes de gravar.
 *
 * Quando o OAuth voltar a funcionar, o cliente pode refazer Conectar pelo
 * fluxo normal — o webhook continua casando pelo mesmo phoneNumberId, então
 * dá pra arquivar a manual e usar a do OAuth sem perda de histórico.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, CheckCircle, KeyRound, Phone, Building2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface WhatsappManualDialogProps {
  open: boolean;
  onClose: () => void;
  onConectado?: (canalId: number) => void;
}

export function WhatsappManualDialog({ open, onClose, onConectado }: WhatsappManualDialogProps) {
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [wabaId, setWabaId] = useState("");

  const conectarMut = (trpc as any).configuracoes.conectarWhatsappCloudManual.useMutation({
    onSuccess: (data: { id: number; nome: string; telefone?: string }) => {
      toast.success("WhatsApp Cloud conectado!", {
        description: `${data.nome}${data.telefone ? ` · ${data.telefone}` : ""}`,
      });
      reset();
      onConectado?.(data.id);
      onClose();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const reset = () => {
    setAccessToken("");
    setPhoneNumberId("");
    setWabaId("");
  };

  const handleSubmit = () => {
    if (!accessToken.trim() || !phoneNumberId.trim() || !wabaId.trim()) {
      toast.error("Preencha os 3 campos.");
      return;
    }
    conectarMut.mutate({
      accessToken: accessToken.trim(),
      phoneNumberId: phoneNumberId.trim().replace(/\D/g, ""),
      wabaId: wabaId.trim().replace(/\D/g, ""),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 grid place-items-center text-white text-xs">📥</span>
            Cadastro manual — WhatsApp Cloud API
          </DialogTitle>
          <DialogDescription className="text-xs">
            Pra clientes que já têm o número no Meta Business Manager e podem
            gerar token de usuário do sistema. Bypassa o Embedded Signup —
            útil enquanto o App Review/Tech Provider não tá aprovado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Onde achar — guia rápido */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-[11px] text-amber-900 space-y-1.5">
            <p className="font-semibold flex items-center gap-1">
              <ExternalLink className="h-3 w-3" /> Como conseguir os 3 valores
            </p>
            <ol className="list-decimal ml-4 space-y-0.5">
              <li><b>business.facebook.com</b> → Configurações → Contas → <b>Contas do WhatsApp</b> → seleciona a WABA</li>
              <li><b>WABA ID</b> aparece no topo da página da WABA</li>
              <li><b>Phone Number ID</b>: aba <i>Números de telefone</i> → ID embaixo do número</li>
              <li><b>Access Token</b>: Configurações da empresa → Usuários → <i>Usuários do sistema</i> → cria um system user com acesso à WABA → <b>Gerar novo token</b> (perpétuo ou 60 dias)</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <KeyRound className="h-3 w-3" /> Access Token (System User Token)
            </Label>
            <Textarea
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAJ... (cola o token completo aqui)"
              rows={3}
              className="font-mono text-[11px]"
            />
            <p className="text-[10px] text-muted-foreground">
              Token gerado pelo system user no Meta Business Manager. Recomendado: token perpétuo (system user).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Phone className="h-3 w-3" /> Phone Number ID
              </Label>
              <Input
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="654321098765432"
                className="font-mono text-xs"
                inputMode="numeric"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Building2 className="h-3 w-3" /> WABA ID
              </Label>
              <Input
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                placeholder="123456789012345"
                className="font-mono text-xs"
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-700 flex items-start gap-2">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Antes de salvar, vamos chamar a Graph API com esses valores. Se a
              Meta confirmar (retornar o nome verificado e o número do canal),
              gravamos. Senão, mostramos o erro e nada é salvo.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={conectarMut.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={conectarMut.isPending || !accessToken.trim() || !phoneNumberId.trim() || !wabaId.trim()}
            className="bg-gradient-to-br from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800"
          >
            {conectarMut.isPending
              ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Validando na Meta…</>
              : <><CheckCircle className="h-3.5 w-3.5 mr-1.5" /> Testar e conectar</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
