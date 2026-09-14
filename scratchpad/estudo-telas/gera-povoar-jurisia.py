#!/usr/bin/env python3
"""Gera scratchpad/estudo-telas/povoar-jurisia.sql — acervo e base de fontes.

Tela vazia esconde defeito: JurisIA e Base Jurídica nascem sem uma linha no
banco local, e sem dado o mockup mostraria caixa vazia em vez de produto. Os
números são inventados mas COERENTES: a distribuição de desfecho de cada
recorte é a mesma que a tela soma, e cada processo tem movimento com a data
do desfecho.

Idempotente: apaga o que ele mesmo criou antes de inserir.
"""
import random

random.seed(20260913)

TRIBUNAIS = [
    # sigla, peso, órgãos de 1º grau
    ("TJCE", 46, ["1ª Vara Cível de Fortaleza", "3ª Vara Cível de Fortaleza",
                  "2ª Vara Cível de Caucaia", "14ª Vara Cível de Fortaleza",
                  "Vara Única de Maracanaú"]),
    ("TJSP", 34, ["15ª Vara Cível Central de São Paulo", "4ª Vara Cível de Campinas",
                  "2ª Vara Cível de Santo André", "7ª Vara Cível de Guarulhos"]),
    ("TJMG", 22, ["9ª Vara Cível de Belo Horizonte", "2ª Vara Cível de Uberlândia",
                  "1ª Vara Cível de Contagem"]),
    ("TJPE", 16, ["12ª Vara Cível do Recife", "3ª Vara Cível de Jaboatão"]),
    ("TRF5", 10, ["4ª Vara Federal de Fortaleza", "9ª Vara Federal do Recife"]),
]

ASSUNTOS = [
    (7771, "Contratos Bancários", "Contratos Bancários · Juros · Capitalização"),
    (7772, "Revisão do Contrato", "Revisão do Contrato · Contratos Bancários"),
    (10646, "Alienação Fiduciária", "Alienação Fiduciária · Busca e Apreensão"),
    (7681, "Cláusulas Abusivas", "Cláusulas Abusivas · Contratos de Consumo"),
]

CLASSES = [
    (7, "Procedimento Comum Cível"),
    (81, "Busca e Apreensão em Alienação Fiduciária"),
    (159, "Execução de Título Extrajudicial"),
]

# A distribuição existe pra o número da tela ser plausível pra um advogado:
# revisional raramente é procedente em bloco; parcial é o desfecho comum.
DESFECHOS = (
    ["parcial"] * 31 + ["procedente"] * 24 + ["improcedente"] * 23
    + ["acordo"] * 12 + ["extinto_sem_merito"] * 10
)

MOV_POR_DESFECHO = {
    "procedente": (219, "Procedência"),
    "parcial": (220, "Procedência em Parte"),
    "improcedente": (221, "Improcedência"),
    "acordo": (466, "Homologação de Acordo"),
    "extinto_sem_merito": (471, "Extinção sem Resolução do Mérito"),
}

RECURSOS = ["nao_provido"] * 9 + ["parcialmente_provido"] * 5 + ["provido"] * 3 + ["nao_conhecido"] * 2

linhas_proc, linhas_mov = [], []
seq = 0


def dia(ano, mes, d):
    return f"{ano}-{mes:02d}-{d:02d}"


