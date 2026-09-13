#!/usr/bin/env python3
"""Mutações de `saude-semaforos.test.ts`: quebra cada regra dos semáforos da
Visão rápida (e as amarras de tela/servidor) e exige que o teste fique
VERMELHO. Régua que ninguém consegue mover sem o teste gritar é régua; a
outra é decoração."""
import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(os.environ.get("RAIZ", Path(__file__).resolve().parents[1]))
SH = RAIZ / "shared/saude-semaforos.ts"
SAUDE = RAIZ / "client/src/pages/admin/AdminSaude.tsx"
JORNADA = RAIZ / "client/src/pages/admin/AdminRoboJornada.tsx"
ERROS_TELA = RAIZ / "client/src/pages/admin/AdminErros.tsx"
DASH = RAIZ / "client/src/pages/AdminDashboard.tsx"
ROUTER = RAIZ / "server/admin/router-admin-erros.ts"

MUTACOES = [
    # --- as réguas pedidas pelo dono ---
    ("régua 2000 ms/tela vira 200", SH,
     "export const MS_POR_TELA_MINIMO = 2000;", "export const MS_POR_TELA_MINIMO = 200;"),
    ("36 h vira 360 h", SH,
     "export const HORAS_SEM_RODAR_MAXIMO = 36;", "export const HORAS_SEM_RODAR_MAXIMO = 360;"),
    ("repetição: exige 4 varreduras em vez de 3", SH,
     "  if (trio.length < minimo) return nada;", "  if (trio.length <= minimo) return nada;"),
    ("repetição: some a comparação pelas regras (cai sempre no número)", SH,
     "  if (ids.every((l): l is string[] => l !== null)) {", "  if (false && ids.every((l): l is string[] => l !== null)) {"),
    ("repetição: some a comparação inteira (nunca repete)", SH,
     "  const naoCaiu = trio.every((v, i) => i === 0 || trio[i - 1].achados >= v.achados);",
     "  const naoCaiu = false;"),
    ("repetição: achado zerado no meio deixa de barrar", SH,
     "  if (trio.some((v) => v.achados <= 0)) return nada;", "  if (trio.every((v) => v.achados <= 0)) return nada;"),
    ("servidor: capturaConfigurada some de uma das saídas", ROUTER,
     "return { configurado: false as const, capturaConfigurada, issues: []",
     "return { configurado: false as const, issues: []"),
    ("servidor: process.env vira literal", ROUTER,
     "capturaSentryConfigurada(process.env)", 'capturaSentryConfigurada({ SENTRY_DSN_BACKEND: "https://x" })'),
    ("servidor: helper responde true sem olhar a env", SH,
     "  return Boolean((env.SENTRY_DSN_BACKEND || env.SENTRY_DSN)?.trim());", "  return true;"),
    ("servidor: helper volta a ignorar a SENTRY_DSN genérica (a régua do initSentry aceita)", SH,
     "  return Boolean((env.SENTRY_DSN_BACKEND || env.SENTRY_DSN)?.trim());",
     "  return Boolean(env.SENTRY_DSN_BACKEND?.trim());"),
    ("servidor: helper aceita só espaço em branco", SH,
     "  return Boolean((env.SENTRY_DSN_BACKEND || env.SENTRY_DSN)?.trim());",
     "  return Boolean(env.SENTRY_DSN_BACKEND || env.SENTRY_DSN);"),
    ("servidor: helper com `??` (BACKEND vazia esconderia a genérica)", SH,
     "  return Boolean((env.SENTRY_DSN_BACKEND || env.SENTRY_DSN)?.trim());",
     "  return Boolean((env.SENTRY_DSN_BACKEND ?? env.SENTRY_DSN)?.trim());"),
    ("erros: frase âmbar volta a citar só uma variável", SH,
     "nem SENTRY_DSN_BACKEND nem SENTRY_DSN estão no Railway",
     "a variável SENTRY_DSN_BACKEND não está no Railway"),
    ("erros: '25+' vira '25' (página cheia lida como contagem)", SH,
     "    const abertos = e.totalMinimo\n", "    const abertos = false\n"),
    ("servidor: página cheia deixa de virar piso", ROUTER,
     "totalMinimo: data.length >= input.limite,", "totalMinimo: false,"),
    ("servidor: totalMinimo some de uma das saídas", ROUTER,
     "issues: [], total: 0, totalMinimo: false, motivo: \"sentry_nao_configurado\"",
     "issues: [], total: 0, motivo: \"sentry_nao_configurado\""),
    # --- a montagem query → semáforo (as três que sobreviveram à suíte inteira) ---
    ("montagem: abertos vira 0 (linha verde com issues abertas)", SH,
     "        abertos: lidos?.total ?? 0,", "        abertos: 0,"),
    ("montagem: leitura que falhou some (Sentry fora do ar vira verde)", SH,
     '        leituraFalhou: lidos?.motivo ?? (erros.isError ? "erro_rede" : null),',
     "        leituraFalhou: null,"),
    ("montagem: isError do tRPC ignorado", SH,
     '        leituraFalhou: lidos?.motivo ?? (erros.isError ? "erro_rede" : null),',
     "        leituraFalhou: lidos?.motivo ?? null,"),
    ("montagem: captura sempre confirmada", SH,
     "        capturaConfigurada: lidos?.capturaConfigurada === true,", "        capturaConfigurada: true,"),
    ("montagem: totalMinimo ignorado", SH,
     "        totalMinimo: lidos?.totalMinimo === true,", "        totalMinimo: false,"),
    ("montagem: último erro some", SH,
     "        ultimoErroEm: ultimoErroVisto(lidos?.issues ?? []),", "        ultimoErroEm: null,"),
    ("montagem: auditor recebe lista vazia ('ainda não rodou' pra sempre)", SH,
     "    auditor: semaforoAuditor(auditor.data?.varreduras ?? [], agora, fuso),",
     "    auditor: semaforoAuditor([], agora, fuso),"),
    ("montagem: jornada recebe lista vazia ('ainda não rodou' pra sempre)", SH,
     "    jornada: semaforoJornada(jornada.data?.varreduras ?? [], agora, fuso),",
     "    jornada: semaforoJornada([], agora, fuso),"),
    ("montagem: ultimoErroVisto pega o mais antigo", SH,
     "      .sort()\n      .at(-1) ?? null", "      .sort()\n      .at(0) ?? null"),
    ("tela: entrega isError falso", SAUDE,
     "    erros: { data: erros.data, isError: erros.isError },", "    erros: { data: erros.data, isError: false },"),
    ("tela: entrega erros sem data", SAUDE,
     "    erros: { data: erros.data, isError: erros.isError },", "    erros: { data: undefined, isError: erros.isError },"),
    ("tela: entrega auditor sem data", SAUDE,
     "    auditor: { data: auditor.data },", "    auditor: { data: undefined },"),
    ("tela: entrega jornada sem data", SAUDE,
     "    jornada: { data: jornada.data },", "    jornada: { data: undefined },"),
    ("tela: 'Ver os erros' abre E-mails", SAUDE,
     'if (tipo === "aba_erros") irParaAba("erros");', 'if (tipo === "aba_erros") irParaAba("emails");'),
    ("tela: 'aba_auditor' abre Erros", SAUDE,
     'else if (tipo === "aba_auditor") irParaAba("robo-auditor");', 'else if (tipo === "aba_auditor") irParaAba("erros");'),
    ("tela: 'aba_jornada' abre o auditor", SAUDE,
     'else if (tipo === "aba_jornada") irParaAba("robo-jornada");', 'else if (tipo === "aba_jornada") irParaAba("robo-auditor");'),
    ("aba erros: banner volta a citar só uma variável", ERROS_TELA,
     "genérica <code>SENTRY_DSN</code>", "genérica <code>SENTRY_DSN_BACKEND</code>"),
    ("dashboard: esqueleto não espera o auditor", DASH,
     "|| erros.isLoading || auditor.isLoading;", "|| erros.isLoading;"),
    ("dashboard: card de erros sem o '+'", DASH,
     '${errosAbertos}${erros.data?.totalMinimo ? "+" : ""} ${errosAbertos === 1', "${errosAbertos} ${errosAbertos === 1"),
    # --- bordas das regras ---
    ("erros: 1 aberto deixa de ser vermelho", SH,
     "  if (e.abertos > 0) {", "  if (e.abertos > 1) {"),
    ("erros: leitura que falhou vira verde", SH,
     "  if (e.leituraFalhou) {", "  if (false) {"),
    ("erros: captura ausente vira verde", SH,
     "  if (!e.capturaConfigurada) {", "  if (false) {"),
    ("auditor: 36 h exatas já é 'não roda'", SH,
     "  if (horasParado > HORAS_SEM_RODAR_MAXIMO) {", "  if (horasParado >= HORAS_SEM_RODAR_MAXIMO) {"),
    ("auditor: regra que falhou deixa de ser vermelho", SH,
     "  if (ultima.regrasComErro > 0) {", "  if (ultima.regrasComErro > 9) {"),
    ("auditor: 'ontem e anteontem' sem conferir os dias", SH,
     '    return "de ontem e de anteontem";\n  }\n  return `das 2 varreduras anteriores',
     '    return "de ontem e de anteontem";\n  }\n  return `de ontem e de anteontem'),
    ("jornada: 2 s exatos vira suspeito", SH,
     "  return v.duracaoMs / v.rotasVisitadas < MS_POR_TELA_MINIMO;",
     "  return v.duracaoMs / v.rotasVisitadas <= MS_POR_TELA_MINIMO;"),
    ("jornada: não confiável vira âmbar", SH,
     '      cor: "vermelho",\n      titulo: "Robô de jornada — resultado não confiável",',
     '      cor: "ambar",\n      titulo: "Robô de jornada — resultado não confiável",'),
    ("jornada: achado deixa de ser âmbar", SH,
     "  if (ultima.rotasComAchado > 0) {", "  if (ultima.rotasComAchado > 5) {"),
    ("jornada: linha 'rodando' passa a contar como última", SH,
     '  const ultima = varreduras.find((v) => v.status !== "rodando");',
     "  const ultima = varreduras[0];"),
    # --- a tela usa a shared, e nada sumiu ---
    ("tela: import da shared some", SAUDE,
     '} from "@shared/saude-semaforos";', '} from "@shared/saude-semaforos-copia";'),
    ("tela: detalhes nascem abertos", SAUDE,
     "const [detalhes, setDetalhes] = useState(false)", "const [detalhes, setDetalhes] = useState(true)"),
    ("tela: 'Últimas rondas dos robôs' some", SAUDE,
     "<CardTitle className=\"text-base\">Últimas rondas dos robôs</CardTitle>",
     "<CardTitle className=\"text-base\">Rondas</CardTitle>"),
    ("tela: fila de tribunais sai da dobra", SAUDE,
     "        <FilaTribunais />\n      </div>\n        </CollapsibleContent>",
     "      </div>\n        </CollapsibleContent>\n        <FilaTribunais />"),
    ("tela: linha sem flex-wrap", SAUDE,
     '<div className="flex flex-wrap items-start gap-3 px-4 py-3">',
     '<div className="flex items-start gap-3 px-4 py-3">'),
    ("tela: botão do auditor deixa de rodar de verdade", SAUDE,
     'else if (tipo === "rodar_auditor") varrerAuditor.mutate({});',
     'else if (tipo === "rodar_auditor") irParaAba("robo-auditor");'),
    ("aba jornada: selo some", JORNADA,
     "{jornadaNaoConfiavel(ultima) && (", "{false && ("),
    ("aba erros: nota da variável some", ERROS_TELA,
     "{data?.capturaConfigurada === false && (", "{false && ("),
    ("dashboard: card aponta pra aba que não existe", DASH,
     'setLocation("/admin/saude?aba=robo-auditor")', 'setLocation("/admin/saude?aba=auditor")'),
    ("dashboard: card não entra na contagem", DASH,
     "    (repeticaoAuditor.repetido ? 1 : 0);", "    0;"),
]


def roda():
    r = subprocess.run(
        ["npx", "vitest", "run", "server/__tests__/saude-semaforos.test.ts"],
        cwd=RAIZ, capture_output=True, text=True)
    return r.returncode != 0


vivas = []
for nome, arq, de, para in MUTACOES:
    original = arq.read_text(encoding="utf8")
    if de not in original:
        print(f"?? {nome}: âncora não encontrada — mutação inválida")
        vivas.append(nome)
        continue
    arq.write_text(original.replace(de, para, 1), encoding="utf8")
    try:
        vermelho = roda()
    finally:
        arq.write_text(original, encoding="utf8")
    print(("ok " if vermelho else "VIVA ") + nome)
    if not vermelho:
        vivas.append(nome)

print(f"\n{len(MUTACOES) - len(vivas)}/{len(MUTACOES)} vermelhas")
sys.exit(1 if vivas else 0)
