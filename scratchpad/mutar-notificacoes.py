#!/usr/bin/env python3
"""Mutações da tela de Notificações (14/09).

A que mais importa é a primeira família: qualquer uma delas transforma a
entrega num APAGÃO de avisos — e apagão não dá erro, não aparece em log e só
se descobre quando alguém perde um prazo. Depois vêm os padrões (inverter
rotina/decisão desfaz o motivo da tela existir) e a dedup (sem ela o celular
toca a cada ciclo de cron).

Uso: python3 scratchpad/mutar-notificacoes.py
"""
import io
import os
import subprocess
import sys

AMARRA = "server/__tests__/notificacoes-que-o-dono-escolhe.test.ts"

AVISOS = "shared/notificacoes-avisos.ts"
PREF = "server/_core/preferencias-notificacao.ts"
SSE = "server/_core/sse-notifications.ts"
CRON = "server/_core/cron-jobs.ts"
MON = "server/processos/cron-monitoramento.ts"
HANDLER = "server/integracoes/whatsapp-handler.ts"
WEBHOOK = "server/integracoes/asaas-webhook.ts"
CLIENTES = "server/escritorio/router-clientes.ts"
ESPERA = "server/escritorio/cron-cliente-esperando.ts"
ROUTER = "server/processos/router-notificacoes.ts"
TELA = "client/src/pages/configuracoes/NotificacoesTab.tsx"
CFG = "client/src/pages/Configuracoes.tsx"

