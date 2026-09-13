/**
 * Amarras da "Visão rápida" em três linhas (Saúde do sistema).
 *
 * A pergunta do dono era "esse robô funciona?", e a tela respondia com
 * números. As regras que transformam número em frase moram em
 * `shared/saude-semaforos.ts` e são puras — aqui elas são exercitadas nas
 * bordas (36 h, 2 s por tela, 3 varreduras, captura do Sentry) — e uma
 * varredura de texto garante que a tela USA essas funções (import +
 * chamada) em vez de carregar uma cópia, e que nada do que existia sumiu:
 * os 4 cards, as duas listas e a fila de tribunais continuam no arquivo,
 * dobrados em "Detalhes técnicos".
 *
 * Mutações conferidas em `scratchpad/mutar-saude-semaforos.py`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HORAS_SEM_RODAR_MAXIMO,
  MS_POR_TELA_MINIMO,
  VARREDURAS_PARA_REPETICAO,
  achadosRepetidos,
  capturaSentryConfigurada,
  jornadaNaoConfiavel,
  montarSemaforosDaVisaoRapida,
  motivoLeituraLegivel,
  quandoRodou,
  semaforoAuditor,
  semaforoErros,
  semaforoJornada,
  ultimoErroVisto,
  type LeituraErrosVisaoRapida,
  type VarreduraAuditorSemaforo,
  type VarreduraJornadaSemaforo,
} from "../../shared/saude-semaforos";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const FUSO = "America/Sao_Paulo";
/** 12/09/2026, meio-dia em Brasília. */
const AGORA = new Date("2026-09-12T12:00:00-03:00");
const HORA = 60 * 60 * 1000;

function antes(ms: number): string {
  return new Date(AGORA.getTime() - ms).toISOString();
}

// ---------------------------------------------------------------------------
// 1. Erros no sistema
// ---------------------------------------------------------------------------

describe("semaforoErros", () => {
  it("captura não configurada + 0 abertos = âmbar 'não dá pra afirmar', com as DUAS variáveis na frase", () => {
    const s = semaforoErros({ capturaConfigurada: false, abertos: 0, ultimoErroEm: null }, AGORA);
    expect(s.cor).toBe("ambar");
    expect(s.titulo).toBe("Erros no sistema — não dá pra afirmar");
    expect(s.frase).toContain("Nenhum erro chegou");
    // `initSentry` liga com qualquer uma das duas; a frase mandava criar só a
    // primeira — e nunca ficava verde com a genérica. `\b` separa
    // "SENTRY_DSN" de "SENTRY_DSN_BACKEND" (uma é prefixo da outra).
    expect(s.frase).toContain("SENTRY_DSN_BACKEND");
    expect(s.frase).toMatch(/\bSENTRY_DSN\b/);
    expect(s.acao).toEqual({ rotulo: "Como confirmar", tipo: "aba_erros" });
  });

  it("página cheia (totalMinimo) = '25+ erros abertos' — a procedure devolve UMA página, não o total", () => {
    const s = semaforoErros({ capturaConfigurada: true, abertos: 25, ultimoErroEm: null, totalMinimo: true }, AGORA);
    expect(s.cor).toBe("vermelho");
    expect(s.titulo).toBe("Erros no sistema — 25+ erros abertos");
    expect(s.frase).toBe("Pelo menos 25 erros não resolvidos no Sentry.");
    // página que NÃO veio cheia continua afirmando a contagem exata
    const exato = semaforoErros({ capturaConfigurada: true, abertos: 25, ultimoErroEm: null, totalMinimo: false }, AGORA);
    expect(exato.titulo).toBe("Erros no sistema — 25 erros abertos");
    expect(exato.frase).toBe("25 erros não resolvidos no Sentry.");
  });

  it("captura configurada + 0 abertos = verde", () => {
    const s = semaforoErros({ capturaConfigurada: true, abertos: 0, ultimoErroEm: null }, AGORA);
    expect(s.cor).toBe("verde");
    expect(s.titulo).toBe("Erros no sistema — nenhum erro aberto");
    expect(s.acao?.tipo).toBe("aba_erros");
  });

  it("abertos > 0 = vermelho com a contagem, mesmo sem captura confirmada (erro é real)", () => {
    const tres = semaforoErros({ capturaConfigurada: false, abertos: 3, ultimoErroEm: antes(2 * HORA) }, AGORA);
    expect(tres.cor).toBe("vermelho");
    expect(tres.titulo).toBe("Erros no sistema — 3 erros abertos");
    expect(tres.frase).toContain("há 2h");
    expect(tres.acao).toEqual({ rotulo: "Ver os erros", tipo: "aba_erros" });

    const um = semaforoErros({ capturaConfigurada: true, abertos: 1, ultimoErroEm: null }, AGORA);
    expect(um.cor).toBe("vermelho");
    expect(um.titulo).toBe("Erros no sistema — 1 erro aberto");
  });

  it("leitura do Sentry falhou = âmbar, nunca verde (zero sem leitura não prova nada)", () => {
    const s = semaforoErros(
      { capturaConfigurada: true, abertos: 0, ultimoErroEm: null, leituraFalhou: "timeout" },
      AGORA,
    );
    expect(s.cor).toBe("ambar");
    expect(s.titulo).toBe("Erros no sistema — não dá pra afirmar");
    expect(s.frase).toContain("demorou");
    expect(s.acao?.tipo).toBe("aba_erros");
  });

  it("motivoLeituraLegivel traduz os motivos da procedure", () => {
    expect(motivoLeituraLegivel("sentry_nao_configurado")).toContain("token");
    expect(motivoLeituraLegivel("erro_rede")).toContain("rede");
    expect(motivoLeituraLegivel("sentry_http_401")).toContain("HTTP 401");
    expect(motivoLeituraLegivel("outro")).toBe("outro");
  });
});

