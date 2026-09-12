/**
 * Tribunais: o texto honesto em todos os lugares (decisão 2 do dono).
 *
 * Havia um número diferente em cada tela ("+90 tribunais", "16 estados",
 * "TJCE 1º grau. Próximos: TJSP…") e nenhum era o que o robô faz. Agora a
 * cobertura tem UMA fonte (`coberturaTribunais` em shared/tribunais-pje.ts)
 * e todo texto — site, planos, app, mensagens de erro, Cofre — sai dela.
 * O que estas amarras travam:
 *  - os números são DERIVADOS da lista (ninguém digita 12, 16 ou 17);
 *  - TJDFT é a sigla de exibição, TRF5 fica separado (consulta pública);
 *  - a lista compartilhada bate com o registro do motor no servidor;
 *  - as quatro mensagens de recusa do router usam o mesmo helper;
 *  - nenhum "+90 tribunais" / "todos os tribunais" sobrou no client;
 *  - a migration troca o bullet certo de cada plano, idempotente;
 *  - "Avisar quando chegar" avisa de verdade: só quem não foi avisado,
 *    grava `avisadoEm`, e a procedure audita.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  TRIBUNAIS_CONSULTA_PUBLICA_PJE,
  TRIBUNAIS_PJE,
  avisoProcessoForaDaCobertura,
  bulletVigiaPlano,
  chipPjeIntegracoes,
  coberturaTribunais,
  codigosTribunaisCobertos,
  listaSiglasCobertas,
  mensagemTribunalSemMotor,
  parseCnjTribunalPuro,
  resumoPjeNacional,
  rotuloPjeNacional,
  siglaConsultaNaHora,
  textoConsultaNaHora,
  textoCoberturaComparativo,
  textoCoberturaCurto,
  textoCoberturaGuia,
  textoCoberturaPricing,
  tjsCobertos,
  totalTribunaisVigiaveis,
  trfsCobertos,
} from "../../shared/tribunais-pje";
import {
  TRIBUNAIS_CONSULTA_PUBLICA,
  TRIBUNAIS_MOTOR_PROPRIO,
  tribunaisPjeDisponiveis,
} from "../processos/tribunais-pdpj";
import { parseCnjTribunal } from "../processos/cnj-parser";
import {
  agruparInteresses,
  avisarInteressados,
  normalizarTribunalInteresse,
  type DepsAvisar,
  type InteresseRow,
} from "../admin/interesse-tribunais";
import { TIPO_EMAIL_TRIBUNAL_DISPONIVEL, textoEmailTribunalDisponivel } from "../_core/email";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

function arquivosDoClient(dir = join(raiz, "client", "src")): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosDoClient(caminho));
    else if (/\.(tsx?|jsx?)$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

const nTjs = TRIBUNAIS_PJE.filter((t) => t.codigo.startsWith("tj")).length;
const nTrfs = TRIBUNAIS_PJE.filter((t) => t.codigo.startsWith("trf")).length;
// "TRF5, TRT2 e TRT15" — derivado da lista de consulta pública, como os helpers.
const siglasPublicas = TRIBUNAIS_CONSULTA_PUBLICA_PJE.map((t) => t.sigla);
const publicas = `${siglasPublicas.slice(0, -1).join(", ")} e ${siglasPublicas[siglasPublicas.length - 1]}`;
const trtsPublicos = siglasPublicas.filter((s) => s.startsWith("TRT"));

describe("fonte única: cobertura derivada da lista, nunca digitada", () => {
  it("contagens saem da lista compartilhada", () => {
    expect(tjsCobertos().length).toBe(nTjs);
    expect(trfsCobertos().length).toBe(nTrfs);
    expect(coberturaTribunais().comCredencial.length).toBe(TRIBUNAIS_PJE.length);
    expect(totalTribunaisVigiaveis()).toBe(TRIBUNAIS_PJE.length + coberturaTribunais().consultaPublica.length);
    expect(textoCoberturaCurto()).toBe(`${nTjs} TJs + ${nTrfs} TRFs (${publicas} por consulta pública)`);
    expect(resumoPjeNacional()).toBe(`${nTjs} estados + ${nTrfs} TRFs`);
    expect(rotuloPjeNacional()).toBe(`PJe — ${nTjs} estados + ${nTrfs} TRFs`);
    expect(chipPjeIntegracoes()).toBe(`PJe · ${nTjs} TJs + ${nTrfs} TRFs`);
    expect(textoCoberturaComparativo()).toBe(`hoje ${nTjs} TJs e ${nTrfs} TRFs, mais ${publicas} por consulta pública`);
  });

  it("os helpers de texto não carregam número fixo no código-fonte", () => {
    const src = ler("shared/tribunais-pje.ts");
    const ini = src.indexOf("// ── Cobertura");
    const fim = src.indexOf("// ── Parser puro");
    expect(ini).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(ini);
    // Comentários mostram exemplos ("12 TJs + 4 TRFs") — o que vale é o código.
    const secao = src.slice(ini, fim).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Qualquer inteiro ≥ 2 solto num helper é um número digitado — e é
    // exatamente o que fica velho quando entra um tribunal no registro.
    expect(secao).not.toMatch(/\b(1[0-9]|[2-9][0-9]*)\b/);
  });

  it("TJDFT é a sigla de exibição; TRF5, TRT2 e TRT15 ficam separados, por consulta pública", () => {
    const c = coberturaTribunais();
    const siglas = c.comCredencial.map((t) => t.sigla);
    expect(siglas).toContain("TJDFT");
    expect(siglas).not.toContain("TJDF");
    expect(siglas).not.toContain("Federal 1ª");
    expect(siglas).toContain("TRF1");
    expect(c.consultaPublica.map((t) => t.codigo)).toEqual(TRIBUNAIS_CONSULTA_PUBLICA_PJE.map((t) => t.codigo));
    expect(c.consultaPublica.map((t) => t.codigo)).toEqual(expect.arrayContaining(["trf5", "trt2", "trt15"]));
    expect(c.consultaPublica[0].sigla).toBe("TRF5");
    for (const codigo of ["trf5", "trt2", "trt15"]) expect(c.comCredencial.map((t) => t.codigo)).not.toContain(codigo);
    expect(listaSiglasCobertas()).toBe(`TJCE, TJDFT, TJMA, TJMG, TJMT, TJPA, TJPB, TJPE, TJRJ, TJRN, TJRO, TJRR, TRF1, TRF2, TRF3, TRF6 e, por consulta pública, ${publicas}`);
  });

  it("a lista compartilhada bate com o registro do motor no servidor", () => {
    expect(new Set(coberturaTribunais().comCredencial.map((t) => t.codigo))).toEqual(new Set(tribunaisPjeDisponiveis()));
    expect(new Set(coberturaTribunais().consultaPublica.map((t) => t.codigo))).toEqual(TRIBUNAIS_CONSULTA_PUBLICA);
    expect(new Set(codigosTribunaisCobertos())).toEqual(new Set(TRIBUNAIS_MOTOR_PROPRIO));
    expect(TRIBUNAIS_MOTOR_PROPRIO).toContain("trf5");
  });

  it("a sede é a única comprovada em campo; a consulta na hora vale nos cobertos, com ou sem credencial", () => {
    expect(siglaConsultaNaHora()).toBe("TJCE");
    expect(textoConsultaNaHora()).toBe(`nos tribunais cobertos com a sua credencial (${publicas} sem credencial)`);
  });

  it("mensagem de tribunal sem motor nomeia a cobertura inteira", () => {
    expect(mensagemTribunalSemMotor("TJSP")).toBe(`O robô ainda não entra no TJSP. Hoje ele cobre: ${listaSiglasCobertas()}.`);
    expect(avisoProcessoForaDaCobertura("TJSP")).toBe(`Este processo é do TJSP, e o robô ainda não entra lá. Hoje ele cobre ${listaSiglasCobertas()}.`);
  });

  it("textos do site e do guia levam os números derivados", () => {
    expect(textoCoberturaPricing()).toBe(
      `Cobertura hoje: PJe do TJCE, TJDFT, TJMA, TJMG, TJMT, TJPA, TJPB, TJPE, TJRJ, TJRN, TJRO, TJRR, mais TRF1, TRF2, TRF3 e TRF6 (${publicas} por consulta pública). ` +
        `TJSP e os demais ainda não; Justiça do Trabalho: ${trtsPublicos.join(" e ")} por consulta pública — conte pra gente e entra na fila.`,
    );
    expect(textoCoberturaGuia()).toBe(
      `Cobertura hoje: PJe em ${nTjs} estados (CE, DF, MA, MG, MT, PA, PB, PE, RJ, RN, RO, RR) e TRF1/2/3/6, ` +
        `mais ${publicas} por consulta pública · consulta na hora ${textoConsultaNaHora()} · ` +
        "novas ações por CPF/CNPJ: comprovado no TJCE.",
    );
  });
});

describe("parser puro do CNJ (client) concorda com o do servidor", () => {
  const casos: Array<[string, string, boolean]> = [
    ["0000000-00.2024.8.26.0001", "TJSP", false],
    ["0000000-00.2024.8.07.0001", "TJDFT", true],
    ["0000000-00.2024.8.06.0001", "TJCE", true],
    ["0000000-00.2024.4.05.0001", "TRF5", true],
    ["0000000-00.2024.4.01.0001", "TRF1", true],
    ["0000000-00.2024.4.04.0001", "TRF-4", false],
    ["0000000-00.2024.5.07.0001", "TRT-7", false],
  ];
  for (const [cnj, sigla, coberto] of casos) {
    it(`${cnj} → ${sigla} (${coberto ? "coberto" : "fora"})`, () => {
      const puro = parseCnjTribunalPuro(cnj);
      expect(puro?.sigla).toBe(sigla);
      expect(puro?.coberto).toBe(coberto);
      expect(parseCnjTribunal(cnj)?.temMotorProprio).toBe(coberto);
      expect(parseCnjTribunal(cnj)?.codigoTribunal).toBe(puro?.codigo);
    });
  }

  it("número incompleto ou TR desconhecido não parseia", () => {
    expect(parseCnjTribunalPuro("123")).toBeNull();
    expect(parseCnjTribunalPuro("0000000-00.2024.8.99.0001")).toBeNull();
    expect(parseCnjTribunalPuro(null)).toBeNull();
  });
});

describe("servidor: as quatro recusas usam o mesmo helper", () => {
  const router = ler("server/routers/processos.ts");

  it("consultarCNJ, consultarCNJSincrono, criarMonitoramento e o 'sistema cofre' passam pelo helper", () => {
    expect(router.split("mensagemTribunalSemMotor(tribunal.siglaTribunal)").length - 1).toBeGreaterThanOrEqual(5);
    expect(router).toMatch(/import \{[^}]*mensagemTribunalSemMotor,[^}]*normalizarTribunais,[^}]*\} from "\.\.\/\.\.\/shared\/tribunais-pje"/);
  });

  it("os textos antigos e divergentes sumiram", () => {
    expect(router).not.toContain("ainda está em desenvolvimento");
    expect(router).not.toContain("Tribunais cobertos hoje: TJCE 1º grau");
    expect(router).not.toContain("Consulta direta pra");
    expect(router).not.toContain("ainda não mapeado");
    expect(router).not.toContain("siglasSuportadas()");
  });

  it("os códigos TRPCError das recusas continuam NOT_IMPLEMENTED e o 'cause' do consultarCNJ fica", () => {
    expect(router).toContain('cause: { motivo: "tribunal_sem_motor", tribunal: tribunal.codigoTribunal }');
    const recusas = router.split("mensagemTribunalSemMotor(tribunal.siglaTribunal)").slice(0, -1);
    for (const trecho of recusas) {
      expect(trecho.slice(-200)).toContain('code: "NOT_IMPLEMENTED"');
    }
  });

  it("o registro do motor deriva a consulta pública da lista compartilhada", () => {
    const pdpj = ler("server/processos/tribunais-pdpj.ts");
    expect(pdpj).toContain("TRIBUNAIS_CONSULTA_PUBLICA_PJE.map((t) => t.codigo)");
  });

  it("Cofre: rótulo da credencial nacional sai do helper", () => {
    const cofre = ler("server/escritorio/router-cofre-credenciais.ts");
    expect(cofre).toContain("label: rotuloPjeNacional(),");
    expect(cofre).not.toContain("todos os estados (");
  });
});

describe("client: nenhum número inventado sobrou", () => {
  const arquivos = arquivosDoClient();
  const conteudo = new Map(arquivos.map((a) => [a.replace(raiz + "/", ""), readFileSync(a, "utf8")]));

  // O painel do robô de ingestão da JurisIA tem um FILTRO "Todos os
  // tribunais" (DataJud, não o robô de processos) — não é promessa de
  // cobertura, fica de fora da varredura.
  const FORA_DA_VARREDURA = new Set(["client/src/pages/admin/AdminJurisIa.tsx"]);

  it('"+90 tribunais" e "todos os tribunais" não existem mais no client', () => {
    for (const [nome, src] of conteudo) {
      expect(src, nome).not.toContain("+90 tribunais");
      if (FORA_DA_VARREDURA.has(nome)) continue;
      expect(src, nome).not.toMatch(/todos os tribunais/i);
    }
  });

  it("Processos: consulta na hora, vigiar e a busca por CPF dizem a verdade derivada", () => {
    const proc = conteudo.get("client/src/pages/Processos.tsx")!;
    // Consulta por número na hora vale nos cobertos; a busca por CPF segue na sede.
    expect(proc).toContain("Número do processo direto {textoConsultaNaHora()}, ou busca por CPF/CNPJ — hoje no {siglaConsultaNaHora()}.");
    expect(proc).toContain("Consulta na hora {textoConsultaNaHora()}. Para vigiar, {totalTribunaisVigiaveis()} tribunais.");
    expect(proc).toContain("`Buscando no ${siglaConsultaNaHora()} por ${TIPO_LABELS[tipo]}. Pode levar até 2 minutos.`");
  });

  it("Processos: as duas opções 'Todos os PJe' do Cofre usam o resumo derivado", () => {
    const proc = conteudo.get("client/src/pages/Processos.tsx")!;
    expect(proc.split("resumoPjeNacional()").length - 1).toBeGreaterThanOrEqual(2);
    expect(proc).not.toContain("${estadosPje.length} estados");
  });

  it("Monitorar movimentações: tribunal fora da cobertura vira caixa âmbar, botão de aviso e Monitorar travado", () => {
    const proc = conteudo.get("client/src/pages/Processos.tsx")!;
    expect(proc).toContain("parseCnjTribunalPuro(novoValor)");
    expect(proc).toContain("avisoProcessoForaDaCobertura(tribunalForaDaCobertura.sigla)");
    expect(proc).toContain("Avisar quando o {tribunalForaDaCobertura.sigla} chegar");
    expect(proc).toContain('sp.set("interesse", sigla)');
    expect(proc).toMatch(/disabled=\{!novoValor\.trim\(\) \|\| !novoCredencialId \|\| criarMut\.isPending \|\| !!tribunalForaDaCobertura\}/);
    // O Cofre lê o deep-link e abre o diálogo já preenchido.
    expect(proc).toContain('get("interesse")');
    expect(proc).toContain('if (interesse !== "1") setInteresseTribunal(interesse);');
  });

  it("diálogo de interesse: descrição e toast prometem o e-mail", () => {
    const proc = conteudo.get("client/src/pages/Processos.tsx")!;
    expect(proc.replace(/\s+/g, " ")).toContain(
      "Diga qual tribunal você precisa. Seu pedido entra na fila de prioridade, e te avisamos por e-mail assim que a cobertura chegar.",
    );
    expect(proc).toContain('toast.success("Pedido registrado"');
    expect(proc).toContain('description: "Quando esse tribunal entrar, a gente te avisa por e-mail."');
  });

  it("site: Comparativo, Pricing e Integrações leem os helpers", () => {
    expect(conteudo.get("client/src/pages/landing/Comparativo.tsx")).toContain(
      "com motor próprio nos tribunais cobertos — ${textoCoberturaComparativo()}; lista nos planos —, análise estratégica por IA e mensagem pronta pro cliente.",
    );
    expect(conteudo.get("client/src/pages/landing/Pricing.tsx")).toContain("{textoCoberturaPricing()}");
    const integ = conteudo.get("client/src/pages/landing/Integracoes.tsx")!;
    expect(integ).toContain("{ nome: chipPjeIntegracoes(), cor: \"bg-info\" }");
    expect(integ).not.toContain("PJe · TJCE");
  });

  it("guia processual: rodapé derivado e botão que abre o diálogo de interesse", () => {
    const guia = conteudo.get("client/src/pages/dashboards/GuiaProcessual.tsx")!;
    expect(guia).toContain("{textoCoberturaGuia()}");
    expect(guia).toContain('setLocation("/processos?tab=cofre&interesse=1")');
    expect(guia).toContain("Avisar quando chegar");
    expect(guia).not.toContain("Registre o interesse no Cofre");
  });

  it("painel admin: card da fila com o botão de avisar", () => {
    const saude = conteudo.get("client/src/pages/admin/AdminSaude.tsx")!;
    expect(saude).toContain("trpc.admin.interessesTribunais.useQuery");
    expect(saude).toContain("trpc.admin.avisarInteressadosTribunal.useMutation");
    expect(saude).toContain("Avisar interessados");
    expect(saude).toContain("<FilaTribunais />");
  });
});

describe("migration 0223: bullet certo de cada plano, idempotente", () => {
  const mig = ler("drizzle/0223_tribunais_texto_planos.sql");
  const seed = ler("drizzle/0217_pacote_3_planos.sql");

  /** Índice do bullet "Vigia…" no JSON_ARRAY de features de um plano da seed. */
  function indiceDoBulletVigia(slug: string): number {
    const ini = seed.indexOf(`'${slug}', `);
    expect(ini).toBeGreaterThan(-1);
    const fim = seed.indexOf("\n)", ini);
    const tupla = seed.slice(ini, fim);
    const features = tupla.slice(tupla.lastIndexOf("JSON_ARRAY("));
    const bullets = [...features.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    return bullets.findIndex((b) => b.startsWith("Vigia "));
  }

  const planos: Array<[string, string, string]> = [
    ["atende", "300", "15"],
    ["escritorio", "1.000", "50"],
    ["escala", "2.500", "150"],
  ];

  /** O texto que a 0223 gravou é história: fica congelado aqui. O helper
   *  `bulletVigiaPlano` já diz a cobertura de hoje e alimenta a 0227. */
  const bullet0223 = (processos: string, cpfs: string) =>
    `Vigia ${processos} processos nos tribunais cobertos (${nTjs} TJs e ${nTrfs} TRFs, mais o TRF5 por consulta pública — TJSP e TRTs ainda não) · ` +
    `${cpfs} CPFs/CNPJs (novas ações: comprovado no TJCE)`;

  for (const [slug, processos, cpfs] of planos) {
    it(`${slug}: JSON_REPLACE no índice do bullet da seed, WHERE com o texto antigo, texto = o que a 0223 gravou`, () => {
      const i = indiceDoBulletVigia(slug);
      expect(i).toBeGreaterThan(-1);
      const antigo = `Vigia ${processos} processos e ${cpfs} CPFs/CNPJs (novas ações: TJCE por enquanto)`;
      const novo = bullet0223(processos, cpfs);
      // A 0227 parte exatamente deste texto (WHERE) e grava o do helper de hoje.
      expect(bulletVigiaPlano(processos, cpfs)).not.toBe(novo);
      const trecho = mig.slice(mig.indexOf(`WHERE slug = '${slug}'`) - 400, mig.indexOf(`WHERE slug = '${slug}'`) + 300);
      expect(trecho).toContain(`JSON_REPLACE(features, '$[${i}]',`);
      expect(trecho).toContain(`'${novo}'`);
      expect(trecho).toContain(`AND JSON_UNQUOTE(JSON_EXTRACT(features, '$[${i}]')) = '${antigo}'`);
    });
  }

  it("não reescreve o array inteiro (outra migration mexe em outro índice)", () => {
    expect(mig).not.toContain("features = JSON_ARRAY(");
    expect(mig.split("JSON_REPLACE(").length - 1).toBe(3);
  });
});

