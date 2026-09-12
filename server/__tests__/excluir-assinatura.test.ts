/**
 * Excluir documento de assinatura, inclusive o já assinado.
 *
 * A lixeira da aba Documentos só era desenhada enquanto o documento não
 * estava assinado — documento assinado não tinha como sair da lista. Ela
 * passa a aparecer em todos os estados, com três decisões do dono (12/09):
 *
 *  1. excluir apaga TAMBÉM os arquivos do servidor (PDF original, PDF
 *     carimbado e o desenho da assinatura). "Excluir" que deixa o arquivo
 *     no disco não é exclusão, e o dado do cliente continua lá;
 *  2. documento ASSINADO só pode ser excluído pelo atendente daquele cliente
 *     ou por quem coordena o escritório. Documento não assinado segue como
 *     sempre: qualquer colaborador exclui;
 *  3. nada de "arquivar" — o documento já fica guardado em Documentos.
 *
 * Como a exclusão apaga a prova, o que aconteceu só existe depois na
 * auditoria: por isso ela entra no mesmo caminho.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");

const ROUTER = "server/escritorio/router-assinaturas.ts";
const TELA = "client/src/pages/clientes/detail-tabs.tsx";

function trechoExcluir(): string {
  const fonte = ler(ROUTER);
  const inicio = fonte.indexOf("  excluir: protectedProcedure");
  expect(inicio, "a procedure `excluir` sumiu do router").toBeGreaterThan(0);
  const fim = fonte.indexOf("  salvarCampos:", inicio);
  return fonte.slice(inicio, fim > inicio ? fim : undefined);
}

describe("quem pode excluir", () => {
  const trecho = trechoExcluir();

  it("documento assinado exige atendente do cliente ou quem vê tudo", () => {
    expect(trecho).toContain('if (assinatura.status === "assinado")');
    expect(trecho).toContain('checkPermission(ctx.user.id, "clientes", "ver")');
    // O cliente conferido é o DO DOCUMENTO — `contatoId` também aparece na
    // auditoria logo abaixo, então a amarra olha a chamada.
    expect(trecho).toMatch(/podeVerCliente\(\s*\n\s*db,\s*\n\s*assinatura\.contatoId,/);
    expect(trecho).toContain("perm.verTodos");
    expect(trecho).toContain('code: "FORBIDDEN"');
  });

  it("a permissão é conferida no escritório de quem pediu", () => {
    expect(trecho).toContain("perm.escritorioId === esc.escritorio.id");
    // A consulta que carrega a assinatura continua escopada.
    expect(trecho).toContain("eq(assinaturasDigitais.escritorioId, esc.escritorio.id)");
  });

  it("documento NÃO assinado continua sem trava de cargo", () => {
    // A trava está dentro do `if` de assinado: fora dele, nada de permissão.
    const antesDoIf = trecho.slice(0, trecho.indexOf('if (assinatura.status === "assinado")'));
    expect(antesDoIf).not.toContain("checkPermission");
    expect(antesDoIf).not.toContain("podeVerCliente");
  });

  it("`podeVerCliente` é a mesma função que decide quem enxerga a ficha", () => {
    expect(ler("server/escritorio/router-clientes.ts")).toContain(
      "export async function podeVerCliente(",
    );
    expect(ler(ROUTER)).toContain('import { podeVerCliente } from "./router-clientes"');
  });
});

describe("excluir apaga os arquivos do servidor", () => {
  const trecho = trechoExcluir();

  it("os três arquivos entram na lista", () => {
    expect(trecho).toContain("assinatura.documentoUrl");
    expect(trecho).toContain("assinatura.documentoAssinadoUrl");
    expect(trecho).toContain("assinatura.assinaturaImagemUrl");
    expect(trecho).toContain("fs.unlinkSync(");
  });

  it("só apaga caminho nosso — link externo não é nosso para apagar", () => {
    expect(trecho).toContain("caminhoInterno(url)");
    expect(trecho).toContain("if (!interno) continue;");
  });

  it("arquivo preso não impede a exclusão do registro", () => {
    const iCatch = trecho.indexOf("Não deu para apagar arquivo da assinatura");
    const iDelete = trecho.indexOf("db.delete(assinaturasDigitais)");
    expect(iCatch).toBeGreaterThan(0);
    expect(iDelete).toBeGreaterThan(iCatch);
  });

  it("os campos posicionais continuam saindo junto", () => {
    expect(trecho).toContain("db.delete(assinaturaCampos)");
  });
});

describe("fica registrado quem excluiu", () => {
  const trecho = trechoExcluir();

  it("a auditoria guarda o que o documento era", () => {
    expect(trecho).toContain('acao: "assinatura.excluir"');
    expect(trecho).toContain("alvoNome: assinatura.titulo");
    expect(trecho).toContain("assinanteNome:");
    expect(trecho).toContain("arquivosApagados:");
  });

  it("registra DEPOIS de apagar, com o que foi lido antes", () => {
    expect(trecho.indexOf("registrarAuditoria(")).toBeGreaterThan(
      trecho.indexOf("db.delete(assinaturasDigitais)"),
    );
  });
});

describe("a tela", () => {
  const tela = ler(TELA);

  it("a lixeira aparece em qualquer estado", () => {
    expect(tela).not.toContain('{a.status !== "assinado" && <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive"');
    expect(tela).toContain('title="Excluir documento"');
  });

  it("o alvo leva o que a confirmação precisa dizer", () => {
    expect(tela).toContain('assinado: a.status === "assinado"');
    expect(tela).toContain("assinante: a.assinantNome || null");
    expect(tela).toContain("assinadoAt: a.assinadoAt || null");
  });

  it("documento assinado abre a confirmação forte", () => {
    expect(tela).toContain("Excluir um documento assinado?");
    expect(tela).toContain("O que some para sempre");
    expect(tela).toContain("O desenho da assinatura");
    expect(tela).toContain("apagados do servidor");
    expect(tela).toContain("Excluir definitivamente");
  });

  it("sem o aceite, o botão não exclui", () => {
    expect(tela).toContain("checked={aceitouPerder}");
    expect(tela).toContain("if (excluirAssinAlvo?.assinado && !aceitouPerder)");
    expect(tela).toContain("e.preventDefault();");
    expect(tela).toContain("disabled={excluirMut.isPending || (!!excluirAssinAlvo?.assinado && !aceitouPerder)}");
  });

  it("o aceite zera a cada abertura — não fica marcado do documento anterior", () => {
    expect(tela).toMatch(/setAceitouPerder\(false\);\s*\n\s*setExcluirAssinAlvo\(\{/);
  });

  it("documento não assinado continua com o texto curto de antes", () => {
    expect(tela).toContain("será removido permanentemente");
    expect(tela).toContain("o link parará de funcionar");
  });
});
