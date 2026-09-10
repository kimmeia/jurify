#!/usr/bin/env python3
"""Troca `text-[Npx]` pelos tokens da escala nas telas migradas.

Contexto e motivo: docs/frontend-sistema-visual-2026-09-10.md

Regra de conversão (só font-size; nada de line-height):

    <= 10 px  -> text-micro   (11px)   piso de legibilidade
    10.5 - 11.5 -> text-apoio (11.5px)
    12 - 13.5 -> text-corpo   (13px)
    14 - 15   -> text-secao   (15px)
    16 - 20   -> text-titulo  (20px)
    >= 21     -> NÃO TOCA, só reporta

Os >= 21px ficam de fora de propósito: escolher entre `numero` (22px, KPI) e
`pagina` (26px, título de tela) é decisão de papel, não de tamanho, e um
mapeamento cego encolheria um KPI de 42px para 22px sem ninguém pedir.

`text-xs` e `text-sm` também ficam de fora nesta passada — ver o documento.

Uso:  python3 aplicar-escala.py --seco     (mostra o que faria)
      python3 aplicar-escala.py            (aplica)
"""
import re
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]

TELAS = [
    "client/src/pages/Processos.tsx",
    "client/src/pages/Clientes.tsx",
    "client/src/pages/Atendimento.tsx",
    "client/src/pages/Agenda.tsx",
    "client/src/pages/Kanban.tsx",
    "client/src/pages/Financeiro.tsx",
]

PADRAO = re.compile(r"text-\[(\d+(?:\.\d+)?)px\]")


def token(px: float) -> str | None:
    if px <= 10:
        return "text-micro"
    if px <= 11.5:
        return "text-apoio"
    if px <= 13.5:
        return "text-corpo"
    if px <= 15:
        return "text-secao"
    if px <= 20:
        return "text-titulo"
    return None


def main() -> int:
    seco = "--seco" in sys.argv
    trocas: Counter[str] = Counter()
    intocados: list[str] = []
    total = 0

    for rel in TELAS:
        caminho = RAIZ / rel
        origem = caminho.read_text(encoding="utf-8")

        def troca(m: re.Match[str]) -> str:
            px = float(m.group(1))
            alvo = token(px)
            if alvo is None:
                intocados.append(f"{rel}: {m.group(0)}")
                return m.group(0)
            trocas[f"{m.group(0)} -> {alvo}"] += 1
            return alvo

        novo = PADRAO.sub(troca, origem)
        mudou = sum(1 for _ in PADRAO.finditer(origem)) - sum(
            1 for _ in PADRAO.finditer(novo)
        )
        total += mudou
        print(f"{rel:44s} {mudou:4d} trocas")
        if not seco and novo != origem:
            caminho.write_text(novo, encoding="utf-8")

    print(f"\ntotal: {total} trocas\n")
    for k, n in sorted(trocas.items(), key=lambda kv: -kv[1]):
        print(f"  {n:4d}  {k}")

    if intocados:
        print(f"\nnão tocados (>= 21px, decidir um a um) — {len(intocados)}:")
        for i in intocados:
            print(f"  {i}")

    if seco:
        print("\n(modo seco — nada foi escrito)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