# (nome, arquivo, de, para, teste)
MUTACOES = [
    # ── apagão silencioso de avisos ─────────────────────────────────────────
    ("tipo não mapeado passa a ser BLOQUEADO", AVISOS,
     "    default:\n      return null;", '    default:\n      return "processos.rotina";', AMARRA),
    ("banco fora passa a bloquear o push", PREF,
     "    if (!pref) return { enviar: true };", "    if (!pref) return { enviar: false };", AMARRA),
    ("erro na leitura passa a bloquear o push", PREF,
     '    log.warn({ userId, tipo, err: (err as Error).message }, "[push] preferência indisponível — enviando");\n    return { enviar: true };',
     '    log.warn({ userId, tipo, err: (err as Error).message }, "[push] preferência indisponível");\n    return { enviar: false };', AMARRA),
    ("a recusa é registrada mas o push sai assim mesmo", SSE,
     "          );\n          return;\n        }\n\n        const { enviarPushParaUsuario }",
     "          );\n        }\n\n        const { enviarPushParaUsuario }", AMARRA),
    ("o push para de consultar a preferência (volta ao tudo-ou-nada)", SSE,
     "        const decisao = await pushPermitido(userId, notificacao.tipo, notificacao.dados);",
     "        const decisao = { enviar: true } as { enviar: boolean; motivo?: string };", AMARRA),

    # ── os padrões aprovados ────────────────────────────────────────────────
    ("movimentação de rotina volta a vir LIGADA", AVISOS,
     '    id: "processos.rotina",\n    grupo: "processos",\n    titulo: "Movimentação de rotina",\n    explica:\n      "Juntada, conclusos, publicação, remessa. São 8 de cada 10 — desligado, o celular para de tocar à toa.",\n    padrao: false,',
     '    id: "processos.rotina",\n    grupo: "processos",\n    titulo: "Movimentação de rotina",\n    explica:\n      "Juntada, conclusos, publicação, remessa. São 8 de cada 10 — desligado, o celular para de tocar à toa.",\n    padrao: true,', AMARRA),
    ("decisão no processo passa a vir desligada", AVISOS,
     '    titulo: "Decisão ou sentença no processo",\n    explica: "Sentença, liminar, acórdão — o que muda o rumo do caso. Chega com o resumo em uma linha.",\n    padrao: true,',
     '    titulo: "Decisão ou sentença no processo",\n    explica: "Sentença, liminar, acórdão — o que muda o rumo do caso. Chega com o resumo em uma linha.",\n    padrao: false,', AMARRA),
    ("toda mensagem volta a vir LIGADA (o celular do dono de novo)", AVISOS,
     '    titulo: "Toda mensagem que chega",\n    explica:\n      "Era o que acontecia antes, sem escolha. Fica desligado por padrão: quem atende continua recebendo as conversas dele.",\n    padrao: false,',
     '    titulo: "Toda mensagem que chega",\n    explica:\n      "Era o que acontecia antes, sem escolha. Fica desligado por padrão: quem atende continua recebendo as conversas dele.",\n    padrao: true,', AMARRA),
    ("nova conversa passa a vir desligada", AVISOS,
     '    titulo: "Nova conversa iniciada",\n    explica:\n      "A primeira mensagem de quem nunca falou com o escritório, ou de quem voltou depois de um atendimento encerrado.",\n    padrao: true,',
     '    titulo: "Nova conversa iniciada",\n    explica:\n      "A primeira mensagem de quem nunca falou com o escritório, ou de quem voltou depois de um atendimento encerrado.",\n    padrao: false,', AMARRA),
    ("saúde do sistema deixa de ser só do dono", AVISOS,
     '    explica:\n      "Qualidade caindo na Meta, limite de envio rebaixado, disjuntor disparado. É a diferença entre reagir no amarelo e descobrir no bloqueio.",\n    padrao: true,\n    quemVe: "dono",',
     '    explica:\n      "Qualidade caindo na Meta, limite de envio rebaixado, disjuntor disparado. É a diferença entre reagir no amarelo e descobrir no bloqueio.",\n    padrao: true,\n    quemVe: "todos",', AMARRA),
    ("dinheiro deixa de exigir acesso ao Financeiro", AVISOS,
     '    titulo: "Pagamento recebido",\n    explica: "O cliente pagou a cobrança. Chega com o valor e o nome.",\n    padrao: true,\n    quemVe: "financeiro",',
     '    titulo: "Pagamento recebido",\n    explica: "O cliente pagou a cobrança. Chega com o valor e o nome.",\n    padrao: true,\n    quemVe: "todos",', AMARRA),
    ("o silêncio noturno passa a vir desligado", AVISOS,
     "  [AJUSTE_SILENCIO]: true,", "  [AJUSTE_SILENCIO]: false,", AMARRA),
    ("receber o dos colaboradores passa a vir LIGADO", AVISOS,
     "  [AJUSTE_ALCANCE]: false,", "  [AJUSTE_ALCANCE]: true,", AMARRA),

    # ── a classificação ─────────────────────────────────────────────────────
    ("movimentação sem classe cai em ROTINA (silencia o que a IA não leu)", AVISOS,
     '  if (grupo === "rotina") return "processos.rotina";\n  return "processos.decisao";',
     '  if (grupo === "rotina") return "processos.rotina";\n  return "processos.rotina";', AMARRA),
    ("exige providência passa a contar como rotina", AVISOS,
     '  if (grupo === "exigem_acao") return "processos.providencia";',
     '  if (grupo === "exigem_acao") return "processos.rotina";', AMARRA),
    ("o cron para de mandar a classe", MON,
     "            classe: movsParaNotif[0]?.classe ?? null,", "", AMARRA),
    ("o cron inventa a própria classificação em vez da da Central", MON,
     "            m.classe = classificarGrupo({", "            m.classe = ((x) => \"rotina\")({", AMARRA),

    # ── nova conversa × toda mensagem ───────────────────────────────────────
    ("toda mensagem volta a ser indistinguível de conversa nova", AVISOS,
     '      return dados?.conversaNova === true ? "atendimento.nova-conversa" : "atendimento.toda-mensagem";',
     '      return "atendimento.toda-mensagem";', AMARRA),
    ("o handler para de marcar começo de conversa", HANDLER,
     '  const conversaNova =\n    contatoFoiCriado || statusAtual === "resolvido" || statusAtual === "fechado";',
     "  const conversaNova = false;", AMARRA),
    ("a marca não chega no aviso", HANDLER,
     'dados: { conversaId, contatoId, canal: "whatsapp", conversaNova },',
     'dados: { conversaId, contatoId, canal: "whatsapp" },', AMARRA),

    # ── o que não chegava no celular ────────────────────────────────────────
    ("credencial de tribunal volta a não chegar no celular", SSE,
     '  "credencial_erro",\n  "credencial_recuperada",', "", AMARRA),
    ("prazo vencendo volta a não chegar no celular", SSE,
     '  "prazo_vencendo",\n  "pagamento_recebido",', '  "pagamento_recebido",', AMARRA),
    ("o aviso de prazo passa a sair ANTES da dedup (toca a cada 5 min)", CRON,
     "      if (existente) return;", "      if (false) return;", AMARRA),
    ("prazo vencendo para de emitir", CRON,
     '      emitirNotificacao(userId, { tipo: "prazo_vencendo", titulo, mensagem });', "", AMARRA),
    ("pagamento recebido para de avisar", WEBHOOK,
     '                      tipo: "pagamento_recebido",', '                      tipo: "info",', AMARRA),
    ("cobrança vencida para de avisar", WEBHOOK,
     '                      tipo: "cobranca_vencida",', '                      tipo: "info",', AMARRA),
    ("contrato fechado deixa de ser best-effort (aviso derruba a venda)", CLIENTES,
     "      } catch {\n        /* aviso é best-effort */\n      }", "      }", AMARRA),
    ("as rotas dos avisos novos somem (tudo cai no Atendimento)", SSE,
     '  if (n.tipo === "prazo_vencendo") return "/agenda";', "", AMARRA),

    # ── cliente esperando ───────────────────────────────────────────────────
    ("a espera deixa de exigir que a última mensagem seja do cliente", ESPERA,
     '          eq(mensagens.direcao, "entrada"),', "", AMARRA),
    ("conversa já em atendimento passa a contar como espera", ESPERA,
     '          eq(conversas.status, "aguardando"),', "", AMARRA),
    ("some o teto de idade (backlog de semanas vira urgência)", ESPERA,
     "          gte(ultima.quando, limiteAntigo),", "", AMARRA),
    ("a dedup some (toca a cada ciclo de 5 minutos)", ESPERA,
     "      if (jaAvisou) continue;", "", AMARRA),
    ("o cron de espera sai do ar", CRON,
     '      const { avisarClientesEsperando } = await import("../escritorio/cron-cliente-esperando");',
     "      const avisarClientesEsperando = async () => ({ avisadas: 0 });", AMARRA),

    # ── silêncio ────────────────────────────────────────────────────────────
    ("o silêncio deixa de cruzar a meia-noite (madrugada volta a tocar)", AVISOS,
     "  return horaLocal >= SILENCIO_DE || horaLocal < SILENCIO_ATE;",
     "  return horaLocal >= SILENCIO_DE && horaLocal < SILENCIO_ATE;", AMARRA),
    ("a hora passa a ser a do servidor, não a do escritório", PREF,
     "    const txt = new Intl.DateTimeFormat(\"pt-BR\", {\n      timeZone: fuso,",
     "    const txt = new Intl.DateTimeFormat(\"pt-BR\", {\n      timeZone: \"UTC\",", AMARRA),
    ("o motivo mente: desligado passa a se chamar silêncio", PREF,
     '  if (!ligado) return { enviar: false, motivo: "desligado" };',
     '  if (!ligado) return { enviar: false, motivo: "silencio" };', AMARRA),
    ("o silêncio passa a decidir ANTES do desligado", PREF,
     '  const ligado = opts.mapa.get(opts.aviso) ?? padraoDaChave(opts.aviso);\n  if (!ligado) return { enviar: false, motivo: "desligado" };\n\n  const silencio',
     '  const silencio', AMARRA),
    ("o silêncio para de valer", PREF,
     "  if (silencio && dentroDoSilencio(opts.horaLocal)) {",
     "  if (false && dentroDoSilencio(opts.horaLocal)) {", AMARRA),
    ("a chave do silêncio deixa de ser consultada (vale sempre)", PREF,
     "  const silencio = opts.mapa.get(AJUSTE_SILENCIO) ?? padraoDaChave(AJUSTE_SILENCIO);",
     "  const silencio = true;", AMARRA),
    ("a hora para de chegar na decisão", PREF,
     "    return decidirPush({ aviso, mapa: pref.mapa, horaLocal: horaLocalEm(pref.fuso, agora) });",
     "    return decidirPush({ aviso, mapa: pref.mapa, horaLocal: 12 });", AMARRA),

    # ── gravar só o que diverge ─────────────────────────────────────────────
    ("voltar ao padrão passa a GRAVAR em vez de apagar", ROUTER,
     "      if (input.ligado === padraoDaChave(input.chave)) {", "      if (false) {", AMARRA),
    ("chave inventada passa a ser aceita", ROUTER,
     "      if (!chaveConhecida(input.chave)) {", "      if (false) {", AMARRA),
    ("o cache não é esquecido ao salvar", ROUTER,
     "      esquecerPreferencias(ctx.user.id);", "", AMARRA),
    ("o grupo do dono passa a aparecer pra todo mundo", ROUTER,
     '      quem === "todos" || (quem === "dono" && ehDono) || (quem === "financeiro" && veFinanceiro);',
     "      true;", AMARRA),

    # ── alcance do dono ─────────────────────────────────────────────────────
    ("o dono deixa de receber o que é dos colaboradores", MON,
     "        const donoTambem = await donoQueQuerTudo(mon.escritorioId, mon.criadoPor);",
     "        const donoTambem = null;", AMARRA),
    ("o dono passa a receber duas vezes o que ele mesmo cadastrou", PREF,
     "    if (!dono?.userId || dono.userId === jaAvisadoUserId) return null;",
     "    if (!dono?.userId) return null;", AMARRA),

    # ── a tela ──────────────────────────────────────────────────────────────
    ("a aba sai de Configurações", CFG,
     '        <TabsContent value="notificacoes" className="space-y-3">', '        <TabsContent value="notificacoes-off" className="space-y-3">', AMARRA),
    ("o clique que falha deixa de voltar atrás", TELA,
     "        delete copia[vars.chave];", "", AMARRA),
    ("a tela para de salvar", TELA,
     "    salvar.mutate({ chave, ligado });", "", AMARRA),
    ("o bloco do aparelho perde o estado de bloqueado pelo navegador", TELA,
     '        ) : push.estado === "negado" ? (', "        ) : false ? (", AMARRA),
    ("o alcance do escritório passa a aparecer pra colaborador", TELA,
     "          {data?.ehDono && (", "          {true && (", AMARRA),
]


