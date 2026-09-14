/**
 * "Pensei em criar uma seção para ativar as notificações push padrões do app.
 * Sentença proferida, Nova ação detectada, Nova conversa Iniciada… o que faz
 * sentido ter como padrão no sistema? Notificações que o dono do escritório ou
 * responsável, deve e quer saber na hora." — dono, 14/09, seguido de
 * "Bora fazer" no mockup `mockup-notificacoes-padrao.html`.
 *
 * O que estes testes guardam, em ordem de importância:
 *
 *  1. **Nada que funcionava para de funcionar.** Tipo que o catálogo não
 *     conhece SEMPRE envia, e banco fora também envia. O único "não" é o
 *     explícito — senão esta entrega vira um apagão silencioso de avisos.
 *  2. **Rotina desligada, decisão ligada.** É a razão de a tela existir: 8 de
 *     cada 10 movimentações são rotina, e é ela que faz a pessoa desligar
 *     tudo. Inverter o padrão desfaz a entrega inteira sem erro nenhum.
 *  3. **"Nova conversa" não é "toda mensagem".** O dono recebia aviso de toda
 *     mensagem de toda conversa; a distinção é o que tira o celular do colo
 *     dele sem tirar a conversa nova.
 *  4. **Silêncio cala o CELULAR, não o sino.** Desligar um aviso é "não me
 *     toque", nunca "esconda de mim" — a notificação continua sendo criada.
 *  5. **Só o que diverge do padrão é gravado.** Voltar ao padrão APAGA a
 *     linha; é isso que deixa mudar um padrão depois e alcançar quem nunca
 *     mexeu.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  AVISOS,
  GRUPOS,
  AJUSTE_ALCANCE,
  AJUSTE_SILENCIO,
  avisoDaMovimentacao,
  avisoDoTipo,
  avisoPorId,
  chaveConhecida,
  dentroDoSilencio,
  padraoDaChave,
} from "../../shared/notificacoes-avisos";
import { decidirPush, horaLocalEm } from "../_core/preferencias-notificacao";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("nada que funcionava para de funcionar", () => {
  it("tipo que o catálogo não conhece continua enviando", () => {
    // null = "manda assim mesmo". Se um dia isto virar string, todo tipo novo
    // nasce mudo até alguém lembrar de declarar.
    expect(avisoDoTipo("info")).toBeNull();
    expect(avisoDoTipo("chamada_entrante")).toBeNull();
    expect(avisoDoTipo("tipo_que_ainda_nao_existe")).toBeNull();
  });

  it("a decisão de enviar é tomada sem nunca lançar e sem bloquear por dúvida", () => {
    const fonte = ler("server/_core/preferencias-notificacao.ts");
    // Banco fora, usuário sem linha, erro na leitura: tudo passa.
    expect(fonte).toContain("if (!pref) return { enviar: true };");
    expect(fonte).toMatch(/catch \(err\)[\s\S]{0,200}return \{ enviar: true \}/);
  });

  it("o push é decidido por usuário, e o SSE sai de qualquer jeito", () => {
    const sse = ler("server/_core/sse-notifications.ts");
    // `conexoes.get` também aparece no registro do SSE, muito antes — ancorar
    // no primeiro devolvia um pedaço vazio e o teste passava sem olhar nada.
    const inicio = sse.indexOf("export function emitirNotificacao");
    const bloco = sse.slice(inicio, sse.indexOf("const conns = conexoes.get", inicio));
    expect(bloco.length).toBeGreaterThan(200);
    expect(bloco).toContain("pushPermitido(userId, notificacao.tipo, notificacao.dados)");
    expect(bloco).toContain("if (!decisao.enviar)");
    // A recusa sai do bloco do PUSH com `return` — se ela derrubasse a função
    // inteira, o sino e o tempo real morriam junto.
    // O `return` é o que impede o envio de acontecer mesmo assim.
    expect(bloco).toMatch(/if \(!decisao\.enviar\) \{[\s\S]{0,260}return;\n/);
    expect(bloco.indexOf("if (!decisao.enviar)")).toBeLessThan(bloco.indexOf("enviarPushParaUsuario"));
  });
});

describe("os padrões são os que o dono aprovou", () => {
  it("rotina desligada; decisão, providência, prazo e nova ação ligadas", () => {
    expect(avisoPorId("processos.rotina")!.padrao).toBe(false);
    expect(avisoPorId("processos.decisao")!.padrao).toBe(true);
    expect(avisoPorId("processos.providencia")!.padrao).toBe(true);
    expect(avisoPorId("processos.prazo")!.padrao).toBe(true);
    expect(avisoPorId("processos.nova-acao")!.padrao).toBe(true);
  });

  it("nova conversa ligada; toda mensagem desligada", () => {
    // Era o contrário na prática: o dono recebia TODA mensagem e não tinha
    // como separar o começo de conversa.
    expect(avisoPorId("atendimento.nova-conversa")!.padrao).toBe(true);
    expect(avisoPorId("atendimento.toda-mensagem")!.padrao).toBe(false);
  });

  it("dinheiro ligado, e só pra quem vê o Financeiro", () => {
    for (const id of ["dinheiro.pago", "dinheiro.vencida", "dinheiro.contrato"]) {
      expect(avisoPorId(id)!.padrao, id).toBe(true);
      expect(avisoPorId(id)!.quemVe, id).toBe("financeiro");
    }
  });

  it("saúde do sistema é só do dono, e vem ligada", () => {
    for (const id of ["saude.whatsapp", "saude.credencial"]) {
      expect(avisoPorId(id)!.quemVe, id).toBe("dono");
      expect(avisoPorId(id)!.padrao, id).toBe(true);
    }
    expect(GRUPOS.find((g) => g.id === "saude")!.quemVe).toBe("dono");
  });

  it("silêncio vem ligado; receber o dos colaboradores, não", () => {
    expect(padraoDaChave(AJUSTE_SILENCIO)).toBe(true);
    expect(padraoDaChave(AJUSTE_ALCANCE)).toBe(false);
  });

  it("todo aviso pertence a um grupo declarado e tem explicação", () => {
    const ids = new Set(GRUPOS.map((g) => g.id));
    for (const a of AVISOS) {
      expect(ids.has(a.grupo), `${a.id} num grupo que não existe`).toBe(true);
      expect(a.explica.length, `${a.id} sem explicação`).toBeGreaterThan(20);
    }
  });
});

describe("a classificação da IA decide o que toca o celular", () => {
  it("o vocabulário é o MESMO da Central", () => {
    expect(avisoDaMovimentacao("exigem_acao")).toBe("processos.providencia");
    expect(avisoDaMovimentacao("rotina")).toBe("processos.rotina");
    expect(avisoDaMovimentacao("relevante")).toBe("processos.decisao");
    // Sem classe (análise não rodou) NÃO pode virar rotina: o silêncio seria
    // justamente o do caso que a IA não conseguiu ler.
    expect(avisoDaMovimentacao(null)).toBe("processos.decisao");
  });

  it("o cron manda a classe junto, calculada pelo classificador da Central", () => {
    const cron = ler("server/processos/cron-monitoramento.ts");
    expect(cron).toContain('import { classificarGrupo } from "./router-movimentacoes";');
    expect(cron).toContain("m.classe = classificarGrupo({");
    expect(cron).toContain("classe: movsParaNotif[0]?.classe ?? null,");
  });

  it("movimentação sem classe cai em decisão, não em rotina", () => {
    expect(avisoDoTipo("movimentacao_processo", {})).toBe("processos.decisao");
    expect(avisoDoTipo("movimentacao_processo", { classe: "rotina" })).toBe("processos.rotina");
  });
});

describe("nova conversa não é toda mensagem", () => {
  it("a distinção vem do dado, não do palpite", () => {
    expect(avisoDoTipo("nova_mensagem", { conversaNova: true })).toBe("atendimento.nova-conversa");
    expect(avisoDoTipo("nova_mensagem", { conversaNova: false })).toBe("atendimento.toda-mensagem");
    expect(avisoDoTipo("nova_mensagem")).toBe("atendimento.toda-mensagem");
  });

  it("o handler marca começo de conversa com a MESMA régua do início do atendimento", () => {
    const h = ler("server/integracoes/whatsapp-handler.ts");
    expect(h).toContain(
      'contatoFoiCriado || statusAtual === "resolvido" || statusAtual === "fechado"',
    );
    expect(h).toContain("conversaNova }");
  });
});

describe("o que existia e não chegava no celular agora chega", () => {
  it("prazo, dinheiro e credencial entraram na lista do push", () => {
    const sse = ler("server/_core/sse-notifications.ts");
    const lista = sse.slice(sse.indexOf("const TIPOS_PUSH"), sse.indexOf("/** Rota que a notificação"));
    for (const t of [
      "credencial_erro",
      "credencial_recuperada",
      "prazo_vencendo",
      "pagamento_recebido",
      "cobranca_vencida",
      "contrato_fechado",
      "cliente_esperando",
    ]) {
      expect(lista, t).toContain(`"${t}"`);
    }
  });

  it("cada tipo novo abre a tela certa quando tocado", () => {
    const sse = ler("server/_core/sse-notifications.ts");
    const rota = sse.slice(sse.indexOf("function rotaPush"), sse.indexOf("/** Envia notificação"));
    expect(rota).toContain('return "/tribunais"');
    expect(rota).toContain('return "/agenda"');
    expect(rota).toContain('return "/financeiro"');
  });

  it("prazo vencendo emite DEPOIS da dedup de 12h", () => {
    const cron = ler("server/_core/cron-jobs.ts");
    const bloco = cron.slice(cron.indexOf("const notificarSeNovo"), cron.indexOf("// Helper: obter userId"));
    expect(bloco).toContain("if (existente) return;");
    expect(bloco).toContain('emitirNotificacao(userId, { tipo: "prazo_vencendo", titulo, mensagem });');
    // A ordem é o que impede um toque a cada ciclo de 5 minutos.
    expect(bloco.indexOf("if (existente) return;")).toBeLessThan(
      bloco.indexOf('tipo: "prazo_vencendo"'),
    );
  });

  it("pagamento e cobrança vencida saem do webhook, depois da dedup do evento", () => {
    const wh = ler("server/integracoes/asaas-webhook.ts");
    expect(wh).toContain('tipo: "pagamento_recebido"');
    expect(wh).toContain('tipo: "cobranca_vencida"');
    expect(wh.indexOf("marcarEventoProcessado")).toBeLessThan(wh.indexOf('tipo: "pagamento_recebido"'));
  });

  it("contrato fechado avisa sem poder derrubar a venda", () => {
    const rc = ler("server/escritorio/router-clientes.ts");
    const bloco = rc.slice(rc.indexOf('tipo: "contrato_fechado"') - 900, rc.indexOf('tipo: "contrato_fechado"') + 600);
    expect(bloco).toContain("try {");
    expect(bloco).toContain("/* aviso é best-effort */");
  });
});

