import { describe, expect, it } from "vitest";
import { pareceBloqueioDeRede, type ResultadoSonda } from "../jurisia/sondar-fontes";

const r = (over: Partial<ResultadoSonda>): ResultadoSonda => ({
  fonte: "x",
  nome: "y",
  url: "https://exemplo.jus.br",
  pergunta: "?",
  status: 200,
  tipo: "application/json",
  bytes: 5_000,
  ms: 100,
  veredito: "responde-json",
  forma: "",
  temEmenta: null,
  erro: null,
  amostra: "",
  causa: null,
  retryNavegador: null,
  datajud: null,
  ...over,
});

const bloqueado = () =>
  r({ status: 403, bytes: 104, tipo: "text/plain", veredito: "bloqueado" });

describe("pareceBloqueioDeRede", () => {
  it("acusa quando a maioria é 403 curto em text/plain", () => {
    expect(pareceBloqueioDeRede([bloqueado(), bloqueado(), bloqueado()])).toBe(true);
  });

  it("não acusa quando alguma fonte respondeu de verdade", () => {
    // O caso que importa: o DataJud responde 200 e o resto dá 403. Isso é
    // bloqueio por destino, não proxy — e chamar de proxy manda a gente
    // investigar a rede em vez do WAF do tribunal.
    expect(pareceBloqueioDeRede([r({}), r({}), bloqueado()])).toBe(false);
  });

  it("não confunde 403 com corpo grande de página de erro do tribunal", () => {
    const paginaDeErro = r({
      status: 403,
      bytes: 18_000,
      tipo: "text/html",
      veredito: "bloqueado",
    });
    expect(pareceBloqueioDeRede([paginaDeErro, paginaDeErro])).toBe(false);
  });

  it("devolve false pra lista vazia em vez de dividir por zero", () => {
    expect(pareceBloqueioDeRede([])).toBe(false);
  });
});