describe("migration 0224 + schema: avisadoEm na fila", () => {
  it("coluna nasce NULL com DEFAULT NULL, no mesmo tipo das outras datas da tabela", () => {
    const sql = ler("drizzle/0224_interesse_tribunais_aviso.sql");
    expect(sql).toContain("ALTER TABLE interesse_tribunais");
    expect(sql).toMatch(/ADD COLUMN avisadoEmIntTrib TIMESTAMP NULL DEFAULT NULL/);
    const schema = ler("drizzle/schema.ts");
    expect(schema).toContain('avisadoEm: timestamp("avisadoEmIntTrib")');
  });
});

describe("fila que avisa: só quem não foi avisado, grava avisadoEm, audita", () => {
  const rows: InteresseRow[] = [
    { id: 1, escritorioId: 10, userId: 100, tribunal: "TJSP", criadoEm: "2026-09-01", avisadoEm: null },
    { id: 2, escritorioId: 20, userId: 200, tribunal: "tjsp", criadoEm: "2026-09-02", avisadoEm: "2026-09-05" },
    { id: 3, escritorioId: 10, userId: 101, tribunal: "TJ-SP", criadoEm: "2026-09-03", avisadoEm: null },
    { id: 4, escritorioId: 30, userId: 300, tribunal: "TRT 7", criadoEm: "2026-09-03", avisadoEm: null },
    { id: 5, escritorioId: 40, userId: 400, tribunal: "TJSP", criadoEm: "2026-09-04", avisadoEm: null },
  ];

  function fakeDeps(over: Partial<DepsAvisar> = {}) {
    const enviados: any[] = [];
    const marcados: Array<{ ids: number[]; quando: Date }> = [];
    const deps: DepsAvisar = {
      listarInteresses: async () => rows,
      emailDoDono: async (escritorioId) =>
        escritorioId === 40
          ? null
          : { email: `dono${escritorioId}@x.com`, nome: `Dono ${escritorioId}`, userId: escritorioId * 11 },
      enviar: async (p) => {
        enviados.push(p);
        return { success: true };
      },
      marcarAvisados: async (ids, quando) => {
        marcados.push({ ids, quando });
      },
      agora: () => new Date("2026-09-12T12:00:00Z"),
      ...over,
    };
    return { deps, enviados, marcados };
  }

  it("normaliza a grafia livre do interessado", () => {
    expect(normalizarTribunalInteresse("tj-sp")).toBe("TJSP");
    expect(normalizarTribunalInteresse("TRT 7")).toBe("TRT7");
    expect(normalizarTribunalInteresse(" Tjba ")).toBe("TJBA");
  });

  it("agrupa por tribunal normalizado, pendentes primeiro", () => {
    const grupos = agruparInteresses(rows);
    expect(grupos.map((g) => g.tribunal)).toEqual(["TJSP", "TRT7"]);
    const tjsp = grupos[0];
    expect(tjsp).toMatchObject({ pedidos: 4, avisados: 1, pendentes: 3, escritorios: 3 });
    expect(tjsp.grafias[0]).toBe("TJSP");
  });

  it("envia UM e-mail por escritório pendente, pula quem já foi avisado e marca só os enviados", async () => {
    const { deps, enviados, marcados } = fakeDeps();
    const r = await avisarInteressados(deps, "tj-sp");
    expect(r).toMatchObject({ tribunal: "TJSP", enviados: 1, jaAvisados: 1, semEmail: 1, falhas: [] });
    // escritório 10 tem duas linhas (1 e 3) → um e-mail, duas marcações; 20 já avisado; 40 sem e-mail; TRT7 nem entra.
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ email: "dono10@x.com", sigla: "TJSP", escritorioId: 10, userId: 110 });
    expect(marcados).toEqual([{ ids: [1, 3], quando: new Date("2026-09-12T12:00:00Z") }]);
  });

  it("segunda rodada depois de avisar não manda nada de novo", async () => {
    const depois = rows.map((r) => (r.escritorioId === 10 ? { ...r, avisadoEm: "2026-09-12" } : r));
    const { deps, enviados, marcados } = fakeDeps({ listarInteresses: async () => depois });
    const r = await avisarInteressados(deps, "TJSP");
    expect(enviados).toHaveLength(0);
    expect(marcados).toHaveLength(0);
    expect(r.jaAvisados).toBe(3);
  });

  it("falha no envio não marca avisadoEm (entra na próxima tentativa)", async () => {
    const { deps, marcados } = fakeDeps({ enviar: async () => ({ success: false, error: "429" }) });
    const r = await avisarInteressados(deps, "TJSP");
    expect(r.enviados).toBe(0);
    expect(r.falhas).toEqual([{ escritorioId: 10, erro: "429" }]);
    expect(marcados).toHaveLength(0);
  });

  it("tribunal sem ninguém na fila não chama e-mail nem marcação", async () => {
    const { deps, enviados, marcados } = fakeDeps();
    const r = await avisarInteressados(deps, "TJBA");
    expect(r).toMatchObject({ enviados: 0, jaAvisados: 0, semEmail: 0 });
    expect(enviados).toHaveLength(0);
    expect(marcados).toHaveLength(0);
  });

  it("e-mail: tipo próprio e o texto simples combinado", () => {
    expect(TIPO_EMAIL_TRIBUNAL_DISPONIVEL).toBe("tribunal_disponivel");
    expect(textoEmailTribunalDisponivel("TJSP")).toBe(
      "O TJSP entrou na cobertura do JuridFlow. Cadastre sua credencial no Cofre e vigie seus processos.",
    );
    const email = ler("server/_core/email.ts");
    expect(email).toContain("tipo: TIPO_EMAIL_TRIBUNAL_DISPONIVEL,");
  });

  it("as dependências reais marcam só linhas ainda não avisadas e mandam o e-mail do dono", () => {
    const mod = ler("server/admin/interesse-tribunais.ts");
    expect(mod).toContain("isNull(interesseTribunais.avisadoEm)");
    expect(mod).toContain("innerJoin(users, eq(users.id, escritorios.ownerId))");
    expect(mod).toContain("enviarEmailTribunalDisponivel(p)");
  });

  it("procedures admin: leitura agrupada e o aviso auditado", () => {
    const admin = ler("server/routers/admin.ts");
    expect(admin).toContain("interessesTribunais: adminProcedure.query(");
    const ini = admin.indexOf("avisarInteressadosTribunal: adminProcedure");
    expect(ini).toBeGreaterThan(-1);
    const bloco = admin.slice(ini, ini + 1600);
    expect(bloco).toContain("avisarInteressados(depsInteresseTribunais(db), input.tribunal)");
    expect(bloco).toContain("registrarAuditoria({");
    expect(bloco).toContain('acao: "admin.avisar_interessados_tribunal"');
    expect(bloco).toContain("alvoNome: resultado.tribunal");
  });
});
