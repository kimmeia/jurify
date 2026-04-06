/**
 * WhatsApp Baileys — Gerenciador de Sessões
 * Etapa 3: Conexão WhatsApp via QR Code usando @whiskeysockets/baileys
 *
 * Cada canal do tipo "whatsapp_qr" tem uma sessão Baileys associada.
 * Sessões são armazenadas em memória e reconectam automaticamente.
 *
 * NOTA: Este módulo usa importação dinâmica do Baileys para não quebrar
 * o build caso a dependência não esteja instalada.
 */

import { EventEmitter } from "events";
import path from "path";
import fs from "fs";
import type {
  WhatsappSessionStatus,
  WhatsappSessionInfo,
  WhatsappMensagemRecebida,
  WhatsappMensagemEnviar,
} from "../../shared/whatsapp-types";
import { jidToPhone } from "../../shared/whatsapp-types";

// ─── Tipos internos ────────────────────────────────────────────────────────

interface SessionState {
  canalId: number;
  escritorioId: number;
  status: WhatsappSessionStatus;
  qrCode?: string;
  socket?: any; // WASocket
  store?: any;
  telefone?: string;
  nomeDispositivo?: string;
  mensagemErro?: string;
  connectedAt?: Date;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

type MensagemCallback = (canalId: number, escritorioId: number, msg: WhatsappMensagemRecebida) => void | Promise<void>;
type StatusCallback = (canalId: number, status: WhatsappSessionStatus, extra?: Record<string, unknown>) => void | Promise<void>;

// ─── Singleton Manager ──────────────────────────────────────────────────────

class WhatsappSessionManager extends EventEmitter {
  private sessions = new Map<number, SessionState>();
  private authDir: string;
  private onMensagem?: MensagemCallback;
  private onStatusChange?: StatusCallback;
  private baileysModule: any = null;

