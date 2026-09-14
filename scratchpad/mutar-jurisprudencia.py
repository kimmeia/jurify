#!/usr/bin/env python3
"""Mutações da jurisprudência de verdade (14/09): coletor de ementa + fusão.

Cada entrada desarma uma peça e diz qual amarra tem que ficar vermelha. As
quatro primeiras são as que importam: elas apagam a fronteira entre ementa
(cita) e metadado (mede), que é o que o produto vende.

Uso: python3 scratchpad/mutar-jurisprudencia.py
"""
import io
import os
import subprocess
import sys

AMARRA = "server/__tests__/jurisprudencia-de-verdade.test.ts"
LAYOUT = "server/__tests__/admin-layout-novo.test.ts"
CONTRATO = "server/__tests__/jurisia-router-contrato.test.ts"

FONTES = "shared/fontes-oficiais.ts"
EXTRAI = "server/jurisia/extrair-ementas.ts"
COLETOR = "server/jurisia/coletor-ementas.ts"
BUSCA = "server/jurisia/busca-ementas.ts"
MIG = "drizzle/0230_jurisia_ementas.sql"
SCHEMA = "drizzle/schema.ts"
ADMIN = "server/routers/admin.ts"
CRONS = "server/_core/cron-jobs.ts"
UNA = "server/jurisia/conversa-una.ts"
ROUTER = "server/jurisia/router-jurisia.ts"
TELA = "client/src/pages/JurisIa.tsx"
ABA = "client/src/pages/admin/ConhecimentoJuridicoTab.tsx"
HUB = "client/src/pages/admin/AdminIA.tsx"

