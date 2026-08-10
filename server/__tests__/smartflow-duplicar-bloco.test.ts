/**
 * Duplicação de bloco no editor do SmartFlow.
 *
 * O que se testa aqui não é a interface — é a IDENTIDADE do clone. Dois
 * blocos com o mesmo `clienteId` fazem o `proximoSe` de um roteador apontar
 * pros dois ao mesmo tempo, e o cenário salva torto sem nenhum erro na tela.
 * E config copiada por referência transforma "editar a cópia" em "editar os
 * dois", que o usuário só descobre depois de já ter publicado.
 */

import { describe, it, expect } from "vitest";
import {
  DESLOCAMENTO_COPIA,
  arestasDaCopia,
  duplicarNo,
  type NoDuplicavel,
} from "../../client/src/pages/smartflow/editor-duplicar";

const no = (over: Partial<NoDuplicavel> = {}): NoDuplicavel => ({
  id: "n1",
  type: "passo",
  position: { x: 200, y: 120 },
  data: {
    tipo: "whatsapp_enviar",
    config: { template: "Olá {{nomeCliente}}" },
    label: "Enviar mensagem",
    clienteId: "cli-original",
    ...(over.data ?? {}),
  },
  ...over,
});

describe("duplicarNo — identidade", () => {
  it("a cópia recebe id e clienteId próprios", () => {
    const { no: copia } = duplicarNo(no(), "n2", "cli-copia");
    expect(copia.id).toBe("n2");
    expect(copia.data.clienteId).toBe("cli-copia");
  });

  it("clienteId repetido seria o bug — o original segue intacto", () => {
    const origem = no();
    const { no: copia } = duplicarNo(origem, "n2", "cli-copia");
    expect(copia.data.clienteId).not.toBe(origem.data.clienteId);
    expect(origem.data.clienteId).toBe("cli-original");
    expect(origem.id).toBe("n1");
  });

  it("preserva o tipo do bloco", () => {
    const { no: copia } = duplicarNo(no(), "n2", "c2");
    expect(copia.data.tipo).toBe("whatsapp_enviar");
  });
});

/**
 * O bug que o dono viu: duplicar e arrastar movia os DOIS cards juntos.
 * O ReactFlow move todo nó com `selected: true`, e o clone nascia herdando
 * a flag do original por espalhamento.
 */
describe("duplicarNo — estado de interação não é herdado", () => {
  it("a cópia nasce sem a seleção do original", () => {
    const origem = no({ selected: true });
    const { no: copia } = duplicarNo(origem, "n2", "c2");
    expect(copia.selected).toBe(false);
  });

  it("a cópia nasce sem a flag de arrasto", () => {
    const origem = no({ selected: true, dragging: true });
    const { no: copia } = duplicarNo(origem, "n2", "c2");
    expect(copia.dragging).toBe(false);
  });

  it("duplicar não mexe na seleção do original — quem migra é o editor", () => {
    const origem = no({ selected: true });
    duplicarNo(origem, "n2", "c2");
    expect(origem.selected).toBe(true);
  });
});

describe("duplicarNo — posição", () => {
  it("nasce deslocada, não em cima do original", () => {
    const { no: copia } = duplicarNo(no(), "n2", "c2");
    expect(copia.position).toEqual({
      x: 200 + DESLOCAMENTO_COPIA.x,
      y: 120 + DESLOCAMENTO_COPIA.y,
    });
  });

  it("não mexe na posição do original", () => {
    const origem = no();
    duplicarNo(origem, "n2", "c2");
    expect(origem.position).toEqual({ x: 200, y: 120 });
  });
});

describe("duplicarNo — cópia profunda da config", () => {
  it("editar a config da cópia não mexe na do original", () => {
    const origem = no();
    const { no: copia } = duplicarNo(origem, "n2", "c2");
    copia.data.config.template = "Outro texto";
    expect(origem.data.config.template).toBe("Olá {{nomeCliente}}");
  });

  it("estrutura aninhada também é clonada — o caso do Decisão", () => {
    // Cópia rasa passaria nos testes acima e falharia AQUI: as condições são
    // um array, e as duas cópias apontariam pro mesmo.
    const origem = no({
      data: {
        tipo: "condicional",
        clienteId: "cli-original",
        config: {
          condicoes: [
            { id: "c1", label: "É cliente", requisitos: [{ campo: "cliente.tags", operador: "tem_tag", valor: "cliente" }] },
          ],
        },
      },
    });
    const { no: copia } = duplicarNo(origem, "n2", "c2");

    const condCopia = (copia.data.config.condicoes as any[])[0];
    condCopia.label = "Mudou";
    condCopia.requisitos[0].valor = "lead";

    const condOrig = (origem.data.config.condicoes as any[])[0];
    expect(condOrig.label).toBe("É cliente");
    expect(condOrig.requisitos[0].valor).toBe("cliente");
  });

  it("config vazia não quebra", () => {
    const origem = no({ data: { tipo: "transferir", config: {}, clienteId: "cli-original" } });
    const { no: copia } = duplicarNo(origem, "n2", "c2");
    expect(copia.data.config).toEqual({});
  });
});

describe("arestasDaCopia", () => {
  /**
   * Decisão de produto aprovada pelo dono: a cópia entra solta. Duas cópias
   * saindo pro mesmo destino é quase sempre engano de quem duplicou pra
   * editar uma variação — e desfazer ramificação custa mais que ligar.
   */
  it("a cópia entra sem ligação nenhuma", () => {
    expect(arestasDaCopia()).toEqual([]);
  });
});
