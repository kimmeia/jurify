import { describe, it, expect } from "vitest";
import { parsearPartes, resumirPartes, nomeCurto } from "./partes-processo";

const partes = [
  { nome: "Maria Aparecida do Nascimento", polo: "ativo", tipo: "fisica", documento: "123.456.789-00", advogados: [] },
  { nome: "Banco Exemplo S/A", polo: "passivo", tipo: "juridica", documento: "11.222.333/0001-44", advogados: [] },
];

describe("parsearPartes", () => {
  it("lê o array salvo pelo cron", () => {
    const r = parsearPartes(JSON.stringify(partes));
    expect(r).toHaveLength(2);
    expect(r[0].nome).toBe("Maria Aparecida do Nascimento");
    expect(r[1].polo).toBe("passivo");
  });

  it("aceita o formato antigo { partes: [...] }", () => {
    expect(parsearPartes(JSON.stringify({ partes }))).toHaveLength(2);
  });

  it("JSON quebrado não derruba a tela", () => {
    expect(parsearPartes("{isso não é json")).toEqual([]);
    expect(parsearPartes(null)).toEqual([]);
    expect(parsearPartes("")).toEqual([]);
  });

  it("descarta entrada sem nome", () => {
    const r = parsearPartes(JSON.stringify([{ polo: "ativo" }, { nome: "   " }, { nome: "Ok", polo: "ativo" }]));
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe("Ok");
  });

  it("polo desconhecido cai em ativo", () => {
    expect(parsearPartes(JSON.stringify([{ nome: "X", polo: "sei lá" }]))[0].polo).toBe("ativo");
  });
});

describe("nomeCurto", () => {
  it("preserva nome curto", () => {
    expect(nomeCurto("Banco Exemplo S/A")).toBe("Banco Exemplo S/A");
  });

  it("encurta nome longo mantendo primeiro e último", () => {
    expect(nomeCurto("Maria Aparecida do Nascimento Silva Santos")).toBe("Maria Santos");
  });

  it("nome de uma palavra passa igual", () => {
    expect(nomeCurto("Fulano")).toBe("Fulano");
  });
});

describe("resumirPartes", () => {
  const lista = parsearPartes(JSON.stringify(partes));

  it("monta o rótulo do caso", () => {
    const r = resumirPartes(lista);
    expect(r.rotulo).toBe("Maria Nascimento × Banco Exemplo S/A");
    expect(r.autores).toEqual(["Maria Aparecida do Nascimento"]);
    expect(r.reus).toEqual(["Banco Exemplo S/A"]);
  });

  it("identifica o cliente pelo CPF da busca", () => {
    const r = resumirPartes(lista, { searchKey: "12345678900" });
    expect(r.cliente).toBe("Maria Aparecida do Nascimento");
    expect(r.clientePolo).toBe("ativo");
  });

  it("identifica o cliente pelo apelido do monitoramento", () => {
    const r = resumirPartes(lista, { apelido: "banco exemplo s/a" });
    expect(r.cliente).toBe("Banco Exemplo S/A");
    expect(r.clientePolo).toBe("passivo");
  });

  it("não chuta que o autor é o nosso cliente", () => {
    // Metade da carteira de um escritório é defesa — chutar aqui erraria muito.
    const r = resumirPartes(lista, { searchKey: "0261912-66.2023.8.06.0001" });
    expect(r.clientePolo).toBeNull();
    expect(r.cliente).toBeNull();
  });

  it("CNJ como searchKey não casa com CPF de parte por acidente", () => {
    const soCnj = resumirPartes(lista, { searchKey: "02619126620238060001" });
    expect(soCnj.clientePolo).toBeNull();
  });

  it("sem partes coletadas, o apelido é o melhor que temos", () => {
    const r = resumirPartes([], { apelido: "Cliente X" });
    expect(r.cliente).toBe("Cliente X");
    expect(r.rotulo).toBeNull();
  });

  it("sem partes e sem apelido devolve tudo vazio", () => {
    const r = resumirPartes([], { searchKey: "0261912-66.2023.8.06.0001" });
    expect(r.cliente).toBeNull();
    expect(r.rotulo).toBeNull();
    expect(r.autores).toEqual([]);
  });

  it("só um polo ainda produz rótulo", () => {
    const soAutor = parsearPartes(JSON.stringify([partes[0]]));
    expect(resumirPartes(soAutor).rotulo).toBe("Maria Nascimento");
  });

  it("apelido continua valendo como nome quando não bate com nenhuma parte", () => {
    const r = resumirPartes(lista, { apelido: "Caso do consignado" });
    expect(r.cliente).toBe("Caso do consignado");
    expect(r.clientePolo).toBeNull();
  });

  it("documento bate mesmo com máscaras diferentes", () => {
    const r = resumirPartes(lista, { searchKey: "123.456.789-00" });
    expect(r.cliente).toBe("Maria Aparecida do Nascimento");
  });

  it("vários réus mantêm o primeiro no rótulo mas listam todos", () => {
    const varios = parsearPartes(
      JSON.stringify([...partes, { nome: "Financeira Segunda Ltda", polo: "passivo" }]),
    );
    const r = resumirPartes(varios);
    expect(r.reus).toHaveLength(2);
    expect(r.rotulo).toContain("Banco Exemplo");
  });
});
