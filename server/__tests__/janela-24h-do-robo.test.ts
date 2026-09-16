/**
 * A janela de 24h do WhatsApp aplicada ao ROBÔ.
 *
 * O que esta amarra protege, e por que cada peça existe:
 *
 * 1. A janela NÃO é guardada — é calculada da última mensagem recebida. É isso
 *    que a faz reabrir sozinha quando o cliente escreve de novo. Se alguém um
 *    dia gravar início/fim numa coluna, os testes de `msRestantesDaJanela`
 *    continuam passando, mas a fonte única aqui (`shared/janela-24h`) deixa
 *    claro onde a conta mora.
 * 2. O robô confere a janela antes de mandar conteúdo LIVRE. Sem isso a Meta
 *    recusava com 131047: o cliente não recebia nada e a tentativa desgastava
 *    a reputação do número.
 * 3. TEMPLATE não passa por essa trava, de propósito — é o único formato que
 *    reabre conversa fria. Barrá-lo tiraria a saída do escritório.
 * 4. Resposta a quem escreveu (proativo=false) não é tocada: quem cuida dela é
 *    o bloqueio do envio manual, que já existia e mostra outro texto.
 * 5. Bloqueou, o atendente fica sabendo: recado interno na conversa, um por
 *    episódio (a mensagem do cliente é que encerra o episódio, porque reabre a
 *    janela).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  JANELA_24H_MS,
  janela24hAberta,
  msRestantesDaJanela,
  rotuloTempoRestante,
  janelaAcabando,
  recadoJanelaFechada,
  MARCADOR_JANELA_FECHADA,
} from "../../shared/janela-24h";
import { podeEnviar, podeDispararTemplate, _resetRateLimit } from "../integracoes/whatsapp-envio-guard";

const raiz = join(__dirname, "../..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf-8");

const AGORA = new Date("2026-09-16T12:00:00Z").getTime();
const hAtras = (h: number) => new Date(AGORA - h * 60 * 60 * 1000);

/** db falso: devolve os selects na ordem da fila. */
function fakeDb(filas: any[][]) {
  const fila = [...filas];
  function chain(): any {
    const linhas = fila.length ? fila.shift()! : [];
    const c: any = {
      from: () => c,
      innerJoin: () => c,
      where: () => c,
      orderBy: () => c,
      limit: () => Promise.resolve(linhas),
    };
    return c;
  }
  return { select: () => chain() };
}

const CANAL_OK = [{ restrito: false, disparosDia: 0, tier: "TIER_1K", escritorioId: 7 }];
const SEM_OPTOUT = [{ optOut: false }];

describe("a conta da janela", () => {
  it("abre com mensagem recente e fecha depois de 24h", () => {
    expect(janela24hAberta(hAtras(2), AGORA)).toBe(true);
    expect(janela24hAberta(hAtras(25), AGORA)).toBe(false);
  });

  it("fecha exatamente aos 24h — o limite não é 'até 24h inclusive'", () => {
    expect(janela24hAberta(new Date(AGORA - JANELA_24H_MS), AGORA)).toBe(false);
    expect(janela24hAberta(new Date(AGORA - JANELA_24H_MS + 60_000), AGORA)).toBe(true);
  });

  it("sem mensagem nenhuma do cliente a janela está fechada", () => {
    expect(janela24hAberta(null, AGORA)).toBe(false);
    expect(janela24hAberta(undefined, AGORA)).toBe(false);
    expect(msRestantesDaJanela(null, AGORA)).toBe(0);
  });

  it("carimbo ilegível fecha a janela — dúvida aqui não pode virar 'pode mandar'", () => {
    expect(janela24hAberta("carimbo quebrado", AGORA)).toBe(false);
    expect(msRestantesDaJanela("carimbo quebrado", AGORA)).toBe(0);
  });

  it("reabre sozinha: a mensagem nova do cliente empurra o prazo 24h pra frente", () => {
    const antes = msRestantesDaJanela(hAtras(23), AGORA);
    const depoisDeEleEscrever = msRestantesDaJanela(new Date(AGORA), AGORA);
    expect(antes).toBe(60 * 60 * 1000);
    expect(depoisDeEleEscrever).toBe(JANELA_24H_MS);
  });

  it("o que falta é escrito pra gente ler", () => {
    expect(rotuloTempoRestante(3 * 60 * 60 * 1000 + 20 * 60 * 1000)).toBe("3h20");
    // O zero à esquerda importa: "3h5" se lê como 3h50 num relógio.
    expect(rotuloTempoRestante(3 * 60 * 60 * 1000 + 5 * 60 * 1000)).toBe("3h05");
    expect(rotuloTempoRestante(5 * 60 * 60 * 1000)).toBe("5h");
    expect(rotuloTempoRestante(48 * 60 * 1000)).toBe("48 min");
    expect(rotuloTempoRestante(30_000)).toBe("menos de 1 min");
    expect(rotuloTempoRestante(0)).toBe("");
  });

  it("acabando é só quando falta pouco — e nunca quando já fechou", () => {
    expect(janelaAcabando(60 * 60 * 1000)).toBe(true);
    expect(janelaAcabando(5 * 60 * 60 * 1000)).toBe(false);
    expect(janelaAcabando(0)).toBe(false);
  });

  it("o recado interno diz o prazo e a saída, com e sem nome de fluxo", () => {
    const comNome = recadoJanelaFechada("Boyadjian Advogados");
    expect(comNome).toContain('O robô ("Boyadjian Advogados")');
    expect(comNome).toContain("24 horas");
    expect(comNome).toContain("template aprovado");
    expect(recadoJanelaFechada("")).toContain("O robô não enviou");
    expect(recadoJanelaFechada(null)).not.toContain('("');
  });
});