describe("capturaSentryConfigurada", () => {
  it("é a MESMA régua de initSentry: SENTRY_DSN_BACKEND ou, na falta dela, SENTRY_DSN", () => {
    expect(capturaSentryConfigurada({})).toBe(false);
    expect(capturaSentryConfigurada({ SENTRY_DSN_BACKEND: "" })).toBe(false);
    expect(capturaSentryConfigurada({ SENTRY_DSN_BACKEND: "   " })).toBe(false);
    expect(capturaSentryConfigurada({ SENTRY_DSN: "" })).toBe(false);
    expect(capturaSentryConfigurada({ SENTRY_DSN: "   " })).toBe(false);
    expect(capturaSentryConfigurada({ SENTRY_DSN_BACKEND: "https://x@sentry.io/1" })).toBe(true);
    // Só a genérica no Railway: o servidor sobe com "Sentry ativo" — a tela
    // dizia que a captura não estava confirmada e mandava criar outra variável.
    expect(capturaSentryConfigurada({ SENTRY_DSN: "https://x@sentry.io/1" })).toBe(true);
    expect(capturaSentryConfigurada({ SENTRY_DSN_BACKEND: "", SENTRY_DSN: "https://x@sentry.io/1" })).toBe(true);
  });

  it("initSentry continua com o mesmo fallback — se ele mudar, a régua daqui muda junto", () => {
    const sentry = ler("server/_core/sentry.ts");
    expect(sentry).toContain("process.env.SENTRY_DSN_BACKEND || process.env.SENTRY_DSN");
  });
});

// ---------------------------------------------------------------------------
// 2. Robô auditor
// ---------------------------------------------------------------------------

function varredura(
  iniciadoEm: string,
  achados: number,
  extra: Partial<VarreduraAuditorSemaforo> = {},
): VarreduraAuditorSemaforo {
  return { iniciadoEm, achados, regrasComErro: 0, ...extra };
}

const HOJE_3H = "2026-09-12T03:00:00-03:00";
const ONTEM_3H = "2026-09-11T03:00:00-03:00";
const ANTEONTEM_3H = "2026-09-10T03:00:00-03:00";

