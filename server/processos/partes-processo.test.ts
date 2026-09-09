import { describe, it, expect } from "vitest";
import {
  parsearPartes,
  resumirPartes,
  nomeCurto,
  limparNomeParte,
  extrairPapel,
  titulizar,
} from "./partes-processo";

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

  it("polo que não dá pra ler NÃO vira ativo", () => {
    // Era o comportamento antigo, e custava caro: "ativo" significa "o cliente
    // é o autor", que é o rótulo com que o cron de novas ações silencia o
    // alerta. Uma falha de leitura escolhia o lado que esconde o caso.
    for (const bruto of ["sei lá", "", null, undefined, 7]) {
      expect(parsearPartes(JSON.stringify([{ nome: "X", polo: bruto }]))[0].polo).toBe("desconhecido");
    }
  });

  it("as grafias que o tribunal usa continuam sendo lidas", () => {
    const ler = (polo: string) => parsearPartes(JSON.stringify([{ nome: "X", polo }]))[0].polo;
    expect(ler("ativo")).toBe("ativo");
    expect(ler("ATIVA")).toBe("ativo");
    expect(ler(" passivo ")).toBe("passivo");
    expect(ler("terceiro")).toBe("terceiro");
  });
});

describe("nomeCurto", () => {
  it("preserva nome de duas palavras significativas", () => {
    expect(nomeCurto("Maria da Silva")).toBe("Maria da Silva");
  });

  it("encurta nome longo pras duas primeiras palavras", () => {
    expect(nomeCurto("Carlos Jefferson Ribeiro dos Santos")).toBe("Carlos Jefferson");
  });

  it("conectivo não conta como palavra", () => {
    expect(nomeCurto("Maria Aparecida do Nascimento Silva")).toBe("Maria Aparecida");
  });

  it("razão social vira nome + marca", () => {
    expect(nomeCurto("BANCO PAN S.A.")).toBe("BANCO PAN");
  });

  it("nome de uma palavra passa igual", () => {
    expect(nomeCurto("Fulano")).toBe("Fulano");
  });
});

describe("limparNomeParte", () => {
  it("tira CPF e papel da linha crua do PJe", () => {
    expect(limparNomeParte("CARLOS JEFFERSON RIBEIRO DOS SANTOS - CPF: 066.968.283-70 (AUTOR)")).toBe(
      "CARLOS JEFFERSON RIBEIRO DOS SANTOS",
    );
  });

  it("tira CNPJ e papel de pessoa jurídica", () => {
    expect(limparNomeParte("BANCO PAN S.A. - CNPJ: 59.285.411/0001-13 (REU)")).toBe("BANCO PAN S.A.");
  });

  it("corta o 'registrado(a) civilmente como' do advogado", () => {
    expect(
      limparNomeParte(
        "BRUNO BOYADJIAN SOBREIRA registrado(a) civilmente como BRUNO BOYADJIAN SOBREIRA - OAB CE38828 - CPF: 062.885.473-01 (ADVOGADO)",
      ),
    ).toBe("BRUNO BOYADJIAN SOBREIRA");
  });

  it("nome já limpo passa intacto", () => {
    expect(limparNomeParte("Banco Exemplo S/A")).toBe("Banco Exemplo S/A");
  });
});

describe("extrairPapel", () => {
  it("lê o papel entre parênteses no fim", () => {
    expect(extrairPapel("FULANO - CPF: 111 (AUTOR)")).toBe("AUTOR");
    expect(extrairPapel("SERGIO SCHULZE - OAB SC7629-A (ADVOGADO)")).toBe("ADVOGADO");
  });

  it("sem parênteses devolve null", () => {
    expect(extrairPapel("Banco Exemplo S/A")).toBeNull();
  });

  it("não confunde o (a) de 'registrado(a)' com papel", () => {
    expect(
      extrairPapel("FULANO registrado(a) civilmente como FULANO - OAB CE1 - CPF: 1"),
    ).toBeNull();
  });
});

describe("titulizar", () => {
  it("capitula nome que veio gritando do tribunal", () => {
    expect(titulizar("CARLOS JEFFERSON")).toBe("Carlos Jefferson");
    expect(titulizar("MARIA DA SILVA")).toBe("Maria da Silva");
  });

  it("preserva sigla de razão social", () => {
    expect(titulizar("BANCO PAN S.A.")).toBe("Banco Pan S.A.");
    expect(titulizar("BANCO EXEMPLO S/A")).toBe("Banco Exemplo S/A");
  });

  it("nome que já tem minúscula não é mexido", () => {
    expect(titulizar("Banco Exemplo S/A")).toBe("Banco Exemplo S/A");
    expect(titulizar("João da Silva ME")).toBe("João da Silva ME");
  });
});

describe("resumirPartes", () => {
  const lista = parsearPartes(JSON.stringify(partes));

  it("monta o rótulo do caso", () => {
    const r = resumirPartes(lista);
    expect(r.rotulo).toBe("Maria Aparecida × Banco Exemplo");
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
    expect(resumirPartes(soAutor).rotulo).toBe("Maria Aparecida");
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
  it("linha crua do PJe vira 'Cliente × Outra parte'", () => {
    // Advogado listado antes da parte, que é como o PJe às vezes devolve —
    // sem o filtro por papel o rótulo mostraria o escritório.
    const cru = parsearPartes(
      JSON.stringify([
        {
          nome: "BRUNO BOYADJIAN SOBREIRA registrado(a) civilmente como BRUNO BOYADJIAN SOBREIRA - OAB CE38828 - CPF: 062.885.473-01 (ADVOGADO)",
          polo: "ativo",
        },
        { nome: "CARLOS JEFFERSON RIBEIRO DOS SANTOS - CPF: 066.968.283-70 (AUTOR)", polo: "ativo" },
        { nome: "SERGIO SCHULZE - OAB SC7629-A - CPF: 312.387.349-87 (ADVOGADO)", polo: "passivo" },
        { nome: "BANCO PAN S.A. - CNPJ: 59.285.411/0001-13 (REU)", polo: "passivo" },
      ]),
    );
    const r = resumirPartes(cru, { searchKey: "066.968.283-70" });
    expect(r.rotulo).toBe("Carlos Jefferson × Banco Pan");
    expect(r.cliente).toBe("Carlos Jefferson Ribeiro dos Santos");
    expect(r.clientePolo).toBe("ativo");
  });

  it("CPF pendurado no nome ainda identifica o cliente", () => {
    // O scraper nem sempre preenche `documento`; o número vem no meio do nome.
    const cru = parsearPartes(
      JSON.stringify([{ nome: "FULANO DE TAL - CPF: 111.222.333-44 (AUTOR)", polo: "ativo" }]),
    );
    expect(resumirPartes(cru, { searchKey: "11122233344" }).clientePolo).toBe("ativo");
  });
});
