/**
 * Confirmação destrutiva tipo "type-to-confirm". Usuário precisa digitar
 * a frase exata pra habilitar o botão. Útil pra apagar/substituir dados.
 *
 * Match é case-insensitive + trim — "  substituir tudo  " bate com
 * "SUBSTITUIR TUDO". Match parcial NÃO bate (precisa ser exato).
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface Props {
  /** Frase que o usuário precisa digitar pra confirmar. */
  frase: string;
  onConfirmar: () => void;
  /** Texto do botão. Default: "Confirmar". */
  textoBotao?: string;
  /** Label acima do input. Default: 'Digite "<frase>" pra confirmar:'. */
  label?: string;
  /** Desabilita mesmo com match (ex: durante mutation pendente). */
  disabled?: boolean;
  /** Variant do botão. Default: "destructive". */
  variant?: "destructive" | "default";
}

export function DigiteParaConfirmar({
  frase,
  onConfirmar,
  textoBotao = "Confirmar",
  label,
  disabled,
  variant = "destructive",
}: Props) {
  const [valor, setValor] = useState("");
  const ok = valor.trim().toUpperCase() === frase.toUpperCase();

  return (
    <div className="space-y-2">
      <Label className="text-xs">
        {label ?? (
          <>
            Pra confirmar, digite <code className="font-mono font-semibold">{frase}</code>:
          </>
        )}
      </Label>
      <Input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder={frase}
        autoComplete="off"
        spellCheck={false}
      />
      <Button
        onClick={onConfirmar}
        disabled={!ok || disabled}
        variant={variant}
        className="w-full"
      >
        {textoBotao}
      </Button>
    </div>
  );
}
