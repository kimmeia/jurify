#!/usr/bin/env python3
"""
Bateria de mutação do aniversário do cliente.

Cada entrada quebra o código de um jeito plausível — o erro que alguém
cometeria de verdade, não lixo sintático — e a amarra tem que ficar VERMELHA.
Mutante que sobrevive é amarra que não protege nada.

    python3 scratchpad/mutar-aniversario.py
"""

import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TESTE = "server/__tests__/aniversario-do-cliente.test.ts"

SHARED = "shared/aniversario.ts"
DATAS = "shared/data-calendario.ts"
CATALOGO = "shared/notificacoes-avisos.ts"
CRON = "server/escritorio/cron-aniversarios.ts"
CRONJOBS = "server/_core/cron-jobs.ts"
SSE = "server/_core/sse-notifications.ts"
ROUTER = "server/escritorio/router-clientes.ts"
SCHEMA = "drizzle/schema.ts"
MIGRATION = "drizzle/0232_contato_data_nascimento.sql"
CAMPOS = "client/src/components/CamposQualificacaoEndereco.tsx"
CLIENTES = "client/src/pages/Clientes.tsx"
CLIENTES_DETALHE = "client/src/pages/clientes/detail-tabs.tsx"

MUTACOES = [
    # ── as regras puras ────────────────────────────────────────────────────
    ("data que não existe passa a ser aceita", SHARED,
     "if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;",
     "if (false) return null;"),

    # Não existe aqui a mutação "tirar a faixa de mês/dia": ela é EQUIVALENTE.
    # A volta pelo Date logo abaixo já recusa mês 13 e mês 0 (o Date normaliza
    # e o mês de volta não bate). A faixa é caminho rápido, não a guarda.

    ("nascimento no futuro passa a ser aceito", SHARED,
     'if (iso!.slice(0, 10) > hoje) return { ok: false, motivo: "futuro" };',
     "if (false) return { ok: false, motivo: \"futuro\" };"),

    ("ano absurdo deixa de ser recusado", SHARED,
     'if (p.ano < ANO_MINIMO) return { ok: false, motivo: "antiga" };',
     "if (false) return { ok: false, motivo: \"antiga\" };"),

    ("o aniversário de HOJE é empurrado pro ano que vem", SHARED,
     "if (proximo < hoje) proximo = diaComemoradoNoAno(nasc, h.ano + 1);",
     "if (proximo <= hoje) proximo = diaComemoradoNoAno(nasc, h.ano + 1);"),

    ("29 de fevereiro deixa de cair em 28", SHARED,
     "const dia = Math.min(nasc.dia, diasNoMes(ano, nasc.mes));",
     "const dia = nasc.dia;"),

    ("a idade de hoje passa a contar o aniversário que ainda não chegou", SHARED,
     "const idadeHoje = anoConhecido ? h.ano - nasc.ano - (jaFezEsteAno ? 0 : 1) : null;",
     "const idadeHoje = anoConhecido ? h.ano - nasc.ano : null;"),

    ("diasAte passa a contar errado a virada do ano", SHARED,
     "return Math.round((mb - ma) / 86_400_000);",
     "return (pb.mes - pa.mes) * 30 + (pb.dia - pa.dia);"),

    ("a janela do destaque encolhe", SHARED,
     "export const JANELA_PROXIMO_DIAS = 7;",
     "export const JANELA_PROXIMO_DIAS = 3;"),

    ("«amanhã» some e vira contagem de dias", SHARED,
     'if (a.diasAte === 1) return anos ? `Faz${anos} amanhã` : "Aniversário é amanhã";',
     'if (false) return anos ? `Faz${anos} amanhã` : "Aniversário é amanhã";'),

    ("o rótulo de hoje deixa de falar em hoje", SHARED,
     'if (a.ehHoje) return a.faraIdade != null ? `Faz ${a.faraIdade} anos hoje` : "Aniversário é hoje";',
     'if (a.ehHoje) return a.faraIdade != null ? `Faz ${a.faraIdade} anos` : "Aniversário";'),

    ("estaProximo passa a valer pra todo mundo", SHARED,
     "return !!a && a.diasAte <= JANELA_PROXIMO_DIAS;",
     "return !!a;"),

    # ── o filtro ───────────────────────────────────────────────────────────
    ('o filtro "hoje" passa a aceitar a semana inteira', SHARED,
     'if (filtro === "hoje") return a.ehHoje;',
     'if (filtro === "hoje") return a.diasAte <= JANELA_PROXIMO_DIAS;'),

    ('o filtro "mês" vira "próximos 30 dias"', SHARED,
     "return !!h && a.mes === h.mes;",
     "return a.diasAte <= 30;"),

    ("ficha sem data passa a entrar no filtro", SHARED,
     "  if (!a) return false;\n  if (filtro === \"hoje\") return a.ehHoje;",
     "  if (!a) return true;\n  if (filtro === \"hoje\") return a.ehHoje;"),

    # ── o lembrete ─────────────────────────────────────────────────────────
    ("lista vazia passa a gerar aviso", SHARED,
     "if (nomes.length === 0) return null;",
     "if (nomes.length === -1) return null;"),

    ("o «e mais N» some e a lista mente sobre quantos são", SHARED,
     "      ? `${primeiros.join(\", \")} e mais ${resto}`",
     "      ? `${primeiros.join(\", \")}`"),

    ("o título do plural deixa de começar pelo prefixo", SHARED,
     "    titulo: `${PREFIXO_TITULO_ANIVERSARIO}s hoje`,",
     "    titulo: `${nomes.length} aniversários hoje`,"),

    ("o título do singular deixa de começar pelo prefixo", SHARED,
     "    return { titulo: `${PREFIXO_TITULO_ANIVERSARIO} hoje`, mensagem: `${nomes[0]} faz aniversário hoje.` };",
     "    return { titulo: `Hoje tem aniversário`, mensagem: `${nomes[0]} faz aniversário hoje.` };"),

    ("os parabéns passam a usar o nome inteiro", SHARED,
     'const primeiro = (nome || "").trim().split(/\\s+/)[0] || "";',
     'const primeiro = (nome || "").trim();'),

    # ── a data digitada ────────────────────────────────────────────────────
    ("31 de fevereiro passa a virar ISO", DATAS,
     "  return d.getUTCDate() === Number(dd) && d.getUTCMonth() + 1 === Number(mm)\n    ? `${aaaa}-${mm}-${dd}`\n    : \"\";",
     "  return `${aaaa}-${mm}-${dd}`;"),

    ("a máscara troca a ordem pro formato americano", DATAS,
     "  if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;",
     "  if (d.length > 4) return `${d.slice(2, 4)}/${d.slice(0, 2)}/${d.slice(4)}`;"),

    ("isoParaBrData devolve o ISO cru", DATAS,
     'return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";',
     "return iso;"),

    ("o campo volta a ser o nativo do navegador", CAMPOS,
     '            placeholder="dd/mm/aaaa"',
     '            type="date"'),

    ("nascimento entra na lista de campos exigidos pelo contrato", CAMPOS,
     '  { chave: "nacionalidade", label: "Nacionalidade" },',
     '  { chave: "nacionalidade", label: "Nacionalidade" },\n  { chave: "dataNascimento", label: "Data de nascimento" },'),

    # ── obrigatória no cadastro novo, e só nele ────────────────────────────
    ("o cadastro novo para de cobrar a data", CAMPOS,
     "  ...CAMPOS_OBRIGATORIOS_QUALIFICACAO,\n  { chave: \"dataNascimento\", label: \"Data de nascimento\" },",
     "  ...CAMPOS_OBRIGATORIOS_QUALIFICACAO,"),

    ("a exigência VAZA pra edição (a carteira antiga trava)", CAMPOS,
     "  const lista = opts.exigirNascimento\n    ? CAMPOS_OBRIGATORIOS_CADASTRO\n    : CAMPOS_OBRIGATORIOS_QUALIFICACAO;",
     "  const lista = CAMPOS_OBRIGATORIOS_CADASTRO;"),

    ("a opção é ignorada e nada é exigido a mais", CAMPOS,
     "  const lista = opts.exigirNascimento\n    ? CAMPOS_OBRIGATORIOS_CADASTRO\n    : CAMPOS_OBRIGATORIOS_QUALIFICACAO;",
     "  const lista = CAMPOS_OBRIGATORIOS_QUALIFICACAO;"),

    ("a lista do cadastro vira cópia solta e sai do sincronismo", CAMPOS,
     "  ...CAMPOS_OBRIGATORIOS_QUALIFICACAO,\n  { chave: \"dataNascimento\", label: \"Data de nascimento\" },",
     "  { chave: \"profissao\", label: \"Profissão\" },\n  { chave: \"dataNascimento\", label: \"Data de nascimento\" },"),

    ("o asterisco some do campo exigido", CAMPOS,
     '          <Label className="text-xs">{REQ("Data de nascimento", !!exigirNascimento)}</Label>',
     '          <Label className="text-xs">Data de nascimento</Label>'),

    ("a tela segue dizendo «Opcional» com o campo exigido", CAMPOS,
     '                (exigirNascimento\n                  ? "É ela que gera o lembrete do aniversário."\n                  : "Opcional. É ela que gera o lembrete do aniversário.")',
     '                "Opcional. É ela que gera o lembrete do aniversário."'),

    ("o «Novo cliente» deixa de marcar o componente", CLIENTES_DETALHE,
     "      obrigatorios\n      exigirNascimento\n      value={qualif}",
     "      obrigatorios\n      value={qualif}"),

    ("a trava do botão Cadastrar deixa de exigir a data", CLIENTES_DETALHE,
     "de nascimento entra junto; na edição, não — ver CAMPOS_OBRIGATORIOS_CADASTRO.\n    const qualifFaltando = validarQualificacaoCompleta(qualif, { exigirNascimento: true });",
     "de nascimento entra junto; na edição, não — ver CAMPOS_OBRIGATORIOS_CADASTRO.\n    const qualifFaltando = validarQualificacaoCompleta(qualif);"),

    ("a EDIÇÃO passa a exigir a data (o que ele recusou)", CLIENTES_DETALHE,
     "  const qualifFaltando = validarQualificacaoCompleta(qualif);\n  const todosFaltando",
     "  const qualifFaltando = validarQualificacaoCompleta(qualif, { exigirNascimento: true });\n  const todosFaltando"),

    # ── o catálogo de avisos ───────────────────────────────────────────────
    ("o aviso nasce desligado", CATALOGO,
     '    id: "clientes.aniversario",\n    grupo: "clientes",\n    titulo: "Aniversário de cliente",\n    explica:\n      "De manhã, uma vez por dia, com todos os aniversariantes do dia num aviso só. Só entra quem tem a data de nascimento no cadastro.",\n    padrao: true,',
     '    id: "clientes.aniversario",\n    grupo: "clientes",\n    titulo: "Aniversário de cliente",\n    explica:\n      "De manhã, uma vez por dia, com todos os aniversariantes do dia num aviso só. Só entra quem tem a data de nascimento no cadastro.",\n    padrao: false,'),

    ("o grupo Clientes some da tela", CATALOGO,
     '    id: "clientes",\n    titulo: "Clientes",',
     '    id: "clientes-fora",\n    titulo: "Clientes",'),

    ("o tipo do cron deixa de casar com o aviso", CATALOGO,
     '    case "aniversario_cliente":\n      return "clientes.aniversario";',
     '    case "aniversario_cliente":\n      return "clientes.outro";'),

    ("tipo desconhecido passa a ser BLOQUEADO em vez de enviado", CATALOGO,
     "    default:\n      return null;",
     '    default:\n      return "clientes.aniversario";'),

    # ── a fiação ───────────────────────────────────────────────────────────
    ("a coluna vira Date e o dia passa a passear de fuso", SCHEMA,
     '  dataNascimento: date("dataNascimentoContato", { mode: "string" }),',
     '  dataNascimento: date("dataNascimentoContato"),'),

    ("a migration deixa de criar a coluna", MIGRATION,
     "'ALTER TABLE contatos ADD COLUMN dataNascimentoContato DATE NULL DEFAULT NULL',",
     "'SELECT 1',"),

    ("a migration passa a apagar coisa", MIGRATION,
     "-- Aditiva: NULL para todo mundo que já existe",
     "-- DROP COLUMN seria destrutivo. Aditiva: NULL para todo mundo que já existe"),

    ("o cron é importado mas nunca chamado", CRONJOBS,
     "      await rodarLembretesDeAniversario();",
     "      void rodarLembretesDeAniversario;"),

    ("o tipo sai da lista do que vira push", SSE,
     '  "cliente_esperando",\n  "aniversario_cliente",\n]);',
     '  "cliente_esperando",\n]);'),

    ("o push leva pra lista inteira em vez do filtro", SSE,
     '  if (n.tipo === "aniversario_cliente") return "/clientes?aniversario=hoje";',
     '  if (n.tipo === "aniversario_cliente") return "/clientes";'),

    ("a tela para de ler o filtro que a notificação prometeu", CLIENTES,
     '    const aniv = params.get("aniversario") ?? "";',
     '    const aniv = "";'),

    ("a hora vira igualdade e o restart custa o dia", CRON,
     "if (horaLocalEm(fuso, agora) < HORA_DO_LEMBRETE) continue;",
     "if (horaLocalEm(fuso, agora) !== HORA_DO_LEMBRETE) continue;"),

    ("a dedup do banco some e o redeploy manda duas vezes", CRON,
     "        if (await jaAvisadoHoje(db, userId, comecoDoDia)) continue;",
     "        if (false) continue;"),

    ("a dedup deixa de procurar pelo prefixo do título", CRON,
     "        like(notificacoes.titulo, `${PREFIXO_TITULO_ANIVERSARIO}%`),",
     "        like(notificacoes.titulo, `%`),"),

    ("cliente com serviço encerrado volta a receber parabéns", CRON,
     'const FORA_DO_LEMBRETE = ["encerrado", "cancelado", "rescindido"] as const;',
     "const FORA_DO_LEMBRETE = [] as const;"),

    ("o servidor para de validar a data que chega", ROUTER,
     "  const v = validarNascimento(valor, hoje);",
     "  const v = { ok: true } as ReturnType<typeof validarNascimento>;"),

    ("o filtro do servidor deixa de usar a regra da tela", ROUTER,
     "        .filter((r) => passaNoFiltro(paraIsoDeData(r.dataNascimento), input.aniversario as FiltroAniversario, hoje))",
     "        .filter((r) => !!r.dataNascimento)"),

    ("um dos caminhos volta a usar o fuso fixo de Brasília", ROUTER,
     "          nascimentoParaColuna(d.dataNascimento, await hojeDoEscritorio(db, perm.escritorioId, d.dataNascimento)) ?? null;",
     "          nascimentoParaColuna(d.dataNascimento, dataHojeBR()) ?? null;"),
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
