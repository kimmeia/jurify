#!/usr/bin/env python3
"""Quebra o conserto de propósito e confere que as amarras ficam VERMELHAS."""
import subprocess, pathlib, sys
AD = pathlib.Path("scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts")
RT = pathlib.Path("server/routers/processos.ts")
CL = pathlib.Path("server/processos/capa-da-lista.ts")
TESTES = ["server/__tests__/abrir-pagina-do-processo.test.ts", "server/__tests__/capa-da-pagina-certa.test.ts"]
MUT = [
 ("volta a clicar pelo primeiro do HTML", AD,
  "const alvo = (await this.marcarLinkDoProcesso(pageBusca, cnjLimpo))\n            ? SELETOR_LINK_MARCADO\n            : seletorLinkResultado;",
  "const alvo = seletorLinkResultado;"),
 ("escolhe sem olhar o numero", AD, "const porNumero = links.find((a) => digitos(a.textContent).includes(cnj));",
  "const porNumero = links[0];"),
 ("deixa o botao Acoes ser escolhido", AD, "const escolhido = porNumero ?? porClasse ?? links.find((a) => !ehAcoes(a)) ?? null;",
  "const escolhido = porNumero ?? porClasse ?? links[0] ?? null;"),
 ("chuta o juiz na capa da lista", CL, "    juiz: null,", '    juiz: "a definir",'),
 ("chuta o tipo da parte", CL, '      tipo: "desconhecido" as const,', '      tipo: "fisica" as const,'),
 ("volta a devolver erro quando o detalhe nao abre", RT,
  "if (!resultado.ok && !capaDeReserva) {", "if (!resultado.ok) {"),
 ("nao usa a lista, so o DataJud", RT, "const linha = linhaDoCnj(resultado.linhasDaBusca, input.cnj);",
  "const linha = null as ReturnType<typeof linhaDoCnj>;"),
 ("esconde a procedencia de quem le", RT, "return { lawsuit, fonte: fonteDaCapa };", "return { lawsuit };"),
 ("volta a cravar a procedencia como pagina do processo", RT, "          fonte: fonteDaCapa,", '          fonte: "processo",'),
]
falhas = []
for nome, arq, de, para in MUT:
    orig = arq.read_text(encoding="utf-8")
    if de not in orig:
        falhas.append(nome + ": trecho nao encontrado"); continue
    arq.write_text(orig.replace(de, para, 1), encoding="utf-8")
    r = subprocess.run(["pnpm", "vitest", "run", *TESTES], capture_output=True, text=True)
    arq.write_text(orig, encoding="utf-8")
    vermelho = "failed" in r.stdout or r.returncode != 0
    print(("VERMELHO " if vermelho else "PASSOU!! ") + nome)
    if not vermelho: falhas.append(nome)
print()
print(("%d sobreviveram: " % len(falhas)) + "; ".join(falhas) if falhas else "todas as %d mutacoes ficaram vermelhas" % len(MUT))
sys.exit(1 if falhas else 0)