describe("semaforoAuditor", () => {
  it("nunca rodou = cinza com 'Rodar varredura'", () => {
    const s = semaforoAuditor([], AGORA, FUSO);
    expect(s.cor).toBe("cinza");
    expect(s.titulo).toBe("Robô auditor — ainda não rodou");
    expect(s.acao).toEqual({ rotulo: "Rodar varredura", tipo: "rodar_auditor" });
  });

  it("borda das 36 h: exatamente 36 h ainda vale; um minuto a mais é 'não roda desde'", () => {
    expect(HORAS_SEM_RODAR_MAXIMO).toBe(36);
    const noLimite = semaforoAuditor([varredura(antes(36 * HORA), 0)], AGORA, FUSO);
    expect(noLimite.cor).toBe("verde");

    const passou = semaforoAuditor([varredura(antes(36 * HORA + 60_000), 0)], AGORA, FUSO);
    expect(passou.cor).toBe("vermelho");
    expect(passou.titulo).toContain("não roda desde 10/09");
    expect(passou.acao).toEqual({ rotulo: "Rodar varredura", tipo: "rodar_auditor" });
  });

  it("regra que falhou = vermelho, mesmo sem achado", () => {
    const s = semaforoAuditor([varredura(HOJE_3H, 0, { regrasComErro: 2 })], AGORA, FUSO);
    expect(s.cor).toBe("vermelho");
    expect(s.titulo).toBe("Robô auditor — 2 regras falharam");
    expect(s.acao?.tipo).toBe("aba_auditor");
    expect(semaforoAuditor([varredura(HOJE_3H, 0, { regrasComErro: 1 })], AGORA, FUSO).titulo).toBe(
      "Robô auditor — 1 regra falhou",
    );
  });

  it("0 achados = verde 'rodou hoje às HH:MM, nada encontrado'", () => {
    const s = semaforoAuditor([varredura(HOJE_3H, 0)], AGORA, FUSO);
    expect(s.cor).toBe("verde");
    expect(s.titulo).toBe("Robô auditor — rodou hoje às 03:00, nada encontrado");
  });

  it("achados sem repetição = âmbar com o número e 'Ver os N e resolver'", () => {
    const s = semaforoAuditor([varredura(HOJE_3H, 5), varredura(ONTEM_3H, 0)], AGORA, FUSO);
    expect(s.cor).toBe("ambar");
    expect(s.titulo).toBe("Robô auditor — achou 5 pontos");
    expect(s.frase).toBe("Rodou hoje às 03:00 e achou 5 pontos no banco.");
    expect(s.frase).not.toContain("mesmos");
    expect(s.acao).toEqual({ rotulo: "Ver os 5 e resolver", tipo: "aba_auditor" });
  });

  it("os mesmos achados 3 dias seguidos = 'de ontem e de anteontem', comparando pelas regras", () => {
    const regras = [
      { id: "LEA-01", total: 3 },
      { id: "COB-02", total: 2 },
    ];
    const s = semaforoAuditor(
      [
        varredura(HOJE_3H, 5, { regras }),
        varredura(ONTEM_3H, 5, { regras }),
        varredura(ANTEONTEM_3H, 5, { regras }),
      ],
      AGORA,
      FUSO,
    );
    expect(s.cor).toBe("ambar");
    expect(s.titulo).toBe("Robô auditor — funciona, mas ninguém olha");
    expect(s.frase).toContain("São os mesmos 5 de ontem e de anteontem");
    expect(s.frase).toContain("as mesmas regras violadas");
    expect(s.acao).toEqual({ rotulo: "Ver os 5 e resolver", tipo: "aba_auditor" });
  });

  it("três varreduras no mesmo dia não viram 'ontem e anteontem'", () => {
    const s = semaforoAuditor(
      [varredura(HOJE_3H, 5), varredura("2026-09-12T02:00:00-03:00", 5), varredura("2026-09-12T01:00:00-03:00", 5)],
      AGORA,
      FUSO,
    );
    expect(s.frase).toContain("São os mesmos 5 das 2 varreduras anteriores (desde 12/09)");
    expect(s.frase).toContain("mesmo número de achados");
  });
});

