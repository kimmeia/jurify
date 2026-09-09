/**
 * Trocar de ficha na lista lateral de Clientes chegou a deixar a tela com os
 * dados da ficha anterior (intermitente, visto em produção em 09/09/2026:
 * cabeçalho com "Tirza" e o formulário com "Tirzah"). O mecanismo exato da
 * corrida não foi reproduzido; a blindagem é em duas camadas, e as duas têm
 * que continuar de pé:
 *
 *  1. `ClienteDetalhe` nunca renderiza um registro cujo id não é o pedido —
 *     vale esqueleto até o certo chegar;
 *  2. `EditarForm` re-hidrata os campos quando o cadastro que ele recebe muda
 *     de id ou de `updatedAt` (o `key` no pai continua).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("ficha de cliente ao trocar de registro", () => {
  it("o detalhe só usa o registro do id pedido; outro id vira esqueleto, não tela", () => {
    const clientes = ler("client/src/pages/Clientes.tsx");
    expect(clientes).toContain("const { data: clienteCarregado, refetch, isLoading: detalheCarregando } = trpc.clientes.detalhe.useQuery({ id });");
    expect(clientes).toContain("const cliente = clienteCarregado && clienteCarregado.id === id ? clienteCarregado : undefined;");
    expect(clientes).toContain("const registroDeOutroId = !!clienteCarregado && clienteCarregado.id !== id;");
    expect(clientes).toContain("if (detalheCarregando || registroDeOutroId) {");
    // O form continua recriado por id no pai.
    expect(clientes).toContain("<EditarForm key={cliente.id} cliente={cliente}");
  });

  it("o formulário re-hidrata todos os campos quando muda o cadastro (id ou updatedAt), e só então", () => {
    const tabs = ler("client/src/pages/clientes/detail-tabs.tsx");
    const inicio = tabs.indexOf("export function EditarForm(");
    const corpo = tabs.slice(inicio, tabs.indexOf("\n  return (", inicio));
    expect(corpo).toContain("}, [cliente.id, cliente.updatedAt]);");
    for (const set of [
      'setNome(cliente.nome || "")',
      'setTel(cliente.telefone || "")',
      'setEmail(cliente.email || "")',
      'setCpf(cliente.cpfCnpj || "")',
      'setObs(cliente.observacoes || "")',
      'setTags(cliente.tags || "")',
      "setDocPendente(!!cliente.documentacaoPendente)",
      'setDocObs(cliente.documentacaoObservacoes || "")',
      "setQualif(extrairQualificacaoEndereco(cliente))",
      "setCamposExtras(camposExtrasDe(cliente))",
      'setResponsavelId(cliente.responsavelId ? String(cliente.responsavelId) : "")',
    ]) {
      expect(corpo).toContain(set);
    }
    // O efeito fica ANTES do return — hook depois de saída antecipada derruba a tela (React #310).
    expect(corpo.indexOf("useEffect(() => {")).toBeGreaterThan(0);
  });
});
