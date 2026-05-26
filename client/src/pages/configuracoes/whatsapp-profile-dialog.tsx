/**
 * Dialog de edição do Business Profile do número WhatsApp Cloud API.
 *
 * Lê o perfil atual via `whatsappCloud.getPerfil` e permite editar descrição,
 * endereço, email, site, "sobre" e categoria (vertical) do negócio.
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save, UserCircle } from "lucide-react";
import { toast } from "sonner";
import { WA_VERTICAIS_LABELS } from "@shared/whatsapp-cloud-types";
import type { WAVerticalNegocio } from "@shared/whatsapp-cloud-types";

interface Props {
  open: boolean;
  onClose: () => void;
  canalId: number;
  canEdit: boolean;
}

export function WhatsAppProfileDialog({ open, onClose, canalId, canEdit }: Props) {
  const [about, setAbout] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [vertical, setVertical] = useState<WAVerticalNegocio>("PROF_SERVICES");

  const { data, isLoading, error } = trpc.whatsappCloud.getPerfil.useQuery(
    { canalId },
    { enabled: open, retry: false },
  );

  useEffect(() => {
    if (!data) return;
    setAbout(data.about || "");
    setDescription(data.description || "");
    setAddress(data.address || "");
    setEmail(data.email || "");
    setWebsite(data.websites?.[0] || "");
    if (data.vertical) setVertical(data.vertical);
  }, [data]);

  const salvarMut = trpc.whatsappCloud.atualizarPerfil.useMutation({
    onSuccess: () => {
      toast.success("Perfil atualizado!");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-emerald-600" />
            Perfil do número
          </DialogTitle>
          <DialogDescription>
            Informações exibidas no perfil de negócio do seu WhatsApp.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando perfil...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {(error as any).message}
          </div>
        )}

        {!isLoading && !error && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Sobre (status)</Label>
              <Input
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                maxLength={139}
                placeholder="Ex.: Advocacia especializada"
                disabled={!canEdit}
                className="text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Descrição</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={512}
                rows={3}
                disabled={!canEdit}
                className="text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Endereço</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={256}
                disabled={!canEdit}
                className="text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={128}
                  disabled={!canEdit}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Categoria</Label>
                <Select
                  value={vertical}
                  onValueChange={(v) => setVertical(v as WAVerticalNegocio)}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WA_VERTICAIS_LABELS.map((v) => (
                      <SelectItem key={v.value} value={v.value}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Site</Label>
              <Input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://..."
                disabled={!canEdit}
                className="text-sm"
              />
            </div>

            {canEdit && (
              <Button
                className="w-full"
                disabled={salvarMut.isPending}
                onClick={() =>
                  salvarMut.mutate({
                    canalId,
                    about,
                    description,
                    address,
                    email: email || "",
                    vertical,
                    websites: website.trim() ? [website.trim()] : [],
                  })
                }
              >
                {salvarMut.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Salvar perfil
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