describe("o robô conferindo a janela antes de mandar", () => {
  beforeEach(() => _resetRateLimit());

  it("segura o texto livre quando o cliente não escreve há mais de 24h", async () => {
    const db = fakeDb([CANAL_OK, SEM_OPTOUT, [{ createdAt: hAtras(30) }]]);
    const r = await podeEnviar({
      db, canalId: 1, contatoId: 5, proativo: true, textoLivre: true, agoraMs: AGORA,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.tipo).toBe("janela");
      expect(r.erro).toContain("131047");
      // O id volta porque quem chama nem sempre o tinha — é ele que acha a
      // conversa onde o recado interno precisa aparecer.
      expect(r.contatoId).toBe(5);
    }
  });

  it("deixa passar dentro da janela", async () => {
    const db = fakeDb([CANAL_OK, SEM_OPTOUT, [{ createdAt: hAtras(3) }]]);
    const r = await podeEnviar({
      db, canalId: 1, contatoId: 5, proativo: true, textoLivre: true, agoraMs: AGORA,
    });
    expect(r.ok).toBe(true);
  });

  it("TEMPLATE sai fora da janela — é o formato que reabre a conversa", async () => {
    const db = fakeDb([CANAL_OK, SEM_OPTOUT, [{ createdAt: hAtras(30) }]]);
    const r = await podeDispararTemplate({ db, canalId: 1, contatoId: 5, agoraMs: AGORA });
    expect(r.ok).toBe(true);
  });

  it("resposta a quem escreveu não é tocada por esta trava", async () => {
    const db = fakeDb([CANAL_OK, [{ createdAt: hAtras(30) }]]);
    const r = await podeEnviar({
      db, canalId: 1, contatoId: 5, proativo: false, textoLivre: true, agoraMs: AGORA,
    });
    expect(r.ok).toBe(true);
  });

  it("sem contato resolvido a dúvida passa — indeterminação não é prova de janela fechada", async () => {
    const db = fakeDb([CANAL_OK]);
    const r = await podeEnviar({ db, canalId: 1, proativo: true, textoLivre: true, agoraMs: AGORA });
    expect(r.ok).toBe(true);
  });
});

describe("as portas do robô pedem a conferência", () => {
  const canalEnvio = ler("server/integracoes/canal-envio.ts");

  it("as DUAS portas de conteúdo livre (texto e interativo) marcam textoLivre", () => {
    const marcas = canalEnvio.match(/textoLivre: true/g) ?? [];
    expect(marcas.length).toBe(2);
  });

  it("cada porta bloqueada por janela deixa o recado na conversa", () => {
    const blocos = canalEnvio.split('permitido.tipo === "janela"');
    // 1 texto antes do primeiro split + 2 ocorrências = 3 pedaços.
    expect(blocos.length).toBe(3);
    for (const depois of blocos.slice(1)) {
      expect(depois.slice(0, 600)).toContain("registrarJanelaFechadaNaConversa({");
    }
  });

  it("o gate do template NÃO manda textoLivre", () => {
    const guard = ler("server/integracoes/whatsapp-envio-guard.ts");
    const inicio = guard.indexOf("export async function podeDispararTemplate");
    expect(inicio).toBeGreaterThan(-1);
    expect(guard.slice(inicio, inicio + 700)).not.toContain("textoLivre: true");
  });

  it("a conta da janela tem UMA fonte, e o servidor reexporta a da shared", () => {
    const optout = ler("server/integracoes/whatsapp-optout.ts");
    expect(optout).toContain('export { JANELA_24H_MS, janela24hAberta } from "../../shared/janela-24h";');
    // A cópia antiga não pode voltar a viver aqui.
    expect(optout).not.toContain("agoraMs - t < JANELA_24H_MS");
  });
});

describe("o recado interno, um por episódio", () => {
  const helper = ler("server/integracoes/recado-janela-fechada.ts");

  it("procura recado anterior DEPOIS da última mensagem do cliente", () => {
    expect(helper).toContain("const ultimaEntrada = await ultimaEntradaDoContatoNoCanal(db, contatoId, canalId);");
    expect(helper).toContain("if (ultimaEntrada) filtros.push(gte(mensagens.createdAt, ultimaEntrada));");
  });

  it("a conversa é lida escopada pelo escritório", () => {
    const i = helper.indexOf(".from(conversas)");
    expect(helper.slice(Math.max(0, i - 400), i + 400)).toContain("eq(conversas.escritorioId, escritorioId)");
  });

  it("grava como nota de sistema, com o marcador que a dedup procura", () => {
    expect(helper).toContain('tipo: "sistema"');
    expect(helper).toContain("conteudo: recadoJanelaFechada(opts.nomeCenario)");
    expect(helper).toContain("JSON.stringify({ sistema: { tipo: MARCADOR_JANELA_FECHADA, canalId } })");
    expect(MARCADOR_JANELA_FECHADA).toBe("janela_fechada");
  });

  it("nunca derruba o envio: tudo dentro de try/catch", () => {
    expect(helper).toContain("} catch (err: any) {");
    expect(helper).toContain("log.warn(");
  });
});
