#!/usr/bin/env python3
"""Mutações da entrega "motor próprio, fundação" (despachante, TRT2/TRT15,
parsers puros). Cada mutação quebra o código de propósito, roda a amarra que
deveria pegar e restaura o arquivo. Esperado: TODAS vermelhas.

Uso: python3 scratchpad/mutar-motor-despachante.py   (na raiz do repo)
"""
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

RUNNER = "server/processos/motor-proprio-runner.ts"
DESPACHANTE = "server/processos/adapters/index.ts"
PARSER = "server/processos/adapters/parse/pje-lista.ts"
ROUTER = "server/routers/processos.ts"
CRON = "server/processos/cron-monitoramento.ts"
SHARED = "shared/tribunais-pje.ts"
MIG = "drizzle/0227_tribunais_bullet_planos_trt.sql"

T_DESP = "server/__tests__/motor-proprio-despachante.test.ts"
T_INDEX = "server/processos/adapters/index.test.ts"
T_PARSE = "server/processos/adapters/parse/pje-lista.test.ts"
T_ROUTER = "server/__tests__/processos-consulta-publica-router.test.ts"
T_HONESTO = "server/__tests__/tribunais-texto-honesto.test.ts"

MUTACOES = [
    # (nome, arquivo, trecho antigo, trecho mutado, testes que devem ficar vermelhos)
    (
        "runner volta a cravar 'if tjce' (TRT2 vira erro)",
        RUNNER,
        "    const resultado: ResultadoScraper = await consultarProcesso(codigoTribunal, cnj, storageStateJson);",
        '    if (codigoTribunal !== "tjce") throw new Error(`Adapter motor próprio pra ${codigoTribunal} não implementado`);\n'
        "    const resultado: ResultadoScraper = await consultarProcesso(codigoTribunal, cnj, storageStateJson);",
        [T_DESP],
    ),
    (
        "runner manda sessão fixa em vez da recebida (consulta pública perde o null)",
        RUNNER,
        "await consultarProcesso(codigoTribunal, cnj, storageStateJson);",
        'await consultarProcesso(codigoTribunal, cnj, storageStateJson ?? "");',
        [T_DESP],
    ),
    (
        "despachante sem trt2 no mapa público",
        DESPACHANTE,
        '  trt2: async () => (await import("./pje-trt")).consultarTrt2,\n',
        "",
        [T_INDEX],
    ),
    (
        "despachante chama consultarTjce SEM a config do tribunal (cai no TJCE)",
        DESPACHANTE,
        "return consultarTjce(cnj, storageStateJson, cfg, opcoesConsulta);",
        "return consultarTjce(cnj, storageStateJson, undefined as never, opcoesConsulta);",
        [T_INDEX],
    ),
    (
        "despachante prefere o PDPJ sempre que há sessão (consulta pública com sessão vai pro lugar errado)",
        DESPACHANTE,
        "if (storageStateJson && cfg) {",
        "if (storageStateJson) {",
        [T_INDEX],
    ),
    (
        "despachante troca o adapter do trt15 pelo do trt2",
        DESPACHANTE,
        '  trt15: async () => (await import("./pje-trt")).consultarTrt15,',
        '  trt15: async () => (await import("./pje-trt")).consultarTrt2,',
        [T_INDEX],
    ),
    (
        "parser aceita rótulo de tabela como valor ('Polo ativo' vira classe)",
        PARSER,
        "if (v && !ehRotuloDeTabela(v)) return v;",
        "if (v) return v;",
        [T_PARSE],
    ),
    (
        "parser lê a grade mesmo sem reconhecer Classe/Polo (layout mudado vira linha)",
        PARSER,
        "if (indice.classe === undefined && indice.poloAtivo === undefined) continue;",
        "if (false) continue;",
        [T_PARSE],
    ),
    (
        "parser de movimentações cai no body inteiro quando não acha timeline nem tabela (o que o adapter fazia antes)",
        PARSER,
        "return tabela ? movimentacoesDaTabela(tabela, base) : [];",
        "return tabela ? movimentacoesDaTabela(tabela, base) : movimentacoesDaTimeline(doc.body, base);",
        [T_PARSE],
    ),
    (
        "parser da capa segue adiante até achar qualquer célula (valor do campo vizinho)",
        PARSER,
        '    if (["DT", "TH", "LABEL"].includes(irmao.tagName.toUpperCase())) return null;\n',
        "",
        [T_PARSE],
    ),
    (
        "router: consulta pública sai sem cobrar",
        ROUTER,
        '      if (!tribunalRequerCredencial(tribunal.codigoTribunal)) {\n        await contarUso(esc.escritorio.id, "consulta_processo");\n',
        "      if (!tribunalRequerCredencial(tribunal.codigoTribunal)) {\n",
        [T_ROUTER],
    ),
    (
        "router: consultarDocumento ignora o tribunal do pedido (volta a cravar a sede)",
        ROUTER,
        "const codigoTribunal = input.codigoTribunal ?? TRIBUNAL_SEDE;",
        "const codigoTribunal = TRIBUNAL_SEDE;",
        [T_ROUTER],
    ),
    (
        "router: monitor de novas ações nasce sempre na sede",
        ROUTER,
        "const tribunalDaCred = input.codigoTribunal ?? TRIBUNAL_SEDE;",
        "const tribunalDaCred = TRIBUNAL_SEDE;",
        [T_ROUTER],
    ),
    (
        "cron volta ao ramo literal do trf5",
        CRON,
        "if (temAdapterPublico(mon.tribunal)) {",
        'if (mon.tribunal === "trf5") {',
        [T_DESP],
    ),
    (
        "lista compartilhada perde o trt15",
        SHARED,
        '  { codigo: "trt15", sigla: "TRT15" },\n',
        "",
        [T_INDEX, T_HONESTO],
    ),
    (
        "texto da Justiça do Trabalho volta a dizer 'ainda não' com TRTs na lista",
        SHARED,
        'if (trts.length === 0) return "Justiça do Trabalho ainda não";',
        'return "Justiça do Trabalho ainda não";',
        [T_DESP],
    ),
    (
        "migration 0227 mexe no bullet errado do plano escritorio",
        MIG,
        "SET features = JSON_REPLACE(features, '$[5]',",
        "SET features = JSON_REPLACE(features, '$[4]',",
        [T_DESP],
    ),
]


def roda(testes: list[str]) -> bool:
    r = subprocess.run(
        ["pnpm", "vitest", "run", *testes],
        cwd=RAIZ,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return r.returncode == 0


def main() -> int:
    falhas = 0
    for nome, arquivo, antigo, mutado, testes in MUTACOES:
        caminho = RAIZ / arquivo
        original = caminho.read_text(encoding="utf-8")
        if original.count(antigo) != 1:
            print(f"?? {nome}: trecho não encontrado ou ambíguo em {arquivo}")
            falhas += 1
            continue
        caminho.write_text(original.replace(antigo, mutado), encoding="utf-8")
        try:
            verde = roda(testes)
        finally:
            caminho.write_text(original, encoding="utf-8")
        if verde:
            print(f"XX SOBREVIVEU: {nome}")
            falhas += 1
        else:
            print(f"ok vermelho: {nome}")
    print(f"\n{len(MUTACOES) - falhas}/{len(MUTACOES)} mutações vermelhas")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
