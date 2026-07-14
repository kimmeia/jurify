/**
 * Resolve o mimetype do áudio a partir do path do arquivo. WhatsApp respeita
 * o mimetype declarado pra escolher o decoder — mandar "audio/mpeg" pra um
 * .webm faz o app do cliente rejeitar/quebrar o player.
 */
export function detectarMimetypeAudio(mediaUrl: string): string {
  const ext = mediaUrl.toLowerCase().split("?")[0].split("#")[0].split(".").pop() || "";
  switch (ext) {
    case "webm": return "audio/webm; codecs=opus";
    case "ogg":
    case "oga": return "audio/ogg; codecs=opus";
    case "mp4":
    case "m4a": return "audio/mp4";
    case "aac": return "audio/aac";
    case "wav": return "audio/wav";
    default: return "audio/mpeg";
  }
}