describe("cliente esperando: um toque por espera, não por ciclo", () => {
  it("espera é a ÚLTIMA mensagem ser do cliente, numa conversa aguardando", () => {
    const c = ler("server/escritorio/cron-cliente-esperando.ts");
    expect(c).toContain('eq(conversas.status, "aguardando")');
    expect(c).toContain('eq(mensagens.direcao, "entrada")');
    // Sem o teto de idade na CONSULTA, conversa parada há semanas viraria
    // urgência nova — a constante existir não basta.
    expect(c).toContain("gte(ultima.quando, limiteAntigo)");
    expect(c).toContain("ESPERA_MAXIMA_HORAS * 3_600_000");
  });

  it("não repete o aviso da mesma conversa dentro da janela", () => {
    const c = ler("server/escritorio/cron-cliente-esperando.ts");
    expect(c).toContain("if (jaAvisou) continue;");
    expect(c).toContain("tituloEspera(c.id)");
  });

  it("o cron está registrado", () => {
    expect(ler("server/_core/cron-jobs.ts")).toContain(
      'const { avisarClientesEsperando } = await import("../escritorio/cron-cliente-esperando");',
    );
  });
});

describe("o silêncio cala o celular, não o sino", () => {
  it("a janela cruza a meia-noite", () => {
    expect(dentroDoSilencio(22)).toBe(true);
    expect(dentroDoSilencio(3)).toBe(true);
    expect(dentroDoSilencio(21)).toBe(true);
    expect(dentroDoSilencio(7)).toBe(false);
    expect(dentroDoSilencio(14)).toBe(false);
  });

  it("a hora é a do escritório, não a do servidor", () => {
    // 01:00 UTC é 22:00 em São Paulo: o silêncio tem que pegar.
    const meiaNoiteUtc = new Date("2026-09-15T01:00:00Z");
    expect(horaLocalEm("America/Sao_Paulo", meiaNoiteUtc)).toBe(22);
    expect(dentroDoSilencio(horaLocalEm("America/Sao_Paulo", meiaNoiteUtc))).toBe(true);
    expect(horaLocalEm("UTC", meiaNoiteUtc)).toBe(1);
  });

  it("de madrugada o push não sai, mesmo com o aviso ligado", () => {
    const vazio = new Map<string, boolean>();
    expect(decidirPush({ aviso: "processos.decisao", mapa: vazio, horaLocal: 23 })).toEqual({
      enviar: false,
      motivo: "silencio",
    });
    expect(decidirPush({ aviso: "processos.decisao", mapa: vazio, horaLocal: 10 })).toEqual({
      enviar: true,
    });
  });

  it("quem desliga o silêncio recebe de madrugada", () => {
    const semSilencio = new Map([[AJUSTE_SILENCIO, false]]);
    expect(decidirPush({ aviso: "processos.decisao", mapa: semSilencio, horaLocal: 3 })).toEqual({
      enviar: true,
    });
  });

  it("desligado vence silêncio — e o motivo diz a verdade", () => {
    // Quem desligou o aviso não precisa que a hora seja consultada; trocar a
    // ordem faria o log dizer "silêncio" pra quem simplesmente não quer.
    const desligado = new Map([["processos.rotina", false]]);
    expect(decidirPush({ aviso: "processos.rotina", mapa: desligado, horaLocal: 23 })).toEqual({
      enviar: false,
      motivo: "desligado",
    });
    expect(decidirPush({ aviso: "processos.rotina", mapa: desligado, horaLocal: 10 })).toEqual({
      enviar: false,
      motivo: "desligado",
    });
  });

  it("a hora que chega na decisão é a do escritório, não uma fixa", () => {
    // A decisão é pura e bem testada acima; o que falta guardar é a FIAÇÃO —
    // passar uma hora fixa aqui desligaria o silêncio sem quebrar nada.
    const fonte = ler("server/_core/preferencias-notificacao.ts");
    expect(fonte).toContain(
      "return decidirPush({ aviso, mapa: pref.mapa, horaLocal: horaLocalEm(pref.fuso, agora) });",
    );
  });

  it("aviso desconhecido ignora silêncio e preferência", () => {
    const tudoDesligado = new Map([["processos.decisao", false]]);
    expect(decidirPush({ aviso: null, mapa: tudoDesligado, horaLocal: 3 })).toEqual({ enviar: true });
  });
});

