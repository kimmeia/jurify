/**
 * CofreCredenciais — UI de gerenciamento das credenciais que o motor
 * próprio usa pra acessar tribunais autenticados (E-SAJ TJCE, etc).
 *
 * Acesso: admin only + ambiente staging (gateado no backend).
 *
 * Fluxo:
 *  1. Admin abre essa página, clica "Nova credencial"
 *  2. Modal pede: sistema (TJCE/TJSP/...), apelido, OAB/CPF, senha,
 *     opcionalmente o secret TOTP da app autenticadora (Google
 *     Authenticator etc — a string base32 que sai junto do QR code)
 *  3. Backend criptografa AES-256-GCM e salva em `cofre_credenciais`
 *  4. Status inicial = "validando" (login real será testado quando o
 *     adapter ESAJ estiver pronto)
 *  5. Admin pode "Validar" (re-tenta login), "Remover" (soft delete)
 *
 * SEGURANÇA: senha e TOTP secret NUNCA voltam ao frontend depois de
 * cadastrados — só `usernameMascarado` e flags de status.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertTriangle, CheckCircle2, Clock, Eye, EyeOff, KeyRound, Loader2, Lock,
  Plus, RefreshCw, ShieldCheck, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { SISTEMAS_COFRE_LABELS, type SistemaCofre } from "@shared/cofre-credenciais-types";

const STATUS_BADGE: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  validando: {
    label: "Validando",
    className: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    icon: <Clock className="h-3 w-3" />,
  },
  ativa: {
    label: "Ativa",
    className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  erro: {
    label: "Erro",
    className: "bg-red-500/15 text-red-700 border-red-500/30",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  expirada: {
    label: "Expirada",
    className: "bg-orange-500/15 text-orange-700 border-orange-500/30",
    icon: <AlertTriangle className="h-3 w-3" />,
  },
  removida: {
    label: "Removida",
    className: "bg-slate-500/15 text-slate-700 border-slate-500/30",
    icon: <Trash2 className="h-3 w-3" />,
  },
};

export default function CofreCredenciais() {
  const [dialogAberto, setDialogAberto] = useState(false);
  const [secretAutoConfigurado, setSecretAutoConfigurado] = useState<string | null>(null);

  const listaQuery = (trpc as any).cofreCredenciais.listar.useQuery();
  const removerMut = (trpc as any).cofreCredenciais.remover.useMutation({
    onSuccess: () => {
      toast.success("Credencial removida");
      listaQuery.refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });
  const validarMut = (trpc as any).cofreCredenciais.validar.useMutation({
    onSuccess: (data: any) => {
      if (data.ok) toast.success(data.mensagem || "Credencial validada");
      else toast.info(data.mensagem || "Validação ainda não implementada");

      // Se 2FA foi auto-configurado pelo robô, mostra modal proeminente
      // com o secret pra usuário cadastrar no app autenticador dele.
      if (data.totpSecretConfigurado) {
        setSecretAutoConfigurado(data.totpSecretConfigurado);
      }

      listaQuery.refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const credenciais = listaQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-blue-600" />
            Cofre de Credenciais
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Credenciais (CPF/OAB + senha + 2FA) que o motor próprio usa pra acessar
            tribunais autenticados como E-SAJ TJCE. Tudo criptografado com AES-256-GCM.
            Backend nunca expõe senha ou TOTP em claro.
          </p>
        </div>
        <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nova credencial
            </Button>
          </DialogTrigger>
          <NovaCredencialDialog
            onCriado={() => {
              setDialogAberto(false);
              listaQuery.refetch();
            }}
          />
        </Dialog>
      </div>

      {secretAutoConfigurado && (
        <Dialog open={!!secretAutoConfigurado} onOpenChange={(o) => !o && setSecretAutoConfigurado(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                2FA configurado automaticamente
              </DialogTitle>
              <DialogDescription>
                O Keycloak forçou a configuração inicial de 2FA — o robô concluiu por você.
                Pra você também conseguir logar manualmente no PJe TJCE quando precisar,
                cadastre o secret abaixo no seu Google Authenticator / Authy.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Secret base32 (cadastre no app autenticador)
                </Label>
                <div className="mt-1 p-3 bg-amber-50 border border-amber-300 rounded font-mono text-sm break-all select-all">
                  {secretAutoConfigurado}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    navigator.clipboard.writeText(secretAutoConfigurado);
                    toast.success("Secret copiado pra clipboard");
                  }}
                >
                  Copiar secret
                </Button>
              </div>
              <Alert className="border-amber-500/40 bg-amber-50/40">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-sm">Importante</AlertTitle>
                <AlertDescription className="text-xs leading-relaxed">
                  Esse secret é equivalente à sua senha 2FA permanente. Não compartilhe.
                  Já está salvo criptografado no nosso cofre — robô consegue logar sozinho.
                  Adicione no seu app autenticador também caso queira logar manualmente
                  no PJe TJCE pelo navegador.
                </AlertDescription>
              </Alert>
              <div className="text-xs text-muted-foreground">
                <strong>Como adicionar no app:</strong> Google Authenticator → "+" → "Inserir
                chave de configuração" → cola o secret + dá um nome (ex: "PJe TJCE"). Authy:
                "+" → "Add account" → "Enter setup key manually" → cola.
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => setSecretAutoConfigurado(null)}>Entendi, fechar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Alert className="border-blue-500/30 bg-blue-50/30">
        <ShieldCheck className="h-4 w-4 text-blue-600" />
        <AlertTitle>Como obter o TOTP secret da app autenticadora</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          Quando você ativa 2FA no E-SAJ pela primeira vez, o tribunal mostra um QR Code
          + uma string base32 (~16 caracteres). É essa <strong>string</strong>, não o código
          de 6 dígitos, que você cola no campo "Secret TOTP". Sem ela, o robô não consegue
          gerar o código atual sozinho durante o login. Se você já passou dessa tela e não
          guardou o secret, use a opção do tribunal de "Reconfigurar 2FA" pra ver de novo.
        </AlertDescription>
      </Alert>

      {listaQuery.isLoading && <SkeletonLista />}

      {!listaQuery.isLoading && listaQuery.error && (
        <Card className="border-red-500/30 bg-red-50/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Falha ao carregar credenciais
            </CardTitle>
            <CardDescription>{(listaQuery.error as any).message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!listaQuery.isLoading && credenciais.length === 0 && !listaQuery.error && (
        <Card>
          <CardContent className="py-12 text-center">
            <Lock className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">
              Nenhuma credencial cadastrada ainda. Clique em <strong>Nova credencial</strong> pra começar.
            </p>
          </CardContent>
        </Card>
      )}

      {credenciais.length > 0 && (
        <div className="space-y-3">
          {credenciais.map((c: any) => {
            const status = STATUS_BADGE[c.status] || STATUS_BADGE.validando;
            const sistemaLabel = SISTEMAS_COFRE_LABELS[c.sistema as SistemaCofre]?.label || c.sistema;
            const sistemaDesc = SISTEMAS_COFRE_LABELS[c.sistema as SistemaCofre]?.descricao;

            return (
              <Card key={c.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">{c.apelido}</h3>
                        <Badge variant="outline" className={status.className}>
                          {status.icon}
                          <span className="ml-1">{status.label}</span>
                        </Badge>
                        {c.tem2fa && (
                          <Badge variant="outline" className="bg-purple-500/15 text-purple-700 border-purple-500/30">
                            2FA
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>
                          <strong>Sistema:</strong> <span className="font-mono">{c.sistema}</span> — {sistemaLabel}
                        </div>
                        {sistemaDesc && <div className="opacity-70">{sistemaDesc}</div>}
                        <div>
                          <strong>Username:</strong> <span className="font-mono">{c.usernameMascarado}</span>
                        </div>
                        {c.ultimoLoginSucessoEm && (
                          <div>
                            <strong>Último login OK:</strong>{" "}
                            {new Date(c.ultimoLoginSucessoEm).toLocaleString("pt-BR")}
                          </div>
                        )}
                        {c.ultimoErro && (
                          <div className="text-amber-700 mt-1">
                            <strong>Último aviso:</strong> {c.ultimoErro}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => validarMut.mutate({ id: c.id })}
                        disabled={validarMut.isPending}
                      >
                        <RefreshCw className={`mr-1 h-3 w-3 ${validarMut.isPending ? "animate-spin" : ""}`} />
                        Validar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (!confirm(`Remover credencial "${c.apelido}"? (soft delete — pode ser recuperada manualmente)`)) return;
                          removerMut.mutate({ id: c.id });
                        }}
                        disabled={removerMut.isPending}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Remover
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NovaCredencialDialog({ onCriado }: { onCriado: () => void }) {
  const [sistema, setSistema] = useState<string>("esaj_tjce");
  const [apelido, setApelido] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const criarMut = (trpc as any).cofreCredenciais.criar.useMutation({
    onSuccess: () => {
      toast.success("Credencial cadastrada — valide via login real quando o adapter ESAJ estiver pronto.");
      setApelido("");
      setUsername("");
      setPassword("");
      setTotpSecret("");
      onCriado();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!apelido.trim() || !username.trim() || !password.trim()) {
      toast.error("Preencha apelido, username e senha");
      return;
    }
    criarMut.mutate({
      sistema,
      apelido: apelido.trim(),
      username: username.trim(),
      password,
      totpSecret: totpSecret.trim() || undefined,
    });
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Nova credencial</DialogTitle>
        <DialogDescription>
          Tudo aqui é criptografado com AES-256-GCM antes de tocar disco. Backend nunca exibe senha em claro depois.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sistema">Sistema do tribunal</Label>
          <Select value={sistema} onValueChange={setSistema}>
            <SelectTrigger id="sistema">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SISTEMAS_COFRE_LABELS).map(([codigo, info]) => (
                <SelectItem key={codigo} value={codigo}>
                  <span className="font-medium">{info.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{info.descricao}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="apelido">Apelido</Label>
          <Input
            id="apelido"
            placeholder="Ex: Dr. Rafael — TJCE"
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            maxLength={100}
          />
          <p className="text-xs text-muted-foreground">Identificação interna pra você reconhecer essa credencial.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="username">Username (CPF ou OAB)</Label>
          <Input
            id="username"
            placeholder="123.456.789-00"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={64}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Senha do tribunal</Label>
          <div className="relative">
            <Input
              id="password"
              type={mostrarSenha ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setMostrarSenha(!mostrarSenha)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={mostrarSenha ? "Esconder senha" : "Mostrar senha"}
            >
              {mostrarSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="totp">
            Secret TOTP (opcional)
            <span className="text-xs text-muted-foreground ml-2 font-normal">— string base32 da app autenticadora</span>
          </Label>
          <Input
            id="totp"
            type="password"
            placeholder="ex: JBSWY3DPEHPK3PXP..."
            value={totpSecret}
            onChange={(e) => setTotpSecret(e.target.value)}
            maxLength={128}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            É a string que aparece junto do QR code quando você ativa 2FA — NÃO é o código de 6 dígitos.
            Sem isso, o robô não vai conseguir gerar o código atual durante login automatizado.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={criarMut.isPending}>
          {criarMut.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando…
            </>
          ) : (
            "Salvar credencial"
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function SkeletonLista() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="py-4 space-y-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
