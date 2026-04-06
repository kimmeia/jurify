import { TrendingUp } from "lucide-react";
import CalculoPlaceholder from "./CalculoPlaceholder";

export default function AtualizacaoMonetaria() {
  return (
    <CalculoPlaceholder
      title="Cálculos Diversos"
      icon={<TrendingUp className="h-8 w-8 text-teal-600" />}
    />
  );
}
