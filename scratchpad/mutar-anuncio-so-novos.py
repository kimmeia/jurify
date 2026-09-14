#!/usr/bin/env python3
"""Mutações da amarra `anuncio-so-de-quem-chegou` + `anuncio-no-inbox`."""
import subprocess, sys, pathlib
RAIZ = pathlib.Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / "server/integracoes/whatsapp-origem-anuncio.ts"
HANDLER = RAIZ / "server/integracoes/whatsapp-handler.ts"
MIG = RAIZ / "drizzle/0233_origem_anuncio_so_de_quem_chegou.sql"
TELA = RAIZ / "client/src/pages/Atendimento.tsx"
PAINEL = RAIZ / "client/src/pages/atendimento/customer-panel.tsx"

MUTACOES = [
    (ORIGEM, "  if (contatoNovo === false) {", "  if (false) {",
             "contato antigo volta a ser carimbado"),
    (ORIGEM, "if (contatoNovo === false) {", "if (contatoNovo !== true) {",
             "caller sem o sinal para de gravar (regressao silenciosa)"),
    (ORIGEM, "    if (!row || row.atual) return;", "    if (!row) return;",
             "first-touch morre: origem antiga e sobrescrita"),
    (HANDLER, "        contatoFoiCriado = false;", "",
              "unificacao com cadastro existente nao derruba o sinal"),
    (HANDLER, "msg.timestamp * 1000, contatoFoiCriado)", "msg.timestamp * 1000, true)",
              "handler afirma sempre que o contato e novo"),
    (MIG, "   AND origemAnuncioEm > createdAtContato + INTERVAL 5 MINUTE;", ";",
          "limpeza varre tambem quem nasceu do anuncio"),
    (MIG, "       origemAnuncioEm = NULL", "       origemAnuncioEm = origemAnuncioEm",
          "limpeza deixa a data orfa"),
    (TELA, '    {/* A origem por anúncio NÃO é desenhada aqui',
           '    {/* data-testid="cartao-origem-anuncio" ad.corpo ad.sourceUrl',
           "bloco do anuncio volta pra conversa"),
    (PAINEL, "` · chegou em ${formatDate(contato.origemAnuncioEm)}`",
             "` · clique em ${formatDate(contato.origemAnuncioEm)}`",
             "rotulo volta a prometer hora de clique"),
]

def roda():
    r = subprocess.run(["pnpm","vitest","run",
        "server/__tests__/anuncio-so-de-quem-chegou.test.ts",
        "server/__tests__/anuncio-no-inbox.test.ts"],
        cwd=RAIZ, capture_output=True, text=True)
    return r.returncode == 0

def main():
    vivos = []
    for arq, de, para, nome in MUTACOES:
        orig = arq.read_text()
        if de not in orig:
            print(f"?? ALVO NAO ENCONTRADO: {nome}"); vivos.append(nome); continue
        arq.write_text(orig.replace(de, para, 1))
        try: verde = roda()
        finally: arq.write_text(orig)
        print(("SOBREVIVEU  " if verde else "morreu      ") + nome)
        if verde: vivos.append(nome)
    print(f"\n{len(MUTACOES)-len(vivos)}/{len(MUTACOES)} mutações mortas")
    sys.exit(1 if vivos else 0)

main()