for sigla, quantos, orgaos in TRIBUNAIS:
    for _ in range(quantos):
        seq += 1
        classe_cod, classe_nome = random.choice(CLASSES)
        assunto_cod, assunto_nome, assuntos_todos = random.choice(ASSUNTOS)
        orgao = random.choice(orgaos)
        ano_aj = random.choice([2024, 2024, 2025, 2025, 2026])
        mes_aj = random.randint(1, 12 if ano_aj < 2026 else 7)
        aj = dia(ano_aj, mes_aj, random.randint(1, 28))
        desfecho = random.choice(DESFECHOS)
        mes_res = random.randint(1, 9)
        ano_res = 2026 if ano_aj < 2026 else 2026
        res = dia(ano_res, mes_res, random.randint(1, 28))
        cod_mov, nome_mov = MOV_POR_DESFECHO[desfecho]
        # Só dígitos, 20 posições — é assim que `cnjNormalizado` grava.
        cnj = f"{seq:07d}{random.randint(10,99)}{ano_aj}806{random.randint(1,199):04d}"
        grau = "G2" if random.random() < 0.18 else "G1"
        rec = random.choice(RECURSOS) if grau == "G2" else None

        linhas_proc.append(
            "('{cnj}','{trib}','{grau}',{cc},'{cn}',{ac},'{an}','{at}',{oc},'{on}',"
            "'{aj} 09:00:00','{res} 15:20:00','{desf}','{res} 15:20:00','{nm}','2026-09-13 06:00:00',"
            "{rec},{rec_em})".format(
                cnj=cnj, trib=sigla, grau=grau, cc=classe_cod, cn=classe_nome,
                ac=assunto_cod, an=assunto_nome, at=assuntos_todos,
                oc=random.randint(1000, 9999), on=orgao, aj=aj, res=res,
                desf=desfecho, nm=nome_mov,
                rec=f"'{rec}'" if rec else "NULL",
                rec_em=f"'{res} 15:20:00'" if rec else "NULL",
            )
        )
        linhas_mov.append((cnj, [
            (26, "Distribuição", f"{aj} 09:00:00"),
            (51, "Audiência de Conciliação", f"{res} 10:00:00"),
            (cod_mov, nome_mov, f"{res} 15:20:00"),
        ]))

FONTES = [
    ("sumula", "Súmula 297 do STJ", "STJ", "revisional",
     "O Código de Defesa do Consumidor é aplicável às instituições financeiras.",
     "consumidor,banco,revisional", True),
    ("sumula", "Súmula 382 do STJ", "STJ", "revisional",
     "A estipulação de juros remuneratórios superiores a 12% ao ano, por si só, não indica abusividade.",
     "juros,revisional", True),
    ("sumula", "Súmula 539 do STJ", "STJ", "revisional",
     "É permitida a capitalização de juros com periodicidade inferior à anual em contratos celebrados "
     "com instituições integrantes do Sistema Financeiro Nacional a partir de 31/3/2000, desde que "
     "expressamente pactuada.", "capitalizacao,juros", True),
    ("sumula", "Súmula 72 do STJ", "STJ", "busca_apreensao",
     "A comprovação da mora é imprescindível à busca e apreensão do bem alienado fiduciariamente.",
     "busca e apreensao,mora", True),
    ("tese", "Tema 1.061 do STJ", "STJ", "revisional",
     "A abusividade da tarifa de avaliação do bem e do seguro de proteção financeira deve ser aferida "
     "no caso concreto.", "tarifa,seguro", True),
    ("lei", "CDC art. 42, parágrafo único", "Congresso Nacional", "revisional",
     "O consumidor cobrado em quantia indevida tem direito à repetição do indébito, por valor igual ao "
     "dobro do que pagou em excesso, acrescido de correção monetária e juros legais, salvo hipótese de "
     "engano justificável.", "repeticao,indebito", True),
    ("lei", "Decreto-Lei 911/69, art. 3º", "Congresso Nacional", "busca_apreensao",
     "O proprietário fiduciário ou credor poderá, desde que comprovada a mora, requerer contra o devedor "
     "a busca e apreensão do bem alienado fiduciariamente.", "busca e apreensao", True),
    ("precedente", "TJCE — Apelação 0123456-78.2025.8.06.0001", "TJCE", "revisional",
     "Revisional de contrato bancário. Capitalização mensal expressamente pactuada. Tarifa de avaliação "
     "do bem não comprovada. Abusividade reconhecida em parte. Recurso parcialmente provido.",
     "tjce,capitalizacao,tarifa", True),
    ("precedente", "TJSP — Apelação 1004567-12.2025.8.26.0100", "TJSP", "revisional",
     "Contrato bancário. Juros remuneratórios dentro da média de mercado. Manutenção da sentença de "
     "improcedência.", "tjsp,juros", False),
    ("precedente", "TJMG — Apelação 5001234-55.2025.8.13.0024", "TJMG", "busca_apreensao",
     "Busca e apreensão. Notificação extrajudicial enviada ao endereço do contrato. Mora comprovada. "
     "Sentença mantida.", "tjmg,mora", False),
]