# (nome, arquivo, de, para, teste)
MUTACOES = [
    # ── a fronteira ementa × metadado ───────────────────────────────────────
    ("o DataJud passa a se declarar como jurisprudência", FONTES,
     '    material: "metadado",\n    entrega:\n      "Classe, assunto, vara e movimentos de 90+ tribunais.',
     '    material: "ementa",\n    entrega:\n      "Classe, assunto, vara e movimentos de 90+ tribunais.', AMARRA),
    ("a frase que avisa que o DataJud não traz decisão some", FONTES,
     "Não traz texto de decisão — é o que vira estatística.", "Traz tudo que o tribunal publica.", AMARRA),
    ("uma fonte de ementa fica sem endereço de busca", FONTES,
     '    busca: "https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre={termo}",',
     '    busca: "",', AMARRA),
    ("uma fonte de ementa fica sem tribunal (some do entendimento regional)", FONTES,
     '    tribunal: "TJCE",', '    tribunal: "",', AMARRA),
    ("o termo entra na URL sem escape", FONTES,
     "return fonte.busca.replace(\"{termo}\", encodeURIComponent(termo));",
     "return fonte.busca.replace(\"{termo}\", termo);", AMARRA),
    ("a cadência para de decidir quando voltar", FONTES,
     "  return agora - ultimaColetaEm.getTime() >= fonte.cadenciaHoras * 3_600_000;",
     "  return true;", AMARRA),

    # ── o extrator ─────────────────────────────────────────────────────────
    ("registro sem texto de decisão passa a virar ementa", EXTRAI,
     "  if (ementa.length < MINIMO_EMENTA) return null;", "  if (false) return null;", AMARRA),
    ("ementa sem identificador passa (não dá pra citar)", EXTRAI,
     "  if (!identificador) return null;", "  if (false) return null;", AMARRA),
    ("o JSON deixa de ser percorrido e só olha a raiz", EXTRAI,
     "    for (const v of Object.values(reg)) {\n      if (v && typeof v === \"object\") fila.push(v);\n    }",
     "    // fila não cresce", AMARRA),
    ("o HTML aceita bloco sem identificador", EXTRAI,
     "    return identificadorNoTexto(t) !== null;", "    return true;", AMARRA),
    ("o HTML pega o bloco de fora em vez do menor", EXTRAI,
     "  const candidatos = comAsDuas.filter(\n    (el) => !comAsDuas.some((outro) => outro !== el && el.contains(outro as never)),\n  );",
     "  const candidatos = comAsDuas;", AMARRA),
    ("a data brasileira deixa de virar ISO", EXTRAI,
     "  if (br) return `${br[3]}-${br[2]}-${br[1]}`;", "  if (br) return br[0];", AMARRA),
    ("link relativo deixa de virar absoluto", EXTRAI,
     "    return new URL(href, baseUrl).toString().slice(0, 500);", "    return href.slice(0, 500);", AMARRA),

    # ── a busca ────────────────────────────────────────────────────────────
    ("a busca deixa de tirar as palavras vazias", BUSCA,
     "    .filter((p) => p.length >= 4 && !VAZIAS.has(p))", "    .filter((p) => p.length >= 1)", AMARRA),
    ("as aspas somem (hífen vira operador do MySQL)", BUSCA,
     'return palavras.map((p) => `"${p}"`).join(" ");', 'return palavras.join(" ");', AMARRA),

    # ── o robô não começa sozinho ──────────────────────────────────────────
    ("a fonte passa a nascer LIGADA na migration", MIG,
     "`ligadaJurisFonte` BOOLEAN NOT NULL DEFAULT FALSE", "`ligadaJurisFonte` BOOLEAN NOT NULL DEFAULT TRUE", AMARRA),
    ("a fonte passa a nascer ligada no schema", SCHEMA,
     'ligada: boolean("ligadaJurisFonte").default(false).notNull()',
     'ligada: boolean("ligadaJurisFonte").default(true).notNull()', AMARRA),
    ("o cron passa a visitar fonte desligada", COLETOR,
     "eq(jurisiaFontesColeta.ligada, true)", "sql`1 = 1`", AMARRA),
    ("o cron ignora a cadência e coleta toda hora", COLETOR,
     "    if (!coletaDevida(fonte, linha.ultimaColetaEm, agora)) continue;", "    // sem cadência", AMARRA),
    ("ligar a fonte passa a coletar na hora (bate no tribunal no clique)", ADMIN,
     "      await ligarFonte(input.fonteId, input.ligada);\n      return { ok: true };",
     "      await ligarFonte(input.fonteId, input.ligada);\n      const { coletarFonte } = await import(\"../jurisia/coletor-ementas\");\n      await coletarFonte(input.fonteId);\n      return { ok: true };", AMARRA),
    ("403 deixa de ser marcado como bloqueio de quem chama", COLETOR,
     "      bloqueada = r.status === 403 || r.status === 401;", "      bloqueada = false;", AMARRA),
    ("a coleta some do cron", CRONS,
     "  setInterval(rodarColetaEmentas, 60 * 60 * 1000);", "  // sem coleta", AMARRA),

    # ── citação sem endereço ───────────────────────────────────────────────
    ("ementa sem URL passa a ser gravada", COLETOR,
     "    const url = b.url;\n    if (!url) continue;", "    const url = b.url ?? \"\";", AMARRA),
    ("o banco passa a aceitar ementa sem endereço", MIG,
     "`urlJurisEm` VARCHAR(500) NOT NULL", "`urlJurisEm` VARCHAR(500)", AMARRA),
    ("o mesmo julgado passa a duplicar a cada coleta", MIG,
     "UNIQUE KEY `uq_juris_ementa` (`fonteIdJurisEm`, `identificadorJurisEm`),",
     "KEY `k_juris_ementa` (`fonteIdJurisEm`),", AMARRA),
    ("o índice de texto some (a busca vira varredura)", MIG,
     "FULLTEXT INDEX `ft_juris_ementa` (`ementaJurisEm`)", "KEY `k_ft` (`urlJurisEm`)", AMARRA),
    ("a tela passa a desenhar o link mesmo sem endereço", TELA,
     "{e.url && (", "{true && (", AMARRA),

    # ── a resposta ─────────────────────────────────────────────────────────
    ("a conversa para de buscar ementa", UNA,
     'const { buscarEmentas } = await import("./busca-ementas");',
     'const buscarEmentas = async () => [] as never[];', AMARRA),
    ("o tribunal do caso deixa de pesar na busca", UNA,
     "      tribunalPreferido: medido?.filtro?.tribunal ?? null,", "      tribunalPreferido: null,", AMARRA),
    ("a ementa não é gravada na resposta", ROUTER,
     "          jurisprudencia: r.jurisprudencia,", "          // sem jurisprudência", AMARRA),
    ("a frase que separa ementa de estatística some da tela", TELA,
     "Ementa é acórdão publicado — entra na peça.", "Fonte consultada.", AMARRA),
    ("falha na busca de ementa passa a derrubar a conversa", UNA,
     '  } catch (err) {\n    log.warn({ err: String(err) }, "Falha ao buscar ementas do acervo");\n  }',
     '  } finally {\n    // sem rede de proteção\n  }', AMARRA),

    # ── a fusão não removeu nada ───────────────────────────────────────────
    ("o painel do DataJud some da tela nova", ABA,
     "<AdminJurisIa />", "<div />", AMARRA),
    ("a biblioteca some da tela nova", ABA,
     "<BaseJuridicaTab />", "<div />", AMARRA),
    ("o link antigo das duas abas deixa de chegar", HUB,
     'if (aba === "base" || aba === "jurisia") return "conhecimento";', "// sem redirecionamento", LAYOUT),
    ("a tela nova some do hub", HUB,
     "<ConhecimentoJuridicoTab />", "<div />", LAYOUT),
    ("a procedure de ementas some do router", ROUTER,
     "  ementas: protectedProcedure.query(async ({ ctx }) => {", "  ementasRemovida: protectedProcedure.query(async ({ ctx }) => {", CONTRATO),
    ("o entendimento regional deixa de agrupar por tribunal", ADMIN,
     "      GROUP BY p.tribunalJurisProc", "      GROUP BY p.resultadoJurisProc", AMARRA),
    ("a contagem de ementa volta pra dentro do SQL (refém do collation)", ADMIN,
     "      FROM jurisia_ementas GROUP BY tribunalJurisEm", "      FROM jurisia_ementas GROUP BY fonteIdJurisEm", AMARRA),
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
