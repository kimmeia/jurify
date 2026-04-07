declare module "qrcode" {
  export interface QRCodeToDataURLOptions {
    type?: "image/png" | "image/jpeg" | "image/webp";
    width?: number;
    margin?: number;
    color?: { dark?: string; light?: string };
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    scale?: number;
  }

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;

  export function toString(
    text: string,
    options?: { type?: "terminal" | "svg" | "utf8" } & QRCodeToDataURLOptions,
  ): Promise<string>;

  export function toBuffer(
    text: string,
    options?: QRCodeToDataURLOptions,
  ): Promise<Buffer>;

  const _default: {
    toDataURL: typeof toDataURL;
    toString: typeof toString;
    toBuffer: typeof toBuffer;
  };
  export default _default;
}
