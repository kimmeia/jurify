#!/usr/bin/env python3
"""Confere por mutação as amarras dos Primeiros passos (Central de ajuda,
fatia 2): quebra o código de um jeito por vez e exige que o teste fique
vermelho. Restaura o arquivo ao final de cada mutação."""
import subprocess, sys

ROUTER = "server/escritorio/router-ajuda.ts"
SHARED = "shared/primeiros-passos.ts"
DASH = "client/src/pages/Dashboard.tsx"
COMP = "client/src/pages/dashboards/PrimeirosPassos.tsx"
CLI = "client/src/pages/Clientes.tsx"
CFG = "client/src/pages/Configuracoes.tsx"
MAPA = "shared/modulos-contratacao.ts"
TESTES = [
    "server/__tests__/primeiros-passos.test.ts",
    "server/__tests__/modulos-contratacao.test.ts",
]

MUTACOES = [
    # ── tenancy: tirar o escritorioId de cada consulta ──
    ("contatos sem escritorioId", ROUTER,
     ".where(eq(contatos.escritorioId, escritorioId))",
     '.where(eq(contatos.estagio, "cliente"))'),
    ("canais sem escritorioId", ROUTER,
     "        eq(canaisIntegrados.escritorioId, escritorioId),\n", ""),
    ("cofre sem escritorioId", ROUTER,
     "        eq(cofreCredenciais.escritorioId, escritorioId),\n", ""),
    ("monitoramentos sem escritorioId", ROUTER,
     "        eq(motorMonitoramentos.escritorioId, escritorioId),\n", ""),
    ("colaboradores sem escritorioId", ROUTER,
     ".where(and(eq(colaboradores.escritorioId, escritorioId), eq(colaboradores.ativo, true)))",
     ".where(eq(colaboradores.ativo, true))"),
    ("convites sem escritorioId", ROUTER,
     ".where(eq(convitesColaborador.escritorioId, escritorioId))",
     ".where(isNotNull(convitesColaborador.id))"),
    # ── quem vê ──
    ("não-dono passa a ver", ROUTER,
     'if (!vinculo || vinculo.colaborador.cargo !== "dono") return PAYLOAD_VAZIO;',
     "if (!vinculo) return PAYLOAD_VAZIO;"),
    ("não-dono recebe dados (consulta antes de decidir)", ROUTER,
     "    if (!vinculo || vinculo.colaborador.cargo !== \"dono\") return PAYLOAD_VAZIO;\n    const escritorioId = vinculo.escritorio.id;",
     "    const escritorioId = vinculo?.escritorio.id ?? 0;\n    const ehDono = !!vinculo && vinculo.colaborador.cargo === \"dono\";\n    await DETECTORES.cliente(db, escritorioId);\n    if (!ehDono) return PAYLOAD_VAZIO;"),
    # ── cadeado do 4 ──
    ("destravar o 4 (sem dependência do Cofre)", SHARED,
     '    dependeDe: "cofre",', "    dependeDe: null,"),
    ("cadeado ignora que o Cofre já foi feito", SHARED,
     "travadoPor: !feito && p.dependeDe && !paiFeito ? p.dependeDe : null,",
     "travadoPor: !feito && p.dependeDe ? p.dependeDe : null,"),
    # ── contrato de módulos ──
    ("contar módulo não contratado (lista inteira)", SHARED,
     "  return PRIMEIROS_PASSOS.filter((p) => contratoLibera(modulosContratados, p.modulos));",
     "  return [...PRIMEIROS_PASSOS];"),
    ("consultar tabela de módulo não contratado", ROUTER,
     "    const listados = passosDoContrato(modulosContratados);",
     "    const { PRIMEIROS_PASSOS } = await import(\"@shared/primeiros-passos\");\n    const listados = [...PRIMEIROS_PASSOS];"),
    ("contrato resolvido pra outro usuário", ROUTER,
     "modulosContratados = await modulosContratadosDoUsuario(ctx.user.id);",
     "modulosContratados = await modulosContratadosDoUsuario(escritorioId);"),
    # ── condições de estado ──
    ("canal de qualquer status conta como conectado", ROUTER,
     '        eq(canaisIntegrados.status, "conectado"),\n', ""),
    ("credencial com erro conta como Cofre feito", ROUTER,
     '        inArray(cofreCredenciais.status, ["ativa", "validando"]),\n', ""),
    ("monitoramento pausado conta como vigiado", ROUTER,
     '        eq(motorMonitoramentos.status, "ativo"),\n', ""),
    ("equipe: o próprio dono conta como equipe", ROUTER,
     "ativos.length > 1 ? ativos[1]?.createdAt : null",
     "ativos.length > 0 ? ativos[0]?.createdAt : null"),
    # ── client ──
    ("esconder na variante errada: bloco também no dashboard processual", DASH,
     "    return <DashboardProcessual />;",
     "    return <><PrimeirosPassos /><DashboardProcessual /></>;"),
    ("bloco some do Dashboard do dono", DASH,
     "        {isDono && <PrimeirosPassos />}\n", ""),
    ("bloco aparece pra quem não é dono no client", DASH,
     "        {isDono && <PrimeirosPassos />}",
     "        <PrimeirosPassos />"),
    ("bloco não some quando completa", COMP,
     "data.total === 0 || data.feitos === data.total) return null;",
     "data.total === 0) return null;"),
    ("grid sem a coluna do celular", COMP,
     '<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">',
     '<div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">'),
    ("hook depois do return antecipado", COMP,
     "  const [, setLocation] = useLocation();\n  const { data } = usePrimeirosPassos();\n\n  // Some sozinho",
     "  const { data } = usePrimeirosPassos();\n  if (!data) return null;\n  const [, setLocation] = useLocation();\n\n  // Some sozinho"),
    ("rota de passo que não existe no App.tsx", SHARED,
     '    rota: "/configuracoes?tab=canais&novo=1",',
     '    rota: "/config?tab=canais&novo=1",'),
    ("cofre deixa de reusar o deep-link do guia", SHARED,
     '    rota: "/processos?tab=cofre&novo=1",',
     '    rota: "/processos?tab=cofre",'),
    ("Clientes não abre o cadastro por ?novo=1", CLI,
     '    () => new URLSearchParams(window.location.search).get("novo") === "1",',
     "    () => false,"),
    ("Canais não abre o WhatsApp novo por ?novo=1", CFG,
     '? { type: "whatsapp" } : null', "? null : null"),
    ("Equipe não leva ao convite por ?novo=1", CFG,
     '    if (new URLSearchParams(window.location.search).get("novo") !== "1") return;\n', ""),
    # ── registro ──
    ("namespace ajuda sem declaração no mapa de módulos", MAPA,
     "  ajuda: null, // Central de ajuda / Primeiros passos — core, vale pra qualquer plano\n", ""),
]


