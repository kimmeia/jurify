import { trpc } from "@/lib/trpc";
import { contratoLibera } from "@shared/modulos-contratacao";

/**
 * Clientes que a tela pode oferecer pra vínculo/seleção respeitando o
 * contrato: módulo Clientes completo quando contratado, senão a lista
 * essencial do pacote processual (mesma tabela). Sem isto, o plano de
 * monitoramento chama `clientes.listar`, toma FORBIDDEN silencioso do
 * porteiro de módulos e o seletor vem vazio.
 */
export function useClientesVinculaveis(opts: { busca?: string; enabled?: boolean }) {
  const habilitado = opts.enabled !== false;
  const { data: modulosData } = trpc.subscription.modulosContratados.useQuery(undefined, {
    staleTime: 60_000,
    enabled: habilitado,
  });
  const carregouContrato = modulosData !== undefined;
  const temModuloClientes = contratoLibera(modulosData?.modulos ?? null, ["clientes"]);
  const completo = trpc.clientes.listar.useQuery(
    { busca: opts.busca || undefined, limite: 100 },
    { enabled: habilitado && carregouContrato && temModuloClientes },
  );
  const essencial = trpc.clientesEssencial.listar.useQuery(
    { busca: opts.busca || undefined },
    { enabled: habilitado && carregouContrato && !temModuloClientes },
  );
  return temModuloClientes ? (completo.data?.clientes ?? []) : (essencial.data?.itens ?? []);
}