describe("só o que diverge do padrão é gravado", () => {
  it("voltar ao padrão APAGA a linha", () => {
    const r = ler("server/processos/router-notificacoes.ts");
    const bloco = r.slice(r.indexOf("salvarPreferencia:"), r.indexOf("Listar notificações do utilizador"));
    expect(bloco).toContain("if (input.ligado === padraoDaChave(input.chave)) {");
    expect(bloco).toContain(".delete(notificacaoPreferencias)");
    // E o cache do usuário morre na hora, senão a escolha demora até um minuto.
    expect(bloco).toContain("esquecerPreferencias(ctx.user.id)");
  });

  it("chave inventada não é gravada", () => {
    expect(chaveConhecida("processos.decisao")).toBe(true);
    expect(chaveConhecida(AJUSTE_SILENCIO)).toBe(true);
    expect(chaveConhecida("processos.qualquer-coisa")).toBe(false);
    expect(ler("server/processos/router-notificacoes.ts")).toContain(
      "if (!chaveConhecida(input.chave)) {",
    );
  });

  it("a lista sai do catálogo e é filtrada por quem a pessoa é", () => {
    const r = ler("server/processos/router-notificacoes.ts");
    const bloco = r.slice(r.indexOf("preferencias: protectedProcedure"), r.indexOf("salvarPreferencia:"));
    expect(bloco).toContain('quem === "dono" && ehDono');
    expect(bloco).toContain('quem === "financeiro" && veFinanceiro');
    expect(bloco).toContain("GRUPOS.filter((g) => podeVer(g.quemVe))");
  });
});

