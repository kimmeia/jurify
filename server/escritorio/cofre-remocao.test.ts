/**
 * Uma credencial removida tem que ficar removida.
 *
 * O caso real: o dono apagou uma credencial do cofre e ela reapareceu sozinha
 * minutos depois, marcada como "expirada". Os 420 processos monitorados ainda
 * guardavam o ID dela, o robô tentou usá-la, o login falhou, e a rotina que
 * marca falha fazia `UPDATE ... SET status='expirada' WHERE id = ?` — sem
 * checar que o status era `removida`. A linha saía de removida e voltava pra
 * lista.
 *
 * Duas consequências, e a segunda é a cara: o cofre mostrava uma credencial
 * que o dono tinha apagado, e os processos ficavam parados apontando pra ela
 * enquanto a credencial boa, ativa e válida, não era usada por ninguém.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Fake do drizzle: registra o que foi escrito e devolve o que a gente
// enfileirar pros selects. Só o suficiente pro caminho destas funções.
interface Escrita {
  valores: Record<string, unknown>;
  where: unknown;
}

const escritas: Escrita[] = [];
let filas: unknown[][] = [];

function proximaFila(): unknown[] {
  return filas.length > 0 ? (filas.shift() as unknown[]) : [];
}

function resultadoSelect() {
  const linhas = proximaFila();
  const alvo: any = Promise.resolve(linhas);
  alvo.limit = () => Promise.resolve(linhas);
  alvo.orderBy = () => alvo;
  return alvo;
}

const mockDb = {
  select: () => ({ from: () => ({ where: () => resultadoSelect() }) }),
  update: () => ({
    set: (valores: Record<string, unknown>) => ({
      where: (where: unknown) => {
        escritas.push({ valores, where });
        return Promise.resolve();
      },
    }),
  }),
};

vi.mock("../db", () => ({ getDb: vi.fn(async () => mockDb) }));
vi.mock("../_core/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const notificarCredencialCaiu = vi.fn();
vi.mock("./notificar-credencial", () => ({
  notificarCredencialCaiu,
  notificarCredencialRecuperada: vi.fn(),
}));

const helpers = await import("./cofre-helpers");

/**
 * Procura um valor dentro da árvore do WHERE do drizzle.
 *
 * O objeto de condição referencia a tabela, que referencia as colunas, que
 * referenciam a tabela de volta — `JSON.stringify` estoura em circular. Daí a
 * varredura com controle de visitados.
 */
function contemValor(no: unknown, alvo: string, vistos = new Set<unknown>()): boolean {
  if (no === alvo) return true;
  if (typeof no !== "object" || no === null || vistos.has(no)) return false;
  vistos.add(no);
  for (const v of Object.values(no as Record<string, unknown>)) {
    if (contemValor(v, alvo, vistos)) return true;
  }
  return false;
}

beforeEach(() => {
  escritas.length = 0;
  filas = [];
  notificarCredencialCaiu.mockReset();
});

const credencial = (status: string) => [
  { status, apelido: "OAB do dono", sistema: "pje_tjce", criadoPor: 1 },
];

describe("marcarCredencialExpirada", () => {
  it("não toca em credencial removida", async () => {
    filas = [credencial("removida")];
    await helpers.marcarCredencialExpirada(7, "Código inválido");
    expect(escritas).toHaveLength(0);
  });

  it("não notifica o dono sobre credencial que ele apagou", async () => {
    filas = [credencial("removida")];
    await helpers.marcarCredencialExpirada(7, "Código inválido");
    expect(notificarCredencialCaiu).not.toHaveBeenCalled();
  });

  it("continua marcando credencial viva", async () => {
    filas = [credencial("ativa")];
    await helpers.marcarCredencialExpirada(7, "Sessão caiu");
    expect(escritas).toHaveLength(1);
    expect(escritas[0]!.valores.status).toBe("expirada");
  });

  it("não escreve quando a credencial nem existe", async () => {
    filas = [[]];
    await helpers.marcarCredencialExpirada(999, "qualquer coisa");
    expect(escritas).toHaveLength(0);
  });
});

describe("atualizarStatusAposLogin", () => {
  it("no sucesso, não religa monitoramento de credencial removida", async () => {
    // O UPDATE sai com filtro que exclui `removida`, então não muda nada; o
    // que este teste prende é o passo seguinte — religar os monitoramentos
    // faria eles voltarem a rodar apontando pra credencial apagada.
    filas = [
      credencial("removida"), // estaRemovida()
    ];
    await helpers.atualizarStatusAposLogin(7, { ok: true });
    const mexeuEmMonitoramento = escritas.some((e) => "credencialId" in e.valores || e.valores.status === "ativo");
    expect(mexeuEmMonitoramento).toBe(false);
  });

  it("no sucesso de credencial viva, segue religando", async () => {
    filas = [
      credencial("ativa"), // estaRemovida()
      [{ id: 1, status: "erro", ultimoErro: "Sessão expirada. Vá no Cofre → Validar." }],
    ];
    await helpers.atualizarStatusAposLogin(7, { ok: true });
    expect(escritas.some((e) => e.valores.status === "ativo")).toBe(true);
  });

  it("na falha, a escrita carrega o filtro de não-removida", async () => {
    filas = [];
    await helpers.atualizarStatusAposLogin(7, { ok: false, mensagemErro: "senha errada" });
    expect(escritas).toHaveLength(1);
    expect(escritas[0]!.valores.status).toBe("erro");
    // O filtro é composto (id AND status <> removida), não um eq solto. É a
    // trava de corrida: o login demora dezenas de segundos e o dono pode
    // apagar a credencial nesse meio-tempo — quem decide é o banco na hora
    // da escrita, não a leitura feita lá atrás.
    expect(contemValor(escritas[0]!.where, "removida")).toBe(true);
  });
});

describe("deveReligarMonitoramento", () => {
  it("religa o que parou por causa da credencial", () => {
    expect(
      helpers.deveReligarMonitoramento({
        status: "erro",
        ultimoErro: "Sessão expirada. Vá no Cofre → Validar.",
      }),
    ).toBe(true);
  });

  it("não religa pausa, que é escolha de quem usa", () => {
    expect(
      helpers.deveReligarMonitoramento({ status: "pausado", ultimoErro: null }),
    ).toBe(false);
  });

  it("não apaga erro de outra natureza", () => {
    expect(
      helpers.deveReligarMonitoramento({ status: "erro", ultimoErro: "CNJ inválido" }),
    ).toBe(false);
  });
});
