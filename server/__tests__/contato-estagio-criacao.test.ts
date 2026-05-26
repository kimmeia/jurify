/**
 * Testes — estágio do contato na CRIAÇÃO (`criarOuReutilizarContato`).
 *
 * Regra de negócio (separação Lead × Cliente): quem chega pelo atendimento
 * (WhatsApp recebido, iniciar conversa, novo contato no Atendimento) entra
 * como LEAD — não como Cliente. Cliente é só quem fecha contrato.
 *
 * `criarOuReutilizarContato` é o ÚNICO caminho de criação usado pelo
 * atendimento, então é onde o default 'lead' precisa estar travado. Os
 * outros inserts (cadastro manual na tela Clientes, sync Asaas) usam outro
 * caminho e ficam 'cliente' pelo default da coluna — fora do escopo daqui.
 *
 * Também garante que REUTILIZAR um contato existente (mesmo telefone) NÃO
 * insere de novo — logo não altera o estágio de quem já é cliente e voltou
 * a mandar mensagem.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

const captured = { inserts: [] as any[] };
const selectState = { rows: [] as any[] };

function makeDb() {
  function builder(): any {
    const b: any = {
      from: () => b,
      where: () => b,
      orderBy: () => b,
      limit: () => Promise.resolve(selectState.rows),
      then: (resolve: (v: unknown) => unknown) => resolve(selectState.rows),
    };
    return b;
  }
  return {
    select: () => builder(),
    insert: () => ({
      values: (v: any) => {
        captured.inserts.push(v);
        return Promise.resolve([{ insertId: 123 }]);
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }) }),
  };
}

const dbInstance = makeDb();

vi.mock("../db", () => ({
  getDb: vi.fn(async () => dbInstance),
}));

const { criarOuReutilizarContato } = await import("../escritorio/db-crm");

beforeEach(() => {
  captured.inserts = [];
  selectState.rows = [];
});

describe("criarOuReutilizarContato — estágio", () => {
  it("contato novo do atendimento nasce como LEAD (default)", async () => {
    const r = await criarOuReutilizarContato({
      escritorioId: 1,
      nome: "Fulano WhatsApp",
      origem: "whatsapp",
    });
    expect(r.jaCadastrado).toBe(false);
    expect(captured.inserts).toHaveLength(1);
    expect(captured.inserts[0].estagio).toBe("lead");
  });

  it("respeita estágio explícito 'cliente' quando passado", async () => {
    await criarOuReutilizarContato({
      escritorioId: 1,
      nome: "Cliente Direto",
      estagio: "cliente",
    });
    expect(captured.inserts).toHaveLength(1);
    expect(captured.inserts[0].estagio).toBe("cliente");
  });

  it("reutiliza contato existente por telefone e NÃO insere (não mexe no estágio)", async () => {
    // Telefone já cadastrado → buscarContatoPorTelefone acha o registro.
    selectState.rows = [{ id: 50, nome: "Já Existe", telefone: "5585999990000" }];
    const r = await criarOuReutilizarContato({
      escritorioId: 1,
      nome: "Mesmo Número",
      telefone: "85999990000",
      origem: "whatsapp",
    });
    expect(r.jaCadastrado).toBe(true);
    expect(r.id).toBe(50);
    expect(captured.inserts).toHaveLength(0);
  });
});
