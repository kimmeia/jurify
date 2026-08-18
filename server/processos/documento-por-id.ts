/**
 * Baixar o documento a partir do id que veio no rótulo.
 *
 * O caminho normal é seguir o link da timeline. No PJe esse link é
 * `javascript:void(0)` — JSF dispara AJAX e não existe href pra baixar. O que
 * sobra é o id que o próprio rótulo escreve ("… 226277277 - Despacho"), e a
 * pergunta vira: qual URL desse tribunal serve o documento por id?
 *
 * NÃO EXISTE UMA SÓ. O PJe teve várias gerações de rota, e instalações
 * diferentes expõem caminhos diferentes. Em vez de fingir que sei qual é a do
 * TJCE, este módulo tenta uma lista curta, na ordem, e devolve junto QUAL
 * funcionou — é o dado que falta pra fixar a rota certa depois da primeira
 * execução real contra o tribunal.
 *
 * O custo de errar é uma requisição extra por candidato, só no caminho sob
 * demanda (o usuário clicou "ler documento"). O cron não passa por aqui.
 */

import { createLogger } from "../_core/logger";

const log = createLogger("documento-por-id");

/**
 * Candidatas em ordem de probabilidade. Todas são caminhos de LEITURA de um
 * documento já existente — nenhuma cria, altera ou apaga nada no tribunal.
 */
export function urlsCandidatasDocumento(urlBusca: string, idDocumento: string): string[] {
  let base: URL;
  try {
    base = new URL(urlBusca);
  } catch {
    return [];
  }
  // `urlBusca` aponta pra tela de consulta ("…/pje1grau/Processo/Consulta…").
  // O prefixo da instalação é o primeiro segmento do path (`pje1grau`).
  const instalacao = base.pathname.split("/").filter(Boolean)[0] ?? "";
  const raiz = `${base.origin}${instalacao ? `/${instalacao}` : ""}`;
  const id = encodeURIComponent(idDocumento);

  return [
    `${raiz}/Processo/ConsultaDocumento/listView.seam?idProcessoDocumento=${id}`,
    `${raiz}/documentos/download/${id}`,
    `${raiz}/Processo/ConsultaProcesso/Detalhe/documentoSemLoginHTML.seam?idProcessoDocumento=${id}`,
    `${raiz}/Processo/downloadDocumento.seam?idProcessoDocumento=${id}`,
  ];
}

export type ResultadoDocumentoPorId =
  | { ok: true; texto: string; urlQueFuncionou: string }
  | { ok: false; erro: string; tentadas: number };

/**
 * Tenta as candidatas até uma devolver documento legível.
 *
 * `baixar` é injetado pra este módulo não depender do Playwright — o caller
 * passa `baixarDocumentoAvulso`, e o teste passa um dublê.
 */
export async function baixarDocumentoPorId(
  urlBusca: string,
  idDocumento: string,
  baixar: (url: string) => Promise<{ ok: true; texto: string } | { ok: false; erro: string }>,
): Promise<ResultadoDocumentoPorId> {
  const candidatas = urlsCandidatasDocumento(urlBusca, idDocumento);
  if (candidatas.length === 0) {
    return { ok: false, erro: "não foi possível montar a URL do tribunal", tentadas: 0 };
  }

  const erros: string[] = [];
  for (const url of candidatas) {
    const r = await baixar(url);
    if (r.ok) {
      // Texto vazio é o tribunal devolvendo uma página de erro com HTTP 200 —
      // acontece, e aceitar isso gravaria um teor em branco como sucesso.
      if (r.texto.trim().length < 40) {
        erros.push("resposta sem texto");
        continue;
      }
      log.info({ idDocumento, url }, "[documento-por-id] rota que funcionou");
      return { ok: true, texto: r.texto, urlQueFuncionou: url };
    }
    erros.push(r.erro);
  }

  log.warn({ idDocumento, erros }, "[documento-por-id] nenhuma rota serviu");
  return {
    ok: false,
    // A mensagem vai pra tela: quem lê precisa entender que o documento existe
    // e o que falhou foi o caminho até ele.
    erro: `O documento ${idDocumento} existe no tribunal, mas nenhuma das ${candidatas.length} rotas conhecidas o entregou (${erros[0] ?? "sem detalhe"}).`,
    tentadas: candidatas.length,
  };
}