def roda():
    r = subprocess.run(["pnpm", "vitest", "run", *TESTES], capture_output=True, text=True)
    return r.returncode


def main():
    originais = {}
    for _, arq, _, _ in MUTACOES:
        if arq not in originais:
            originais[arq] = open(arq, encoding="utf-8").read()

    if roda() != 0:
        print("baseline VERMELHO — abortando"); sys.exit(2)
    print("baseline verde")

    verdes = []
    for i, (nome, arq, antes, depois) in enumerate(MUTACOES, 1):
        src = originais[arq]
        if src.count(antes) != 1:
            print(f"[{i:02d}] ?? trecho não encontrado (ou repetido) em {arq}: {nome}")
            verdes.append(nome); continue
        open(arq, "w", encoding="utf-8").write(src.replace(antes, depois))
        try:
            rc = roda()
        finally:
            open(arq, "w", encoding="utf-8").write(src)
        estado = "vermelho" if rc != 0 else "VERDE (amarra não pegou)"
        print(f"[{i:02d}] {estado}: {nome}")
        if rc == 0:
            verdes.append(nome)

    print()
    print(f"{len(MUTACOES) - len(verdes)}/{len(MUTACOES)} mutações vermelhas")
    if verdes:
        print("ficaram verdes:", *verdes, sep="\n  - ")
        sys.exit(1)


if __name__ == "__main__":
    main()
