#!/usr/bin/env python3
"""Mutações da amarra `anuncio-no-inbox`.

Cada entrada quebra UMA decisão do código. Se o teste continuar verde, a
amarra não está protegendo nada — é o caso que já aconteceu várias vezes
neste repo, com o literal de pé em outra ocorrência do arquivo.
"""
import subprocess, sys, pathlib

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DB = RAIZ / "server/escritorio/db-crm.ts"
ROUTER = RAIZ / "server/escritorio/router-crm.ts"
TELA = RAIZ / "client/src/pages/Atendimento.tsx"
ORIGEM = RAIZ / "server/integracoes/whatsapp-origem-anuncio.ts"

MUTACOES = [
    (DB, "conditions.push(isNotNull(contatos.origemAnuncio));",
         "conditions.push(isNull(contatos.origemAnuncio));",
         "filtro da lista inverte a origem"),
    (DB, "{ ...filtros, somenteAnuncio: false }",
         "{ ...filtros, somenteAnuncio: true }",
         "contador do chip passa a seguir o proprio filtro"),
    (DB, ".where(and(...(baseSemAnuncio ?? base), isNotNull(contatos.origemAnuncio)));",
         ".where(and(...(baseSemAnuncio ?? base)));",
         "contador do chip conta a vista inteira"),
    (ROUTER, "      modoPeriodo: z.enum([\"inicio\", \"mensagens\"]).optional(),\n      somenteAnuncio: z.boolean().optional(),",
             "      modoPeriodo: z.enum([\"inicio\", \"mensagens\"]).optional(),",
             "zod do contador descarta o filtro (pills divergem da lista)"),
    (ROUTER, "      somenteNovos: z.boolean().optional(),\n      // Só quem chegou clicando num anúncio (Click-to-WhatsApp).\n      somenteAnuncio: z.boolean().optional(),",
             "      somenteNovos: z.boolean().optional(),",
             "zod da lista descarta o filtro"),
    (ROUTER, "fechado: 0, anuncio: 0 }", "fechado: 0 }",
             "resposta sem permissao perde o campo do chip"),
    (TELA, "(counts.anuncio > 0 || somenteAnuncio)", "(counts.anuncio > 0)",
           "chip ligado some quando a contagem zera"),
    (TELA, "if (somenteAnuncio) f.somenteAnuncio = true;", "",
           "chip nao chega ao backend"),
    (TELA, 'data-testid="selo-anuncio"', 'data-testid="selo-qualquer"',
           "selo do anuncio some da lista"),
    (TELA, 'data-testid="cartao-origem-anuncio"', 'data-testid="cartao-qualquer"',
           "cartao do anuncio some da conversa"),
    (TELA, "Chegou por um anúncio\n            </p>", "Origem\n            </p>",
           "cartao perde a frase que explica de onde veio"),
    (TELA, "bg-accent-purple-bg/50", "bg-violet-100",
           "cor do cartao volta pra paleta crua"),
    (ORIGEM, "    thumbnailUrl: o.thumbnailUrl || \"\",",
             "    thumbnailUrl: o.thumbnailUrl || \"\",\n    ctwaClid: o.ctwaClid || \"\",",
             "identificador do clique vaza pra lista"),
    (ORIGEM, "  if (!o) return null;", "  if (!o) return {} as any;",
             "contato sem anuncio vira objeto vazio (selo aparece pra todos)"),
]


def roda():
    r = subprocess.run(
        ["pnpm", "vitest", "run", "server/__tests__/anuncio-no-inbox.test.ts"],
        cwd=RAIZ, capture_output=True, text=True)
    return r.returncode == 0


def main():
    sobreviventes = []
    for arq, de, para, nome in MUTACOES:
        original = arq.read_text()
        if de not in original:
            print(f"?? ALVO NAO ENCONTRADO: {nome}")
            sobreviventes.append(nome)
            continue
        arq.write_text(original.replace(de, para, 1))
        try:
            verde = roda()
        finally:
            arq.write_text(original)
        print(("SOBREVIVEU  " if verde else "morreu      ") + nome)
        if verde:
            sobreviventes.append(nome)
    print(f"\n{len(MUTACOES) - len(sobreviventes)}/{len(MUTACOES)} mutações mortas")
    sys.exit(1 if sobreviventes else 0)


if __name__ == "__main__":
    main()
