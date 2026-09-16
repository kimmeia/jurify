#!/usr/bin/env python3
"""
Bateria de mutação da janela de 24h aplicada ao robô.

Cada entrada quebra o código de um jeito plausível — o erro que alguém
cometeria de verdade — e a amarra tem que ficar VERMELHA. Mutante que
sobrevive é amarra que não protege nada.

    python3 scratchpad/mutar-janela-24h.py
"""

import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TESTE = "server/__tests__/janela-24h-do-robo.test.ts"

SHARED = "shared/janela-24h.ts"
GUARD = "server/integracoes/whatsapp-envio-guard.ts"
CANAL = "server/integracoes/canal-envio.ts"
HELPER = "server/integracoes/recado-janela-fechada.ts"
OPTOUT = "server/integracoes/whatsapp-optout.ts"

MUTACOES = [
    # ── a conta da janela ──────────────────────────────────────────────────
    ("a janela passa a incluir o instante exato dos 24h", SHARED,
     "  const restante = t + JANELA_24H_MS - agoraMs;",
     "  const restante = t + JANELA_24H_MS - agoraMs + 1;"),

    ("a janela vira 48h", SHARED,
     "export const JANELA_24H_MS = 24 * 60 * 60 * 1000;",
     "export const JANELA_24H_MS = 48 * 60 * 60 * 1000;"),

    ("cliente que nunca escreveu passa a contar como janela aberta", SHARED,
     "  if (!ultimaEntradaAt) return 0;",
     "  if (!ultimaEntradaAt) return JANELA_24H_MS;"),

    ("data inválida passa a abrir a janela", SHARED,
     "  if (Number.isNaN(t)) return 0;",
     "  if (Number.isNaN(t)) return JANELA_24H_MS;"),

    ("o minuto perde o zero à esquerda (3h05 vira 3h5)", SHARED,
     '  return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, "0")}`;',
     "  return resto === 0 ? `${horas}h` : `${horas}h${resto}`;"),

    ("«acabando» passa a valer com a janela já fechada", SHARED,
     "  return ms > 0 && ms <= JANELA_ACABANDO_MS;",
     "  return ms <= JANELA_ACABANDO_MS;"),

    ("o erro deixa de citar o código que a Meta devolve", SHARED,
     "o WhatsApp recusa mensagem livre (131047). ",
     "o WhatsApp recusa mensagem livre. "),

    ("o recado interno para de dizer a saída", SHARED,
     "    `Para retomar a conversa, envie um template aprovado.`",
     '    ""',),

    ("o marcador muda e a dedup para de achar o recado anterior", SHARED,
     'export const MARCADOR_JANELA_FECHADA = "janela_fechada";',
     'export const MARCADOR_JANELA_FECHADA = "janela24h";'),

    # ── a trava no guard ───────────────────────────────────────────────────
    ("o robô deixa de conferir a janela", GUARD,
     "  if (opts.proativo && opts.textoLivre && contatoId && opts.canalId) {",
     "  if (false && opts.proativo && opts.textoLivre && contatoId && opts.canalId) {"),

    ("a trava passa a valer também pro template", GUARD,
     "  if (opts.proativo && opts.textoLivre && contatoId && opts.canalId) {",
     "  if (opts.proativo && contatoId && opts.canalId) {"),

    ("a trava passa a valer pra resposta a quem escreveu", GUARD,
     "  if (opts.proativo && opts.textoLivre && contatoId && opts.canalId) {",
     "  if (opts.textoLivre && contatoId && opts.canalId) {"),

    ("janela fechada deixa de recusar (condição invertida)", GUARD,
     "    if (!janela24hAberta(ultimaEntrada, agoraMs)) {",
     "    if (janela24hAberta(ultimaEntrada, agoraMs)) {"),

    ("a recusa deixa de devolver o contato — o recado perde o endereço", GUARD,
     '      return { ok: false, tipo: "janela", erro: MENSAGEM_BLOQUEIO_JANELA, contatoId };',
     '      return { ok: false, tipo: "janela", erro: MENSAGEM_BLOQUEIO_JANELA };'),

    ("o gate do template passa a mandar conteúdo livre", GUARD,
     "  return podeEnviar({ ...opts, proativo: true });",
     "  return podeEnviar({ ...opts, proativo: true, textoLivre: true });"),

    # ── as portas ──────────────────────────────────────────────────────────
    ("a porta do TEXTO para de marcar conteúdo livre", CANAL,
     "        exigirOptin: opts.exigirOptin,\n        textoLivre: true,\n      });",
     "        exigirOptin: opts.exigirOptin,\n      });"),

    ("a porta do INTERATIVO para de marcar conteúdo livre", CANAL,
     "      // recusa é a mesma do texto.\n      textoLivre: true,\n    });",
     "      // recusa é a mesma do texto.\n    });"),

    ("a porta do TEXTO bloqueia calada (sem recado na conversa)", CANAL,
     '        if (permitido.tipo === "janela") {\n          const alvo = permitido.contatoId ?? opts.contatoId;',
     '        if (false) {\n          const alvo = permitido.contatoId ?? opts.contatoId;'),

    ("a porta do INTERATIVO bloqueia calada (sem recado na conversa)", CANAL,
     '      if (permitido.tipo === "janela") {\n        const alvo = permitido.contatoId ?? opts.contatoId;',
     '      if (false) {\n        const alvo = permitido.contatoId ?? opts.contatoId;'),

    # ── o recado interno ───────────────────────────────────────────────────
    ("o recado volta a sair a cada tentativa (dedup sem âncora)", HELPER,
     "    if (ultimaEntrada) filtros.push(gte(mensagens.createdAt, ultimaEntrada));",
     "    if (false) filtros.push(gte(mensagens.createdAt, ultimaEntrada));"),

    ("a conversa deixa de ser lida escopada pelo escritório", HELPER,
     "          eq(conversas.escritorioId, escritorioId),\n          eq(conversas.contatoId, contatoId),",
     "          eq(conversas.contatoId, contatoId),"),

    ("o recado interno vira mensagem de verdade e vaza pro cliente", HELPER,
     '      tipo: "sistema",\n      conteudo: recadoJanelaFechada(opts.nomeCenario),',
     '      tipo: "texto",\n      conteudo: recadoJanelaFechada(opts.nomeCenario),'),

    ("o recado passa a poder derrubar o envio", HELPER,
     "  } catch (err: any) {\n    log.warn(",
     "  } finally {\n    void ((err: any) => log.warn("),

    # ── fonte única ────────────────────────────────────────────────────────
    ("a cópia velha da conta volta a viver no servidor", OPTOUT,
     'export { JANELA_24H_MS, janela24hAberta } from "../../shared/janela-24h";\nimport { janela24hAberta } from "../../shared/janela-24h";',
     "export const JANELA_24H_MS = 24 * 60 * 60 * 1000;\n"
     "export function janela24hAberta(ultimaEntradaAt: any, agoraMs: number): boolean {\n"
     "  if (!ultimaEntradaAt) return false;\n"
     "  const t = new Date(ultimaEntradaAt).getTime();\n"
     "  if (Number.isNaN(t)) return false;\n"
     "  return agoraMs - t < JANELA_24H_MS;\n"
     "}"),
]


