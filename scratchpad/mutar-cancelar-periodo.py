#!/usr/bin/env python3
"""Mutações da amarra `cancelar-periodo-pago`: quebra o código de propósito,
roda o teste, confere que ficou VERMELHO e desfaz. Rodar da raiz do repo."""
import subprocess, sys, pathlib

RAIZ = pathlib.Path(__file__).resolve().parent.parent
TESTE = "server/__tests__/cancelar-periodo-pago.test.ts"

MUTACOES = [
    ("temAcessoAtivo sem a checagem de data (carência eterna)",
     "shared/assinatura-carencia.ts",
     "  return sub.fimPeriodoPagoEm > agora;\n}",
     "  return true;\n}"),
    ("temAcessoAtivo ignora a flag cancelAtPeriodEnd",
     "shared/assinatura-carencia.ts",
     "  if (!sub.cancelAtPeriodEnd) return false;\n",
     ""),
    ("ordem do getActiveSubscription: cancelada em carência antes da active",
     "server/db.ts",
     "  const active = comAcesso.find((s) => s.status === \"active\");\n  if (active) return active;",
     "  const carenciaPrimeiro = comAcesso.find((s) => s.status === \"canceled\");\n  if (carenciaPrimeiro) return carenciaPrimeiro;\n  const active = comAcesso.find((s) => s.status === \"active\");\n  if (active) return active;"),
    ("cancel aceita cancelar duas vezes",
     "server/routers/subscription.ts",
     "    if (sub.status === \"canceled\") {\n      throw new TRPCError({ code: \"PRECONDITION_FAILED\", message: \"Esta assinatura já foi cancelada.\" });\n    }",
     ""),
    ("cancel grava canceled sem a flag de carência",
     "server/routers/subscription.ts",
     "          status: \"canceled\",\n          cancelAtPeriodEnd: true,\n          ...(acessoAte != null ? { fimPeriodoPagoEm: acessoAte } : {}),",
     "          status: \"canceled\",\n          ...(acessoAte != null ? { fimPeriodoPagoEm: acessoAte } : {}),"),
    ("reativar grava a linha ANTES de chamar o Asaas",
     "server/routers/subscription.ts",
     "    let nova: { id: string };\n    try {\n      const client = await getAdminAsaasClient();",
     "    let nova: { id: string };\n    await db.update(subscriptionsTable).set({ status: \"active\", cancelAtPeriodEnd: false }).where(eq(subscriptionsTable.id, sub.id));\n    try {\n      const client = await getAdminAsaasClient();"),
    ("reativar: vencimento no MESMO dia do fim do acesso",
     "server/billing/periodo-pago.ts",
     "  return new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);",
     "  return new Date(Date.UTC(ano, mes - 1, dia)).toISOString().slice(0, 10);"),
    ("webhook: período pago ignora o ciclo (sempre 30 dias)",
     "server/billing/asaas-billing-webhook.ts",
     "              ? fimDoPeriodoPago(payment.dueDate, existing.ciclo, fuso)",
     "              ? fimDoPeriodoPago(payment.dueDate, null, fuso)"),
    ("webhook: período pago no fuso do servidor, não do escritório",
     "server/billing/asaas-billing-webhook.ts",
     "            const fuso = await fusoDoDonoDaAssinatura(db, existing.userId);",
     "            const fuso = \"America/Sao_Paulo\";"),
    ("webhook SUBSCRIPTION_DELETED sem a carência",
     "server/billing/asaas-billing-webhook.ts",
     "              .set(camposDeCancelamento(existing))",
     "              .set({ status: \"canceled\" })"),
    ("admin.cancelarAssinaturaAdmin sem a carência",
     "server/routers/admin.ts",
     "        .set(camposDeCancelamento(sub))",
     "        .set({ status: \"canceled\" })"),
    ("adminFinanceiro.cancelarAssinaturaPorAsaasId sem a carência",
     "server/routers/admin-financeiro.ts",
     "          .set(camposDeCancelamento(local))",
     "          .set({ status: \"canceled\" })"),
    ("encerrarOutrasAssinaturas não encerra a cancelada em carência",
     "server/billing/assinatura-substituicao.ts",
     "      if (!emCarenciaDeCancelamento(s)) continue;",
     "      continue;"),
    ("cron avisa duas vezes (trava do avisoFimAcessoEnviadoEm removida)",
     "server/billing/trial-cron.ts",
     "    if (c.avisoFimAcessoEnviadoEm != null) continue;\n",
     ""),
    ("cron avisa fora da janela",
     "server/billing/trial-cron.ts",
     "    if (c.fimPeriodoPagoEm == null || c.fimPeriodoPagoEm < inicioJanela || c.fimPeriodoPagoEm > fimJanela) continue;\n",
     "    if (c.fimPeriodoPagoEm == null) continue;\n"),
    ("tela volta ao confirm() nativo",
     "client/src/pages/Plans.tsx",
     "  const handleCancel = () => {\n    setCancelDialogOpen(true);\n  };",
     "  const handleCancel = () => {\n    if (!confirm(\"Cancelar?\")) return;\n    confirmarCancelamento();\n  };"),
    ("tela: botão Cancelar continua aparecendo na cancelada",
     "client/src/pages/Plans.tsx",
     "{currentSub.status !== \"trialing\" && currentSub.status !== \"canceled\" && (",
     "{currentSub.status !== \"trialing\" && ("),
]


def roda() -> bool:
    r = subprocess.run(["pnpm", "vitest", "run", TESTE], cwd=RAIZ, capture_output=True, text=True)
    return r.returncode == 0


def main() -> int:
    falhas = 0
    for nome, arquivo, antes, depois in MUTACOES:
        p = RAIZ / arquivo
        original = p.read_text()
        if antes not in original:
            print(f"?? {nome}: trecho não encontrado em {arquivo}")
            falhas += 1
            continue
        if original.count(antes) != 1:
            print(f"?? {nome}: trecho aparece {original.count(antes)}x em {arquivo}")
            falhas += 1
            continue
        p.write_text(original.replace(antes, depois))
        try:
            verde = roda()
        finally:
            p.write_text(original)
        print(("VERDE (mutante sobreviveu!) " if verde else "vermelho ✓ ") + nome)
        if verde:
            falhas += 1
    print(f"\n{len(MUTACOES) - falhas}/{len(MUTACOES)} mutações mortas")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
