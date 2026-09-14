#!/usr/bin/env python3
"""Mutações da amarra `relatorio-por-anuncio`.

Cada entrada quebra UMA decisão. Mutante que sobrevive = a amarra descreve
o código em vez de proteger o comportamento.
"""
import subprocess, sys, pathlib

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ROUTER = RAIZ / "server/escritorio/router-relatorios.ts"
PDF = RAIZ / "server/escritorio/relatorios-comercial-pdf.ts"
ENVIO = RAIZ / "server/escritorio/relatorios-envio.ts"
TELA = RAIZ / "client/src/pages/Relatorios.tsx"

MUTACOES = [
    # ── a regra pura ────────────────────────────────────────────────────────
    (ROUTER, "    if (!ref || typeof ref !== \"object\") continue;", "",
             "origem que nao e objeto passa direto"),
    (ROUTER, "    const chave = anuncioId || String(ref.titulo || \"\");\n    if (!chave) continue;",
             "    const chave = anuncioId;",
             "referral sem id junta anuncios diferentes num balde vazio"),
    (ROUTER, "      g.fechados++;", "      g.fechados += 2;",
             "contrato passa a contar como dois fechados (taxa > 100%)"),
    (ROUTER, "    const f = porContato.get(l.contatoId);\n    if (f) {",
             "    const f = porContato.get(l.contatoId) || { valor: 0, recebido: 0 };\n    if (true) {",
             "lead que nao fechou passa a contar como fechado"),
    (ROUTER, "return [...grupos.values()].sort((a, b) => b.recebido - a.recebido || b.leads - a.leads);",
             "return [...grupos.values()];",
             "ordem deixa de priorizar quem trouxe dinheiro"),
    (ROUTER, "g.valorFechado = centavos(g.valorFechado + f.valor);",
             "g.valorFechado = g.valorFechado + f.valor;",
             "centavos viram dizima no valor fechado"),
    (ROUTER, "g.recebido = centavos(g.recebido + f.recebido);",
             "g.recebido = g.recebido + f.recebido;",
             "centavos viram dizima no recebido"),
    (ROUTER, "titulo: String(ref.titulo || \"\") || \"Anúncio sem título\",",
             "titulo: String(ref.titulo || \"\"),",
             "anuncio sem titulo vira linha em branco"),
    # ── a ligação no servidor ───────────────────────────────────────────────
    (ROUTER, "          recebido: porLead.get(Number(r.leadId)) || 0,\n        })),\n      );",
             "          recebido: 0,\n        })),\n      );",
             "o recebido por anuncio deixa de vir da distribuicao do card"),
    (ROUTER, "          gte(contatos.origemAnuncioEm, dataInicio),\n          lte(contatos.origemAnuncioEm, dataFim),",
             "",
             "periodo do clique some (conta a base inteira)"),
    (ROUTER, "          eq(contatos.escritorioId, eid),\n          isNotNull(contatos.origemAnuncio),",
             "          isNotNull(contatos.origemAnuncio),",
             "consulta dos leads vaza entre escritorios"),
    (ROUTER, "        fechamentosPorOrigem,\n        anuncios,", "        fechamentosPorOrigem,",
             "campo nao chega na tela nem no PDF"),
    # ── PDF ─────────────────────────────────────────────────────────────────
    (PDF, "  anuncios?: Array<{", "  anunciosXX?: Array<{",
          "contrato do PDF perde o campo"),
    (PDF, "      if (data.anuncios && data.anuncios.length > 0) {",
          "      if (false && data.anuncios && data.anuncios.length > 0) {",
          "secao some do PDF"),
    (PDF, "const titulo = textoParaPdfWinAnsi(a.titulo) || \"Anúncio sem título\";",
          "const titulo = a.titulo || \"Anúncio sem título\";",
          "titulo do criativo entra sem filtro WinAnsi"),
    (PDF, "\"De qual anúncio veio o lead: quem clicou num anúncio do Facebook/Instagram e chamou no WhatsApp, \" +",
          "\"\" +",
          "nota de metodologia perde a explicacao"),
    # ── envio e tela ────────────────────────────────────────────────────────
    (ENVIO, 'const r = await chamar("exportarComercialPdf", filtros);\n    const d = await chamar("comercialDashboard", filtros);',
            'const d = await chamar("comercialDashboard", filtros);\n    const r = { filename: "x.pdf", base64: "" } as any;',
            "e-mail programado deixa de usar o PDF real"),
    (TELA, "  if (itens.length === 0) return null;", "  if (false) return null;",
           "cartao vazio aparece pra quem nao anuncia"),
    (TELA, 'className="w-full min-w-[560px] text-xs"', 'className="w-full text-xs"',
           "tabela no celular volta a engolir os numeros"),
]


def roda():
    r = subprocess.run(
        ["pnpm", "vitest", "run", "server/__tests__/relatorio-por-anuncio.test.ts"],
        cwd=RAIZ, capture_output=True, text=True)
    return r.returncode == 0


def main():
    vivos = []
    for arq, de, para, nome in MUTACOES:
        original = arq.read_text()
        if de not in original:
            print(f"?? ALVO NAO ENCONTRADO: {nome}")
            vivos.append(nome)
            continue
        arq.write_text(original.replace(de, para, 1))
        try:
            verde = roda()
        finally:
            arq.write_text(original)
        print(("SOBREVIVEU  " if verde else "morreu      ") + nome)
        if verde:
            vivos.append(nome)
    print(f"\n{len(MUTACOES) - len(vivos)}/{len(MUTACOES)} mutações mortas")
    sys.exit(1 if vivos else 0)


if __name__ == "__main__":
    main()
