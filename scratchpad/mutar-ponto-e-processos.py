#!/usr/bin/env python3
"""Mutações das entregas de 13/09: módulo Ponto fora de produção + as cinco
remoções da tela de Processos.

Cada entrada quebra UMA decisão no código e diz qual teste tem que ficar
vermelho. Mutação que sobrevive = amarra que não amarra nada.

Uso: python3 scratchpad/mutar-ponto-e-processos.py
"""
import io
import subprocess
import sys

PONTO = "server/__tests__/modulo-ponto-fora-de-producao.test.ts"
PROC = "server/__tests__/processos-cabecalho-enxuto.test.ts"
CELULAR = "server/__tests__/telas-cabem-no-celular.test.ts"
CARTEIRA = "server/__tests__/movimentacoes-na-carteira.test.ts"

SHARED = "shared/modulos-por-ambiente.ts"
GATE = "server/_core/gate-modulos.ts"
GUARD = "client/src/components/ModuloGuard.tsx"
LAYOUT = "client/src/components/AppLayout.tsx"
SUB = "server/routers/subscription.ts"
TELA = "client/src/pages/Processos.tsx"

MUTACOES = [
    # ── módulo Ponto ────────────────────────────────────────────────────────
    ("lista de beta vazia", SHARED,
     'export const MODULOS_BETA: readonly string[] = ["ponto"];',
     'export const MODULOS_BETA: readonly string[] = [];', PONTO),
    ("beta escondido também em staging", SHARED,
     'return ambiente !== "staging" && ambiente !== "development";',
     'return true;', PONTO),
    ("beta visível em produção", SHARED,
     'return ambiente !== "staging" && ambiente !== "development";',
     'return false;', PONTO),
    ("ambiente desconhecido tratado como staging", SHARED,
     '  if (!ehModuloBeta(modulo)) return false;\n  return ambiente !== "staging" && ambiente !== "development";',
     '  if (!ehModuloBeta(modulo)) return false;\n  if (ambiente == null) return false;\n  return ambiente !== "staging" && ambiente !== "development";',
     PONTO),
    ("selo aparece em produção", SHARED,
     'return ehModuloBeta(modulo) && !moduloRemovidoNoAmbiente(modulo, ambiente);',
     'return ehModuloBeta(modulo);', PONTO),
    ("filtro da cesta não filtra", SHARED,
     '  return modulos.filter((m) => !moduloRemovidoNoAmbiente(m, ambiente));',
     '  return modulos;', PONTO),
    ("cesta null virou lista vazia", SHARED,
     '  if (modulos == null) return null;',
     '  if (modulos == null) return [];', PONTO),
    ("porteiro não filtra a cesta", GATE,
     '  modulos = filtrarModulosDoAmbiente(modulos, resolverAmbiente());',
     '  modulos = modulos;', PONTO),
    ("porteiro filtra DEPOIS de cachear", GATE,
     '  modulos = filtrarModulosDoAmbiente(modulos, resolverAmbiente());\n\n  // Cache até de null: a resposta "tudo liberado" também não pode custar\n  // 2 queries por chamada.\n  if (cache.size > 5_000) cache.clear();\n  cache.set(userId, { expiraEm: agora + TTL_MS, modulos });',
     '  if (cache.size > 5_000) cache.clear();\n  cache.set(userId, { expiraEm: agora + TTL_MS, modulos });\n  modulos = filtrarModulosDoAmbiente(modulos, resolverAmbiente());',
     PONTO),
    ("admin passa por cima do beta", GATE,
     '  if (moduloRemovidoNoAmbiente(modulo, resolverAmbiente())) {',
     '  if (args.role !== "admin" && moduloRemovidoNoAmbiente(modulo, resolverAmbiente())) {',
     PONTO),
    ("recusa de ambiente desarmada no lugar", GATE,
     '  if (moduloRemovidoNoAmbiente(modulo, resolverAmbiente())) {',
     '  if (false && moduloRemovidoNoAmbiente(modulo, resolverAmbiente())) {',
     PONTO),
    ("rota não confere ambiente", GUARD,
     '  if (exigidos && ambiente && exigidos.some((m) => moduloRemovidoNoAmbiente(m, ambiente))) {\n    return <ModuloEmTestes modulos={exigidos} />;\n  }\n',
     '', PONTO),
    ("rota confere ambiente DEPOIS do contrato", GUARD,
     '  if (exigidos && ambiente && exigidos.some((m) => moduloRemovidoNoAmbiente(m, ambiente))) {\n    return <ModuloEmTestes modulos={exigidos} />;\n  }\n  if (exigidos && !contratoLibera(contratados, exigidos)) {\n    return <ModuloBloqueado modulos={exigidos} />;\n  }',
     '  if (exigidos && !contratoLibera(contratados, exigidos)) {\n    return <ModuloBloqueado modulos={exigidos} />;\n  }\n  if (exigidos && ambiente && exigidos.some((m) => moduloRemovidoNoAmbiente(m, ambiente))) {\n    return <ModuloEmTestes modulos={exigidos} />;\n  }',
     PONTO),
    ("tela de teste manda ver o plano", GUARD,
     '        Este módulo ainda não foi liberado. Ele volta pra cá quando estiver\n        pronto — nada do que você já cadastrou foi apagado.\n      </p>\n      <div className="mt-5 flex justify-center gap-2.5">\n        <Button variant="outline" onClick={() => setLocation("/dashboard")}>',
     '        Este módulo ainda não foi liberado. Ele volta pra cá quando estiver\n        pronto — nada do que você já cadastrou foi apagado.\n      </p>\n      <div className="mt-5 flex justify-center gap-2.5">\n        <Button variant="outline" onClick={() => setLocation("/configuracoes?tab=meu-plano")}>',
     PONTO),
    ("menu não esconde o item", LAYOUT,
     '    !(i.modulo ?? []).some((m) => moduloRemovidoNoAmbiente(m, ambiente)) &&',
     '', PONTO),
    ("menu não mostra selo", LAYOUT,
     'moduloMostraSeloBeta(m, ambiente)',
     'false', PONTO),
    ("admin não recebe o ambiente", SUB,
     'return { modulos: null, ambiente };',
     'return { modulos: null };', PONTO),
    ("ponto sai da cesta do plano Escala", "drizzle/0217_pacote_3_planos.sql",
     "'comissoes','ponto','backups'", "'comissoes','backups'", PONTO),

    # ── tela de Processos ───────────────────────────────────────────────────
    ("aprovar prazo sugerido sumiu junto com a aba", TELA,
     '  const criarPrazoMut = (trpc as any).prazosSugeridos.aprovar.useMutation({',
     '  const criarPrazoMut = (trpc as any).processos.saldo.useMutation({', PROC),
    ("o botão de criar prazo da timeline sumiu", TELA,
     'onClick={() => criarPrazoMut.mutate({ id: prazo.id })}',
     'onClick={() => {}}', PROC),
    ("selo Requer prazo sumiu", TELA, 'Requer prazo', 'Tem prazo', PROC),
    ("aba alertas volta ao gatilho", TELA,
     '          {podeCofre && (\n            <TabsTrigger\n              value="cofre"',
     '          <TabsTrigger value="alertas">Alertas</TabsTrigger>\n          {podeCofre && (\n            <TabsTrigger\n              value="cofre"',
     PROC),
    ("link ?tab=alertas volta a abrir aba inexistente", TELA,
     '    if (t === "alertas") return "central";\n    return t === "movimentacoes" || t === "novas-acoes" || t === "cofre" || t === "central"',
     '    return t === "movimentacoes" || t === "novas-acoes" || t === "alertas" || t === "cofre" || t === "central"',
     PROC),
    ("pastilha de crédito volta ao cabeçalho", TELA,
     '        <p className="text-corpo text-muted-foreground mt-1.5">\n          O robô entra nos tribunais todo dia e avisa o que mudou nos seus processos\n        </p>\n      </div>',
     '        <p className="text-corpo text-muted-foreground mt-1.5">\n          O robô entra nos tribunais todo dia e avisa o que mudou nos seus processos\n        </p>\n        <span><Coins className="h-4 w-4" />créditos</span>\n      </div>',
     PROC),
    ("botão volta ao cabeçalho", TELA,
     '        <p className="text-corpo text-muted-foreground mt-1.5">\n          O robô entra nos tribunais todo dia e avisa o que mudou nos seus processos\n        </p>\n      </div>',
     '        <p className="text-corpo text-muted-foreground mt-1.5">\n          O robô entra nos tribunais todo dia e avisa o que mudou nos seus processos\n        </p>\n        <Button size="sm">Resumo diário</Button>\n      </div>',
     PROC),
    ("modal de consulta volta a ser montado", TELA,
     '        {podeCofre && <TabsContent value="cofre" className="mt-5"><CofreTab /></TabsContent>}\n      </Tabs>',
     '        {podeCofre && <TabsContent value="cofre" className="mt-5"><CofreTab /></TabsContent>}\n      </Tabs>\n      <Dialog open={false}><DialogContent><ConsultarTab /></DialogContent></Dialog>',
     CARTEIRA),
    ("a busca avulsa foi apagada do arquivo", TELA,
     'function ConsultarTab() {', 'function ConsultarTabRemovida() {', PROC),
    ("o comentário que explica a decisão saiu", TELA,
     '// ABA: CONSULTAR PROCESSOS — SEM ENTRADA NA TELA DESDE 13/09',
     '// ABA: CONSULTAR PROCESSOS', PROC),
    ("aviso de saldo baixo removido sem autorização", TELA,
     '<span className="text-sm text-warning-fg">Saldo baixo.',
     '<span className="text-sm text-warning-fg">Sem saldo.', PROC),
    ("badge do Monitoramento para de mostrar parados", TELA,
     '  const parados = mons.filter((m: any) => !!m.diagnostico).length;\n  return (\n    <span\n      className={`ml-1 text-micro px-1.5 rounded-full tabular-nums font-semibold ${',
     '  const parados = 0;\n  return (\n    <span\n      className={`ml-1 text-micro px-1.5 rounded-full tabular-nums font-semibold ${',
     PROC),
    ("tira de abas perde a quebra de linha", TELA,
     '!inline-flex !w-auto gap-1 flex-wrap', '!inline-flex !w-auto gap-1', CELULAR),
]


def rodar(teste: str) -> bool:
    r = subprocess.run(
        ["pnpm", "vitest", "run", teste],
        capture_output=True, text=True, cwd=".",
    )
    return r.returncode == 0


def main() -> int:
    sobreviventes = []
    for i, (nome, arquivo, de, para, teste) in enumerate(MUTACOES, 1):
        original = io.open(arquivo, encoding="utf-8").read()
        if de not in original:
            print(f"[{i:2}/{len(MUTACOES)}] ⚠ TRECHO NÃO ENCONTRADO — {nome} ({arquivo})")
            sobreviventes.append(nome + " (trecho não encontrado)")
            continue
        if original.count(de) != 1:
            print(f"[{i:2}/{len(MUTACOES)}] ⚠ TRECHO AMBÍGUO ({original.count(de)}×) — {nome}")
            sobreviventes.append(nome + " (trecho ambíguo)")
            continue
        io.open(arquivo, "w", encoding="utf-8").write(original.replace(de, para))
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