describe("achadosRepetidos", () => {
  it("precisa de 3 varreduras, todas com achado", () => {
    expect(VARREDURAS_PARA_REPETICAO).toBe(3);
    expect(achadosRepetidos([varredura(HOJE_3H, 5), varredura(ONTEM_3H, 5)]).repetido).toBe(false);
    expect(
      achadosRepetidos([varredura(HOJE_3H, 5), varredura(ONTEM_3H, 0), varredura(ANTEONTEM_3H, 5)]).repetido,
    ).toBe(false);
    // Zero na mais antiga: o número "não caiu" (5 ≥ 5 ≥ 0), mas uma varredura
    // limpa no trio significa que o achado NASCEU depois — não está parado.
    expect(
      achadosRepetidos([varredura(HOJE_3H, 5), varredura(ONTEM_3H, 5), varredura(ANTEONTEM_3H, 0)]).repetido,
    ).toBe(false);
  });

  it("com regras no histórico compara os ids violados — número igual com regras diferentes NÃO repete", () => {
    const a = [{ id: "LEA-01", total: 5 }];
    const b = [{ id: "COB-02", total: 5 }];
    const r = achadosRepetidos([
      varredura(HOJE_3H, 5, { regras: a }),
      varredura(ONTEM_3H, 5, { regras: b }),
      varredura(ANTEONTEM_3H, 5, { regras: a }),
    ]);
    expect(r.repetido).toBe(false);

    const igual = achadosRepetidos([
      varredura(HOJE_3H, 5, { regras: a }),
      varredura(ONTEM_3H, 5, { regras: a }),
      varredura(ANTEONTEM_3H, 5, { regras: a }),
    ]);
    expect(igual).toEqual({ repetido: true, criterio: "regras", achados: 5, desde: ANTEONTEM_3H });
  });

  it("regra com erro não conta como violada; ordem dos ids não importa", () => {
    const r = achadosRepetidos([
      varredura(HOJE_3H, 2, { regras: [{ id: "B", total: 1 }, { id: "A", total: 1 }] }),
      varredura(ONTEM_3H, 2, { regras: [{ id: "A", total: 1 }, { id: "B", total: 1 }, { id: "C", total: 1, erro: "x" }] }),
      varredura(ANTEONTEM_3H, 2, { regras: [{ id: "A", total: 1 }, { id: "B", total: 1 }] }),
    ]);
    expect(r.repetido).toBe(true);
    expect(r.criterio).toBe("regras");
  });

  it("sem regras cai pro número: repete quando não caiu; caiu = não repete", () => {
    expect(achadosRepetidos([varredura(HOJE_3H, 5), varredura(ONTEM_3H, 5), varredura(ANTEONTEM_3H, 5)])).toEqual({
      repetido: true,
      criterio: "numero",
      achados: 5,
      desde: ANTEONTEM_3H,
    });
    // cresceu (7 hoje, 6 ontem, 5 anteontem) = não caiu = ninguém resolveu
    expect(achadosRepetidos([varredura(HOJE_3H, 7), varredura(ONTEM_3H, 6), varredura(ANTEONTEM_3H, 5)]).repetido).toBe(true);
    // caiu (5 hoje, 6 ontem, 7 anteontem) = alguém está resolvendo
    expect(achadosRepetidos([varredura(HOJE_3H, 5), varredura(ONTEM_3H, 6), varredura(ANTEONTEM_3H, 7)]).repetido).toBe(false);
  });

  it("histórico misto (uma linha sem regras) cai pro número", () => {
    const r = achadosRepetidos([
      varredura(HOJE_3H, 5, { regras: [{ id: "A", total: 5 }] }),
      varredura(ONTEM_3H, 5),
      varredura(ANTEONTEM_3H, 5, { regras: [{ id: "A", total: 5 }] }),
    ]);
    expect(r.criterio).toBe("numero");
  });
});

// ---------------------------------------------------------------------------
// 3. Robô de jornada
// ---------------------------------------------------------------------------

function jornada(extra: Partial<VarreduraJornadaSemaforo> = {}): VarreduraJornadaSemaforo {
  return {
    status: "concluida",
    iniciadoEm: HOJE_3H,
    duracaoMs: 95_000,
    rotasVisitadas: 19,
    rotasComAchado: 0,
    ...extra,
  };
}

describe("jornadaNaoConfiavel", () => {
  it("régua é 2 s por tela: abaixo é suspeito, exatamente 2 s não", () => {
    expect(MS_POR_TELA_MINIMO).toBe(2000);
    expect(jornadaNaoConfiavel({ rotasVisitadas: 19, duracaoMs: 32_000 })).toBe(true);
    expect(jornadaNaoConfiavel({ rotasVisitadas: 10, duracaoMs: 19_999 })).toBe(true);
    expect(jornadaNaoConfiavel({ rotasVisitadas: 10, duracaoMs: 20_000 })).toBe(false);
    expect(jornadaNaoConfiavel({ rotasVisitadas: 0, duracaoMs: 0 })).toBe(false);
    expect(jornadaNaoConfiavel({ rotasVisitadas: 10, duracaoMs: null })).toBe(false);
  });
});

