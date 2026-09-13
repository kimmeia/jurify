#!/usr/bin/env python3
"""
Mutação da amarra do bloco comercial: cupom pelo catálogo, extras avulsos que
somam ao teto e cobram, JurisIA cobrando e liberando pelos dois caminhos.

Uso: python3 scratchpad/mutar-bloco-comercial.py
"""
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TESTE = "server/__tests__/bloco-comercial-extras-cupom-jurisia.test.ts"

SHARED = "shared/extras-avulsos.ts"
FATURA = "shared/fatura-modulos.ts"
ADMIN = "server/routers/admin.ts"
LIMITES = "server/processos/limites-monitoramento.ts"
PLANLIM = "server/billing/plan-limits.ts"
CONFIG = "server/escritorio/router-configuracoes.ts"
COBRANCA = "server/billing/modulos-cobranca.ts"
ADDONS = "server/billing/addons-repo.ts"
CARTAO = "client/src/pages/admin/ModulosCobrancaCard.tsx"

MUTACOES = [
    # ── cupom ───────────────────────────────────────────────────────────────
    ("cupom volta a conferir só contra a lista fixa",
     ADMIN,
     "        const conhecidos = new Set<string>([\n          ...doCatalogo.map((p) => p.slug),\n          ...PLANS.map((p) => p.id),\n        ]);",
     "        const conhecidos = new Set<string>(PLANS.map((p) => p.id));",
     ),
    ("cupom perde a reserva da lista fixa (base sem catálogo trava)",
     ADMIN,
     "          ...PLANS.map((p) => p.id),\n",
     "",
     ),

    # ── regra de soma ───────────────────────────────────────────────────────
    ("soma rebaixa teto ilimitado (null) para o extra",
     SHARED,
     "  if (base == null) return null;",
     "  if (base == null) return somar;",
     ),
    ("soma rebaixa teto ilimitado (zero libera) para o extra",
     SHARED,
     "  if (opcoes.zeroEIlimitado && base <= 0) return base;",
     "  // zero deixa de ser ilimitado",
     ),
    ("zero passa a ser ilimitado onde significa NENHUM (número de WhatsApp)",
     SHARED,
     '    zeroEIlimitado: false,\n  },\n] as const;',
     '    zeroEIlimitado: true,\n  },\n] as const;',
     ),
    ("extra negativo passa a subtrair do teto",
     SHARED,
     "  const somar = Number.isFinite(extra) ? Math.max(0, Math.trunc(extra)) : 0;",
     "  const somar = Number.isFinite(extra) ? Math.trunc(extra) : 0;",
     ),
    ("produto de outra família passa a ser lido como extra",
     SHARED,
     "  if (!produto.startsWith(PRODUTO_EXTRA_PREFIXO)) return null;",
     "  if (false) return null;",
     ),
    ("chave inventada passa a valer",
     SHARED,
     "  return ehChaveExtra(chave) ? chave : null;",
     "  return chave as ChaveExtra;",
     ),
    ("rótulo da fatura ignora singular/plural",
     SHARED,
     "  return `+${quantidade} ${quantidade === 1 ? def.rotuloSingular : def.rotulo}`;",
     "  return `+${quantidade} ${def.rotulo}`;",
     ),

    # ── enforcement ─────────────────────────────────────────────────────────
    ("monitoramentos param de somar o extra",
     LIMITES,
     "    const maximo = await tetoComExtra(\n      escritorioId,\n      tipo === \"movimentacoes\" ? \"processos\" : \"cpfs\",\n      doPlano,\n    );",
     "    const maximo = doPlano;",
     ),
    ("colaboradores param de somar o extra",
     PLANLIM,
     '      maximo = (await tetoComExtra(escritorioId, "usuarios", limites.maxColaboradores))\n        ?? limites.maxColaboradores;',
     "      maximo = limites.maxColaboradores;",
     ),
    ("um dos três caminhos de WhatsApp volta a ler o teto cru",
     CONFIG,
     "        const limite = await limiteConexoesWhatsapp(\n          esc.escritorio.id,\n          plano?.limites.maxConexoesWhatsapp ?? 0,\n          false,\n        );",
     "        const limite = plano?.limites.maxConexoesWhatsapp ?? 0;",
     ),
    ("cortesia deixa de estar acima do teto",
     CONFIG,
     "  if (cortesia) return 999999;",
     "  void cortesia;",
     ),

    # ── fatura ──────────────────────────────────────────────────────────────
    ("a linha do extra não entra na fatura",
     FATURA,
     "  for (const extra of args.extras ?? []) {\n    itens.push({\n      tipo: \"extra\",",
     "  for (const extra of []) {\n    itens.push({\n      tipo: \"extra\",",
     ),
    ("a composição do escritório para de mandar os extras",
     COBRANCA,
     "    extras,\n    atendentesAtivos,",
     "    atendentesAtivos,",
     ),
    ("extra suspenso/vencido volta a ser cobrado",
     COBRANCA,
     "    (e) => e.vigente && e.quantidade > 0,",
     "    () => true,",
     ),

    # ── JurisIA ─────────────────────────────────────────────────────────────
    ("o JurisIA do cartão volta a não entrar na fatura",
     COBRANCA,
     "  const jurisiaAvulso = await avulsoJurisiaCobravel(escritorioId, agoraMs);\n  if (jurisiaAvulso) extras.push(jurisiaAvulso);",
     "  // sem o JurisIA do cartão",
     ),
    ("os dois caminhos do JurisIA passam a cobrar dobrado",
     COBRANCA,
     "  if (comoModulo && avulsoVigente(comoModulo, agoraMs)) return null;",
     "  void comoModulo;",
     ),
    ("concessão de graça do JurisIA vira linha de R$ 0",
     COBRANCA,
     "  if (!doCartao || doCartao.precoCentavos <= 0) return null;",
     "  if (!doCartao) return null;",
     ),
    ("conceder JurisIA pelo diálogo de módulos volta a não liberar",
     ADDONS,
     "  const addon = await addonJurisiaPorQualquerCaminho(args.escritorioId, args.agora ?? new Date());",
     "  const addon = await buscarAddon(args.escritorioId, MODULO_JURISIA);",
     ),
    ("o motivo do bloqueio vira 'nunca contratou' quando está vencido",
     ADDONS,
     "  return doCartao ?? comoModulo;",
     "  return null;",
     ),

    # ── painel ──────────────────────────────────────────────────────────────
    ("o botão de vender extra desaparece do painel",
     CARTAO,
     "            <Plus className=\"h-3 w-3 mr-1\" /> Extra\n",
     "",
     ),
    ("cancelar o extra deixa de zerar a quantidade",
     CARTAO,
     "                      quantidade: 0,",
     "                      quantidade: 1,",
     ),
    ("a procedure do extra deixa de ser auditada",
     ADMIN,
     '        acao: "extra.avulso",',
     '        acao: "",',
     ),
]


def roda():
    r = subprocess.run(
        ["pnpm", "vitest", "run", TESTE],
        cwd=RAIZ, capture_output=True, text=True,
    )
    return r.returncode == 0


def main():
    vivos = []
    for i, (rotulo, arquivo, de, para) in enumerate(MUTACOES, 1):
        p = RAIZ / arquivo
        original = p.read_text()
        n = original.count(de)
        if n == 0:
            print(f"{i:2}. ⚠  ALVO NÃO ENCONTRADO — {rotulo} (em {arquivo})")
            vivos.append(rotulo)
            continue
        p.write_text(original.replace(de, para))
        try:
            passou = roda()
        finally:
            p.write_text(original)
        if passou:
            print(f"{i:2}. ✗  SOBREVIVEU — {rotulo}")
            vivos.append(rotulo)
        else:
            print(f"{i:2}. ✓  vermelho — {rotulo}" + (f"  [{n}x]" if n > 1 else ""))

    print()
    if vivos:
        print(f"{len(vivos)} de {len(MUTACOES)} mutações sobreviveram:")
        for v in vivos:
            print(f"  - {v}")
        sys.exit(1)
    print(f"Todas as {len(MUTACOES)} mutações ficaram vermelhas.")


if __name__ == "__main__":
    main()
