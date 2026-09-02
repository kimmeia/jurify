/**
 * A conversa aberta responde por si — não depende da lista do Inbox.
 *
 * O aviso de número repetido levava à conversa certa, mas o cabeçalho chegava
 * "Contato · Sem atendente" com o cliente vinculado o tempo todo. Causa: os
 * dados do contato eram lidos do array já carregado do Inbox, que é filtrado
 * por período — conversa de 13 dias simplesmente não está lá.
 *
 * O mesmo defeito estava no clique do telefone vindo da Agenda, e ali com
 * consequência de verdade: sem achar a conversa antiga na lista, a tela
 * concluía que ela não existia e oferecia CRIAR OUTRA. O caminho que existe
 * pra evitar conversa duplicada estava produzindo uma.
 *
 * Estes testes travam as três pontas: a consulta por id acha a conversa onde
 * ela estiver, as duas telas perguntam ao servidor antes de decidir, e a
 * permissão de quem só vê os próprios atendimentos continua valendo.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

function ler(rel: string) {
  return fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf-8");
}

describe("consulta por id acha a conversa onde ela estiver", () => {
  const db = ler("server/escritorio/db-crm.ts");
  const cond = db.slice(
    db.indexOf("async function condicoesConversa"),
    db.indexOf("export async function listarConversas"),
  );

  it("id passado vira filtro de conversa", () => {
    expect(cond).toMatch(/const porId = filtros\?\.ids && filtros\.ids\.length > 0/);
    expect(cond).toMatch(/inArray\(conversas\.id, filtros!\.ids!\)/);
  });

  it("por id, a pasta Arquivadas deixa de excluir", () => {
    // Conversa arquivada aberta por link continuava existindo — só não podia
    // ser encontrada, e a tela ficava sem os dados do contato.
    expect(cond).toMatch(/if \(porId\) \{[\s\S]*?\} else if \(filtros\?\.arquivadas\)/);
  });

  it("por id, o período não se aplica", () => {
    // É o coração do defeito: quem tem o id está apontando pra conversa, e o
    // recorte de datas do Inbox não pode escondê-la.
    expect(cond).toMatch(/const inicio = !porId && filtros\?\.dataInicio/);
    expect(cond).toMatch(/const fim = !porId && filtros\?\.dataFim/);
  });
});

describe("as procedures novas", () => {
  const router = ler("server/escritorio/router-crm.ts");
  const porId = router.slice(
    router.indexOf("conversaPorId: protectedProcedure"),
    router.indexOf("conversaDoContato: protectedProcedure"),
  );
  const doContato = router.slice(
    router.indexOf("conversaDoContato: protectedProcedure"),
    router.indexOf("arquivarConversa: protectedProcedure"),
  );

  it("conversaPorId é gateada e devolve o mesmo formato da lista", () => {
    expect(porId).toMatch(/checkPermission\(ctx\.user\.id, "atendimento", "ver"\)/);
    expect(porId).toMatch(/if \(!perm\.allowed\) return null/);
    // Reusa listarConversas: o cabeçalho precisa dos MESMOS campos (canal,
    // status do canal, opt-out, atendente) que a lista já entrega.
    expect(porId).toMatch(/listarConversas\(perm\.escritorioId, filtros\)/);
    expect(porId).toMatch(/ids: \[input\.id\]/);
  });

  it("ter o id não fura o verProprios", () => {
    expect(porId).toMatch(
      /if \(!perm\.verTodos && perm\.verProprios\) filtros\.atendenteId = perm\.colaboradorId/,
    );
    expect(doContato).toMatch(
      /if \(!perm\.verTodos && perm\.verProprios\) filtros\.atendenteId = perm\.colaboradorId/,
    );
  });

  it("conversaDoContato pega a mais recente, dentro do escritório", () => {
    expect(doContato).toMatch(/eq\(conversas\.escritorioId, perm\.escritorioId\)/);
    expect(doContato).toMatch(/eq\(conversas\.contatoId, input\.contatoId\)/);
    expect(doContato).toMatch(/descOrd\(conversas\.ultimaMensagemAt\)/);
    expect(doContato).toMatch(/\.limit\(1\)/);
  });
});

describe("a conversa aberta na tela", () => {
  const tela = ler("client/src/pages/Atendimento.tsx");

  it("busca os próprios dados quando não está na lista", () => {
    expect(tela).toMatch(/trpc\.crm\.conversaPorId\.useQuery\(/);
    expect(tela).toMatch(/enabled: !!cid && !convEncontrada/);
  });

  it("a lista ainda tem prioridade — sem consulta extra no caso comum", () => {
    // A conversa que já está na lista continua vindo de lá: a consulta nova é
    // exceção, não o caminho de todo dia.
    expect(tela).toMatch(/const conv = convEncontrada\s*\n\s*\?\?/);
  });

  it("o cache antigo continua como última reserva", () => {
    // Nada foi removido: o cache cobre a conversa que sai do array ao mudar
    // de status, que é outro caso e continua valendo.
    expect(tela).toMatch(/\?\? \(convCacheRef\.current\?\.id === cid \? convCacheRef\.current : undefined\)/);
  });

  it("avisa que está fora do filtro, com saída", () => {
    expect(tela).toMatch(/const foraDoFiltro = !!conv && !convEncontrada/);
    expect(tela).toMatch(/\{foraDoFiltro && \(/);
    expect(tela).toMatch(/Mostrar na lista/);
  });

  it("Mostrar na lista usa a busca por número", () => {
    // A busca é a única vista que varre tudo (período, status e arquivadas).
    const bloco = tela.slice(tela.indexOf("onMostrarNaLista={(tel) =>"));
    expect(bloco.slice(0, 500)).toMatch(/setInboxBusca\(tel\)/);
  });
});

describe("os links da Agenda não oferecem mais criar conversa que já existe", () => {
  const tela = ler("client/src/pages/Atendimento.tsx");
  const porTelefone = tela.slice(
    tela.indexOf('const checagemUrl = trpc.crm.conversaPorTelefone.useQuery('),
    tela.indexOf("const convDoContatoUrl"),
  );
  const porContato = tela.slice(
    tela.indexOf("const convDoContatoUrl"),
    tela.indexOf("const goToConversaFromLead"),
  );

  it("o link por telefone pergunta ao servidor", () => {
    expect(porTelefone).toMatch(/trpc\.crm\.conversaPorTelefone\.useQuery/);
    expect(porTelefone).toMatch(/const idAchado = naLista\?\.id \?\? doServidor\?\.conversaId/);
  });

  it("espera a resposta antes de decidir", () => {
    // Sem isso a decisão sai no primeiro render, quando a lista é o único
    // dado disponível — e o defeito volta inteiro.
    expect(porTelefone).toMatch(/if \(!naLista && checagemUrl\.isLoading\) return/);
    expect(porContato).toMatch(/if \(!naLista && convDoContatoUrl\.isLoading\) return/);
  });

  it("conversa de outro atendente não vira conversa nova", () => {
    expect(porTelefone).toMatch(/doServidor\?\.estado === "sem_acesso"/);
  });

  it("o link por contato também pergunta ao servidor", () => {
    expect(porContato).toMatch(/trpc\.crm\.conversaDoContato\.useQuery/);
    expect(porContato).toMatch(/const conv = naLista \?\? \(convDoContatoUrl\.data as any\)/);
  });

  it("criar conversa continua existindo pra quem realmente não tem nenhuma", () => {
    expect(porTelefone).toMatch(/setPreencherConversa\(\{ telefone: telefoneUrl \}\)/);
    expect(porTelefone).toMatch(/setShowIniciar\(true\)/);
  });
});
