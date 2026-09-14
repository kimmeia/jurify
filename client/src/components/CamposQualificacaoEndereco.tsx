/**
 * Bloco de qualificação civil + endereço do cliente.
 *
 * Campos nativos (não confundir com `CamposPersonalizadosForm`, que é
 * o sistema de campos extras configuráveis por escritório):
 *  - Profissão, Estado civil, Nacionalidade
 *  - Endereço estruturado (CEP, logradouro, número, complemento,
 *    bairro, cidade, UF) — com autocomplete via ViaCEP
 *
 * Reutilizado em `NovoClienteDialog` e `EditarForm`. Componente
 * controlado: estado fica no parent, fluindo via `value` + `onChange`.
 */

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import {
  brParaIsoData, dataCalendarioISO, dataLocalHoje, isoParaBrData, mascararDataBR,
} from "@shared/data-calendario";
import { diaEMes, proximoAniversario } from "@shared/aniversario";

export type EstadoCivil =
  | "solteiro"
  | "casado"
  | "divorciado"
  | "viuvo"
  | "uniao_estavel";

export interface QualificacaoEndereco {
  profissao: string;
  estadoCivil: EstadoCivil | "";
  nacionalidade: string;
  /** `YYYY-MM-DD`. "" = não sei — e "não sei" nunca vira data nenhuma. */
  dataNascimento: string;
  cep: string;
  logradouro: string;
  numeroEndereco: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export const QUALIFICACAO_ENDERECO_VAZIO: QualificacaoEndereco = {
  profissao: "",
  estadoCivil: "",
  nacionalidade: "",
  dataNascimento: "",
  cep: "",
  logradouro: "",
  numeroEndereco: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
};

const ESTADO_CIVIL_LABEL: Record<EstadoCivil, string> = {
  solteiro: "Solteiro(a)",
  casado: "Casado(a)",
  divorciado: "Divorciado(a)",
  viuvo: "Viúvo(a)",
  uniao_estavel: "União estável",
};

const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA",
  "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN",
  "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

/** Formata CEP: "12345678" → "12345-678". Aceita parcial. */
function formatarCep(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

interface Props {
  value: QualificacaoEndereco;
  onChange: (patch: Partial<QualificacaoEndereco>) => void;
  /** Quando true, marca os campos como obrigatórios (asterisco `*`).
   *  A validação real fica no caller — esse flag é apenas dica visual. */
  obrigatorios?: boolean;
  /**
   * A data de nascimento também é exigida.
   *
   * Separado de `obrigatorios` de propósito: ela é obrigatória no CADASTRO
   * NOVO e não na edição. Ver `CAMPOS_OBRIGATORIOS_CADASTRO`.
   */
  exigirNascimento?: boolean;
}

/**
 * Lista de campos da qualificação/endereço considerados obrigatórios pra
 * gerar contrato. `Complemento` fica de fora — nem todo endereço tem.
 */
export const CAMPOS_OBRIGATORIOS_QUALIFICACAO: Array<{
  chave: keyof QualificacaoEndereco;
  label: string;
}> = [
  { chave: "profissao", label: "Profissão" },
  { chave: "estadoCivil", label: "Estado civil" },
  { chave: "nacionalidade", label: "Nacionalidade" },
  { chave: "cep", label: "CEP" },
  { chave: "uf", label: "UF" },
  { chave: "logradouro", label: "Logradouro" },
  { chave: "numeroEndereco", label: "Número" },
  { chave: "bairro", label: "Bairro" },
  { chave: "cidade", label: "Cidade" },
];

/**
 * O que o CADASTRO NOVO exige — a lista acima mais a data de nascimento.
 *
 * São duas listas, e não uma, porque as duas telas cobram coisas diferentes:
 * o cadastro novo TRAVA o botão, a edição só AVISA. Pôr a data na lista de
 * cima colocaria a carteira inteira que já existe em falta de um dado que
 * ninguém tem em mãos — e, pra cliente (não lead), o `EditarForm` recusa
 * salvar enquanto houver campo obrigatório vazio. Quem já está cadastrado
 * ficaria impedido de corrigir o próprio telefone até descobrir o
 * aniversário.
 */
export const CAMPOS_OBRIGATORIOS_CADASTRO: Array<{
  chave: keyof QualificacaoEndereco;
  label: string;
}> = [
  ...CAMPOS_OBRIGATORIOS_QUALIFICACAO,
  { chave: "dataNascimento", label: "Data de nascimento" },
];

/** Retorna labels dos campos obrigatórios que estão vazios. */
export function validarQualificacaoCompleta(
  v: QualificacaoEndereco,
  opts: { exigirNascimento?: boolean } = {},
): string[] {
  const lista = opts.exigirNascimento
    ? CAMPOS_OBRIGATORIOS_CADASTRO
    : CAMPOS_OBRIGATORIOS_QUALIFICACAO;
  const faltando: string[] = [];
  for (const campo of lista) {
    const valor = v[campo.chave];
    if (!valor || String(valor).trim() === "") {
      faltando.push(campo.label);
    }
  }
  return faltando;
}

/** A leitura do que foi digitado: "12 de março · 41 anos", já embaixo do campo. */
function rotuloDaData(iso: string): string {
  const a = proximoAniversario(iso, dataLocalHoje());
  if (!a) return "";
  const idade = a.idadeHoje != null ? ` · ${a.idadeHoje} anos` : "";
  return `${diaEMes(a)}${idade}`;
}

const REQ = (label: string, on: boolean) =>
  on ? (
    <>
      {label} <span className="text-destructive">*</span>
    </>
  ) : (
    label
  );

export function CamposQualificacaoEndereco({
  value,
  onChange,
  obrigatorios,
  exigirNascimento,
}: Props) {
  const [buscandoCep, setBuscandoCep] = useState(false);
  // O que está no campo enquanto se digita. O filtro só vira valor quando a
  // data fecha — senão "12/0" apagaria o que já estava gravado.
  const [nascimentoDigitado, setNascimentoDigitado] = useState(() =>
    isoParaBrData(value.dataNascimento),
  );
  useEffect(() => {
    setNascimentoDigitado(isoParaBrData(value.dataNascimento));
  }, [value.dataNascimento]);

  const nascimentoRuim = nascimentoDigitado.length === 10 && !brParaIsoData(nascimentoDigitado);

  const digitarNascimento = (bruto: string) => {
    const texto = mascararDataBR(bruto);
    setNascimentoDigitado(texto);
    const iso = brParaIsoData(texto);
    if (iso || texto === "") onChange({ dataNascimento: iso });
  };

  /** Consulta ViaCEP (API pública gratuita) e preenche os campos.
   *  Não bloqueia edição manual: mantém o que o usuário já digitou em
   *  `numeroEndereco`/`complemento`. */
  async function buscarCep() {
    const cepNum = value.cep.replace(/\D/g, "");
    if (cepNum.length !== 8) {
      toast.error("CEP precisa ter 8 dígitos");
      return;
    }
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cepNum}/json/`);
      if (!r.ok) throw new Error("Falha na busca");
      const data = await r.json();
      if (data.erro) {
        toast.error("CEP não encontrado");
        return;
      }
      onChange({
        logradouro: data.logradouro || value.logradouro,
        bairro: data.bairro || value.bairro,
        cidade: data.localidade || value.cidade,
        uf: data.uf || value.uf,
      });
      toast.success("Endereço preenchido");
    } catch {
      toast.error("Não foi possível consultar o CEP");
    } finally {
      setBuscandoCep(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Qualificação civil */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{REQ("Profissão", !!obrigatorios)}</Label>
          <Input
            value={value.profissao}
            onChange={(e) => onChange({ profissao: e.target.value })}
            maxLength={100}
            placeholder="Ex: Engenheiro civil"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{REQ("Estado civil", !!obrigatorios)}</Label>
          <Select
            value={value.estadoCivil || "_none"}
            onValueChange={(v) =>
              onChange({ estadoCivil: v === "_none" ? "" : (v as EstadoCivil) })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— Não informado —</SelectItem>
              {(Object.keys(ESTADO_CIVIL_LABEL) as EstadoCivil[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {ESTADO_CIVIL_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">{REQ("Nacionalidade", !!obrigatorios)}</Label>
          <Input
            value={value.nacionalidade}
            onChange={(e) => onChange({ nacionalidade: e.target.value })}
            maxLength={50}
            placeholder="Brasileira"
          />
        </div>
        <div className="space-y-1.5">
          {/* Obrigatória no cadastro NOVO, e fora da lista do contrato de
              propósito: o contrato sai sem ela, e cobrá-la na edição travaria
              a carteira que já existe num dado que ninguém tem em mãos. */}
          <Label className="text-xs">{REQ("Data de nascimento", !!exigirNascimento)}</Label>
          {/* Texto mascarado, não `input type=date`: o campo nativo desenha no
              idioma do NAVEGADOR — num Chrome em inglês "12/03/1985" aparece
              como "03/12/1985". A mesma decisão do filtro de cadastro. */}
          <Input
            type="text"
            inputMode="numeric"
            maxLength={10}
            placeholder="dd/mm/aaaa"
            value={nascimentoDigitado}
            onChange={(e) => digitarNascimento(e.target.value)}
            className={nascimentoRuim ? "border-danger" : ""}
          />
          <p
            className={`text-[10.5px] leading-snug ${
              nascimentoRuim ? "text-danger-fg" : "text-muted-foreground"
            }`}
          >
            {nascimentoRuim
              ? "Data que não existe — confira o dia e o mês."
              : rotuloDaData(value.dataNascimento) ||
                (exigirNascimento
                  ? "É ela que gera o lembrete do aniversário."
                  : "Opcional. É ela que gera o lembrete do aniversário.")}
          </p>
        </div>
      </div>

      {/* Endereço */}
      <div className="pt-3 border-t">
        <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          Endereço
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{REQ("CEP", !!obrigatorios)}</Label>
            <div className="flex gap-1.5">
              <Input
                value={value.cep}
                onChange={(e) => onChange({ cep: formatarCep(e.target.value) })}
                onBlur={() => {
                  // Auto-busca quando completo. Não-fatal: erro só toasta.
                  if (value.cep.replace(/\D/g, "").length === 8) buscarCep();
                }}
                placeholder="12345-678"
                maxLength={9}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={buscarCep}
                disabled={buscandoCep || value.cep.replace(/\D/g, "").length !== 8}
                title="Buscar endereço pelo CEP (ViaCEP)"
              >
                {buscandoCep ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{REQ("UF", !!obrigatorios)}</Label>
            <Select
              value={value.uf || "_none"}
              onValueChange={(v) => onChange({ uf: v === "_none" ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">—</SelectItem>
                {UFS.map((uf) => (
                  <SelectItem key={uf} value={uf}>
                    {uf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3 mt-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{REQ("Logradouro", !!obrigatorios)}</Label>
            <Input
              value={value.logradouro}
              onChange={(e) => onChange({ logradouro: e.target.value })}
              maxLength={200}
              placeholder="Rua, avenida..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{REQ("Número", !!obrigatorios)}</Label>
            <Input
              value={value.numeroEndereco}
              onChange={(e) => onChange({ numeroEndereco: e.target.value })}
              maxLength={20}
              placeholder="123"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Complemento</Label>
            <Input
              value={value.complemento}
              onChange={(e) => onChange({ complemento: e.target.value })}
              maxLength={100}
              placeholder="Apto, bloco..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{REQ("Bairro", !!obrigatorios)}</Label>
            <Input
              value={value.bairro}
              onChange={(e) => onChange({ bairro: e.target.value })}
              maxLength={100}
            />
          </div>
        </div>
        <div className="space-y-1.5 mt-3">
          <Label className="text-xs">{REQ("Cidade", !!obrigatorios)}</Label>
          <Input
            value={value.cidade}
            onChange={(e) => onChange({ cidade: e.target.value })}
            maxLength={100}
          />
        </div>
      </div>
    </div>
  );
}

/** Helper: extrai os campos de qualificação/endereço de um cliente vindo
 *  do tRPC (que vem com `null`s) pra um objeto pronto pro componente
 *  controlado. */
export function extrairQualificacaoEndereco(
  cliente: Record<string, unknown> | null | undefined,
): QualificacaoEndereco {
  if (!cliente) return { ...QUALIFICACAO_ENDERECO_VAZIO };
  return {
    profissao: (cliente.profissao as string) || "",
    estadoCivil: ((cliente.estadoCivil as EstadoCivil) || "") as EstadoCivil | "",
    nacionalidade: (cliente.nacionalidade as string) || "",
    // Vem do servidor como Date ou "YYYY-MM-DD": a parte de data é lida em
    // UTC, que é onde o dia foi gravado. Ler no fuso do navegador mostraria
    // o dia anterior à noite.
    dataNascimento: dataCalendarioISO(cliente.dataNascimento as string | Date | null),
    cep: (cliente.cep as string) || "",
    logradouro: (cliente.logradouro as string) || "",
    numeroEndereco: (cliente.numeroEndereco as string) || "",
    complemento: (cliente.complemento as string) || "",
    bairro: (cliente.bairro as string) || "",
    cidade: (cliente.cidade as string) || "",
    uf: (cliente.uf as string) || "",
  };
}