describe("semaforoJornada", () => {
  it("nunca rodou = cinza com 'Rodar agora'; só 'rodando' = cinza sem botão", () => {
    const s = semaforoJornada([], AGORA, FUSO);
    expect(s.cor).toBe("cinza");
    expect(s.titulo).toBe("Robô de jornada — ainda não rodou");
    expect(s.acao).toEqual({ rotulo: "Rodar agora", tipo: "rodar_jornada" });

    const voo = semaforoJornada([jornada({ status: "rodando", duracaoMs: null })], AGORA, FUSO);
    expect(voo.cor).toBe("cinza");
    expect(voo.titulo).toContain("rodando agora");
    expect(voo.acao).toBeUndefined();
  });

  it("rápido demais = VERMELHO 'resultado não confiável' com a frase e 'Rodar de novo' — mesmo com 0 achados", () => {
    const s = semaforoJornada([jornada({ duracaoMs: 32_000, rotasVisitadas: 19 })], AGORA, FUSO);
    expect(s.cor).toBe("vermelho");
    expect(s.titulo).toBe("Robô de jornada — resultado não confiável");
    expect(s.frase).toBe("Passou por 19 telas em 32 segundos — rápido demais pra ter olhado de verdade.");
    expect(s.acao).toEqual({ rotulo: "Rodar de novo", tipo: "rodar_jornada" });
  });

  it("falhou = vermelho com o motivo e 'Rodar de novo'", () => {
    const s = semaforoJornada([jornada({ status: "falhou", erro: "browser não subiu" })], AGORA, FUSO);
    expect(s.cor).toBe("vermelho");
    expect(s.titulo).toBe("Robô de jornada — a última varredura falhou");
    expect(s.frase).toContain("browser não subiu");
    expect(s.acao?.tipo).toBe("rodar_jornada");
  });

  it("achados > 0 = âmbar com o número e 'Ver o que quebrou'", () => {
    const s = semaforoJornada([jornada({ rotasComAchado: 2 })], AGORA, FUSO);
    expect(s.cor).toBe("ambar");
    expect(s.titulo).toBe("Robô de jornada — 2 telas com problema");
    expect(s.frase).toContain("2 não abriram direito");
    expect(s.acao).toEqual({ rotulo: "Ver o que quebrou", tipo: "aba_jornada" });
    expect(semaforoJornada([jornada({ rotasComAchado: 1 })], AGORA, FUSO).titulo).toBe(
      "Robô de jornada — 1 tela com problema",
    );
  });

  it("0 achados e ritmo normal = verde; a linha 'rodando' é ignorada em favor da última que terminou", () => {
    const s = semaforoJornada(
      [jornada({ status: "rodando", duracaoMs: null, iniciadoEm: antes(60_000) }), jornada()],
      AGORA,
      FUSO,
    );
    expect(s.cor).toBe("verde");
    expect(s.titulo).toBe("Robô de jornada — rodou hoje às 03:00, nada quebrou");
    expect(s.frase).toBe("Passou por 19 telas em 95 s e todas abriram.");
  });
});

describe("quandoRodou", () => {
  it("hoje / ontem / dia curto, no fuso pedido", () => {
    expect(quandoRodou(HOJE_3H, AGORA, FUSO)).toBe("hoje às 03:00");
    expect(quandoRodou(ONTEM_3H, AGORA, FUSO)).toBe("ontem às 03:00");
    expect(quandoRodou(ANTEONTEM_3H, AGORA, FUSO)).toBe("em 10/09 às 03:00");
  });
});

// ---------------------------------------------------------------------------
// 4. As telas usam a shared (import + chamada), e nada sumiu
// ---------------------------------------------------------------------------

