/**
 * O cerco em volta dos dados de cliente.
 *
 * O robô de jornada navega o sistema como usuário. A parede que separa ele
 * dos dados dos clientes é o próprio `escritorioId` — ele entra num escritório
 * que só tem ele dentro, e toda consulta do produto já filtra por escritório.
 * Não é uma trava nova; é a mesma que protege um escritório do outro.
 *
 * Estes testes vigiam as travas ADICIONAIS, que existem justamente porque a
 * primeira é a que está sendo auditada: se ela tiver furo, o clique
 * destrutivo acontece do lado errado dela.
 *
 *   · lista negra de ações — nada que apague, cobre ou mande mensagem
 *   · lista negra de rotas — `/admin` é global e não tem escritório pra filtrar
 *   · guarda de e-mail — a única integração de saída que não é por escritório
 *   · constantes num lugar só — renomear o prefixo em UM arquivo não pode
 *     fazer um guarda parar de guardar em silêncio
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  ACOES_PROIBIDAS,
  ehAcaoProibida,
  ehRotaProibida,
  normalizarNomeAcessivel,
} from "../admin/jornada/lista-negra";
import { CONFERENCIAS } from "../admin/jornada/conferencias";
import {
  DOMINIO_EMAIL_TESTE,
  ehEmailDeTeste,
  ehEscritorioDeTeste,
  IDADE_MAXIMA_ESCRITORIO_TESTE_MS,
  nomeEscritorioDeTeste,
  PREFIXO_ESCRITORIO_TESTE,
} from "../../shared/escritorio-de-teste";
import { REGRAS } from "../admin/auditoria/regras";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const email = ler("server/_core/email.ts");
const seed = ler("tests/e2e/lib/seed-escritorio.ts");
const helpers = ler("tests/e2e/lib/page-helpers.ts");
const specRotas = ler("tests/e2e/jornada.spec.ts");
const specConf = ler("tests/e2e/jornada-conferencias.spec.ts");

describe("lista negra de ações", () => {
  it("recusa o que destrói", () => {
    for (const nome of [
      "Excluir",
      "Excluir cargo",
      "Apagar coluna",
      "Remover colaborador",
      "Deletar",
      "Arquivar card",
    ]) {
      expect(ehAcaoProibida(nome), nome).toBe(true);
    }
  });

  it("recusa o que mexe em dinheiro", () => {
    for (const nome of [
      "Gerar cobrança",
      "Cancelar assinatura",
      "Emitir boleto",
      "Comprar créditos",
      "Trocar plano",
    ]) {
      expect(ehAcaoProibida(nome), nome).toBe(true);
    }
  });

  it("recusa o que sai do sistema e chega em alguém", () => {
    for (const nome of ["Enviar mensagem", "Reenviar convite", "Convidar colaborador", "Disparar lembrete"]) {
      expect(ehAcaoProibida(nome), nome).toBe(true);
    }
  });

  it("recusa o que gasta crédito no tribunal", () => {
    // Consulta paga é dinheiro saindo, mesmo que a tela não diga "cobrança".
    for (const nome of ["Monitorar", "Carregar detalhes", "Ler documento", "Validar"]) {
      expect(ehAcaoProibida(nome), nome).toBe(true);
    }
  });

  it("deixa passar o que o robô precisa fazer", () => {
    // Se a lista pegasse tudo, o robô não conferiria nada — e uma trava que
    // impede o trabalho inteiro é removida na primeira sexta-feira.
    for (const nome of ["Criar", "Salvar", "Novo cliente", "Cancelar", "Próximo", "Buscar"]) {
      expect(ehAcaoProibida(nome), nome).toBe(false);
    }
  });

  it("não se engana com acento nem com caixa", () => {
    // O nome vem da tela; "COBRANÇA", "Cobrança" e "cobranca" são o mesmo
    // botão, e a trava não pode depender de qual deles o dev escreveu.
    expect(ehAcaoProibida("GERAR COBRANÇA")).toBe(true);
    expect(ehAcaoProibida("gerar cobranca")).toBe(true);
    expect(normalizarNomeAcessivel("  Excluir   Cargo ")).toBe("excluir cargo");
  });

  it("nome vazio não vira proibição", () => {
    // Botão sem nome acessível é problema de acessibilidade, não permissão —
    // e travar tudo que não tem rótulo pararia o robô por motivo errado.
    expect(ehAcaoProibida("")).toBe(false);
    expect(ehAcaoProibida(null)).toBe(false);
  });

  it("a lista tem tamanho de lista pensada, não de exemplo", () => {
    expect(ACOES_PROIBIDAS.length).toBeGreaterThan(20);
  });
});

describe("lista negra de rotas", () => {
  it("o painel admin está fora", () => {
    // É o único lugar sem escritorioId pra filtrar: a parede principal não
    // existe lá dentro.
    expect(ehRotaProibida("/admin")).toBe(true);
    expect(ehRotaProibida("/admin/erros")).toBe(true);
    expect(ehRotaProibida("/checkout")).toBe(true);
  });

  it("as rotas do app seguem abertas", () => {
    for (const r of ["/dashboard", "/clientes", "/agenda", "/kanban", "/ponto"]) {
      expect(ehRotaProibida(r), r).toBe(false);
    }
  });

  it("não confunde rota que só COMEÇA parecido", () => {
    // `/administrativo` não é `/admin`.
    expect(ehRotaProibida("/administrativo")).toBe(false);
  });

  it("a varredura de rotas checa a lista antes de sair navegando", () => {
    expect(specRotas).toContain("ehRotaProibida");
  });
});

describe("os cliques do robô passam pela trava", () => {
  it("existe clique seguro e navegação segura", () => {
    expect(helpers).toContain("export async function clicarSeguro");
    expect(helpers).toContain("export async function irSeguro");
    expect(helpers).toContain("ehAcaoProibida(rotulo)");
  });

  it("a trava falha alto, não em silêncio", () => {
    // Passo tentando clicar em algo proibido é bug do passo. Ignorar o
    // clique deixaria a conferência "passando" sem ter conferido.
    const i = helpers.indexOf("export async function clicarSeguro");
    expect(helpers.slice(i, i + 900)).toContain("throw new Error(");
  });

  it("as conferências usam os helpers seguros, não page.click cru", () => {
    expect(specConf).toContain("clicarSeguro");
    expect(specConf).toContain("irSeguro");
    expect(specConf).not.toContain("page.goto(");
  });

  it("toda conferência apaga o escritório no fim, mesmo falhando", () => {
    // `finally`: conferência que falha no meio não pode deixar escritório de
    // pé — seria justamente o caso em que ninguém está olhando.
    const blocos = specConf.match(/} finally \{\s*await teardownTestEscritorio\(runId\);/g);
    expect(blocos?.length, "toda conferência precisa de teardown em finally").toBe(5);
  });
});

describe("guarda de e-mail", () => {
  it("reconhece a conta do robô pelo domínio inteiro", () => {
    expect(ehEmailDeTeste(`dono-123@${DOMINIO_EMAIL_TESTE}`)).toBe(true);
    expect(ehEmailDeTeste("DONO-123@JURIFY.TEST")).toBe(true);
  });

  it("não confunde cliente de verdade com conta de teste", () => {
    // Sem exigir o `@`, um cliente chamado "contato.jurify.test@gmail.com"
    // pararia de receber e-mail — o oposto do que o guarda existe pra fazer.
    expect(ehEmailDeTeste("contato.jurify.test@gmail.com")).toBe(false);
    expect(ehEmailDeTeste("maria@escritorio.com.br")).toBe(false);
    expect(ehEmailDeTeste(null)).toBe(false);
  });

  it("o envio é bloqueado antes de qualquer chamada ao Resend", () => {
    // Tem que vir ANTES das validações e do envio: bloquear depois já teria
    // gasto cota e produzido bounce.
    const i = email.indexOf("export async function enviarEmail");
    const corpo = email.slice(i, i + 1400);
    const posGuarda = corpo.indexOf("ehEmailDeTeste(options.to)");
    const posValidacao = corpo.indexOf("if (!options.to ||");
    expect(posGuarda, "guarda não encontrado").toBeGreaterThan(0);
    expect(posValidacao).toBeGreaterThan(posGuarda);
  });
});

describe("as constantes moram num lugar só", () => {
  it("o semeador usa as compartilhadas, não strings próprias", () => {
    // Quatro peças dependem delas: semeador, varredor, guarda de e-mail e a
    // regra ROB-01. Cada uma com a própria cópia é uma renomeação de
    // distância de um guarda parar de guardar sem ninguém notar.
    expect(seed).toContain("PREFIXO_ESCRITORIO_TESTE");
    expect(seed).toContain("DOMINIO_EMAIL_TESTE");
    expect(seed).not.toContain('const ESCRITORIO_PREFIX = "test-runner-"');
    expect(seed).not.toContain("@jurify.test`");
  });

  it("nome de escritório de teste é reconhecível pelos dois lados", () => {
    const nome = nomeEscritorioDeTeste("1787063-a9f2");
    expect(nome.startsWith(PREFIXO_ESCRITORIO_TESTE)).toBe(true);
    expect(ehEscritorioDeTeste(nome)).toBe(true);
    expect(ehEscritorioDeTeste("Escritório Silva & Associados")).toBe(false);
  });

  it("o varredor usa a mesma idade máxima da regra do auditor", () => {
    expect(seed).toContain("IDADE_MAXIMA_ESCRITORIO_TESTE_MS");
    expect(IDADE_MAXIMA_ESCRITORIO_TESTE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("ROB-01 — o alarme de quando a limpeza falha", () => {
  const regra = REGRAS.find((r) => r.id === "ROB-01");

  it("existe e é observabilidade", () => {
    expect(regra, "ROB-01 não está no catálogo").toBeDefined();
    expect(regra!.dominio).toBe("observabilidade");
    expect(regra!.tabela).toBe("escritorios");
  });

  it("não se autoriza a apagar escritório sozinha", () => {
    // Mesmo sendo de teste, apagar escritório é irreversível. Quem confirma
    // é gente.
    expect(regra!.nivel).toBe("B");
    expect(regra!.shadow).toBe(true);
  });

  it("usa o prefixo compartilhado, não uma cópia", () => {
    const src = ler("server/admin/auditoria/regras.ts");
    expect(src).toContain("like(escritorios.nome, `${PREFIXO_ESCRITORIO_TESTE}%`)");
    expect(src).toContain("IDADE_MAXIMA_ESCRITORIO_TESTE_MS");
  });
});

describe("catálogo de conferências", () => {
  it("cada uma diz o que protege, não só o que faz", () => {
    // "Cria cliente e confere" não sobrevive a uma revisão daqui a um ano.
    // O porquê é o que impede alguém de apagar a conferência achando que é
    // redundante.
    for (const c of CONFERENCIAS) {
      expect(c.porque.length, `${c.id} sem motivo`).toBeGreaterThan(30);
      expect(c.passos.length, `${c.id} com poucos passos`).toBeGreaterThan(1);
    }
  });

  it("toda conferência declarada tem implementação", () => {
    // Declarada sem implementação viraria linha verde no painel que não
    // conferiu nada — pior que não existir.
    for (const c of CONFERENCIAS) {
      expect(specConf, `${c.id} declarada mas não implementada`).toContain(c.id);
    }
  });

  it("ids únicos", () => {
    const ids = CONFERENCIAS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