describe("o dono pode receber o que é dos colaboradores", () => {
  it("a chave nasce desligada e o cron a consulta nos DOIS avisos de processo", () => {
    expect(padraoDaChave(AJUSTE_ALCANCE)).toBe(false);
    const cron = ler("server/processos/cron-monitoramento.ts");
    expect(cron).toContain("donoQueQuerTudo(mon.escritorioId, mon.criadoPor)");
    expect((cron.match(/donoQueQuerTudo\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("o dono não recebe duas vezes quando foi ele quem cadastrou", () => {
    const fonte = ler("server/_core/preferencias-notificacao.ts");
    expect(fonte).toContain("dono.userId === jaAvisadoUserId) return null;");
  });
});

describe("a tela", () => {
  it("está montada em Configurações e salva sozinha", () => {
    const cfg = ler("client/src/pages/Configuracoes.tsx");
    expect(cfg).toContain('<TabsContent value="notificacoes"');
    expect(cfg).toContain("<NotificacoesTab />");

    const tela = ler("client/src/pages/configuracoes/NotificacoesTab.tsx");
    expect(tela).toContain("trpc.notificacoes.preferencias.useQuery");
    expect(tela).toContain("salvar.mutate({ chave, ligado })");
    // Clique que falha volta atrás: chave não pode mostrar o que não gravou.
    expect(tela).toContain("delete copia[vars.chave]");
  });

  it("o bloco do aparelho cobre os quatro estados do navegador", () => {
    const tela = ler("client/src/pages/configuracoes/NotificacoesTab.tsx");
    for (const estado of ["ativo", "negado", "indisponivel"]) {
      expect(tela, estado).toContain(`push.estado === "${estado}"`);
    }
    expect(tela).toContain("Ativar neste aparelho");
  });

  it("o alcance do escritório só aparece pro dono", () => {
    const tela = ler("client/src/pages/configuracoes/NotificacoesTab.tsx");
    expect(tela).toContain("{data?.ehDono && (");
  });
});