describe("Visão rápida em três linhas (AdminSaude.tsx)", () => {
  const saude = ler("client/src/pages/admin/AdminSaude.tsx");

  it("monta as três linhas pela shared, entregando o que as TRÊS queries devolveram — não carrega cópia", () => {
    const importacao = saude.match(/import \{[^}]*\} from "@shared\/saude-semaforos"/);
    expect(importacao, "a tela não importa shared/saude-semaforos").toBeTruthy();
    expect(importacao![0]).toContain("montarSemaforosDaVisaoRapida");
    // O cabo procedure → regra é pinado inteiro: `abertos: 0`, `isError: false`
    // e `data: undefined` passavam no typecheck e na suíte inteira quando a
    // montagem morava aqui.
    expect(saude).toContain(
      [
        "  const semaforos = montarSemaforosDaVisaoRapida({",
        "    erros: { data: erros.data, isError: erros.isError },",
        "    auditor: { data: auditor.data },",
        "    jornada: { data: jornada.data },",
        "    agora,",
        "  });",
      ].join("\n"),
    );
    expect(saude, "há uma função semaforo* local — a regra tem que morar na shared").not.toMatch(
      /function semaforo/,
    );
    for (const fn of ["semaforoErros", "semaforoAuditor", "semaforoJornada"]) {
      expect(saude, `${fn} chamada direto na tela — a montagem é da shared`).not.toMatch(new RegExp(`${fn}\\(`));
    }
    // as três queries que alimentam a montagem são as reais
    expect(saude).toContain('trpc.adminErros.listar.useQuery(\n    { status: "unresolved", limite: 25, pagina: 1 }');
    expect(saude).toContain("trpc.adminRoboAuditor.historico.useQuery(\n    { limite: 4 }");
    expect(saude).toContain("trpc.adminJornada.historico.useQuery(\n    { limite: 4 }");
  });

  it("liga os botões às ações reais — cada tipo abre a SUA aba", () => {
    expect(saude).toContain("trpc.adminJornada.rodar.useMutation");
    expect(saude).toContain("trpc.adminRoboAuditor.varrer.useMutation");
    // "Rodar" tem que RODAR — a mutation existir não prova que o botão a chama.
    expect(saude).toContain('tipo === "rodar_auditor") varrerAuditor.mutate({})');
    expect(saude).toContain('tipo === "rodar_jornada") rodarJornada.mutate()');
    // A linha inteira: `irParaAba("erros")` solto também existe no card
    // "Últimos erros" da dobra, e "Ver os erros" abrindo E-mails passava.
    expect(saude).toContain('if (tipo === "aba_erros") irParaAba("erros");');
    expect(saude).toContain('else if (tipo === "aba_auditor") irParaAba("robo-auditor");');
    expect(saude).toContain('else if (tipo === "aba_jornada") irParaAba("robo-jornada");');
  });

  it("as três linhas vêm ANTES dos detalhes, e os detalhes nascem fechados", () => {
    expect(saude).toContain("const [detalhes, setDetalhes] = useState(false)");
    expect(saude).toContain("Detalhes técnicos");
    const linha = saude.indexOf("<LinhaSemaforo");
    const dobra = saude.indexOf("<Collapsible ");
    expect(linha).toBeGreaterThan(-1);
    expect(dobra).toBeGreaterThan(linha);
  });

  it("os 4 cards, as duas listas e a fila continuam no arquivo, dentro da dobra", () => {
    const abre = saude.indexOf("<CollapsibleContent");
    const fecha = saude.indexOf("</CollapsibleContent>");
    expect(abre).toBeGreaterThan(-1);
    expect(fecha).toBeGreaterThan(abre);
    const dentro = saude.slice(abre, fecha);
    for (const titulo of [
      "Erros abertos",
      "Robô auditor",
      "Robô de jornada",
      "E-mails · 24h",
      "Últimos erros",
      "Últimas rondas dos robôs",
      "<FilaTribunais />",
    ]) {
      expect(dentro, `"${titulo}" saiu da Visão rápida`).toContain(titulo);
    }
  });

  it("cabe em 390px: a linha quebra e o texto pode encolher", () => {
    const i = saude.indexOf("function LinhaSemaforo");
    const trecho = saude.slice(i, saude.indexOf("function VisaoRapida"));
    expect(trecho).toContain("flex-wrap");
    expect(trecho).toContain("min-w-0");
  });
});

describe("o selo 'não confiável' na aba Robô de jornada", () => {
  it("usa a MESMA régua da shared", () => {
    const pagina = ler("client/src/pages/admin/AdminRoboJornada.tsx");
    expect(pagina).toMatch(/import \{[^}]*jornadaNaoConfiavel[^}]*\} from "@shared\/saude-semaforos"/);
    expect(pagina).toContain("jornadaNaoConfiavel(ultima)");
    expect(pagina).toContain("NÃO CONFIÁVEL");
  });
});

