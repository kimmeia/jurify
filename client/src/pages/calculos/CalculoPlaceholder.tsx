import { Card, CardContent } from "@/components/ui/card";

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
        </CardContent>
      </Card>
    </div>
  );
}
