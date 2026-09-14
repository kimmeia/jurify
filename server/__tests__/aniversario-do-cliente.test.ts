/**
 * Aniversário do cliente — a data no cadastro e o lembrete.
 *
 * O grosso é comportamento de verdade: `shared/aniversario.ts` é puro, então
 * dá pra perguntar a ele o que acontece em 29 de fevereiro, na virada do ano e
 * no dia do aniversário sem subir banco nenhum. A varredura de texto cobre só
 * o que é fiação — que a coluna existe, que o cron está registrado, que o
 * catálogo conhece o aviso —, porque fiação não tem comportamento pra medir.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANO_MINIMO,
  FILTRO_ANIVERSARIO_ROTULO,
  JANELA_PROXIMO_DIAS,
  MENSAGEM_DATA_INVALIDA,
  PREFIXO_TITULO_ANIVERSARIO,
  diaComemoradoNoAno,
  diaEMes,
  estaProximo,
  mensagemParabens,
  partesDaData,
  passaNoFiltro,
  proximoAniversario,
  resumoDoDia,
  rotuloAniversario,
  validarNascimento,
} from "@shared/aniversario";
import {
  brParaIsoData,
  isoParaBrData,
  mascararDataBR,
} from "@shared/data-calendario";
import { AVISOS, GRUPOS, avisoDoTipo, padraoDaChave } from "@shared/notificacoes-avisos";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("a data lida como data", () => {
  it("recusa o que não existe em vez de normalizar em silêncio", () => {
    // O Date empurra 31 de fevereiro pra março sozinho. Uma data que "existe"
    // errada é pior do que uma recusada: ela grava e ninguém percebe.
    expect(partesDaData("2026-02-31")).toBeNull();
    expect(partesDaData("2026-13-01")).toBeNull();
    expect(partesDaData("1985-03-12")).toEqual({ ano: 1985, mes: 3, dia: 12 });
  });

  it("recusa nascimento no futuro e ano absurdo, com o motivo certo", () => {
    expect(validarNascimento("2027-01-01", "2026-09-14")).toEqual({
      ok: false,
      motivo: "futuro",
    });
    expect(validarNascimento("1899-01-01", "2026-09-14")).toEqual({
      ok: false,
      motivo: "antiga",
    });
    expect(validarNascimento("2026-09-14", "2026-09-14")).toEqual({ ok: true });
    expect(MENSAGEM_DATA_INVALIDA.futuro).toContain("futuro");
    expect(MENSAGEM_DATA_INVALIDA.antiga).toContain(String(ANO_MINIMO));
  });
});

describe("quando é o próximo aniversário", () => {
  it("o de HOJE é o próximo, não o do ano que vem", () => {
    const a = proximoAniversario("1985-09-14", "2026-09-14")!;
    expect(a.ehHoje).toBe(true);
    expect(a.diasAte).toBe(0);
    expect(a.faraIdade).toBe(41);
    expect(a.idadeHoje).toBe(41);
  });

  it("depois de passar, pula pro ano seguinte", () => {
    const a = proximoAniversario("1985-09-14", "2026-09-15")!;
    expect(a.proximo).toBe("2027-09-14");
    expect(a.diasAte).toBe(364);
    expect(a.faraIdade).toBe(42);
    expect(a.idadeHoje).toBe(41);
  });

  it("atravessa a virada do ano contando dias, não meses", () => {
    const a = proximoAniversario("1990-01-02", "2026-12-29")!;
    expect(a.proximo).toBe("2027-01-02");
    expect(a.diasAte).toBe(4);
    expect(estaProximo(a)).toBe(true);
  });

  it("29 de fevereiro é comemorado em 28 quando o ano não tem o dia 29", () => {
    expect(diaComemoradoNoAno({ ano: 2000, mes: 2, dia: 29 }, 2027)).toBe("2027-02-28");
    expect(diaComemoradoNoAno({ ano: 2000, mes: 2, dia: 29 }, 2028)).toBe("2028-02-29");
    const a = proximoAniversario("2000-02-29", "2027-02-28")!;
    expect(a.ehHoje).toBe(true);
    expect(a.faraIdade).toBe(27);
  });

  it("idade só aparece quando faz sentido", () => {
    const a = proximoAniversario("1985-09-14", "2026-09-10")!;
    expect(a.idadeHoje).toBe(40);
    expect(a.faraIdade).toBe(41);
    expect(proximoAniversario("", "2026-09-14")).toBeNull();
    expect(proximoAniversario(null, "2026-09-14")).toBeNull();
  });
});

describe("o que o cartão escreve", () => {
  it("perto conta os dias; longe mostra a data e a idade", () => {
    const hoje = proximoAniversario("1985-09-14", "2026-09-14")!;
    expect(rotuloAniversario(hoje)).toBe("Faz 41 anos hoje");

    const amanha = proximoAniversario("1985-09-15", "2026-09-14")!;
    expect(rotuloAniversario(amanha)).toBe("Faz 41 anos amanhã");

    const emTres = proximoAniversario("1985-09-17", "2026-09-14")!;
    expect(rotuloAniversario(emTres)).toBe("Faz 41 anos em 3 dias");

    const longe = proximoAniversario("1985-03-12", "2026-09-14")!;
    expect(rotuloAniversario(longe)).toBe("12 de março · 41 anos");
    expect(diaEMes(longe)).toBe("12 de março");
  });

  it("a janela do destaque é a mesma que a contagem usa", () => {
    const naBorda = proximoAniversario("1985-09-21", "2026-09-14")!;
    expect(naBorda.diasAte).toBe(JANELA_PROXIMO_DIAS);
    expect(estaProximo(naBorda)).toBe(true);
    expect(rotuloAniversario(naBorda)).toContain("em 7 dias");

    const foraDaBorda = proximoAniversario("1985-09-22", "2026-09-14")!;
    expect(estaProximo(foraDaBorda)).toBe(false);
    expect(rotuloAniversario(foraDaBorda)).toContain("22 de setembro");
  });
});

describe("o filtro da lista", () => {
  it("hoje, sete dias e o mês são recortes diferentes", () => {
    const hoje = "2026-09-14";
    expect(passaNoFiltro("1985-09-14", "hoje", hoje)).toBe(true);
    expect(passaNoFiltro("1985-09-17", "hoje", hoje)).toBe(false);
    expect(passaNoFiltro("1985-09-17", "semana", hoje)).toBe(true);
    expect(passaNoFiltro("1985-09-28", "semana", hoje)).toBe(false);
    expect(passaNoFiltro("1985-09-28", "mes", hoje)).toBe(true);
    expect(passaNoFiltro("1985-10-02", "mes", hoje)).toBe(false);
  });

  it("o mês é o mês do calendário, não os próximos 30 dias", () => {
    // Dia 2 de setembro já passou em 14/09 — continua sendo "deste mês".
    expect(passaNoFiltro("1985-09-02", "mes", "2026-09-14")).toBe(true);
    expect(passaNoFiltro("1985-09-02", "semana", "2026-09-14")).toBe(false);
  });

  it("sem data gravada ninguém entra em filtro nenhum", () => {
    for (const f of Object.keys(FILTRO_ANIVERSARIO_ROTULO) as Array<"hoje" | "semana" | "mes">) {
      expect(passaNoFiltro(null, f, "2026-09-14")).toBe(false);
      expect(passaNoFiltro("", f, "2026-09-14")).toBe(false);
    }
  });
});

describe("o lembrete do dia", () => {
  it("junta todo mundo num aviso só", () => {
    expect(resumoDoDia([])).toBeNull();

    const um = resumoDoDia(["Maria Aparecida"])!;
    expect(um.mensagem).toBe("Maria Aparecida faz aniversário hoje.");

    const tres = resumoDoDia(["Maria", "João", "Pedro"])!;
    expect(tres.mensagem).toBe("Maria, João e Pedro fazem aniversário hoje.");

    const cinco = resumoDoDia(["Maria", "João", "Pedro", "Ana", "Rita"])!;
    expect(cinco.mensagem).toContain("e mais 2");
    expect(cinco.mensagem).not.toContain("Rita");
  });

  it("os dois títulos começam pelo prefixo que o cron procura no banco", () => {
    // É por ele que o cron sabe que já mandou hoje. A memória do processo
    // morre num redeploy; o registro no sino, não.
    expect(resumoDoDia(["Maria"])!.titulo.startsWith(PREFIXO_TITULO_ANIVERSARIO)).toBe(true);
    expect(resumoDoDia(["Maria", "João"])!.titulo.startsWith(PREFIXO_TITULO_ANIVERSARIO)).toBe(true);
  });

  it("os parabéns saem com o primeiro nome, não com o nome inteiro", () => {
    expect(mensagemParabens("Maria Aparecida Nogueira de Sousa")).toContain("Maria");
    expect(mensagemParabens("Maria Aparecida Nogueira de Sousa")).not.toContain("Nogueira");
    expect(mensagemParabens("Maria", "Boyadjian")).toContain("Boyadjian");
  });
});

describe("a data digitada é lida como brasileiro", () => {
  it("máscara e conversão fecham o ciclo", () => {
    expect(mascararDataBR("12031985")).toBe("12/03/1985");
    expect(brParaIsoData("12/03/1985")).toBe("1985-03-12");
    expect(isoParaBrData("1985-03-12")).toBe("12/03/1985");
    expect(brParaIsoData("31/02/1985")).toBe("");
  });

  it("o campo NÃO é `input type=date`", () => {
    // O campo nativo desenha no idioma do NAVEGADOR: num Chrome em inglês
    // "12/03/1985" aparece como 03/12/1985. Foi a foto que pegou isso.
    const arq = ler("client/src/components/CamposQualificacaoEndereco.tsx");
    const bloco = arq.slice(arq.indexOf("Data de nascimento"));
    const campo = bloco.slice(0, bloco.indexOf("</div>"));
    expect(campo).toContain('placeholder="dd/mm/aaaa"');
    expect(campo).not.toContain('type="date"');
  });
});

describe("o aviso está no catálogo que a tela mostra", () => {
  it("existe grupo Clientes com o aniversário, ligado de fábrica", () => {
    expect(GRUPOS.some((g) => g.id === "clientes")).toBe(true);
    const aviso = AVISOS.find((a) => a.id === "clientes.aniversario");
    expect(aviso).toBeDefined();
    expect(aviso!.grupo).toBe("clientes");
    expect(aviso!.padrao).toBe(true);
    expect(padraoDaChave("clientes.aniversario")).toBe(true);
  });

  it("o tipo do cron cai no aviso certo, e o desconhecido continua passando", () => {
    expect(avisoDoTipo("aniversario_cliente")).toBe("clientes.aniversario");
    expect(avisoDoTipo("tipo_que_ninguem_declarou")).toBeNull();
  });
});

describe("a fiação", () => {
  it("a coluna existe no schema e na migration, sem apagar ninguém", () => {
    expect(ler("drizzle/schema.ts")).toContain('date("dataNascimentoContato", { mode: "string" })');
    const mig = ler("drizzle/0232_contato_data_nascimento.sql");
    expect(mig).toContain("ADD COLUMN dataNascimentoContato DATE NULL");
    expect(mig).not.toContain("DROP");
  });

  it("o cron está registrado e é CHAMADO, não só importado", () => {
    // Conferir o nome não basta: renomear só o binding do import deixa o
    // literal de pé e o job nunca roda.
    expect(ler("server/_core/cron-jobs.ts")).toContain("await rodarLembretesDeAniversario()");
  });

  it("o tipo entra na lista do que vira push, e o push sabe pra onde levar", () => {
    const sse = ler("server/_core/sse-notifications.ts");
    const lista = sse.slice(sse.indexOf("const TIPOS_PUSH"), sse.indexOf("/** Rota que a notificação"));
    expect(lista).toContain('"aniversario_cliente"');
    expect(sse).toContain('if (n.tipo === "aniversario_cliente") return "/clientes?aniversario=hoje";');
  });

  it("a tela abre no filtro que a notificação prometeu", () => {
    // Sem isto, tocar o aviso no celular cai na lista inteira.
    expect(ler("client/src/pages/Clientes.tsx")).toContain('params.get("aniversario")');
  });

  it("o cron pergunta ao BANCO se já mandou hoje, antes de cada envio", () => {
    const cron = ler("server/escritorio/cron-aniversarios.ts");
    // A CHAMADA, não o nome da função: trocar a condição por `false` deixaria
    // a definição intacta e o redeploy mandaria o aviso de hora em hora.
    expect(cron).toContain("if (await jaAvisadoHoje(db, userId, comecoDoDia)) continue;");
    // E a pergunta é pelo prefixo do título, que é o que sobrevive ao restart.
    expect(cron).toContain("like(notificacoes.titulo, `${PREFIXO_TITULO_ANIVERSARIO}%`)");
    // `<` e não `!==`: reiniciar às 8h em ponto não pode custar o dia inteiro.
    expect(cron).toContain("< HORA_DO_LEMBRETE) continue");
  });

  it("serviço encerrado, cancelado e rescindido ficam fora", () => {
    const cron = ler("server/escritorio/cron-aniversarios.ts");
    for (const s of ["encerrado", "cancelado", "rescindido"]) {
      expect(cron).toContain(`"${s}"`);
    }
  });

  it("o servidor valida a data e o filtro usa a MESMA regra da tela", () => {
    const router = ler("server/escritorio/router-clientes.ts");
    // Sempre a chamada, nunca o import: o nome sobrevive a qualquer desvio.
    expect(router).toContain("const v = validarNascimento(valor, hoje);");
    expect(router).toContain(
      "passaNoFiltro(paraIsoDeData(r.dataNascimento), input.aniversario as FiltroAniversario, hoje)",
    );
    // Os dois caminhos que gravam data resolvem o "hoje" no fuso do
    // escritório — criar e atualizar.
    const usos = router.split("await hojeDoEscritorio(db, perm.escritorioId,").length - 1;
    expect(usos).toBeGreaterThanOrEqual(3);
  });

  it("nascimento não entra na lista de campos exigidos pelo contrato", () => {
    // Exigir agora travaria a geração de contrato pra toda a carteira que já
    // existe — a data é opcional, e opcional quer dizer opcional.
    const arq = ler("client/src/components/CamposQualificacaoEndereco.tsx");
    const lista = arq.slice(
      arq.indexOf("CAMPOS_OBRIGATORIOS_QUALIFICACAO"),
      arq.indexOf("validarQualificacaoCompleta"),
    );
    expect(lista).not.toContain("dataNascimento");
  });
});