describe("a captura do Sentry é afirmada pelo servidor, não presumida", () => {
  it("adminErros.listar devolve capturaConfigurada lido de process.env em TODAS as saídas", () => {
    const router = ler("server/admin/router-admin-erros.ts");
    const ini = router.indexOf("listar: adminProcedure");
    const fim = router.indexOf("resolver: adminProcedure");
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    const listar = router.slice(ini, fim);
    expect(listar).toContain("capturaSentryConfigurada(process.env)");
    // Cada `return {` da procedure (sem token, HTTP, sucesso, catch) leva o
    // campo — contado no TRECHO, não no arquivo, senão o comentário engorda.
    const saidas = (listar.match(/return \{/g) || []).length;
    expect(saidas).toBeGreaterThanOrEqual(4);
    expect((listar.match(/\bcapturaConfigurada,/g) || []).length).toBe(saidas);
    expect(listar).not.toMatch(/capturaConfigurada:\s*(true|false)\b/);
    // `total` é o tamanho da página pedida ao Sentry (`limit=25`): página
    // cheia devolve `totalMinimo` pra tela escrever "25+", e as saídas sem
    // leitura levam o campo também (a tela lê a união dos quatro `return`).
    expect(listar).toContain('params.set("limit", String(input.limite))');
    expect(listar).toContain("totalMinimo: data.length >= input.limite,");
    expect((listar.match(/\btotalMinimo:/g) || []).length).toBe(saidas);
  });

  it("a aba Erros explica as DUAS variáveis quando a captura não está confirmada", () => {
    const erros = ler("client/src/pages/admin/AdminErros.tsx");
    expect(erros).toContain("capturaConfigurada === false");
    expect(erros).toContain("<code>SENTRY_DSN_BACKEND</code>");
    expect(erros).toContain("<code>SENTRY_DSN</code>");
    expect(erros).toContain("Railway");
  });
});

// ---------------------------------------------------------------------------
// 5. A montagem da Visão rápida, com os payloads no formato das procedures
// ---------------------------------------------------------------------------

describe("montarSemaforosDaVisaoRapida", () => {
  /** Uma issue como `adminErros.listar` a devolve. */
  function issue(ultimoVisto: string) {
    return {
      id: "1",
      shortId: "JF-1",
      titulo: "TypeError",
      local: "router",
      ocorrencias: 3,
      usuariosAfetados: 1,
      primeiroVisto: antes(5 * HORA),
      ultimoVisto,
      nivel: "error",
      status: "unresolved",
      link: "https://sentry.io/x",
    };
  }
  /** `adminErros.listar` com o Sentry lido de verdade (sem `motivo`). */
  function lido(issues: ReturnType<typeof issue>[], extra: Partial<LeituraErrosVisaoRapida> = {}): LeituraErrosVisaoRapida {
    return {
      configurado: true,
      capturaConfigurada: true,
      issues,
      total: issues.length,
      totalMinimo: false,
      ...extra,
    } as LeituraErrosVisaoRapida;
  }
  const semHistorico = { auditor: { data: undefined }, jornada: { data: undefined } };

  it("issues abertas → vermelho com a contagem e o último visto — `abertos` vem de `total`", () => {
    const r = montarSemaforosDaVisaoRapida({
      erros: { data: lido([issue(antes(2 * HORA)), issue(antes(30 * HORA)), issue(antes(6 * HORA))]), isError: false },
      ...semHistorico,
      agora: AGORA,
    });
    expect(r.erros.cor).toBe("vermelho");
    expect(r.erros.titulo).toBe("Erros no sistema — 3 erros abertos");
    expect(r.erros.frase).toBe("3 erros não resolvidos no Sentry, o último visto há 2h.");
  });

  it("página cheia → '25+' (é `totalMinimo` da procedure, não a tela contando)", () => {
    const pagina = Array.from({ length: 25 }, () => issue(antes(HORA)));
    const r = montarSemaforosDaVisaoRapida({
      erros: { data: lido(pagina, { totalMinimo: true }), isError: false },
      ...semHistorico,
      agora: AGORA,
    });
    expect(r.erros.titulo).toBe("Erros no sistema — 25+ erros abertos");
  });

  it("`motivo` da procedure (sem token, HTTP, timeout) → âmbar, nunca verde", () => {
    const semToken: LeituraErrosVisaoRapida = {
      configurado: false,
      capturaConfigurada: true,
      issues: [],
      total: 0,
      totalMinimo: false,
      motivo: "sentry_nao_configurado",
    } as LeituraErrosVisaoRapida;
    const r = montarSemaforosDaVisaoRapida({ erros: { data: semToken, isError: false }, ...semHistorico, agora: AGORA });
    expect(r.erros.cor).toBe("ambar");
    expect(r.erros.frase).toContain("token da API");

    const http = montarSemaforosDaVisaoRapida({
      erros: { data: { ...semToken, configurado: true, motivo: "sentry_http_401" } as LeituraErrosVisaoRapida, isError: false },
      ...semHistorico,
      agora: AGORA,
    });
    expect(http.erros.cor).toBe("ambar");
    expect(http.erros.frase).toContain("HTTP 401");
  });

  it("a query em erro (sem `data`) → âmbar 'erro de rede' — o `isError` do tRPC conta", () => {
    const r = montarSemaforosDaVisaoRapida({ erros: { data: undefined, isError: true }, ...semHistorico, agora: AGORA });
    expect(r.erros.cor).toBe("ambar");
    expect(r.erros.frase).toContain("erro de rede");
  });

  it("0 issues, captura confirmada, sem motivo → verde; sem captura → âmbar", () => {
    const verde = montarSemaforosDaVisaoRapida({ erros: { data: lido([]), isError: false }, ...semHistorico, agora: AGORA });
    expect(verde.erros.cor).toBe("verde");
    const ambar = montarSemaforosDaVisaoRapida({
      erros: { data: lido([], { capturaConfigurada: false }), isError: false },
      ...semHistorico,
      agora: AGORA,
    });
    expect(ambar.erros.cor).toBe("ambar");
    expect(ambar.erros.frase).toContain("não está confirmada");
  });

  it("auditor e jornada recebem as `varreduras` dos históricos — não uma lista vazia", () => {
    const regras = [{ id: "LEA-01", total: 5 }];
    const r = montarSemaforosDaVisaoRapida({
      erros: { data: lido([]), isError: false },
      auditor: {
        data: {
          varreduras: [
            varredura(HOJE_3H, 5, { regras }),
            varredura(ONTEM_3H, 5, { regras }),
            varredura(ANTEONTEM_3H, 5, { regras }),
          ],
        },
      },
      jornada: {
        data: {
          // a linha `rodando` de agora vem primeiro no histórico; a que conta é a última que TERMINOU
          varreduras: [jornada({ status: "rodando", duracaoMs: null, iniciadoEm: antes(60_000) }), jornada({ rotasComAchado: 2 })],
          emAndamento: true,
        },
      },
      agora: AGORA,
      fuso: FUSO,
    });
    expect(r.auditor.titulo).toBe("Robô auditor — funciona, mas ninguém olha");
    expect(r.jornada.titulo).toBe("Robô de jornada — 2 telas com problema");
    expect(r.jornada.frase).toContain("Rodou hoje às 03:00");
  });

  it("históricos ainda sem resposta → cinza 'ainda não rodou' (a tela mostra esqueleto enquanto carrega)", () => {
    const r = montarSemaforosDaVisaoRapida({ erros: { data: lido([]), isError: false }, ...semHistorico, agora: AGORA });
    expect(r.auditor.titulo).toBe("Robô auditor — ainda não rodou");
    expect(r.jornada.titulo).toBe("Robô de jornada — ainda não rodou");
  });

  it("ultimoErroVisto pega o `ultimoVisto` mais recente e ignora vazio", () => {
    expect(ultimoErroVisto([])).toBeNull();
    expect(ultimoErroVisto([{ ultimoVisto: null }, { ultimoVisto: undefined }])).toBeNull();
    const a = antes(3 * HORA);
    const b = antes(HORA);
    expect(ultimoErroVisto([{ ultimoVisto: a }, { ultimoVisto: b }, { ultimoVisto: a }])).toBe(b);
  });
});

describe("card 'Precisa de você' do robô auditor (AdminDashboard.tsx)", () => {
  it("o esqueleto espera o histórico do auditor — senão o verde 'nenhum achado parado' sai antes da resposta", () => {
    const dash = ler("client/src/pages/AdminDashboard.tsx");
    expect(dash).toMatch(/const carregando =[^;]*auditor\.isLoading/);
  });

  it("o card de erros escreve '25+' quando a página do Sentry veio cheia", () => {
    const dash = ler("client/src/pages/AdminDashboard.tsx");
    expect(dash).toContain('titulo={`${errosAbertos}${erros.data?.totalMinimo ? "+" : ""} ${errosAbertos === 1 ? "erro aberto" : "erros abertos"}`}');
  });

  it("usa achadosRepetidos da shared e aponta pra uma aba que existe em AdminSaude", () => {
    const dash = ler("client/src/pages/AdminDashboard.tsx");
    expect(dash).toMatch(/import \{[^}]*achadosRepetidos[^}]*\} from "@shared\/saude-semaforos"/);
    expect(dash).toContain("achadosRepetidos(");
    expect(dash).toContain("repeticaoAuditor.repetido ? 1 : 0");
    const link = dash.match(/\/admin\/saude\?aba=([a-z-]+)"\)\}\s*linhas=\{\[\s*\{\s*texto: \(\s*<span[^>]*>\s*os mesmos/);
    expect(link, "card do auditor não aponta pra /admin/saude?aba=…").toBeTruthy();

    const saude = ler("client/src/pages/admin/AdminSaude.tsx");
    const abas = saude.match(/const ABAS_VALIDAS = \[([^\]]+)\]/)![1].match(/"([^"]+)"/g)!.map((s) => s.replace(/"/g, ""));
    expect(abas, `aba "${link![1]}" não existe em ABAS_VALIDAS`).toContain(link![1]);
  });
});
