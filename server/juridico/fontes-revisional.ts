/**
 * Base curada inicial — Revisional Bancária / Financiamento (Fase 1 do MVP).
 *
 * Fontes reais e citáveis (súmulas STJ/STF, artigos do CDC, repetitivos) que
 * já embasam os cálculos/pareceres do sistema. É o conjunto semente da base
 * jurídica; o texto é o conteúdo recuperado e citado pelo agente (não é o
 * inteiro teor — é o enunciado/gist suficiente pra fundamentar e localizar).
 */

export type FonteSemente = {
  tipo: "sumula" | "lei" | "precedente" | "tese";
  identificador: string;
  orgao?: string;
  titulo?: string;
  texto: string;
  tags?: string;
};

export const AREA_REVISIONAL = "revisional_bancaria";

export const FONTES_REVISIONAL: FonteSemente[] = [
  {
    tipo: "sumula", identificador: "Súmula 297/STJ", orgao: "STJ",
    titulo: "CDC aplica-se às instituições financeiras",
    texto: "O Código de Defesa do Consumidor é aplicável às instituições financeiras.",
    tags: "cdc,consumidor,banco,aplicabilidade",
  },
  {
    tipo: "sumula", identificador: "Súmula 382/STJ", orgao: "STJ",
    titulo: "Juros remuneratórios acima de 12% a.a.",
    texto: "A estipulação de juros remuneratórios superiores a 12% ao ano, por si só, não indica abusividade.",
    tags: "juros,remuneratorios,abusividade",
  },
  {
    tipo: "sumula", identificador: "Súmula 530/STJ", orgao: "STJ",
    titulo: "Limitação de juros à taxa média de mercado",
    texto: "Nos contratos bancários, na impossibilidade de comprovar a taxa de juros efetivamente contratada, aplica-se a taxa média de mercado divulgada pelo Bacen, praticada nas operações da mesma espécie.",
    tags: "juros,taxa media,bacen",
  },
  {
    tipo: "sumula", identificador: "Súmula 539/STJ", orgao: "STJ",
    titulo: "Capitalização de juros permitida se pactuada",
    texto: "É permitida a capitalização de juros com periodicidade inferior à anual em contratos celebrados após 31/3/2000, data da publicação da MP 1.963-17/2000 (reeditada como MP 2.170-36/2001), desde que expressamente pactuada.",
    tags: "capitalizacao,anatocismo,pactuacao",
  },
  {
    tipo: "sumula", identificador: "Súmula 541/STJ", orgao: "STJ",
    titulo: "Previsão da capitalização",
    texto: "A previsão no contrato bancário de taxa de juros anual superior ao duodécuplo da mensal é suficiente para permitir a cobrança da taxa efetiva anual contratada (capitalização pactuada).",
    tags: "capitalizacao,taxa anual,duodecuplo",
  },
  {
    tipo: "sumula", identificador: "Súmula 472/STJ", orgao: "STJ",
    titulo: "Comissão de permanência — não cumulação",
    texto: "A cobrança de comissão de permanência (limitada à taxa do contrato) exclui a exigibilidade dos juros remuneratórios, moratórios e da multa contratual — vedada a cumulação.",
    tags: "comissao de permanencia,cumulacao,encargos",
  },
  {
    tipo: "sumula", identificador: "Súmula 121/STF", orgao: "STF",
    titulo: "Vedação da capitalização (regra geral)",
    texto: "É vedada a capitalização de juros, ainda que expressamente convencionada — ressalvadas as exceções legais específicas (ex.: SFN após a MP 2.170-36/2001).",
    tags: "capitalizacao,anatocismo,vedacao",
  },
  {
    tipo: "precedente", identificador: "REsp 1.061.530/RS", orgao: "STJ",
    titulo: "Repetitivo — juros remuneratórios e abusividade",
    texto: "Recurso repetitivo: os juros remuneratórios não se limitam a 12% a.a.; a abusividade só se caracteriza quando comprovada discrepância substancial em relação à taxa média de mercado; o ônus da prova da abusividade é do consumidor.",
    tags: "repetitivo,juros,abusividade,onus da prova",
  },
  {
    tipo: "precedente", identificador: "REsp 973.827/RS", orgao: "STJ",
    titulo: "Repetitivo — capitalização mensal",
    texto: "Recurso repetitivo: admite-se a capitalização mensal de juros nos contratos bancários posteriores à MP 2.170-36/2001, desde que expressamente pactuada; a mera menção à taxa anual maior que o duodécuplo da mensal supre a exigência.",
    tags: "repetitivo,capitalizacao mensal,pactuacao",
  },
  {
    tipo: "lei", identificador: "art. 6º, V, CDC", orgao: "CDC",
    titulo: "Modificação de cláusulas desproporcionais",
    texto: "É direito básico do consumidor a modificação das cláusulas contratuais que estabeleçam prestações desproporcionais ou sua revisão em razão de fatos supervenientes que as tornem excessivamente onerosas.",
    tags: "cdc,revisao,onerosidade,clausula",
  },
  {
    tipo: "lei", identificador: "art. 51, IV, CDC", orgao: "CDC",
    titulo: "Nulidade de cláusulas abusivas",
    texto: "São nulas de pleno direito as cláusulas contratuais que estabeleçam obrigações iníquas, abusivas, que coloquem o consumidor em desvantagem exagerada ou sejam incompatíveis com a boa-fé e a equidade.",
    tags: "cdc,clausula abusiva,nulidade",
  },
  {
    tipo: "lei", identificador: "art. 42, § único, CDC", orgao: "CDC",
    titulo: "Repetição de indébito em dobro",
    texto: "O consumidor cobrado em quantia indevida tem direito à repetição do indébito, por valor igual ao dobro do que pagou em excesso, acrescido de correção e juros, salvo hipótese de engano justificável.",
    tags: "repeticao de indebito,dobro,restituicao",
  },
  {
    tipo: "lei", identificador: "MP 2.170-36/2001, art. 5º", orgao: "Presidência",
    titulo: "Capitalização inferior a um ano no SFN",
    texto: "Nas operações realizadas por instituições integrantes do Sistema Financeiro Nacional, é admissível a capitalização de juros com periodicidade inferior a um ano.",
    tags: "capitalizacao,sfn,periodicidade",
  },
  {
    tipo: "lei", identificador: "Decreto 22.626/1933, art. 4º", orgao: "Lei de Usura",
    titulo: "Vedação do anatocismo (regra geral)",
    texto: "É proibido contar juros dos juros (anatocismo); essa vedação geral cede diante das exceções legais específicas aplicáveis às instituições do SFN.",
    tags: "usura,anatocismo,vedacao",
  },
  {
    tipo: "lei", identificador: "Lei 4.380/1964, art. 15-A", orgao: "SFH",
    titulo: "Capitalização no SFH pós Lei 11.977/2009",
    texto: "Nos contratos do Sistema Financeiro da Habitação, é permitido pactuar a capitalização de juros com periodicidade mensal (dispositivo incluído pela Lei 11.977/2009).",
    tags: "sfh,capitalizacao,habitacao",
  },
];
