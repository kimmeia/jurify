/**
 * A opção de ler o 2FA do print do QR.
 *
 * O pedido foi explícito: adicionar sem substituir. Quem digita o base32
 * continua digitando — o print falha com frequência (recorte cortado, foto do
 * monitor, imagem redimensionada) e sem a saída manual a pessoa fica sem
 * caminho nenhum.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const tela = ler("client/src/pages/Processos.tsx");
const leitor = ler("client/src/components/LeitorQr.tsx");
const lerQr = ler("client/src/lib/ler-qr.ts");
const pkg = JSON.parse(ler("package.json"));

describe("as duas portas", () => {
  it("o campo de digitar o código continua inteiro", () => {
    expect(tela).toContain('modo2fa === "codigo"');
    expect(tela).toContain("Cole o secret base32 do app autenticador");
  });

  it("as duas escrevem no MESMO campo do formulário", () => {
    // Se o QR gravasse noutro lugar, o cadastro mandaria o secret vazio e a
    // credencial nasceria sem 2FA sem ninguém perceber.
    expect(tela).toContain("setForm((f) => ({ ...f, totpSecret: r.secret }))");
  });

  it("fechar o diálogo limpa o QR lido", () => {
    // O código é de uma conta específica: reaproveitá-lo no cadastro seguinte
    // gravaria o 2FA de um advogado no login de outro.
    expect(tela).toContain("setQrLido(null)");
    expect(tela).toContain('setModo2fa("codigo")');
  });
});

describe("a imagem não sai do navegador", () => {
  it("a decodificação é no cliente, com a lib no bundle", () => {
    // O QR carrega o segredo em texto puro. Subir o print seria guardar a
    // chave da conta do advogado num arquivo de imagem no servidor.
    expect(pkg.dependencies).toHaveProperty("jsqr");
    expect(lerQr).toContain('import jsQR from "jsqr"');
  });

  it("nenhum upload é feito pelo leitor", () => {
    expect(leitor).not.toMatch(/fetch\(|FormData|useMutation/);
    expect(lerQr).not.toMatch(/fetch\(|FormData/);
  });

  it("a tela diz isso pra quem está usando", () => {
    expect(leitor).toContain("A imagem não sai do seu navegador");
  });
});

describe("robustez da leitura", () => {
  it("tenta as duas inversões, pro print de tema escuro", () => {
    expect(lerQr).toContain('inversionAttempts: "attemptBoth"');
  });

  it("tem segunda passada com contraste esticado", () => {
    // Print com fundo acinzentado derruba a detecção por pouco.
    expect(lerQr).toContain("cinza > 128 ? 255 : 0");
  });

  it("reduz imagem grande antes de decodificar", () => {
    expect(lerQr).toContain("LADO_MAXIMO");
  });

  it("Ctrl+V funciona sem precisar clicar antes na área", () => {
    // Exigir foco na div é um passo invisível que ninguém adivinha.
    expect(leitor).toContain('window.addEventListener("paste"');
  });

  it("a falha explica a saída manual", () => {
    expect(leitor).toContain("Colar o código");
  });
});
