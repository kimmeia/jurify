/**
 * Dialogs do módulo Financeiro.
 * Extraídos de Financeiro.tsx para manter a página principal focada em dados/visualização.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Loader2, Copy, CheckCircle2, Repeat, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ClienteCombobox } from "./ClienteCombobox";

function formatBRL(value: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value); }

export function NovaCobrancaDialog({
  open,
  onOpenChange,
  onSuccess,
  contatoIdInicial,
  esconderCliente,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess: () => void;
  /** Se preenchido, o dialog abre já com este cliente selecionado.
   *  Útil pra invocar a partir do popover/ficha do cliente. */
  contatoIdInicial?: number | string;
  /** Quando true, esconde o seletor de cliente (cliente fixo). */
  esconderCliente?: boolean;
}) {
  const [modo, setModo] = useState<"avulsa" | "parcelada" | "recorrente" | "manual">("avulsa");
  const [contatoId, setContatoId] = useState(contatoIdInicial ? String(contatoIdInicial) : ""); const [valor, setValor] = useState(""); const [vencimento, setVencimento] = useState(""); const [forma, setForma] = useState("PIX"); const [descricao, setDescricao] = useState(""); const [parcelas, setParcelas] = useState("2"); const [ciclo, setCiclo] = useState("MONTHLY"); const [resultado, setResultado] = useState<any>(null);
  // Modo manual: campos extras
  const [jaPaga, setJaPaga] = useState(false);
  const [dataPagamento, setDataPagamento] = useState("");
  // Atribuição de comissão — válida pros 3 modos. Em parcelamento/
  // assinatura, a config é persistida e aplicada nas cobranças filhas
  // pelo webhook handler.
  const [atendenteId, setAtendenteId] = useState<string>("auto"); // "auto" = herda do contato no backend
  const [categoriaId, setCategoriaId] = useState<string>("none");
  const [overrideComissao, setOverrideComissao] = useState<"padrao" | "sim" | "nao">("padrao");
  // Ações vinculadas (cliente_processos.id) — multi-select. Quando o
  // pagamento é recebido, o SmartFlow `pagamento_recebido` dispara UMA
  // VEZ por ação, com o contexto da ação. Cobertura do "pacote": cobro
  // R$ 3000 e abro 3 ações.
  const [acoesIds, setAcoesIds] = useState<number[]>([]);

  const { data: equipeData } = trpc.configuracoes.listarColaboradores.useQuery();
  const { data: categoriasList = [] } = trpc.financeiro.listarCategoriasCobranca.useQuery();
  const atendentes = (equipeData && "colaboradores" in equipeData ? equipeData.colaboradores : []).filter((c) => c.cargo !== "estagiario");
  const categoriasAtivas = categoriasList.filter((c) => c.ativo);

  // Lista ações do cliente selecionado pra popular o multi-select.
  // Só carrega se há contatoId — evita chamada desnecessária.
  const contatoIdNum = contatoId ? parseInt(contatoId) : 0;
  const { data: acoesDoCliente = [] } = trpc.clienteProcessos.listar.useQuery(
    { contatoId: contatoIdNum },
    { enabled: contatoIdNum > 0 },
  );

  const criarAvulsaMut = trpc.asaas.criarCobranca.useMutation({ onSuccess: (data) => { setResultado(data.cobranca); toast.success("Cobranca criada"); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message, duration: 8000 }) });
  const criarParcelaMut = trpc.asaas.criarParcelamento.useMutation({ onSuccess: () => { toast.success("Parcelamento criado"); resetForm(); onOpenChange(false); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message, duration: 8000 }) });
  const criarAssinaturaMut = trpc.asaas.criarAssinatura.useMutation({ onSuccess: () => { toast.success("Assinatura criada"); resetForm(); onOpenChange(false); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message, duration: 8000 }) });
  const criarManualMut = (trpc as any).asaas.criarCobrancaManual.useMutation({
    onSuccess: () => {
      toast.success("Cobrança manual registrada");
      resetForm();
      onOpenChange(false);
      onSuccess();
    },
    onError: (err: any) => toast.error("Erro", { description: err.message, duration: 8000 }),
  });
  const isPending = criarAvulsaMut.isPending || criarParcelaMut.isPending || criarAssinaturaMut.isPending || criarManualMut.isPending;
  const resetForm = () => { setContatoId(contatoIdInicial ? String(contatoIdInicial) : ""); setValor(""); setVencimento(""); setForma("PIX"); setDescricao(""); setParcelas("2"); setCiclo("MONTHLY"); setResultado(null); setModo("avulsa"); setAtendenteId("auto"); setCategoriaId("none"); setOverrideComissao("padrao"); setJaPaga(false); setDataPagamento(""); setAcoesIds([]); };
  const handleCriar = () => {
    const overrideMap = { padrao: undefined, sim: true, nao: false } as const;
    const comissaoFields = {
      atendenteId: atendenteId === "auto" ? undefined : parseInt(atendenteId),
      categoriaId: categoriaId === "none" ? undefined : parseInt(categoriaId),
      comissionavelOverride: overrideMap[overrideComissao],
    };
    // Ações vinculadas — só envia se houver pelo menos uma. Recorrente
    // (assinatura) ainda não suporta vínculo de ação por enquanto (cada
    // cobrança gerada vem do webhook do Asaas, não de uma criação local).
    const acoesField = acoesIds.length > 0 ? { processoIds: acoesIds } : {};
    if (modo === "avulsa") {
      criarAvulsaMut.mutate({
        contatoId: parseInt(contatoId),
        valor: parseFloat(valor),
        vencimento,
        formaPagamento: forma as any,
        descricao: descricao || undefined,
        ...comissaoFields,
        ...acoesField,
      });
    } else if (modo === "parcelada") {
      criarParcelaMut.mutate({
        contatoId: parseInt(contatoId),
        valorTotal: parseFloat(valor),
        parcelas: parseInt(parcelas),
        vencimento,
        formaPagamento: forma as any,
        descricao: descricao || undefined,
        ...comissaoFields,
        ...acoesField,
      });
    } else if (modo === "recorrente") {
      criarAssinaturaMut.mutate({
        contatoId: parseInt(contatoId),
        valor: parseFloat(valor),
        proximoVencimento: vencimento,
        ciclo: ciclo as any,
        formaPagamento: forma as any,
        descricao: descricao || undefined,
        ...comissaoFields,
      });
    } else {
      // Manual: não chama Asaas. Pode nascer já paga.
      criarManualMut.mutate({
        contatoId: parseInt(contatoId),
        valor: parseFloat(valor),
        vencimento,
        formaPagamento: forma as any,
        descricao: descricao || undefined,
        ...acoesField,
        jaPaga,
        dataPagamento: jaPaga ? (dataPagamento || undefined) : undefined,
        ...comissaoFields,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova cobranca</DialogTitle></DialogHeader>
        {resultado ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="h-5 w-5" /><span className="font-medium">Cobranca criada</span></div>
            {resultado.invoiceUrl && (<div><p className="text-xs text-muted-foreground">Link de pagamento:</p><div className="flex items-center gap-2 mt-1"><Input value={resultado.invoiceUrl} readOnly className="text-xs font-mono" /><Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(resultado.invoiceUrl); toast.success("Copiado"); }}><Copy className="h-3.5 w-3.5" /></Button></div></div>)}
            {resultado.pixQrCode && (<div className="text-center"><img src={`data:image/png;base64,${resultado.pixQrCode.image}`} alt="Pix" className="mx-auto w-40 h-40 rounded-lg border" /><Button size="sm" variant="ghost" className="text-xs mt-1" onClick={() => { navigator.clipboard.writeText(resultado.pixQrCode.payload); toast.success("Pix copiado"); }}><Copy className="h-3 w-3 mr-1" /> Copiar Pix</Button></div>)}
            <Button className="w-full" onClick={() => { resetForm(); onOpenChange(false); }}>Fechar</Button>
          </div>
        ) : (
          <><div className="space-y-3 py-1">
            <div className="grid grid-cols-4 gap-2">
              <Button variant={modo === "avulsa" ? "default" : "outline"} size="sm" className="text-xs" onClick={() => setModo("avulsa")}>Avulsa</Button>
              <Button variant={modo === "parcelada" ? "default" : "outline"} size="sm" className="text-xs" onClick={() => setModo("parcelada")}>Parcelada</Button>
              <Button variant={modo === "recorrente" ? "default" : "outline"} size="sm" className="text-xs" onClick={() => setModo("recorrente")}><Repeat className="h-3 w-3 mr-1" />Recorrente</Button>
              <Button variant={modo === "manual" ? "default" : "outline"} size="sm" className="text-xs" onClick={() => setModo("manual")} title="Cobrança lançada à mão (sem Asaas) — cliente pagou em dinheiro/cartão presencial">Manual</Button>
            </div>
            {modo === "manual" && (
              <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
                <b>Cobrança manual</b>: lançada sem passar pelo Asaas. Use quando o cliente
                paga presencialmente (dinheiro, cartão na maquininha, transferência) ou
                quando o Asaas estiver desconectado.
              </div>
            )}
            {!esconderCliente && (
              <div><Label className="text-xs">Cliente</Label><ClienteCombobox value={contatoId} onChange={(id) => setContatoId(id)} /></div>
            )}
            {/* Multi-select de ações vinculadas — aparece apenas quando o
                cliente tem pelo menos uma ação cadastrada. Cobre o caso
                "pacote de R$ 3000 ativando 3 ações". Modo recorrente
                (assinatura) não suporta vínculo de ação ainda.
                Ações que já têm cobrança vinculada aparecem desabilitadas
                pra evitar duplicar (faz visual de "ocupado"). */}
            {modo !== "recorrente" && contatoIdNum > 0 && acoesDoCliente.length > 0 && (
              <div>
                <Label className="text-xs">Ações vinculadas (opcional)</Label>
                <p className="text-[10px] text-muted-foreground mb-1.5">
                  Marque quais ações esta cobrança ativa. Quando paga, o SmartFlow
                  dispara <b>uma execução por ação</b> com dados da ação no contexto
                  ({"{{acaoApelido}}"}, {"{{acaoTipo}}"}, etc).
                </p>
                <div className="space-y-1 max-h-36 overflow-y-auto rounded border p-1.5">
                  {acoesDoCliente.map((acao: any) => {
                    const checked = acoesIds.includes(acao.id);
                    const jaVinculada = (acao.cobrancasTotal ?? 0) > 0;
                    const tooltipMotivo = jaVinculada
                      ? `Esta ação já tem ${acao.cobrancasTotal} cobrança(s) vinculada(s)` +
                        (acao.cobrancasPendentes > 0
                          ? ` (${acao.cobrancasPendentes} aberta${acao.cobrancasPendentes > 1 ? "s" : ""})`
                          : "") +
                        ". Pra cobrar de novo, cadastre uma ação separada."
                      : "";
                    return (
                      <label
                        key={acao.id}
                        title={tooltipMotivo}
                        className={`flex items-center gap-2 px-1.5 py-1 rounded text-xs ${
                          jaVinculada
                            ? "opacity-50 cursor-not-allowed bg-muted/40"
                            : "hover:bg-accent cursor-pointer"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={jaVinculada}
                          onChange={() => {
                            if (jaVinculada) return;
                            setAcoesIds((prev) =>
                              checked ? prev.filter((id) => id !== acao.id) : [...prev, acao.id],
                            );
                          }}
                          className="h-3.5 w-3.5 cursor-pointer disabled:cursor-not-allowed"
                        />
                        <span className="flex-1 truncate">
                          <b>{acao.apelido || acao.numeroCnj}</b>
                          {acao.tipo && (
                            <span className="ml-1.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                              {acao.tipo}
                            </span>
                          )}
                          {acao.classe && (
                            <span className="ml-1.5 text-[10px] text-muted-foreground">
                              {acao.classe}
                            </span>
                          )}
                        </span>
                        {jaVinculada && (
                          <span className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1 py-0 text-[9px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                            ✓ vinculada
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">{modo === "parcelada" ? "Valor total (R$)" : "Valor (R$)"}</Label><Input type="number" step="0.01" min="0.01" placeholder="150.00" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">{modo === "recorrente" ? "Primeiro vencimento" : "Vencimento"}</Label><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="mt-1" /></div></div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Forma</Label>
                <Select value={forma} onValueChange={setForma}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PIX">Pix</SelectItem>
                    <SelectItem value="BOLETO">Boleto</SelectItem>
                    <SelectItem value="CREDIT_CARD">Cartão</SelectItem>
                    {modo !== "manual" && <SelectItem value="UNDEFINED">Cliente escolhe</SelectItem>}
                    {modo === "manual" && <SelectItem value="DINHEIRO">Dinheiro</SelectItem>}
                    {modo === "manual" && <SelectItem value="TRANSFERENCIA">Transferência</SelectItem>}
                    {modo === "manual" && <SelectItem value="OUTRO">Outro</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              {modo === "parcelada" && (
                <div>
                  <Label className="text-xs">Parcelas</Label>
                  <Input type="number" min="2" max="24" value={parcelas} onChange={(e) => setParcelas(e.target.value)} className="mt-1" />
                </div>
              )}
              {modo === "recorrente" && (
                <div>
                  <Label className="text-xs">Ciclo</Label>
                  <Select value={ciclo} onValueChange={setCiclo}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WEEKLY">Semanal</SelectItem>
                      <SelectItem value="BIWEEKLY">Quinzenal</SelectItem>
                      <SelectItem value="MONTHLY">Mensal</SelectItem>
                      <SelectItem value="QUARTERLY">Trimestral</SelectItem>
                      <SelectItem value="SEMIANNUALLY">Semestral</SelectItem>
                      <SelectItem value="YEARLY">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {modo === "manual" && (
              <div className="space-y-2 pt-2 border-t">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={jaPaga}
                    onChange={(e) => setJaPaga(e.target.checked)}
                    className="h-4 w-4 accent-primary cursor-pointer"
                  />
                  <span className="text-xs">Já recebida</span>
                </label>
                {jaPaga && (
                  <div>
                    <Label className="text-xs">Data do pagamento</Label>
                    <Input
                      type="date"
                      value={dataPagamento}
                      onChange={(e) => setDataPagamento(e.target.value)}
                      placeholder="Hoje"
                      className="mt-1"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Vazio = hoje. Cobrança nasce com status "Recebido".
                    </p>
                  </div>
                )}
              </div>
            )}
            {modo === "parcelada" && valor && parcelas && <p className="text-xs text-muted-foreground">{parseInt(parcelas)}x de {formatBRL(parseFloat(valor) / parseInt(parcelas))}</p>}
            {modo === "parcelada" && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
                <b>Como funciona</b>: serão criadas {parcelas || "N"} cobranças avulsas com vencimentos
                mensais sequenciais. <b>Cada parcela é independente</b> — o cliente pode pagar
                cada uma com método diferente (PIX, boleto, cartão).
              </div>
            )}
            {/* Validação preventiva: vencimento não pode ser data passada */}
            {vencimento && vencimento < new Date().toISOString().slice(0, 10) && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
                ⚠️ Vencimento não pode ser uma data passada. Escolha uma data futura.
              </div>
            )}
            <div><Label className="text-xs">Descricao</Label><Input placeholder="Honorarios" value={descricao} onChange={(e) => setDescricao(e.target.value)} className="mt-1" /></div>
            <div className="space-y-2 pt-2 border-t">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Comissão</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Atendente</Label>
                  <Select value={atendenteId} onValueChange={setAtendenteId}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Padrão do cliente</SelectItem>
                      {atendentes.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.userName ?? "—"} ({c.cargo})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Categoria</Label>
                  <Select value={categoriaId} onValueChange={setCategoriaId}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem categoria</SelectItem>
                      {categoriasAtivas.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.nome}{c.comissionavel ? "" : " (não comissionável)"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Conta na comissão?</Label>
                <Select value={overrideComissao} onValueChange={(v) => setOverrideComissao(v as any)}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="padrao">Padrão da categoria</SelectItem>
                    <SelectItem value="sim">Sim (forçar)</SelectItem>
                    <SelectItem value="nao">Não (ignorar)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {modo !== "avulsa" && (
                <p className="text-[10px] text-muted-foreground italic">
                  Aplicado automaticamente em todas as {modo === "parcelada" ? "parcelas" : "cobranças recorrentes"} geradas.
                </p>
              )}
            </div>
          </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={handleCriar} disabled={isPending || !contatoId || !valor || !vencimento || (vencimento < new Date().toISOString().slice(0, 10))}>{isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}{modo === "parcelada" ? `Parcelar ${parcelas}x` : modo === "recorrente" ? "Criar assinatura" : "Criar"}</Button></DialogFooter></>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function NovaAssinaturaDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
  const [contatoId, setContatoId] = useState(""); const [valor, setValor] = useState(""); const [vencimento, setVencimento] = useState(""); const [ciclo, setCiclo] = useState("MONTHLY"); const [forma, setForma] = useState("PIX"); const [descricao, setDescricao] = useState("");
  const criarMut = trpc.asaas.criarAssinatura.useMutation({ onSuccess: () => { toast.success("Assinatura criada"); setContatoId(""); setValor(""); setVencimento(""); setDescricao(""); onOpenChange(false); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message }) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Nova assinatura</DialogTitle><DialogDescription>Cobranca recorrente automatica.</DialogDescription></DialogHeader>
      <div className="space-y-3 py-1">
        <div><Label className="text-xs">Cliente</Label><ClienteCombobox value={contatoId} onChange={(id) => setContatoId(id)} /></div>
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Valor (R$)</Label><Input type="number" step="0.01" min="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">Proximo vencimento</Label><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className="mt-1" /></div></div>
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Ciclo</Label><Select value={ciclo} onValueChange={setCiclo}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="WEEKLY">Semanal</SelectItem><SelectItem value="BIWEEKLY">Quinzenal</SelectItem><SelectItem value="MONTHLY">Mensal</SelectItem><SelectItem value="QUARTERLY">Trimestral</SelectItem><SelectItem value="SEMIANNUALLY">Semestral</SelectItem><SelectItem value="YEARLY">Anual</SelectItem></SelectContent></Select></div><div><Label className="text-xs">Forma</Label><Select value={forma} onValueChange={setForma}><SelectTrigger className="mt-1"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PIX">Pix</SelectItem><SelectItem value="BOLETO">Boleto</SelectItem><SelectItem value="CREDIT_CARD">Cartao</SelectItem></SelectContent></Select></div></div>
        <div><Label className="text-xs">Descricao</Label><Input placeholder="Honorarios mensais" value={descricao} onChange={(e) => setDescricao(e.target.value)} className="mt-1" /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => criarMut.mutate({ contatoId: parseInt(contatoId), valor: parseFloat(valor), proximoVencimento: vencimento, ciclo: ciclo as any, formaPagamento: forma as any, descricao: descricao || undefined })} disabled={criarMut.isPending || !contatoId || !valor || !vencimento}>{criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Repeat className="h-4 w-4 mr-2" />}Criar assinatura</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}

export function NovoClienteDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
  const [nome, setNome] = useState(""); const [cpf, setCpf] = useState(""); const [email, setEmail] = useState(""); const [tel, setTel] = useState(""); const [cep, setCep] = useState(""); const [endereco, setEndereco] = useState(""); const [numero, setNumero] = useState(""); const [bairro, setBairro] = useState("");
  const [responsavelId, setResponsavelId] = useState<string>("none");
  const { data: equipeData } = trpc.configuracoes.listarColaboradores.useQuery();
  const colaboradoresAtivos = (equipeData && "colaboradores" in equipeData ? equipeData.colaboradores : []).filter((c) => c.ativo);
  const reset = () => { setNome(""); setCpf(""); setEmail(""); setTel(""); setCep(""); setEndereco(""); setNumero(""); setBairro(""); setResponsavelId("none"); };
  const criarMut = trpc.asaas.criarClienteAsaas.useMutation({ onSuccess: () => { toast.success("Cliente cadastrado"); reset(); onOpenChange(false); onSuccess(); }, onError: (err) => toast.error("Erro", { description: err.message }) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Novo cliente</DialogTitle><DialogDescription>Cadastra no Asaas e vincula ao CRM.</DialogDescription></DialogHeader>
      <div className="space-y-3 py-1">
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Nome *</Label><Input placeholder="Joao Silva" value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">CPF/CNPJ *</Label><Input placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.target.value)} className="mt-1" /></div></div>
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">Telefone</Label><Input value={tel} onChange={(e) => setTel(e.target.value)} className="mt-1" /></div></div>
        <div className="grid grid-cols-3 gap-2"><div><Label className="text-xs">CEP</Label><Input value={cep} onChange={(e) => setCep(e.target.value)} className="mt-1" /></div><div className="col-span-2"><Label className="text-xs">Endereco</Label><Input value={endereco} onChange={(e) => setEndereco(e.target.value)} className="mt-1" /></div></div>
        <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Numero</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} className="mt-1" /></div><div><Label className="text-xs">Bairro</Label><Input value={bairro} onChange={(e) => setBairro(e.target.value)} className="mt-1" /></div></div>
        <div>
          <Label className="text-xs">Responsável</Label>
          <Select value={responsavelId} onValueChange={setResponsavelId}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Sem responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem responsável</SelectItem>
              {colaboradoresAtivos.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.userName ?? "—"} ({c.cargo})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-1">Quem cuida do cliente nas conversas e recebe comissão pelas cobranças. Visível como agrupamento no painel Asaas.</p>
        </div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button onClick={() => criarMut.mutate({ nome, cpfCnpj: cpf, email: email || undefined, telefone: tel || undefined, cep: cep || undefined, endereco: endereco || undefined, numero: numero || undefined, bairro: bairro || undefined, responsavelId: responsavelId === "none" ? undefined : parseInt(responsavelId) })} disabled={criarMut.isPending || !nome || cpf.replace(/\D/g, "").length < 11}>{criarMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}Cadastrar</Button></DialogFooter>
    </DialogContent></Dialog>
  );
}