  constructor() {
    super();
    this.authDir = path.join(process.cwd(), ".whatsapp-sessions");
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  /** Registra callback para mensagens recebidas */
  setOnMensagem(cb: MensagemCallback) {
    this.onMensagem = cb;
  }

  /** Registra callback para mudanças de status */
  setOnStatusChange(cb: StatusCallback) {
    this.onStatusChange = cb;
  }

  /** Carrega o módulo Baileys dinamicamente */
  private async loadBaileys() {
    if (this.baileysModule) return this.baileysModule;
    try {
      this.baileysModule = await import("@whiskeysockets/baileys");
      return this.baileysModule;
    } catch (err) {
      console.error("[WhatsApp] @whiskeysockets/baileys não instalado. Execute: npm install @whiskeysockets/baileys");
      throw new Error("Baileys não disponível. Instale @whiskeysockets/baileys.");
    }
  }

  // ─── API Pública ──────────────────────────────────────────────────────────

  /** Inicia sessão para um canal whatsapp_qr */
  async iniciarSessao(canalId: number, escritorioId: number): Promise<WhatsappSessionInfo> {
    // Se já existe, retorna status atual
    const existing = this.sessions.get(canalId);
    if (existing && existing.status === "conectado") {
      return this.getSessionInfo(canalId);
    }

    // Criar estado
    const state: SessionState = {
      canalId,
      escritorioId,
      status: "conectando",
      reconnectAttempts: 0,
      maxReconnectAttempts: 15,
    };
    this.sessions.set(canalId, state);
    this.emitStatus(canalId, "conectando");

    try {
      await this.connect(state);
    } catch (err: any) {
      state.status = "erro";
      state.mensagemErro = err.message;
      this.emitStatus(canalId, "erro", { error: err.message });
    }

    return this.getSessionInfo(canalId);
  }

  /** Desconecta e remove sessão */
  async desconectarSessao(canalId: number): Promise<void> {
    const state = this.sessions.get(canalId);
    if (!state) return;

    this.stopKeepalive(state);

    try {
      if (state.socket) {
        await state.socket.logout?.();
        state.socket.end?.(undefined);
      }
    } catch {
      // Ignorar erros ao desconectar
    }

    state.status = "desconectado";
    state.qrCode = undefined;
    state.socket = undefined;
    this.sessions.delete(canalId);
    this.emitStatus(canalId, "desconectado");

    // Limpar pasta de auth
    const authPath = this.getAuthPath(canalId);
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
  }

  /** Obtém info da sessão */
  async getSessionInfo(canalId: number): Promise<WhatsappSessionInfo> {
    const state = this.sessions.get(canalId);
    if (!state) {
      return {
        canalId,
        status: "desconectado",
      };
    }

    // Converter QR string para data URL (imagem PNG base64)
    let qrDataUrl: string | undefined;
    if (state.qrCode) {
      try {
        const QRCode = await import("qrcode");
        qrDataUrl = await QRCode.toDataURL(state.qrCode, {
          width: 256,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        });
      } catch {
        // Se qrcode não disponível, enviar raw string
        qrDataUrl = state.qrCode;
      }
    }

    return {
      canalId,
      status: state.status,
      qrCode: qrDataUrl,
      telefone: state.telefone,
      nomeDispositivo: state.nomeDispositivo,
      mensagemErro: state.mensagemErro,
      uptime: state.connectedAt
        ? Math.floor((Date.now() - state.connectedAt.getTime()) / 1000)
        : undefined,
    };
  }

  /** Verifica se sessão está conectada */
  isConectado(canalId: number): boolean {
    const state = this.sessions.get(canalId);
    return state?.status === "conectado";
  }

  /** Envia mensagem de texto via Baileys */
  async enviarMensagem(canalId: number, msg: WhatsappMensagemEnviar): Promise<{ messageId: string } | null> {
    const jid = `${msg.telefone.replace(/\D/g, "")}@s.whatsapp.net`;
    return this.enviarMensagemJid(canalId, jid, msg.conteudo, msg.tipo, msg.mediaUrl, msg.mediaCaption);
  }

  /** Envia mensagem usando JID direto (chatIdExterno) ou número de telefone */
  async enviarMensagemJid(
    canalId: number,
    destinatario: string,
    conteudo: string,
    tipo?: string,
    mediaUrl?: string,
    mediaCaption?: string,
  ): Promise<{ messageId: string } | null> {
    const state = this.sessions.get(canalId);
    if (!state || state.status !== "conectado" || !state.socket) {
      throw new Error("Sessão WhatsApp não conectada.");
    }

    // Se o destinatário já contém @, usar como JID direto
    // Senão, converter para JID padrão
    let jid: string;
    if (destinatario.includes("@")) {
      jid = destinatario;
    } else {
      jid = `${destinatario.replace(/\D/g, "")}@s.whatsapp.net`;
    }

    console.log(`[WhatsApp] Enviando para JID: ${jid}`);

    try {
      let sent: any;

      if (!tipo || tipo === "texto") {
        sent = await state.socket.sendMessage(jid, { text: conteudo });
      } else if (tipo === "imagem" && mediaUrl) {
        sent = await state.socket.sendMessage(jid, {
          image: { url: mediaUrl },
          caption: mediaCaption || conteudo || "",
        });
      } else if (tipo === "documento" && mediaUrl) {
        sent = await state.socket.sendMessage(jid, {
          document: { url: mediaUrl },
          caption: mediaCaption || conteudo || "",
        });
      } else if (tipo === "audio" && mediaUrl) {
        sent = await state.socket.sendMessage(jid, {
          audio: { url: mediaUrl },
          mimetype: "audio/mpeg",
        });
      } else {
        sent = await state.socket.sendMessage(jid, { text: conteudo });
      }

      console.log(`[WhatsApp] Mensagem enviada com sucesso para ${jid}, id=${sent?.key?.id}`);
      return { messageId: sent?.key?.id || "" };
    } catch (err: any) {
      console.error(`[WhatsApp] Erro ao enviar msg para ${jid}:`, err.message);
      throw new Error(`Falha ao enviar mensagem: ${err.message}`);
    }
  }

  /** Lista todas as sessões ativas */
  listarSessoes(): WhatsappSessionInfo[] {
    return Array.from(this.sessions.keys()).map((id) => this.getSessionInfo(id));
  }

  /**
   * Restaura sessões que têm auth salvo no filesystem.
   * Chamado ao iniciar o servidor para reconectar canais que já estavam conectados.
   */
  async restaurarSessoesSalvas(canais: { canalId: number; escritorioId: number }[]) {
    for (const { canalId, escritorioId } of canais) {
      const authPath = this.getAuthPath(canalId);
      if (fs.existsSync(authPath) && fs.existsSync(path.join(authPath, "creds.json"))) {
        console.log(`[WhatsApp] Restaurando sessão canal ${canalId}...`);
        try {
          await this.iniciarSessao(canalId, escritorioId);
        } catch (err: any) {
          console.error(`[WhatsApp] Falha ao restaurar canal ${canalId}:`, err.message);
        }
      }
    }
  }

  /** Keepalive — envia presenceUpdate a cada 2 minutos para manter conexão ativa */
  private startKeepalive(state: SessionState) {
    // Limpar keepalive anterior se existir
    if ((state as any)._keepalive) clearInterval((state as any)._keepalive);

    (state as any)._keepalive = setInterval(async () => {
      if (state.status === "conectado" && state.socket) {
        try {
          await state.socket.sendPresenceUpdate("available");
        } catch (err: any) {
          console.warn(`[WhatsApp] Keepalive falhou canal ${state.canalId}:`, err.message);
        }
      }
    }, 2 * 60 * 1000); // 2 minutos
  }

  private stopKeepalive(state: SessionState) {
    if ((state as any)._keepalive) {
      clearInterval((state as any)._keepalive);
      (state as any)._keepalive = null;
    }
  }

  // ─── Conexão Interna ──────────────────────────────────────────────────────

  private getAuthPath(canalId: number): string {
    return path.join(this.authDir, `canal_${canalId}`);
  }

  private async connect(state: SessionState): Promise<void> {
    const baileys = await this.loadBaileys();
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
      makeCacheableSignalKeyStore,
    } = baileys;

    // Criar logger Pino silencioso (Baileys v7 exige)
    let logger: any;
    try {
      const P = await import("pino");
      logger = P.default({ level: "silent" });
    } catch {
      // Fallback: criar logger minimal compatível com Baileys
      logger = {
        level: "silent",
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error,
        fatal: console.error,
        child: () => logger,
      };
    }

    const authPath = this.getAuthPath(state.canalId);
    if (!fs.existsSync(authPath)) {
      fs.mkdirSync(authPath, { recursive: true });
    }

    const { state: authState, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: ["SaaS Cálculos", "Chrome", "1.0.0"],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false, // Desativado — evita sobrecarga que causa desconexão
      markOnlineOnConnect: true,
      retryRequestDelayMs: 250,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000, // ping a cada 30s para manter WS aberto
      defaultQueryTimeoutMs: 60000,
    });

