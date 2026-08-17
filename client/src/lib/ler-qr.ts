/**
 * Lê o QR de uma imagem, dentro do navegador.
 *
 * A decodificação acontece aqui, na máquina de quem está cadastrando, e não
 * no servidor. Não é preferência de arquitetura: o QR de 2FA carrega o
 * segredo em texto puro, então subir o print seria guardar a chave da conta
 * do advogado dentro de um arquivo de imagem no disco do servidor. O que
 * viaja é o mesmo que viajaria se ele tivesse digitado o código na mão.
 */

import jsQR from "jsqr";
import { lerOtpauth, type LeituraQr } from "@shared/otpauth";

/** Acima disso a imagem é reduzida antes de decodificar. */
const LADO_MAXIMO = 1600;

async function paraBitmap(fonte: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(fonte);
  // Safari antigo não tem createImageBitmap para todos os tipos.
  const url = URL.createObjectURL(fonte);
  try {
    return await new Promise<HTMLImageElement>((ok, erro) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => erro(new Error("imagem inválida"));
      img.src = url;
    });
  } finally {
    // Revoga só depois do onload: revogar antes cancela o carregamento.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/**
 * Tenta achar um QR na imagem e interpretar o conteúdo dele.
 *
 * Faz duas passadas quando a primeira não acha nada: a segunda inverte o
 * preto e o branco. Print de tela em modo escuro sai com o QR invertido, e
 * sem essa passada ele simplesmente "não é lido" sem motivo aparente.
 */
export async function lerQrDeImagem(fonte: Blob): Promise<LeituraQr | { ok: false; motivo: "sem_qr"; detalhe: string }> {
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await paraBitmap(fonte);
  } catch {
    return { ok: false, motivo: "sem_qr", detalhe: "Não consegui abrir essa imagem." };
  }

  const larguraOriginal = "width" in bitmap ? bitmap.width : 0;
  const alturaOriginal = "height" in bitmap ? bitmap.height : 0;
  if (!larguraOriginal || !alturaOriginal) {
    return { ok: false, motivo: "sem_qr", detalhe: "Não consegui abrir essa imagem." };
  }

  const escala = Math.min(1, LADO_MAXIMO / Math.max(larguraOriginal, alturaOriginal));
  const largura = Math.max(1, Math.round(larguraOriginal * escala));
  const altura = Math.max(1, Math.round(alturaOriginal * escala));

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: false, motivo: "sem_qr", detalhe: "Não consegui abrir essa imagem." };

  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, largura, altura);
  const dados = ctx.getImageData(0, 0, largura, altura);

  let achado = jsQR(dados.data, largura, altura, { inversionAttempts: "attemptBoth" });

  if (!achado) {
    // Segunda tentativa com o contraste esticado: print com fundo acinzentado
    // (janela sobreposta, tema escuro) derruba a detecção por pouco.
    const bytes = dados.data;
    for (let i = 0; i < bytes.length; i += 4) {
      const cinza = (bytes[i]! * 299 + bytes[i + 1]! * 587 + bytes[i + 2]! * 114) / 1000;
      const v = cinza > 128 ? 255 : 0;
      bytes[i] = v;
      bytes[i + 1] = v;
      bytes[i + 2] = v;
    }
    achado = jsQR(bytes, largura, altura, { inversionAttempts: "attemptBoth" });
  }

  if (!achado?.data) {
    return {
      ok: false,
      motivo: "sem_qr",
      detalhe: "Não achei nenhum QR nessa imagem.",
    };
  }

  return lerOtpauth(achado.data);
}
