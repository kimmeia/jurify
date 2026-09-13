import { Link } from "wouter";
import { CircleHelp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TarefaId } from "@/pages/ajuda/tarefas";

/**
 * O "?" ao lado do título de uma tela: abre a Central de ajuda já na tarefa
 * daquela tela. `tarefa` é o id tipado — apontar pra tarefa que não existe
 * nem compila.
 */
export function AjudaDaTela({ tarefa, className = "" }: { tarefa: TarefaId; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/ajuda/${tarefa}`}
          aria-label="Como fazer isso"
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle text-current opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
        >
          <CircleHelp className="h-4 w-4" />
        </Link>
      </TooltipTrigger>
      <TooltipContent>Como fazer isso</TooltipContent>
    </Tooltip>
  );
}