    state.socket = socket;

    // ─── Eventos ─────────────────────────────────────────────────────────

    // QR Code
    socket.ev.on("connection.update", async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        state.status = "aguardando_qr";
        state.qrCode = qr; // string raw do QR — frontend usa qrcode lib para renderizar
        this.emitStatus(state.canalId, "aguardando_qr", { qr });
      }

      if (connection === "open") {
        state.status = "conectado";
        state.qrCode = undefined;
        state.connectedAt = new Date();
        state.reconnectAttempts = 0;
        state.mensagemErro = undefined;

        // Extrair info do dispositivo
        const user = socket.user;
        if (user) {
          state.telefone = jidToPhone(user.id);
          state.nomeDispositivo = user.name || undefined;
        }

        this.emitStatus(state.canalId, "conectado", {
          telefone: state.telefone,
          nome: state.nomeDispositivo,
        });
        console.log(`[WhatsApp] Canal ${state.canalId} conectado: ${state.telefone}`);
        this.startKeepalive(state);
      }

      if (connection === "close") {
        this.stopKeepalive(state);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
          // Logout: limpar credenciais
          state.status = "desconectado";
          state.qrCode = undefined;
          state.socket = undefined;
          this.emitStatus(state.canalId, "desconectado", { reason: "logout" });

          // Limpar auth para permitir novo QR
          if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
          }
          return;
        }

