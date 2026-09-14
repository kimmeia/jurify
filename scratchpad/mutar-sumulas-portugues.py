#!/usr/bin/env python3
"""Mutações das súmulas + da sondagem em português (14/09).

Cada entrada desarma uma peça e diz qual amarra tem que ficar vermelha. As que
importam mais são três: súmula cancelada entrando no acervo (quem cita perde a
causa), a situação medida virando otimismo (convida a ligar fonte que não tem
como responder) e o recado voltando a falar 403/tls/IP (foi o que fez o dono
dizer "entendi nada").

Uso: python3 scratchpad/mutar-sumulas-portugues.py
"""
import io
import os
import subprocess
import sys

AMARRA = "server/__tests__/sumulas-e-sondagem-em-portugues.test.ts"
VELHA = "server/__tests__/jurisprudencia-de-verdade.test.ts"

FONTES = "shared/fontes-oficiais.ts"
PORTUGUES = "shared/sondagem-em-portugues.ts"
UNA = "shared/jurisia-una.ts"
SUMULAS = "server/jurisia/extrair-sumulas.ts"
COLETOR = "server/jurisia/coletor-ementas.ts"
SONDA = "server/jurisia/sondar-fontes.ts"
ADMIN = "server/routers/admin.ts"
ABA = "client/src/pages/admin/ConhecimentoJuridicoTab.tsx"
PAINEL = "client/src/pages/admin/AdminJurisIa.tsx"
TELA = "client/src/pages/JurisIa.tsx"

