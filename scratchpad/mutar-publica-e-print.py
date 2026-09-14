#!/usr/bin/env python3
"""
Mutação das amarras dos dois resíduos fechados em 13/09: o desvio de consulta
pública no `consultarCNJSincrono` e a foto do erro que sobrevive ao deploy.

Uso: python3 scratchpad/mutar-publica-e-print.py
"""
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TESTE = "server/__tests__/consulta-publica-e-print-do-erro.test.ts"

ROUTER = "server/routers/processos.ts"
CRON = "server/processos/cron-monitoramento.ts"
PRINT = "server/processos/print-do-erro.ts"
SCHEMA = "drizzle/schema.ts"
MIGRATION = "drizzle/0228_monitor_erro_print.sql"
TELA = "client/src/pages/Processos.tsx"

MUTACOES = [
    # ── consulta pública no consultarCNJSincrono ────────────────────────────
    ("o desvio de consulta pública desaparece",
     ROUTER,
     "      const consultaPublica = !tribunalRequerCredencial(tribunal.codigoTribunal);",
     "      const consultaPublica = false;",
     ),
    ("o scrape volta pro adapter do TJCE cravado",
     ROUTER,
     "        resultado = await consultarProcesso(tribunal.codigoTribunal, input.cnj, storageState);",
     "        resultado = await consultarTjce(input.cnj, storageState!, getConfigTribunal(tribunal.codigoTribunal)!);",
     ),
    ("a escolha de credencial sai de dentro do ramo e volta a valer pra todos",
     ROUTER,
     "      if (!consultaPublica) {\n        const sistemaCofre = sistemaCofrePorTribunal(tribunal.codigoTribunal);",
     "      if (true) {\n        const sistemaCofre = sistemaCofrePorTribunal(tribunal.codigoTribunal);",
     ),
    ("a cobrança passa pra ANTES das guardas",
     ROUTER,
     '      await contarUso(esc.escritorio.id, "consulta_processo");\n\n      let resultado;',
     "      let resultado;",
     ),
    ("tribunal do registro sem endereço volta a ser cobrado antes de recusar",
     ROUTER,
     "        if (!getConfigTribunal(tribunal.codigoTribunal)) {",
     "        if (false) {",
     ),
    ("o portão do tribunal candidato sai desta procedure",
     ROUTER,
     "      await exigirTribunalComprovado(db, esc.escritorio.id, tribunal.codigoTribunal);\n\n      // Tribunal de consulta pública",
     "      // Tribunal de consulta pública",
     ),

    # ── foto do erro ────────────────────────────────────────────────────────
    ("a pasta da foto deixa de separar por escritório",
     PRINT,
     "  return `monitor-erros/escritorio_${escritorioId}`;",
     "  return `monitor-erros`;",
     ),
    ("o nome do arquivo deixa de ser saneado",
     PRINT,
     '  const limpo = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\\.+/, "");',
     "  const limpo = base;",
     ),
    ("a travessia de diretório volta a passar",
     PRINT,
     '.replace(/^\\.+/, "");',
     ';',
     ),
    ("renomear em vez de copiar (quebra entre mounts)",
     PRINT,
     "    fs.copyFileSync(caminhoOrigem, destino);\n    fs.rmSync(caminhoOrigem, { force: true });",
     "    fs.renameSync(caminhoOrigem, destino);",
     ),
    ("falha de disco volta a derrubar o ciclo do cron",
     PRINT,
     "  } catch (err) {\n    log.warn(",
     "  } finally {\n    void 0;\n  }\n  if (false) {\n    log.warn(",
     ),
    ("o cron para de guardar a foto",
     CRON,
     "          ultimoErroPrintUrl: printUrl,",
     "          // sem foto",
     ),
    ("a foto passa a ser gravada sem escopo de escritório",
     CRON,
     "      const printUrl = await guardarPrintDoErro(\n        mon.escritorioId,",
     "      const printUrl = await guardarPrintDoErro(\n        0,",
     ),
    ("o sucesso deixa de limpar a foto (foto velha ao lado de monitor são)",
     CRON,
     "          ultimoErro: null,\n          ultimoErroPrintUrl: null,",
     "          ultimoErro: null,",
     ),
    ("a coluna muda de nome físico entre schema e migration",
     SCHEMA,
     'ultimoErroPrintUrl: varchar("ultimo_erro_print_url", { length: 500 })',
     'ultimoErroPrintUrl: varchar("ultimoErroPrintUrl", { length: 500 })',
     ),
    ("a migration deixa de criar a coluna",
     MIGRATION,
     "  ADD COLUMN ultimo_erro_print_url VARCHAR(500) DEFAULT NULL;",
     "  ADD COLUMN outra_coisa VARCHAR(500) DEFAULT NULL;",
     ),
    ("a tela oferece a foto mesmo sem erro",
     TELA,
     "{mon.diagnostico && mon.ultimoErroPrintUrl && (",
     "{mon.ultimoErroPrintUrl && (",
     ),
    ("o link da foto perde o destino",
     TELA,
     "                  href={mon.ultimoErroPrintUrl}",
     '                  href="#"',
     ),
]


def roda():
    r = subprocess.run(
        ["pnpm", "vitest", "run", TESTE],
        cwd=RAIZ, capture_output=True, text=True,
    )
    return r.returncode == 0


def main():
    vivos = []
    for i, (rotulo, arquivo, de, para) in enumerate(MUTACOES, 1):
        p = RAIZ / arquivo
        original = p.read_text()
        n = original.count(de)
        if n == 0:
            print(f"{i:2}. ⚠  ALVO NÃO ENCONTRADO — {rotulo} (em {arquivo})")
            vivos.append(rotulo)
            continue
        # Substituição única quando o alvo é único; múltipla é intencional só
        # no caso do sucesso que limpa a foto (4 caminhos iguais).
        p.write_text(original.replace(de, para))
        try:
            passou = roda()
        finally:
            p.write_text(original)
        if passou:
            print(f"{i:2}. ✗  SOBREVIVEU — {rotulo}")
            vivos.append(rotulo)
        else:
            print(f"{i:2}. ✓  vermelho — {rotulo}" + (f"  [{n}x]" if n > 1 else ""))

    print()
    if vivos:
        print(f"{len(vivos)} de {len(MUTACOES)} mutações sobreviveram:")
        for v in vivos:
            print(f"  - {v}")
        sys.exit(1)
    print(f"Todas as {len(MUTACOES)} mutações ficaram vermelhas.")


if __name__ == "__main__":
    main()
