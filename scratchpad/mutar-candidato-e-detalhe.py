#!/usr/bin/env python3
"""
Confere as amarras de 13/09 por mutação: quebra o código de propósito e exige
que o teste fique VERMELHO. Amarra que sobrevive à mutação não protege nada.

Uso: python3 scratchpad/mutar-candidato-e-detalhe.py
"""
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

CANDIDATO = "server/__tests__/tribunal-candidato-nao-derruba.test.ts"
DETALHE = "server/__tests__/detalhe-no-lugar-nao-e-falha.test.ts"

ADAPTER = "scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts"
HELPERS = "server/escritorio/cofre-helpers.ts"
ROUTER_COFRE = "server/escritorio/router-cofre-credenciais.ts"
ROUTER_PROC = "server/routers/processos.ts"
ROUTER_IMP = "server/escritorio/router-importar-processos.ts"
SHARED = "shared/tribunais-pje.ts"
COMPROVADO = "server/processos/tribunal-comprovado.ts"
GRADE = "client/src/components/GradeTribunais.tsx"
TELA = "client/src/pages/Processos.tsx"
PKG = "package.json"

# (rótulo, arquivo, de, para, testes)
MUTACOES = [
    # ── régua de quem é candidato ───────────────────────────────────────────
    ("tribunalEmTeste sempre diz não",
     SHARED,
     "  return coberturaTribunais().emTeste.some((t) => t.codigo === codigo);",
     "  return false;",
     [CANDIDATO]),
    ("tribunalPrecisaDeProva esquece que consulta pública dispensa credencial",
     COMPROVADO,
     "  return tribunalEmTeste(codigoTribunal) && tribunalRequerCredencial(codigoTribunal);",
     "  return tribunalEmTeste(codigoTribunal);",
     [CANDIDATO]),
    ("falhaDerrubaCredencial volta a derrubar sempre",
     HELPERS,
     "  return !tribunalEmTeste(tribunal);",
     "  return true;",
     [CANDIDATO]),

    # ── falha do candidato não fala pela credencial ─────────────────────────
    ("relogin marca a credencial expirada sem consultar a régua",
     HELPERS,
     "    if (falhaDerrubaCredencial(tribunal)) {\n      await marcarCredencialExpirada(credencialId, motivo);",
     "    if (true) {\n      await marcarCredencialExpirada(credencialId, motivo);",
     [CANDIDATO]),
    ("o crash do relogin para de registrar no tribunal",
     HELPERS,
     "    await registrarTribunal(credencialId, tribunal, {\n      ok: false,\n      motivo: `Erro técnico: ${msg.slice(0, 200)}`,\n    });",
     "    // sem registro por tribunal",
     [CANDIDATO]),
    ("o 'Validar' volta a deixar toda falha escrever na credencial",
     ROUTER_COFRE,
     "        if (resultado.ok || falhaDerrubaCredencial(tribunalAlvo)) {\n          await atualizarStatusAposLogin(",
     "        if (true) {\n          await atualizarStatusAposLogin(",
     [CANDIDATO]),

    # ── grade do Cofre ──────────────────────────────────────────────────────
    ("o servidor para de marcar a linha como em teste",
     ROUTER_COFRE,
     "              emTeste: tribunalEmTeste(t),",
     "              emTeste: false,",
     [CANDIDATO]),
    ("a bateria volta a varrer os candidatos",
     GRADE,
     "  return tribunais.filter((t) => !t.semCobertura && !t.emTeste);",
     "  return tribunais.filter((t) => !t.semCobertura);",
     [CANDIDATO]),
    ("a tela faz a própria conta do total, divergindo da fila",
     TELA,
     "        total: lote?.total ?? alvosDaBateria((q.data.tribunais ?? []) as any[]).length,",
     "        total: lote?.total ?? ((q.data.tribunais ?? []) as any[]).filter((t: any) => !t.semCobertura).length,",
     [CANDIDATO]),
    ("a dobra dos candidatos desaparece da grade",
     GRADE,
     "            Em teste — Justiça do Trabalho ({estadosCandidatos.length} tribunais)",
     "            Outros ({estadosCandidatos.length})",
     [CANDIDATO]),
    ("o rodapé volta a contar candidato como portal que falhou",
     GRADE,
     "    comprovados.filter((t) => !t.semCobertura && t.status === s).length;",
     "    tribunais.filter((t) => !t.semCobertura && t.status === s).length;",
     [CANDIDATO]),

    # ── prova de login ──────────────────────────────────────────────────────
    ('a prova aceita tribunal "nao_testado"',
     COMPROVADO,
     '        eq(cofreCredencialTribunais.status, "ativa"),\n        eq(cofreCredenciais.escritorioId, escritorioId),\n        ne(cofreCredenciais.status, "removida"),\n      ),\n    )\n    .limit(1);',
     '        eq(cofreCredenciais.escritorioId, escritorioId),\n      ),\n    )\n    .limit(1);',
     [CANDIDATO]),
    ("a prova vale de qualquer escritório",
     COMPROVADO,
     "        eq(cofreCredencialTribunais.status, \"ativa\"),\n        eq(cofreCredenciais.escritorioId, escritorioId),\n        ne(cofreCredenciais.status, \"removida\"),\n      ),\n    )\n    .limit(1);\n  return !!linha;",
     "        eq(cofreCredencialTribunais.status, \"ativa\"),\n      ),\n    )\n    .limit(1);\n  return !!linha;",
     [CANDIDATO]),
    ("uma das quatro portas de processo perde o portão",
     ROUTER_PROC,
     "      await exigirTribunalComprovado(db, esc.escritorio.id, tribunalDaCred);",
     "      // portão removido",
     [CANDIDATO]),
    ("a importação volta a criar monitor de tribunal candidato",
     ROUTER_IMP,
     "                  tribunalPrecisaDeProva(linha.codigoTribunal) &&\n                  !tribunaisProvados.has(linha.codigoTribunal)",
     "                  false",
     [CANDIDATO]),
    ("a importação para de explicar por que não criou o monitor",
     ROUTER_IMP,
     "                    motivo: mensagemTribunalEmTeste(siglaDoTribunal(linha.codigoTribunal)),",
     "                    motivo: \"não elegível\",",
     [CANDIDATO]),
    ("a mensagem para de dizer onde resolver",
     SHARED,
     "em Processos → Cofre e rode o teste de login dele; se passar, o monitoramento libera sozinho.`",
     "no sistema.`",
     [CANDIDATO]),

    # ── linkedom ────────────────────────────────────────────────────────────
    ("linkedom volta pra devDependencies",
     PKG,
     '    "linkedom": "^0.18.13",\n    "lucide-react"',
     '    "lucide-react"',
     [CANDIDATO]),

    # ── adapter: não desistir antes de extrair ──────────────────────────────
    ("o return antecipado volta ao clique que não confirmou",
     ADAPTER,
     "          detalheNaoAbriu = true;\n          screenshotDetalheNaoAbriu = await this.tirarScreenshotErro(",
     "          return { ...baseResultado, categoriaErro: \"detalhe_nao_abriu\" } as never;\n          screenshotDetalheNaoAbriu = await this.tirarScreenshotErro(",
     [DETALHE]),
    ("órgão julgador deixa de contar como conteúdo extraído",
     ADAPTER,
     "        capa.classe || capa.orgaoJulgador || capa.partes.length > 0 || movimentacoes.length > 0;",
     "        capa.classe || capa.partes.length > 0 || movimentacoes.length > 0;",
     [DETALHE]),
    ("a grade da busca para de voltar no erro de 'não abriu'",
     ADAPTER,
     "            linhasDaBusca,\n            screenshotPath: screenshotDetalheNaoAbriu ?? screenshotPath,",
     "            screenshotPath: screenshotDetalheNaoAbriu ?? screenshotPath,",
     [DETALHE]),
    ("a foto do momento do clique é trocada pela tirada depois",
     ADAPTER,
     "            screenshotPath: screenshotDetalheNaoAbriu ?? screenshotPath,",
     "            screenshotPath,",
     [DETALHE]),
    ("a categoria 'não abriu' desaparece e tudo vira parse_falhou",
     ADAPTER,
     "        if (detalheNaoAbriu) {\n          return {\n            ...baseResultado,\n            latenciaMs: Date.now() - inicio,\n            categoriaErro: \"detalhe_nao_abriu\",",
     "        if (false) {\n          return {\n            ...baseResultado,\n            latenciaMs: Date.now() - inicio,\n            categoriaErro: \"parse_falhou\",",
     [DETALHE]),

    # ── adapter: espera ─────────────────────────────────────────────────────
    ("os marcadores do detalhe voltam a ser copiados em dois lugares",
     ADAPTER,
     "      .evaluate((seletorDetalhe) => {\n        const temDetalhe = !!document.querySelector(seletorDetalhe);",
     "      .evaluate(() => {\n        const temDetalhe = !!document.querySelector(\"#divTimeLine\");",
     [DETALHE]),
    ("o clique volta a esperar só por aba nova",
     ADAPTER,
     "          const sinal = await primeiroSinal<Page | typeof MESMA_ABA>(\n            [newPagePromise.catch(() => null), marcadorNaMesmaAba],\n            ESPERA_DETALHE_MS,\n          );",
     "          const sinal = await newPagePromise.catch(() => null);",
     [DETALHE]),
    ("a corrida volta a ser Promise.race cru, e o null ganha",
     ADAPTER,
     "    p.then((v) => (v == null ? new Promise<T>(() => {}) : v));",
     "    p;",
     [DETALHE]),
    ("o timer da espera volta a segurar o processo",
     ADAPTER,
     "    (t as unknown as { unref?: () => void }).unref?.();",
     "    void t;",
     [DETALHE]),
]