def rodar(teste: str) -> bool:
    r = subprocess.run(["pnpm", "vitest", "run", teste], capture_output=True, text=True, cwd=".")
    return r.returncode == 0


def main() -> int:
    sobreviventes = []
    for i, (nome, arquivo, de, para, teste) in enumerate(MUTACOES, 1):
        if not os.path.exists(arquivo):
            print(f"[{i:2}/{len(MUTACOES)}] ⚠ ARQUIVO NÃO EXISTE — {nome} ({arquivo})")
            sobreviventes.append(nome + " (arquivo não existe)")
            continue
        original = io.open(arquivo, encoding="utf-8").read()
        if de not in original:
            print(f"[{i:2}/{len(MUTACOES)}] ⚠ TRECHO NÃO ENCONTRADO — {nome} ({arquivo})")
            sobreviventes.append(nome + " (trecho não encontrado)")
            continue
        io.open(arquivo, "w", encoding="utf-8").write(original.replace(de, para, 1))
        try:
            passou = rodar(teste)
        finally:
            io.open(arquivo, "w", encoding="utf-8").write(original)
        if passou:
            print(f"[{i:2}/{len(MUTACOES)}] ✗ SOBREVIVEU — {nome}")
            sobreviventes.append(nome)
        else:
            print(f"[{i:2}/{len(MUTACOES)}] ✓ vermelho — {nome}")

    print()
    if sobreviventes:
        print(f"{len(sobreviventes)} sobreviveram:")
        for s in sobreviventes:
            print(f"  - {s}")
        return 1
    print(f"todas as {len(MUTACOES)} mutações ficaram vermelhas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
