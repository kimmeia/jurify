import { Receipt } from "lucide-react";
import CalculoPlaceholder from "./CalculoPlaceholder";

export default function Tributario() {
  return (
    <CalculoPlaceholder
      title="Tributário"
      icon={<Receipt className="h-8 w-8 text-purple-600" />}
    />
  );
}
