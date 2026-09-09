/**
 * Quem ATENDE a conversa pode operar o cadastro do contato.
 *
 * O contato que nasce do WhatsApp nasce sem responsável, e a distribuição
 * automática não preenche esse campo DE PROPÓSITO — `contatos.responsavelId`
 * também governa a "stickiness" do atendimento (conversa nova de cliente com
 * responsável nasce direto com ele e não passa pelo rodízio), então preencher
 * ali grudaria o cliente no primeiro atendente. O efeito colateral era o
 * atendente ficar trancado do lado de fora do cadastro de quem ele está
 * atendendo.
 *
 * Decisão do dono (02/09): liberar o CADASTRO para quem atende — ver, editar
 * e transformar em cliente. É acesso, não posse: nada é gravado, o
 * responsável do cadastro segue como está e a comissão (que vive na cobrança,
 * congelada) não é tocada.
 *
 * O que estes testes travam:
 *  1. os quatro pontos liberados e o formato do gate (é um OU, nunca troca a
 *     regra que já existia);
 *  2. o portão COMPARTILHADO `ehResponsavelPeloContato` intacto — ele gateia
 *     17 procedures, várias destrutivas (apagar arquivo, apagar pasta,
 *     excluir cliente). Liberar por lá teria dado poder de apagar a quem só
 *     precisava enxergar;
 *  3. a consulta presa a escritório + contato + atendente;
 *  4. que a mudança não vazou para excluir cliente e para os arquivos.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../escritorio/router-clientes.ts"),
  "utf-8",
);

/** Corpo de uma procedure, do nome dela até a próxima. */
function procedure(nome: string): string {
  const ini = SRC.indexOf(`  ${nome}: protectedProcedure`);
  expect(ini, `procedure ${nome} não encontrada`).toBeGreaterThan(-1);
  const resto = SRC.slice(ini + 10);
  const prox = resto.search(/\n {2}[a-zA-Z]+: protectedProcedure/);
  return prox === -1 ? resto : resto.slice(0, prox);
}

describe("a consulta que reconhece quem atende", () => {
  const helper = SRC.slice(
    SRC.indexOf("async function atendeConversaDoContato"),
    SRC.indexOf("/** Ids de contato que são \"meus\" por lead"),
  );

  it("casa contato, escritório E atendente — os três", () => {
    // Faltando o escritório, o id de contato de outra empresa passaria.
    expect(helper).toMatch(/eq\(conversas\.contatoId, contatoId\)/);
    expect(helper).toMatch(/eq\(conversas\.escritorioId, escritorioId\)/);
    // Faltando o atendente, QUALQUER conversa do contato liberaria o cadastro
    // pra qualquer pessoa do escritório — o gate viraria enfeite.
    expect(helper).toMatch(/eq\(conversas\.atendenteId, colabId\)/);
  });

  it("é só leitura — não grava nada", () => {
    // O ponto da decisão: conceder acesso sem virar dono. Um update aqui
    // mexeria em stickiness do rodízio e no padrão de comissão.
    expect(helper).not.toMatch(/\.update\(|\.insert\(|\.set\(/);
  });
});

describe("os quatro pontos liberados", () => {
  it("ver a ficha", () => {
    const p = procedure("detalhe");
    expect(p).toMatch(
      /!\(await ehResponsavelPeloContato\([^)]*\)\) &&\s*\n\s*!\(await atendeConversaDoContato\(/,
    );
  });

  it("editar o cadastro", () => {
    const p = procedure("atualizar");
    expect(p).toMatch(/const podeEditar =/);
    expect(p).toMatch(/\(await atendeConversaDoContato\(db, input\.id, perm\.escritorioId, perm\.colaboradorId\)\)/);
  });

  it("transformar em cliente pelo registrar fechamento", () => {
    // Era um impasse: registrar é o que criaria o lead que daria o acesso.
    const p = procedure("registrarFechamento");
    expect(p).toMatch(/const podeFechar =/);
    expect(p).toMatch(/\(await atendeConversaDoContato\(/);
  });

  it("transformar em cliente pelo selo do cadastro", () => {
    const p = procedure("definirEstagio");
    expect(p).toMatch(/podeVerCliente\([^)]*\)\) \|\|\s*\n\s*\(await atendeConversaDoContato\(/);
  });

  it("cada um é um OU — a regra antiga continua valendo sozinha", () => {
    // Trocar (em vez de somar) tiraria o acesso de quem é responsável pelo
    // cadastro e não atende conversa nenhuma — o caso mais comum de todos.
    for (const nome of ["atualizar", "registrarFechamento"]) {
      const p = procedure(nome);
      expect(p).toMatch(/perm\.verTodos \|\|/);
      expect(p).toMatch(/responsavelId === perm\.colaboradorId \|\|/);
    }
  });
});

describe("o que continua fechado", () => {
  it("o portão compartilhado não foi tocado", () => {
    // `ehResponsavelPeloContato` alimenta `podeVerCliente`, que gateia as
    // procedures destrutivas. Mexer nele teria liberado tudo de uma vez.
    const gate = SRC.slice(
      SRC.indexOf("async function ehResponsavelPeloContato"),
      SRC.indexOf("async function atendeConversaDoContato"),
    );
    expect(gate).not.toMatch(/atendeConversaDoContato|conversas\./);
  });

  it("excluir cliente continua só de quem é responsável", () => {
    const p = procedure("excluir");
    expect(p).not.toMatch(/atendeConversaDoContato/);
  });

  it("arquivos e pastas não foram liberados", () => {
    for (const nome of ["salvarArquivo", "excluirArquivo", "excluirPasta", "listarArquivos"]) {
      expect(procedure(nome)).not.toMatch(/atendeConversaDoContato/);
    }
  });

  it("a liberação não escapou pra fora dos quatro pontos", () => {
    const usos = SRC.match(/await atendeConversaDoContato\(/g) ?? [];
    expect(usos.length).toBe(4);
  });

  it("trocar o responsável do cadastro continua sendo só de quem vê tudo", () => {
    // O atendente edita o cadastro, mas não se autodeclara dono do cliente —
    // é o que impede a liberação de acesso de virar redistribuição de
    // comissão pela porta dos fundos.
    expect(procedure("atualizar")).toMatch(
      /if \(d\.responsavelId !== undefined && perm\.verTodos\)/,
    );
  });
});
