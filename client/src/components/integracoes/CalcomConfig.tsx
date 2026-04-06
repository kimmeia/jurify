/**
 * Componente Cal.com Config — Configuração da integração Cal.com
 * Usado dentro da aba "Canais" em Configuracoes.tsx
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Calendar, Loader2, CheckCircle, XCircle, ExternalLink, Clock, Users,
} from "lucide-react";
import { toast } from "sonner";

interface CalcomConfigProps {
  canalId: number;
  status: string;
}

export default function CalcomConfig({ canalId, status }: CalcomConfigProps) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://cal.com");
  const [duration, setDuration] = useState(30);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Queries
  const eventTypesQuery = trpc.calcom.eventTypes.useQuery(
    { canalId },
    { enabled: status === "conectado" },
  );
  const bookingsQuery = trpc.calcom.bookings.useQuery(
    { canalId, status: "upcoming" },
    { enabled: status === "conectado" },
  );

  // Mutations
  const salvarConfig = trpc.calcom.salvarConfig.useMutation({
    onSuccess: (data) => {
      setSaving(false);
      if (data.teste.ok) {
        toast.success("Cal.com conectado com sucesso!", { description: `Usuário: ${data.teste.user}` });
      } else {
        toast.error("Config salva, mas teste falhou", { description: data.teste.error });
      }
      eventTypesQuery.refetch();
      bookingsQuery.refetch();
    },
    onError: (err) => {
      setSaving(false);
      toast.error("Erro ao salvar configuração", { description: err.message });
    },
  });

  const testarConexao = trpc.calcom.testarConexao.useMutation({
    onSuccess: (data) => {
      setTesting(false);
      if (data.ok) {
        toast.success("Conexão OK!", { description: `Usuário: ${data.user}` });
      } else {
        toast.error("Falha na conexão", { description: data.error });
      }
    },
    onError: (err) => {
      setTesting(false);
      toast.error("Erro", { description: err.message });
    },
  });

  const handleSalvar = () => {
    if (!apiKey.trim()) {
      toast.error("Informe a API Key do Cal.com");
      return;
    }
    setSaving(true);
    salvarConfig.mutate({ canalId, apiKey, baseUrl, defaultDuration: duration });
  };

  const handleTestar = () => {
    setTesting(true);
    testarConexao.mutate({ canalId });
  };

  const isConectado = status === "conectado";

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="flex items-center gap-2">
        <Calendar className="h-5 w-5 text-blue-600" />
        <span className="font-medium">Integração Cal.com</span>
        <Badge variant={isConectado ? "default" : "secondary"} className={isConectado ? "bg-emerald-100 text-emerald-700 border-emerald-200" : ""}>
          {isConectado ? "Conectado" : "Desconectado"}
        </Badge>
      </div>

      {/* Configuração */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Configuração da API</CardTitle>
          <CardDescription className="text-xs">
            Obtenha sua API Key em{" "}
            <a href="https://cal.com/settings/developer/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
              cal.com/settings/developer <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">API Key</Label>
            <Input
              type="password"
              placeholder="cal_live_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">URL Base</Label>
            <Input
              placeholder="https://cal.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use https://cal.com para o serviço cloud, ou sua URL se for self-hosted
            </p>
          </div>
          <div>
            <Label className="text-xs">Duração padrão (minutos)</Label>
            <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 min</SelectItem>
                <SelectItem value="30">30 min</SelectItem>
                <SelectItem value="45">45 min</SelectItem>
                <SelectItem value="60">60 min</SelectItem>
                <SelectItem value="90">90 min</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={handleSalvar} disabled={saving || !apiKey.trim()}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1" />}
              Salvar e Conectar
            </Button>
            {isConectado && (
              <Button size="sm" variant="outline" onClick={handleTestar} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Testar Conexão
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tipos de Evento (quando conectado) */}
      {isConectado && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Tipos de Evento
            </CardTitle>
            <CardDescription className="text-xs">
              Eventos disponíveis para agendamento
            </CardDescription>
          </CardHeader>
          <CardContent>
            {eventTypesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : eventTypesQuery.data && eventTypesQuery.data.length > 0 ? (
              <div className="space-y-2">
                {eventTypesQuery.data.map((et) => (
                  <div key={et.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                    <div>
                      <p className="font-medium">{et.title}</p>
                      <p className="text-xs text-muted-foreground">{et.length} min • /{et.slug}</p>
                    </div>
                    <Badge variant="outline">{et.length} min</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum tipo de evento encontrado. Crie um no Cal.com.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Próximos agendamentos */}
      {isConectado && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4" />
              Próximos Agendamentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bookingsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
              </div>
            ) : bookingsQuery.data && bookingsQuery.data.length > 0 ? (
              <div className="space-y-2">
                {bookingsQuery.data.slice(0, 5).map((b) => (
                  <div key={b.id} className="flex items-center justify-between p-2 rounded-lg border text-sm">
                    <div>
                      <p className="font-medium">{b.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(b.startTime).toLocaleDateString("pt-BR")} às{" "}
                        {new Date(b.startTime).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      {b.attendees?.[0] && (
                        <p className="text-xs text-muted-foreground">{b.attendees[0].name} — {b.attendees[0].email}</p>
                      )}
                    </div>
                    <Badge variant={b.status === "ACCEPTED" ? "default" : "secondary"} className="text-xs">
                      {b.status === "ACCEPTED" ? "Confirmado" : b.status === "PENDING" ? "Pendente" : b.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum agendamento futuro.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
