#!/usr/bin/env python3
"""Mutação da portinha do backoffice: quebra o código e exige teste vermelho."""

import pathlib
import subprocess
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
TESTE = "server/__tests__/backoffice-portinha.test.ts"

ROTA = "server/backoffice/rota-resumo.ts"
CONTRATO = "shared/backoffice-contrato.ts"
CORE = "server/_core/index.ts"
COOKIES = "server/_core/cookies.ts"

# (nome, arquivo, de, para)
MUTACOES = [
    ("fail-closed vira fail-open",
     ROTA,
     'if (!esperada || esperada.length < TAMANHO_MINIMO_CHAVE) return "servidor_sem_chave";',
     'if (!esperada) return "ok";'),

    ("aceita chave curta demais",
     ROTA,
     'if (!esperada || esperada.length < TAMANHO_MINIMO_CHAVE) return "servidor_sem_chave";',
     'if (!esperada) return "servidor_sem_chave";'),

    ("some a guarda de tamanho antes do timingSafeEqual",
     ROTA,
     'if (a.length !== b.length) return "chave_invalida";',
     ''),

    ("comparação sempre verdadeira",
     ROTA,
     'return timingSafeEqual(a, b) ? "ok" : "chave_invalida";',
     'return "ok";'),

    ("Bearer vira qualquer esquema",
     ROTA,
     '/^Bearer[ \\t]+(\\S.*)$/',
     '/^\\w+[ \\t]+(\\S.*)$/'),

    ("token vazio passa",
     ROTA,
     '/^Bearer[ \\t]+(\\S.*)$/',
     '/^Bearer[ \\t]*(.*)$/'),

    ("503 vira 200",
     ROTA,
     'res.status(503)',
     'res.status(200)'),

    ("resposta passa a ser cacheável",
     ROTA,
     'res.setHeader("Cache-Control", "no-store");',
     ''),

    ("select traz a tabela inteira (com a chave cifrada)",
     ROTA,
     '''.select({
      provedor: adminIntegracoes.provedor,
      nomeExibicao: adminIntegracoes.nomeExibicao,
      status: adminIntegracoes.status,
      ultimoTeste: adminIntegracoes.ultimoTeste,
    })''',
     '.select()'),

    ("integração nunca testada vira falha",
     CONTRATO,
     'if (bruto === "erro") return "falha";\n  return "desconhecido";',
     'return "falha";'),

    ("conectado deixa de ser ok",
     CONTRATO,
     'if (bruto === "conectado") return "ok";',
     'if (bruto === "conectado") return "desconhecido";'),

    ("troca pagantes por em teste",
     CONTRATO,
     'pagantes: entrada.stats.activeSubscriptions,\n      emTeste: entrada.stats.trialingSubscriptions,',
     'pagantes: entrada.stats.trialingSubscriptions,\n      emTeste: entrada.stats.activeSubscriptions,'),

    ("cortesia entra como pagante",
     CONTRATO,
     'cortesias: entrada.stats.cortesiasAtivas ?? null,',
     'cortesias: entrada.stats.activeSubscriptions,'),

    ("produto sem contagem de cortesia passa a mentir 0 em vez de null",
     CONTRATO,
     'cortesias: entrada.stats.cortesiasAtivas ?? null,',
     'cortesias: entrada.stats.cortesiasAtivas ?? 0,'),

    ("segredo passa a ser copiado pra resposta",
     CONTRATO,
     'chave: i.provedor,',
     'chave: i.provedor, ...(i as never as Record<string, string>),'),

    ("rota deixa de ser registrada",
     CORE,
     'registerBackofficeRoutes(app);',
     ''),

    ("some o teto de requisições",
     CORE,
     'app.use("/api/backoffice", rateLimit({ name: "backoffice", max: 60 }));',
     ''),

    ("some a guarda de banco fora (zeros viram notícia)",
     ROTA,
     'if (!(await getDb())) throw new BancoIndisponivel("banco indisponível");',
     ''),

    ("banco fora vira 500 genérico em vez de 503",
     ROTA,
     'res.status(503).json({ erro: "Banco indisponível — nenhum número é confiável agora." });',
     'res.status(500).json({ erro: "Banco indisponível." });'),

    ("cookie de sessão passa a valer no domínio inteiro",
     COOKIES,
     'return {\n    httpOnly: true,',
     'return {\n    domain: ".devular.com.br",\n    httpOnly: true,'),
]


def roda_teste() -> bool:
    r = subprocess.run(
        ["pnpm", "vitest", "run", TESTE],
        cwd=RAIZ, capture_output=True, text=True,
    )
    return r.returncode == 0


def main() -> int:
    if not roda_teste():
        print("BASE JÁ VERMELHA — conserte antes de mutar")
        return 1
    print("base verde\n")

    sobreviventes = []
    for i, (nome, arquivo, de, para) in enumerate(MUTACOES, 1):
        alvo = RAIZ / arquivo
        original = alvo.read_text()
        if de not in original:
            print(f"{i:2}. {nome}: TRECHO NÃO ENCONTRADO em {arquivo}")
            sobreviventes.append(f"{nome} (trecho não encontrado)")
            continue
        alvo.write_text(original.replace(de, para, 1))
        try:
            verde = roda_teste()
        finally:
            alvo.write_text(original)
        if verde:
            print(f"{i:2}. {nome}: SOBREVIVEU ⚠")
            sobreviventes.append(nome)
        else:
            print(f"{i:2}. {nome}: morreu ✓")

    print()
    if sobreviventes:
        print(f"{len(sobreviventes)} SOBREVIVENTE(S):")
        for s in sobreviventes:
            print(f"  - {s}")
        return 1
    print(f"todas as {len(MUTACOES)} mutações morreram")
    return 0


if __name__ == "__main__":
    sys.exit(main())