        if (shouldReconnect && state.reconnectAttempts < state.maxReconnectAttempts) {
          state.reconnectAttempts++;
          state.status = "conectando";
          this.emitStatus(state.canalId, "conectando", {
            tentativa: state.reconnectAttempts,
          });

          // Delay exponencial antes de reconectar
          const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
          setTimeout(() => {
            this.connect(state).catch((err) => {
              state.status = "erro";
              state.mensagemErro = err.message;
              this.emitStatus(state.canalId, "erro", { error: err.message });
            });
          }, delay);
        } else {
          state.status = "erro";
          state.mensagemErro = `Desconectado (código ${statusCode}). Máximo de tentativas atingido.`;
          this.emitStatus(state.canalId, "erro", {
            error: state.mensagemErro,
            statusCode,
          });
        }
      }
    });

    // Salvar credenciais
    socket.ev.on("creds.update", saveCreds);

    // Mensagens recebidas
    socket.ev.on("messages.upsert", async (upsert: any) => {
      const isHistory = upsert.type === "append";
      const isNotify = upsert.type === "notify";
      if (!isNotify && !isHistory) return;

      console.log(`[WhatsApp] messages.upsert type=${upsert.type}, count=${upsert.messages?.length || 0}${isHistory ? " (histórico)" : ""}`);

      for (const msg of upsert.messages) {
        // Ignorar broadcast
        if (msg.key.remoteJid === "status@broadcast") continue;

        const isGroup = msg.key.remoteJid?.endsWith("@g.us") ?? false;
        const chatId = msg.key.remoteJid || "";
        const telefone = jidToPhone(isGroup ? (msg.key.participant || chatId) : chatId);

        // Se a mensagem é enviada por nós (fromMe), atualizar preview da conversa para sincronização
        if (msg.key.fromMe) {
          // Apenas processar como sync: atualizar ultimaMensagemAt/Preview
          if (this.onMensagem && isNotify) {
            // Não registrar como msg nova — a msg de saída já foi salva pelo CRM
            // Mas emitir evento para que o polling do frontend pegue
          }
          continue;
        }

        console.log(`[WhatsApp] Msg recebida de ${telefone} (${msg.pushName || "?"}) no chat ${chatId}`);

        // Extrair conteúdo
        let conteudo = "";
        let tipo: WhatsappMensagemRecebida["tipo"] = "texto";
        let mediaUrl: string | undefined;

        const m = msg.message;
        if (!m) {
          console.log(`[WhatsApp] Msg sem conteúdo, ignorando`);
          continue;
        }

        if (m.conversation) {
          conteudo = m.conversation;
        } else if (m.extendedTextMessage?.text) {
          conteudo = m.extendedTextMessage.text;
        } else if (m.imageMessage) {
          tipo = "imagem";
          // Tentar fazer download da imagem
          try {
            const buffer = await this.downloadMedia(socket, msg);
            if (buffer) {
              const fileName = `img_${Date.now()}.jpg`;
              const filePath = this.saveMediaFile(buffer, fileName, state.canalId);
              mediaUrl = filePath;
              conteudo = m.imageMessage.caption || `📷 Imagem recebida`;
            } else {
              conteudo = m.imageMessage.caption || "📷 Imagem recebida";
            }
          } catch {
            conteudo = m.imageMessage.caption || "📷 Imagem recebida";
          }
        } else if (m.videoMessage) {
          tipo = "video";
          conteudo = m.videoMessage.caption || "🎥 Vídeo recebido";
        } else if (m.audioMessage) {
          tipo = "audio";
          // Tentar fazer download do áudio
          try {
            const buffer = await this.downloadMedia(socket, msg);
            if (buffer) {
              const ext = m.audioMessage.ptt ? "ogg" : "mp3";
              const fileName = `audio_${Date.now()}.${ext}`;
              const filePath = this.saveMediaFile(buffer, fileName, state.canalId);
              mediaUrl = filePath;
              conteudo = "🎵 Áudio recebido";
            } else {
              conteudo = "🎵 Áudio recebido";
            }
          } catch {
            conteudo = "🎵 Áudio recebido";
          }
        } else if (m.documentMessage) {
          tipo = "documento";
          const docName = m.documentMessage.fileName || "documento";
          try {
            const buffer = await this.downloadMedia(socket, msg);
            if (buffer) {
              const filePath = this.saveMediaFile(buffer, docName, state.canalId);
              mediaUrl = filePath;
              conteudo = `📄 ${docName}`;
            } else {
              conteudo = `📄 ${docName}`;
            }
          } catch {
            conteudo = `📄 ${docName}`;
          }
        } else if (m.stickerMessage) {
          tipo = "sticker";
          conteudo = "🏷️ Sticker";
        } else if (m.locationMessage) {
          tipo = "localizacao";
          conteudo = `📍 Localização: ${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}`;
        } else if (m.contactMessage) {
          tipo = "contato";
          conteudo = `👤 Contato: ${m.contactMessage.displayName || ""}`;
        } else {
          console.log(`[WhatsApp] Tipo de mensagem não reconhecido:`, Object.keys(m));
          continue;
        }

        console.log(`[WhatsApp] Processando: tipo=${tipo}, conteudo="${conteudo.slice(0, 50)}"${mediaUrl ? `, mediaUrl=${mediaUrl}` : ""}`);

        const parsed: WhatsappMensagemRecebida = {
          chatId,
          nome: msg.pushName || telefone,
          telefone,
          conteudo,
          tipo,
          mediaUrl,
          timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000),
          messageId: msg.key.id || "",
          isGroup,
          quotedMessageId: m.extendedTextMessage?.contextInfo?.stanzaId,
        };

        // Emitir para callback
        if (this.onMensagem) {
          try {
            console.log(`[WhatsApp] Chamando onMensagem callback para canal ${state.canalId}, escritório ${state.escritorioId}`);
            await this.onMensagem(state.canalId, state.escritorioId, parsed);
            console.log(`[WhatsApp] Mensagem processada com sucesso no CRM`);
          } catch (err: any) {
            console.error(`[WhatsApp] Erro no callback de mensagem:`, err.message, err.stack);
          }
        } else {
          console.warn(`[WhatsApp] onMensagem callback NÃO configurado!`);
        }

        this.emit("mensagem", state.canalId, parsed);
      }
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Download media from a WhatsApp message */
  private async downloadMedia(socket: any, msg: any): Promise<Buffer | null> {
    try {
      const baileys = await this.loadBaileys();
      const { downloadMediaMessage } = baileys;
      if (!downloadMediaMessage) return null;
      const buffer = await downloadMediaMessage(msg, "buffer", {});
      return buffer as Buffer;
    } catch (err: any) {
      console.warn(`[WhatsApp] Falha ao baixar mídia:`, err.message);
      return null;
    }
  }

  /** Save media file to disk and return relative path */
  private saveMediaFile(buffer: Buffer, fileName: string, canalId: number): string {
    const mediaDir = path.join(this.authDir, `canal_${canalId}`, "media");
    if (!fs.existsSync(mediaDir)) {
      fs.mkdirSync(mediaDir, { recursive: true });
    }
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fullPath = path.join(mediaDir, safeFileName);
    fs.writeFileSync(fullPath, buffer);
    return `/api/whatsapp-media/${canalId}/${safeFileName}`;
  }

  private emitStatus(canalId: number, status: WhatsappSessionStatus, extra?: Record<string, unknown>) {
    if (this.onStatusChange) {
      const result = this.onStatusChange(canalId, status, extra);
      if (result && typeof (result as any).catch === "function") {
        (result as Promise<void>).catch(() => {});
      }
    }
    this.emit("status", canalId, status, extra);
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

let instance: WhatsappSessionManager | null = null;

export function getWhatsappManager(): WhatsappSessionManager {
  if (!instance) {
    instance = new WhatsappSessionManager();
  }
  return instance;
}

export { WhatsappSessionManager };