def roda(testes):
    r = subprocess.run(
        ["pnpm", "vitest", "run", *testes],
        cwd=RAIZ, capture_output=True, text=True,
    )
    return r.returncode == 0


def main():
    vivos = []
    for i, (rotulo, arquivo, de, para, testes) in enumerate(MUTACOES, 1):
        p = RAIZ / arquivo
        original = p.read_text()
        if de not in original:
            print(f"{i:2}. ⚠  ALVO NÃO ENCONTRADO — {rotulo}")
            print(f"      em {arquivo}")
            vivos.append(rotulo)
            continue
        if original.count(de) != 1:
            print(f"{i:2}. ⚠  ALVO AMBÍGUO ({original.count(de)}x) — {rotulo}")
            vivos.append(rotulo)
            continue
        p.write_text(original.replace(de, para, 1))
        try:
            passou = roda(testes)
        finally:
            p.write_text(original)
        if passou:
            print(f"{i:2}. ✗  SOBREVIVEU — {rotulo}")
            vivos.append(rotulo)
        else:
            print(f"{i:2}. ✓  vermelho — {rotulo}")

    print()
    if vivos:
        print(f"{len(vivos)} de {len(MUTACOES)} mutações sobreviveram:")
        for v in vivos:
            print(f"  - {v}")
        sys.exit(1)
    print(f"Todas as {len(MUTACOES)} mutações ficaram vermelhas.")


if __name__ == "__main__":
    main()