sql = ["-- Gerado por gera-povoar-jurisia.py — NÃO editar à mão.",
       "-- Acervo público (DataJud) + base de fontes, pra as telas não saírem vazias.",
       "SET NAMES utf8mb4;",
       "DELETE FROM jurisia_movimentos;",
       "DELETE FROM jurisia_processos;",
       "DELETE FROM jurisia_varredura;",
       "DELETE FROM fontes_juridicas WHERE escritorioId IS NULL;",
       ""]

sql.append(
    "INSERT INTO jurisia_processos (cnjJurisProc,tribunalJurisProc,grauJurisProc,classeCodigoJurisProc,"
    "classeNomeJurisProc,assuntoCodigoJurisProc,assuntoNomeJurisProc,assuntosTodosJurisProc,"
    "orgaoCodigoJurisProc,orgaoNomeJurisProc,ajuizamentoEmJurisProc,atualizadoEmJurisProc,"
    "resultadoJurisProc,resultadoEmJurisProc,resultadoMovimentoJurisProc,sincronizadoEmJurisProc,"
    "resultadoRecursoJurisProc,resultadoRecursoEmJurisProc) VALUES\n"
    + ",\n".join(linhas_proc) + ";\n"
)

partes = []
for cnj, movs in linhas_mov:
    for cod, nome, quando in movs:
        partes.append(
            f"((SELECT id FROM jurisia_processos WHERE cnjJurisProc='{cnj}'),{cod},'{nome}','{quando}')"
        )
sql.append(
    "INSERT INTO jurisia_movimentos (processoIdJurisMov,codigoJurisMov,nomeJurisMov,dataHoraJurisMov) VALUES\n"
    + ",\n".join(partes) + ";\n"
)

VARREDURA = [
    ("TJCE", "completo", 128, 0, None, "2026-09-13 04:10:00"),
    ("TJSP", "rodando", 96, 3, None, "2026-09-13 05:40:00"),
    ("TJMG", "completo", 61, 1, None, "2026-09-12 23:15:00"),
    ("TJPE", "erro", 18, 0, "403 — o tribunal recusou a faixa de IP do servidor", "2026-09-13 02:05:00"),
    ("TRF5", "fila", 0, 0, None, None),
]
sql.append(
    "INSERT INTO jurisia_varredura (tribunalJurisVarr,statusJurisVarr,processosJurisVarr,"
    "sigilososJurisVarr,ultimoErroJurisVarr,ultimaExecucaoJurisVarr) VALUES\n"
    + ",\n".join(
        "('{t}','{s}',{p},{sg},{e},{u})".format(
            t=t, s=s, p=p, sg=sg,
            e="NULL" if e is None else "'" + e.replace("'", "''") + "'",
            u="NULL" if u is None else f"'{u}'",
        )
        for t, s, p, sg, e, u in VARREDURA
    ) + ";\n"
)

sql.append(
    "INSERT INTO fontes_juridicas (escritorioId,tipo,identificador,orgao,area,titulo,texto,tags,embedding) VALUES\n"
    + ",\n".join(
        "(NULL,'{tipo}','{ident}','{orgao}','{area}','{ident}','{texto}','{tags}',{emb})".format(
            tipo=tipo, ident=ident.replace("'", "''"), orgao=orgao, area=area,
            texto=texto.replace("'", "''"), tags=tags,
            emb="'[0.01,0.02,0.03]'" if indexado else "NULL",
        )
        for tipo, ident, orgao, area, texto, tags, indexado in FONTES
    ) + ";\n"
)

with open("scratchpad/estudo-telas/povoar-jurisia.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(sql))

print(f"{len(linhas_proc)} processos · {len(partes)} movimentos · {len(FONTES)} fontes")