def rodar_teste() -> bool:
    r = subprocess.run(
        ["pnpm", "vitest", "run", TESTE],
        cwd=RAIZ, capture_output=True, text=True,
    )
    return r.returncode == 0


def main() -> int:
    print("Conferindo que a amarra passa limpa...")
    if not rodar_teste():
        print("!! a amarra já está vermelha ANTES de qualquer mutação")
        return 1
    print("ok\n")

    sobreviventes = []
    for i, (nome, arquivo, antes, depois) in enumerate(MUTACOES, 1):
        caminho = RAIZ / arquivo
        original = caminho.read_text()
        if antes not in original:
            print(f"{i:2}. {nome}\n    !! TRECHO NÃO ENCONTRADO em {arquivo}")
            sobreviventes.append((nome, "trecho não encontrado"))
            continue
        if original.count(antes) != 1:
            print(f"{i:2}. {nome}\n    !! trecho aparece {original.count(antes)}× em {arquivo}")
            sobreviventes.append((nome, "trecho ambíguo"))
            continue

        caminho.write_text(original.replace(antes, depois, 1))
        try:
            passou = rodar_teste()
        finally:
            caminho.write_text(original)

        if passou:
            print(f"{i:2}. {nome}\n    SOBREVIVEU — a amarra não pegou")
            sobreviventes.append((nome, "sobreviveu"))
        else:
            print(f"{i:2}. {nome} — vermelho")

    print()
    if sobreviventes:
        print(f"{len(sobreviventes)} de {len(MUTACOES)} sobreviveram:")
        for nome, motivo in sobreviventes:
            print(f"  - {nome} ({motivo})")
        return 1
    print(f"{len(MUTACOES)}/{len(MUTACOES)} mutações vermelhas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
