/**
 * Compromisso criado pela conversa leva nome e telefone · e Nova Conversa
 * avisa quando o número já tem conversa.
 *
 * O compromisso agendado de dentro do Atendimento chegava na Agenda sem
 * cliente e sem telefone, apesar do selo "Vinculado a: Fulano". Eram DUAS
 * falhas somando no mesmo buraco:
 *
 *  1. o diálogo mandava o vínculo mas não o número — a coluna de telefone do
 *     compromisso só era preenchida à mão, na tela de Agenda;
 *  2. a lista da Agenda devolvia o nome do contato NAS TAREFAS e não nos
 *     compromissos — devolvia só o `contatoId`, que a tela não sabe virar
 *     nome. Por isso o bloco "Cliente" nunca apareceu num compromisso.
 *
 * A segunda correção é retroativa: compromisso já gravado com cliente
 * vinculado passa a mostrar nome e telefone sem ninguém refazer nada. É o
 * que estes testes travam, junto com a checagem de número repetido.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { estadoDoNumero } from "../../shared/conversa-existente";
import { mascararTelefoneBR, chaveTelefoneBR } from "../../shared/telefone";

function ler(rel: string) {
  return fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf-8");
}

describe("o compromisso leva os dados do contato", () => {
  const routerAgenda = ler("server/escritorio/router-agenda.ts");
  const routerAgendamento = ler("server/escritorio/router-agendamento.ts");
  const dialogo = ler("client/src/components/NovoCompromissoDialog.tsx");
  const atendimento = ler("client/src/pages/Atendimento.tsx");
  const painel = ler("client/src/pages/atendimento/customer-panel.tsx");

  it("a lista da Agenda devolve o nome do cliente também no compromisso", () => {
    // Era o que faltava pro bloco "Cliente" existir num compromisso — e é a
    // parte que conserta o que já está gravado.
    const bloco = routerAgenda.slice(
      routerAgenda.indexOf('fonte: "compromisso"'),
      routerAgenda.indexOf('fonte: "tarefa"'),
    );
    expect(bloco).toMatch(/contatoNome: doContato\?\.nome/);
  });

  it("o telefone digitado no compromisso tem prioridade sobre o do cadastro", () => {
    // Quem digitou um número diferente na Agenda fez de propósito: o cadastro
    // entra só como reserva, nunca por cima.
    const bloco = routerAgenda.slice(
      routerAgenda.indexOf('fonte: "compromisso"'),
      routerAgenda.indexOf('fonte: "tarefa"'),
    );
    expect(bloco).toMatch(
      /contatoTelefone: ag\.contatoTelefone \|\| doContato\?\.telefone \|\| null/,
    );
  });

  it("a busca dos contatos do compromisso é presa ao escritório", () => {
    const bloco = routerAgenda.slice(routerAgenda.indexOf("const contatoIdsAg"));
    const consulta = bloco.slice(0, bloco.indexOf("for (const ag of ags)"));
    expect(consulta).toMatch(/eq\(contatos\.escritorioId, escritorioId\)/);
    expect(consulta).toMatch(/inArray\(contatos\.id, contatoIdsAg\)/);
  });

  it("criar compromisso aceita e grava o telefone", () => {
    expect(routerAgendamento).toMatch(/contatoTelefone: z\.string\(\)\.max\(64\)\.optional\(\)/);
    expect(routerAgendamento).toMatch(/contatoTelefone: input\.contatoTelefone/);
  });

  it("o diálogo manda o telefone junto", () => {
    expect(dialogo).toMatch(/contatoTelefone: contexto\?\.contatoTelefone \|\| undefined/);
  });

  it("o selo aparece mesmo sem cliente cadastrado", () => {
    // Conversa que ainda não virou cliente não tem `contatoId`. Antes o selo
    // (e com ele o telefone) simplesmente não ia — e o compromisso nascia
    // órfão justamente no caso mais comum de lead novo.
    expect(dialogo).toMatch(
      /\(contexto\?\.contatoNome \|\| contexto\?\.contatoTelefone\)\s*&&/,
    );
  });

  it("o Atendimento passa o telefone da conversa", () => {
    const bloco = atendimento.slice(atendimento.indexOf("<NovoCompromissoDialog"));
    const props = bloco.slice(0, bloco.indexOf("/>"));
    expect(props).toMatch(/contatoTelefone: conv\?\.contatoTelefone/);
    // Conversa sem contato salvo ainda tem o número no id externo do WhatsApp.
    expect(props).toMatch(/conv\?\.chatIdExterno\?\.replace\(\/@\.\*\/, ""\)/);
  });

  it("a ficha do cliente também passa o telefone", () => {
    expect(painel).toMatch(/contatoTelefone=\{contato\.telefone \|\| undefined\}/);
    expect(painel).toMatch(/contexto=\{\{ contatoId, contatoNome, contatoTelefone \}\}/);
  });
});

describe("qual aviso o número merece", () => {
  const meu = 7;

  it("sem contato no escritório, o número está livre", () => {
    expect(estadoDoNumero({
      contatoEncontrado: false, conversa: null, soAsMinhas: false, meuColaboradorId: meu,
    })).toBe("livre");
  });

  it("contato cadastrado sem conversa nenhuma", () => {
    expect(estadoDoNumero({
      contatoEncontrado: true, conversa: null, soAsMinhas: false, meuColaboradorId: meu,
    })).toBe("cadastrado");
  });

  it("aguardando e em atendimento contam como conversa aberta", () => {
    for (const status of ["aguardando", "em_atendimento"]) {
      expect(estadoDoNumero({
        contatoEncontrado: true, conversa: { status, atendenteId: meu },
        soAsMinhas: false, meuColaboradorId: meu,
      })).toBe("aberta");
    }
  });

  it("resolvido e fechado contam como encerrada", () => {
    for (const status of ["resolvido", "fechado"]) {
      expect(estadoDoNumero({
        contatoEncontrado: true, conversa: { status, atendenteId: meu },
        soAsMinhas: false, meuColaboradorId: meu,
      })).toBe("encerrada");
    }
  });

  it("quem vê tudo enxerga a conversa mesmo sendo de outro atendente", () => {
    expect(estadoDoNumero({
      contatoEncontrado: true, conversa: { status: "em_atendimento", atendenteId: 99 },
      soAsMinhas: false, meuColaboradorId: meu,
    })).toBe("aberta");
  });

  it("quem só vê as próprias recebe o aviso seco quando a conversa é de outro", () => {
    // Decisão do dono (02/09): avisar que existe, sem mostrar de quem é.
    expect(estadoDoNumero({
      contatoEncontrado: true, conversa: { status: "em_atendimento", atendenteId: 99 },
      soAsMinhas: true, meuColaboradorId: meu,
    })).toBe("sem_acesso");
    // Vale também pra conversa já encerrada de outra pessoa.
    expect(estadoDoNumero({
      contatoEncontrado: true, conversa: { status: "fechado", atendenteId: 99 },
      soAsMinhas: true, meuColaboradorId: meu,
    })).toBe("sem_acesso");
  });

  it("conversa sem atendente não vira 'minha' por descuido", () => {
    // `atendenteId` null casaria com um `meuColaboradorId` null e abriria a
    // conversa de ninguém pra quem só vê as próprias.
    expect(estadoDoNumero({
      contatoEncontrado: true, conversa: { status: "aguardando", atendenteId: null },
      soAsMinhas: true, meuColaboradorId: meu,
    })).toBe("sem_acesso");
    expect(estadoDoNumero({
      contatoEncontrado: true, conversa: { status: "aguardando", atendenteId: null },
      soAsMinhas: true, meuColaboradorId: null,
    })).toBe("sem_acesso");
  });

  it("a conversa é minha: abre normal", () => {
    expect(estadoDoNumero({
      contatoEncontrado: true, conversa: { status: "em_atendimento", atendenteId: meu },
      soAsMinhas: true, meuColaboradorId: meu,
    })).toBe("aberta");
  });
});

describe("a procedure que responde a checagem", () => {
  const router = ler("server/escritorio/router-crm.ts");
  const bloco = router.slice(
    router.indexOf("conversaPorTelefone: protectedProcedure"),
    router.indexOf("arquivarConversa: protectedProcedure"),
  );

  it("é gateada pela mesma permissão do Inbox", () => {
    expect(bloco).toMatch(/checkPermission\(ctx\.user\.id, "atendimento", "ver"\)/);
    expect(bloco).toMatch(/if \(!perm\.allowed\) return \{ estado: "incompleto" as const \}/);
  });

  it("procura o contato com a MESMA função que o envio usa", () => {
    // Se a checagem dissesse "livre" e o envio reaproveitasse um contato que
    // já existe, a tela estaria mentindo no momento em que mais importa.
    expect(bloco).toMatch(/buscarContatoPorTelefone\(perm\.escritorioId, normalizado\)/);
    const envio = router.slice(router.indexOf("iniciarConversa: protectedProcedure"));
    expect(envio.slice(0, envio.indexOf("criarLead:"))).toMatch(/criarOuReutilizarContato/);
  });

  it("a conversa consultada é do escritório e do contato", () => {
    expect(bloco).toMatch(/eq\(conversas\.escritorioId, perm\.escritorioId\)/);
    expect(bloco).toMatch(/eq\(conversas\.contatoId, contato\.id\)/);
  });

  it("pega a conversa MAIS RECENTE", () => {
    // Ordenar ao contrário devolveria o atendimento de dois anos atrás e o
    // aviso mandaria o atendente pra conversa errada.
    expect(bloco).toMatch(/descOrd\(conversas\.ultimaMensagemAt\)/);
    expect(bloco).toMatch(/\.limit\(1\)/);
  });

  it("o aviso seco não vaza nome, conversa nem histórico", () => {
    expect(bloco).toMatch(/if \(estado === "sem_acesso"\) return \{ estado \}/);
  });

  it("número incompleto nem chega a consultar", () => {
    expect(bloco).toMatch(/if \(normalizado\.length < 12\) return \{ estado: "incompleto" as const \}/);
  });
});

describe("a tela de Nova Conversa", () => {
  const atendimento = ler("client/src/pages/Atendimento.tsx");
  const bloco = atendimento.slice(
    atendimento.indexOf("function IniciarConversaDialog({"),
    atendimento.indexOf("function NovoLeadDialog({"),
  );

  it("consulta só com número válido, e atrasada", () => {
    // Sem o atraso sairia uma consulta por tecla digitada.
    expect(bloco).toMatch(/setTimeout\(\(\) => setTelChecagem\(tel\), 350\)/);
    expect(bloco).toMatch(/enabled: open && isValidPhoneBR\(telChecagem\)/);
  });

  it("mostra o aviso e liga o botão de abrir na conversa achada", () => {
    expect(bloco).toMatch(/<AvisoNumeroExistente/);
    expect(bloco).toMatch(/onAbrir=\{\(id\) => \{ onOpenChange\(false\); onSuccess\(id\); \}\}/);
  });

  it("o nome só é preenchido quando está vazio", () => {
    // Quem digitou um nome manda nele — sobrescrever seria roubar o campo.
    expect(bloco).toMatch(/setNome\(\(atual\) => atual \|\| n\)/);
  });

  it("o envio continua o mesmo", () => {
    // A checagem é aviso, não trava: nada aqui pode ter mudado o que é enviado.
    expect(bloco).toMatch(
      /ini\.mutate\(\{ telefone: telDigits, nome: nome \|\| undefined, mensagem: msg, canalId \}\)/,
    );
  });
});

describe("máscara de telefone", () => {
  it("corta o DDI antes de formatar", () => {
    // Contato salvo pelo WhatsApp vem com o 55. Cortar os 11 primeiros dígitos
    // dava "(55) 85997-9657" — um número que não existe, e que ia parar no
    // campo de envio de quem colasse o número internacional.
    expect(mascararTelefoneBR("5585997965706")).toBe("(85) 99796-5706");
    expect(mascararTelefoneBR("+55 85 99796-5706")).toBe("(85) 99796-5706");
  });

  it("o que já funcionava continua igual", () => {
    expect(mascararTelefoneBR("85997965706")).toBe("(85) 99796-5706");
    expect(mascararTelefoneBR("8597965706")).toBe("(85) 9796-5706");
    // O parêntese sem fechar é o comportamento de sempre — o comentário da
    // máscara antiga prometia "(11) ", mas o código nunca fez isso.
    expect(mascararTelefoneBR("11")).toBe("(11");
    expect(mascararTelefoneBR("1199999")).toBe("(11) 9999-9");
    expect(mascararTelefoneBR("")).toBe("");
    expect(mascararTelefoneBR(null)).toBe("");
  });

  it("DDD 55 não é confundido com código do país", () => {
    // 10 dígitos: nada a cortar. Santa Maria (RS) continua existindo.
    expect(mascararTelefoneBR("5599796570")).toBe("(55) 9979-6570");
    expect(chaveTelefoneBR("5599796570")).toBe("5599796570");
  });
});