# (nome, arquivo, de, para, teste)
MUTACOES = [
    # ── o que protege quem assina a peça ────────────────────────────────────
    ("súmula CANCELADA passa a entrar no acervo (texto)", SUMULAS,
     "    if (CANCELADA.test(corpo.slice(0, 120))) {\n      canceladas++;\n      continue;\n    }",
     "    if (false) {\n      canceladas++;\n      continue;\n    }", AMARRA),
    ("súmula CANCELADA passa a entrar no acervo (json)", SUMULAS,
     "    if (CANCELADA.test(texto.slice(0, 120))) {\n      canceladas++;\n      continue;\n    }",
     "    if (false) {\n      canceladas++;\n      continue;\n    }", AMARRA),
    ("item de índice (só número) vira enunciado", SUMULAS,
     "const MINIMO_TEXTO = 30;", "const MINIMO_TEXTO = 1;", AMARRA),
    ("a mesma súmula entra duas vezes", SUMULAS,
     "    if (vistos.has(chave)) continue;\n    vistos.add(chave);\n\n    sumulas.push({",
     "    vistos.add(chave);\n\n    sumulas.push({", AMARRA),
    ("súmula vinculante perde o 'Vinculante' na citação", SUMULAS,
     'const nome = vinculante ? "Súmula Vinculante" : "Súmula";',
     'const nome = "Súmula";', AMARRA),
    ("script e style voltam a ser lidos como conteúdo", SUMULAS,
     'for (const fora of document.querySelectorAll("script, style, noscript")) fora.remove();',
     "", AMARRA),
    ("página em pedaço (sem <html>) volta a devolver vazio", SUMULAS,
     'const texto = document.body?.textContent || document.documentElement?.textContent || "";',
     'const texto = document.body?.textContent || "";', AMARRA),
    ("número escrito dentro do texto para de ser aproveitado", SUMULAS,
     "    if (!numero && texto) {\n      MARCADOR.lastIndex = 0;",
     "    if (false && texto) {\n      MARCADOR.lastIndex = 0;", AMARRA),
    ("o enunciado guardado repete o próprio 'Súmula N'", SUMULAS,
     "      texto: (semMarcador.length >= MINIMO_TEXTO ? semMarcador : texto).slice(0, 4_000),",
     "      texto: texto.slice(0, 4_000),", AMARRA),

    # ── súmula como material de primeira classe ─────────────────────────────
    ("as súmulas do STJ saem da lista de fontes", FONTES,
     '    id: "stj-sumulas",', '    id: "stj-sumulas-desativada",', AMARRA),
    ("súmula deixa de contar como material citável", FONTES,
     'return f.material === "sumula" || f.material === "ementa";',
     'return f.material === "ementa";', AMARRA),
    ("súmula passa a ser buscada por termo, como ementa", FONTES,
     'if (fonte.material === "sumula") return fonte.listaCompleta || null;', "", AMARRA),

    # ── a situação medida ───────────────────────────────────────────────────
    ("o STJ passa a aparecer como porta aberta", FONTES,
     '    busca: "https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre={termo}",\n    situacao: "recusa_nosso_servidor",',
     '    busca: "https://scon.stj.jus.br/SCON/pesquisar.jsp?b=ACOR&livre={termo}",\n    situacao: "porta_aberta",', AMARRA),
    ("o TJSP volta a ser 'nunca medido'", FONTES,
     '    situacao: "porta_aberta",\n    notaDaSondagem: "Respondeu do nosso servidor em 612ms.',
     '    situacao: "nao_sondada",\n    notaDaSondagem: "Respondeu do nosso servidor em 612ms.', AMARRA),
    ("o TRF4 sai da lista (a porta que responde deixa de existir)", FONTES,
     '    id: "trf4-jurisprudencia",', '    id: "trf4-desativada",', AMARRA),
    ("o endereço deduzido do TJCE passa a valer como fonte boa", FONTES,
     '    situacao: "endereco_a_corrigir",', '    situacao: "coleta_liberada",', AMARRA),
    ("quem barra o nosso servidor passa a 'ter chance' de ligar", FONTES,
     'return f.situacao === "coleta_liberada" || f.situacao === "porta_aberta";',
     'return f.situacao !== "nao_sondada";', AMARRA),

    # ── o recado em português ───────────────────────────────────────────────
    ("o 403 que persiste volta a dizer 'é o IP'", PORTUGUES,
     'frase: "O tribunal barrou o nosso servidor, não o nosso pedido.",',
     'frase: "403 persistiu — é o IP.",', AMARRA),
    ("403 que passa com navegador vira porta fechada", PORTUGUES,
     '    if (r.retryNavegador === "passou") {\n      return {\n        tom: "conserto",',
     '    if (r.retryNavegador === "passou") {\n      return {\n        tom: "fechado",', AMARRA),
    ("endereço que não existe vira porta fechada", PORTUGUES,
     '    if (r.causa === "dns") {\n      return {\n        tom: "conserto",',
     '    if (r.causa === "dns") {\n      return {\n        tom: "fechado",', AMARRA),
    ("o certificado volta a ser chamado de tls", PORTUGUES,
     'frase: "A conversa travou no certificado de segurança do site do tribunal.",',
     'frase: "Erro de tls na conexão.",', AMARRA),
    ("responder sem texto de decisão passa a contar como 'serve'", PORTUGUES,
     '    tom: "quase",\n    frase: "Responde, mas nessa página não vem o texto da decisão',
     '    tom: "funciona",\n    frase: "Responde, mas nessa página não vem o texto da decisão', AMARRA),
    ("a contagem de súmula no corpo para de contar", PORTUGUES,
     "  const sumulas = r.sumulasNoCorpo ?? 0;", "  const sumulas = 0;", AMARRA),
    ("o resumo passa a listar grupo vazio", PORTUGUES,
     "  if (conta.fechado > 0) {", "  if (conta.fechado >= 0) {", AMARRA),
    ("o que não tem jeito passa a aparecer primeiro", PORTUGUES,
     "  funciona: 0,\n  conserto: 1,\n  quase: 2,\n  fechado: 3,",
     "  funciona: 3,\n  conserto: 1,\n  quase: 2,\n  fechado: 0,", AMARRA),

    # ── as telas ────────────────────────────────────────────────────────────
    ("a sondagem para de ordenar pelo recado", PAINEL,
     "                  .sort((a, b) => ORDEM_DO_TOM[recadoDaSonda(a.r).tom] - ORDEM_DO_TOM[recadoDaSonda(b.r).tom])",
     "", AMARRA),
    ("o detalhe técnico é REMOVIDO da tela (não é isso que foi pedido)", PAINEL,
     "<TableHead>O que aconteceu · Detalhe técnico</TableHead>",
     "<TableHead>O que aconteceu</TableHead>", AMARRA),
    ("o número técnico sai da linha", PAINEL,
     '{r.status ?? "—"} · {r.ms}ms · {v.rotulo}', "{v.rotulo}", AMARRA),
    ("o resumo em português sai da tela", PAINEL,
     "{resumoDaSondagem(s.resultados).map((frase) => (", "{[].map((frase: string) => (", AMARRA),
    ("a coluna passa a não falar de leitura", ABA,
     "<TableHead>O que ela traz, e se dá pra ler daqui</TableHead>",
     "<TableHead>O que ela traz</TableHead>", AMARRA),
    ("a coleta de hoje para de vencer a medida antiga", FONTES,
     'if (statusDaColeta === "bloqueada") return "recusa_nosso_servidor";', "", AMARRA),
    ("a coleta que deu certo para de promover a fonte", FONTES,
     'if (statusDaColeta === "ok") return "coleta_liberada";', "", AMARRA),
    ("a tela volta a mostrar a situação declarada, ignorando a coleta", COLETOR,
     "situacao: situacaoVigente(f.situacao, l?.status),", "situacao: f.situacao,", AMARRA),
    ("a nota da sondagem sai da tela", ABA,
     "{f.notaDaSondagem && (", "{false && (", AMARRA),
    ("o botão de colar o texto oficial some", ABA,
     '<span className="ml-1">Colar texto oficial</span>', '<span className="ml-1">Colar</span>', AMARRA),
    ("o diálogo de colar perde o teto de altura (passa da tela)", ABA,
     'className="max-h-[90vh] max-w-2xl overflow-y-auto"', 'className="max-w-2xl"', AMARRA),

    # ── coletor e sondagem ─────────────────────────────────────────────────
    ("súmula passa a ser coletada por termo (pega um pedaço do conjunto fechado)", COLETOR,
     'fonte.material === "sumula"\n      ? await colherListaDeSumulas(fonte)\n      : await colherEmentasPorTermo(fonte, opts?.termos);',
     "await colherEmentasPorTermo(fonte, opts?.termos);", AMARRA),
    ("porta que abriu sem texto para de se distinguir de porta fechada", COLETOR,
     'p.erro = "A página respondeu, mas não trazia o texto dos enunciados (provavelmente é só o índice).";',
     "", AMARRA),
    ("importar texto passa a aceitar fonte que não é de súmula", COLETOR,
     '  if (!fonte || fonte.material !== "sumula") {', "  if (!fonte) {", AMARRA),
    ("importar texto passa a usar leitor próprio, diferente do robô", COLETOR,
     "colherSumulas(opts.texto, fonte.tribunal)", "extrairSumulasDeTexto(opts.texto, fonte.tribunal)", AMARRA),
    ("a procedure de importar súmulas deixa de existir", ADMIN,
     "jurisiaImportarSumulas: adminProcedure", "jurisiaImportarSumulasDesativada: adminProcedure", AMARRA),
    ("a sondagem para de bater no endereço que o robô usa", SONDA,
     "  for (const f of fontesQueTrazemEmenta()) {", "  for (const f of []) {", AMARRA),
    ("a sondagem bate duas vezes no mesmo endereço", SONDA,
     "if (!url || lista.some((c) => c.url === url)) continue;", "if (!url) continue;", AMARRA),
    ("a sondagem para de contar súmula no corpo", SONDA,
     '      r.sumulasNoCorpo = colherSumulas(texto, "").sumulas.length;',
     "      r.sumulasNoCorpo = 0;", AMARRA),
    ("os outros hosts do STJ saem da medição", SONDA,
     '      url: "https://dadosabertos.stj.jus.br/",', '      url: "https://scon.stj.jus.br/SCON/",', AMARRA),

    # ── a resposta do JurisIA ──────────────────────────────────────────────
    ("súmula e ementa voltam a contar como a mesma coisa", UNA,
     "    if (/^s[úu]mula\\b/i.test(e.identificador)) sumulas++;", "", AMARRA),
    ("o rótulo da citação perde o singular", UNA,
     'if (sumulas > 0) partes.push(sumulas === 1 ? "1 súmula" : `${sumulas} súmulas`);',
     "if (sumulas > 0) partes.push(`${sumulas} súmulas`);", AMARRA),
    ("a frase que separa citação de estatística sai da resposta", TELA,
     "Súmula é entendimento firmado do tribunal e ementa é acórdão publicado", "Resultado", VELHA),
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
