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

import { useState } from "react";
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
}

export function CamposQualificacaoEndereco({ value, onChange }: Props) {
  const [buscandoCep, setBuscandoCep] = useState(false);

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
          <Label className="text-xs">Profissão</Label>
          <Input
            value={value.profissao}
            onChange={(e) => onChange({ profissao: e.target.value })}
            maxLength={100}
            placeholder="Ex: Engenheiro civil"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Estado civil</Label>
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
      <div className="space-y-1.5">
        <Label className="text-xs">Nacionalidade</Label>
        <Input
          value={value.nacionalidade}
          onChange={(e) => onChange({ nacionalidade: e.target.value })}
          maxLength={50}
          placeholder="Brasileira"
        />
      </div>

      {/* Endereço */}
      <div className="pt-3 border-t">
        <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          Endereço
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">CEP</Label>
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
            <Label className="text-xs">UF</Label>
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
            <Label className="text-xs">Logradouro</Label>
            <Input
              value={value.logradouro}
              onChange={(e) => onChange({ logradouro: e.target.value })}
              maxLength={200}
              placeholder="Rua, avenida..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Número</Label>
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
            <Label className="text-xs">Bairro</Label>
            <Input
              value={value.bairro}
              onChange={(e) => onChange({ bairro: e.target.value })}
              maxLength={100}
            />
          </div>
        </div>
        <div className="space-y-1.5 mt-3">
          <Label className="text-xs">Cidade</Label>
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
    cep: (cliente.cep as string) || "",
    logradouro: (cliente.logradouro as string) || "",
    numeroEndereco: (cliente.numeroEndereco as string) || "",
    complemento: (cliente.complemento as string) || "",
    bairro: (cliente.bairro as string) || "",
    cidade: (cliente.cidade as string) || "",
    uf: (cliente.uf as string) || "",
  };
}
