import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

interface CalculoPlaceholderProps {
  title: string;
  icon: React.ReactNode;
}

export default function CalculoPlaceholder({ title, icon }: CalculoPlaceholderProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="text-muted-foreground mt-1">
          Módulo de cálculos — {title}
        </p>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-6">
            {icon}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <Construction className="h-5 w-5 text-amber-500" />
            <h2 className="text-xl font-semibold text-foreground">Em breve</h2>
          </div>
          <p className="text-muted-foreground max-w-sm">
            Este módulo está em desenvolvimento. Os formulários e motores de
            cálculo serão implementados nas próximas etapas.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
