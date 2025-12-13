// server.js
import "dotenv/config";

import multer from "multer";
import FormData from "form-data";
import fs from "fs";

import express from "express";
import cors from "cors";
import axios from "axios";

import {
  upsertDialog,
  getDialogsFromDb,
  saveMessage,
  getLatestMessages,
  getMessagesBefore,
} from "./db.js";

const API_URL = process.env.GREEN_API_URL || "https://7105.api.greenapi.com";
const GREEN_ID = process.env.GREEN_ID;
const GREEN_TOKEN = process.env.GREEN_TOKEN;
const PORT = Number(process.env.PORT || 3001);

const CHATS_SYNC_INTERVAL_MS = Number(process.env.GREEN_CHATS_SYNC_INTERVAL_MS || 5000);

// fallback poll (страховка)
const POLL_INTERVAL = Number(process.env.GREEN_POLL_INTERVAL_MS || 2000);
const POLL_ENABLED = process.env.GREEN_POLL_ENABLED === "1";

// backfill истории на открытие чата
const BACKFILL_COUNT = Number(process.env.GREEN_BACKFILL_COUNT || 200);
const BACKFILL_MIN_INTERVAL_MS = Number(process.env.GREEN_BACKFILL_MIN_INTERVAL_MS || 30000);

if (!GREEN_ID || !GREEN_TOKEN) {
  console.error("[FATAL] GREEN_ID или GREEN_TOKEN не заданы в .env");
}

function greenUrl(path) {
  // https://{host}/waInstance{ID}/{method}/{token}
  return `${API_URL}/waInstance${GREEN_ID}/${path}/${GREEN_TOKEN}`;
}

const UPLOAD_DIR = "uploads";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR });

const app = express();
app.use(cors({ origin: "*" }));

// ✅ locks
const backfillLock = new Map(); // chatId -> lastBackfillTs

const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/i;

function normalizeChatId(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  if (validChatIdRe.test(raw)) return raw;

  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits === "0") return "";

  return `${digits}@c.us`;
}

function isBadChatId(chatId) {
  const id = String(chatId || "").trim();
  if (!id) return true;
  if (!validChatIdRe.test(id)) return true;
  if (id.startsWith("0@")) return true;
  return false;
}

function previewText(text, mediaType) {
  const t = (text || "").trim();
  if (t) return t;
  if (mediaType) return "[MEDIA]";
  return "";
}

function extractWebhookContent(messageData = {}) {
  const text =
    messageData?.textMessageData?.textMessage ||
    messageData?.extendedTextMessageData?.text ||
    messageData?.captionMessageData?.caption ||
    "";

  const mediaType =
    messageData?.fileMessageData?.typeMessage ||
    messageData?.typeMessage ||
    null;

  const mediaUrl =
    messageData?.fileMessageData?.downloadUrl ||
    messageData?.fileMessageData?.urlFile ||
    null;

  return { text: text || "", mediaType, mediaUrl };
}

function getGreenTimestamp(obj) {
  const tsRaw =
    obj?.timestamp ??
    obj?.timeMessage ??
    obj?.time ??
    obj?.messageTimestamp ??
    null;

  if (typeof tsRaw !== "number") return Date.now();
  return tsRaw.toString().length > 10 ? tsRaw : tsRaw * 1000;
}

function getGreenId(obj, fallbackPrefix = "msg", fallbackTs) {
  const direct =
    obj?.idMessage ||
    obj?.id ||
    (obj?.key && (obj.key.idMessage || obj.key.id)) ||
    null;

  if (direct) return direct;

  const ts = typeof fallbackTs === "number" ? fallbackTs : Date.now();
  return `${fallbackPrefix}_${ts}`;
}

function truthy(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}

function parseGreenMessage(raw) {
  if (!raw || typeof raw !== "object") return null;

  const ts = getGreenTimestamp(raw);
  const id = getGreenId(raw, raw.chatId || "chat", ts);

  const text =
    raw.textMessage ||
    raw.message ||
    raw.caption ||
    (raw.extendedTextMessage && raw.extendedTextMessage.text) ||
    "";

  const mediaType = raw.typeMessage || raw.type || null;
  const mediaUrl = raw.downloadUrl || raw.urlFile || raw.url || null;

  const typeStr = String(raw.type || "").toLowerCase();

  // ✅ максимально надёжно
  const isOutgoing =
    typeStr.includes("outgoing") ||
    truthy(raw.fromMe) ||
    truthy(raw?.key?.fromMe) ||
    truthy(raw?.messageData?.fromMe);

  return {
    id,
    from: isOutgoing ? "me" : "client",
    text,
    timestamp: ts,
    mediaType,
    mediaUrl,
    replyTo: null,
  };
}


function safeJsonParseAny(x) {
  if (!x) return null;
  if (typeof x === "object") return x;
  if (typeof x !== "string") return null;
  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
}

// ====== Webhook handler (GreenAPI -> наш сервер) ======
function handleWebhookBody(rawBody = {}) {
  const body = rawBody?.body ? rawBody.body : rawBody;
  if (!body || typeof body !== "object") return;

  const type = body.typeWebhook;
  const senderData = body.senderData || {};
  const messageData = body.messageData || {};

  if (type === "incomingMessageReceived") {
    const chatId = normalizeChatId(senderData.chatId);
    if (!chatId) return;

    const name = senderData.senderName || senderData.chatName || chatId;
    const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
    if (!text && !mediaUrl) return;

    const ts = getGreenTimestamp(messageData || body);
    const id = body.idMessage || getGreenId(messageData, chatId, ts);

    saveMessage({
      chatId,
      id,
      from: "client",
      text,
      timestamp: ts,
      mediaType,
      mediaUrl,
      replyTo: null,
    });

    upsertDialog({
      chatId,
      name,
      lastMessage: previewText(text, mediaType),
      lastTime: ts,
    });
    return;
  }

  if (type === "outgoingMessageReceived" || type === "outgoingAPIMessageReceived") {
    const chatId = normalizeChatId(senderData.chatId);
    if (!chatId) return;

    const name = senderData.senderName || senderData.chatName || chatId;
    const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
    if (!text && !mediaUrl) return;

    const ts = getGreenTimestamp(messageData || body);
    const id = body.idMessage || getGreenId(messageData, chatId, ts);

    saveMessage({
      chatId,
      id,
      from: "me",
      text,
      timestamp: ts,
      mediaType,
      mediaUrl,
      replyTo: null,
    });

    upsertDialog({
      chatId,
      name,
      lastMessage: previewText(text, mediaType),
      lastTime: ts,
    });
  }
}

// ===== sync chats list =====
async function syncChatsFromGreen() {
  try {
    const r = await axios.post(greenUrl("getChats"), {});
    const raw = Array.isArray(r.data) ? r.data : [];

    for (const c of raw) {
      const chatId = normalizeChatId(c?.id);
      if (!chatId) continue;

      const last = c.lastMessage || {};
      const text =
        last.textMessage ||
        last.message ||
        last.caption ||
        (last.extendedTextMessage && last.extendedTextMessage.text) ||
        "";

      const mediaType = last.typeMessage || last.type || null;

      const tsRaw = last.timestamp ?? last.timeMessage ?? c.lastMessageTime ?? null;
      let ts = null;
      if (typeof tsRaw === "number") ts = tsRaw.toString().length > 10 ? tsRaw : tsRaw * 1000;

      upsertDialog({
        chatId,
        name: c.name || c.chatName || chatId,
        lastMessage: previewText(text, mediaType) || null,
        lastTime: typeof ts === "number" ? ts : null,
      });
    }
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      console.error("[getChats] 401 => проверь GREEN_ID/GREEN_TOKEN и API_URL");
      return;
    }
    console.error("syncChatsFromGreen error:", status || e.message);
  }
}

// ===== backfill истории при открытии/запросах чата =====
async function backfillChatHistory(chatId) {
  if (!chatId) return;

  const now = Date.now();
  const last = backfillLock.get(chatId) || 0;
  if (now - last < BACKFILL_MIN_INTERVAL_MS) return;
  backfillLock.set(chatId, now);

  try {
    const response = await axios.post(greenUrl("getChatHistory"), {
      chatId,
      count: BACKFILL_COUNT,
    });

    const data = Array.isArray(response.data) ? response.data : [];
    for (const raw of data) {
      const m = parseGreenMessage(raw);
      if (!m) continue;
      saveMessage({ ...m, chatId });
    }

    const lastList = getLatestMessages(chatId, 1);
    const lastMsg = lastList[lastList.length - 1];
    if (lastMsg) {
      upsertDialog({
        chatId,
        name: chatId,
        lastMessage: previewText(lastMsg.text, lastMsg.mediaType),
        lastTime: lastMsg.timestamp,
      });
    }
  } catch (e) {
    const status = e?.response?.status;
    if (status === 429) return;
    if (status === 401) {
      console.error("[backfill] 401 => проверь GREEN_ID/GREEN_TOKEN и API_URL");
      return;
    }
    console.error("backfillChatHistory error:", status || e.message);
  }
}

// ✅ ВАЖНО: webhook роуты ставим ДО express.json, и парсим сами (чтобы не зависеть от Content-Type)
async function processWebhookAndMaybeDeleteReceipt(payloadRaw) {
  const payload = safeJsonParseAny(payloadRaw) || {};

  try {
    handleWebhookBody(payload);
  } catch (e) {
    console.error("webhook handle error:", e.message);
  }

  const receiptId = payload?.receiptId;
  if (receiptId) {
    axios.delete(greenUrl(`deleteNotification/${receiptId}`)).catch(() => {});
  }
}

// webhook: ловим и /api/green/webhook и /green/webhook
app.post("/api/green/webhook", express.text({ type: "*/*", limit: "2mb" }), (req, res) => {
  res.sendStatus(200);
  processWebhookAndMaybeDeleteReceipt(req.body);
});

app.post("/green/webhook", express.text({ type: "*/*", limit: "2mb" }), (req, res) => {
  res.sendStatus(200);
  processWebhookAndMaybeDeleteReceipt(req.body);
});

// дальше обычный JSON для твоего API
app.use(express.json({ limit: "2mb" }));

// ========== health ==========
app.get("/health", (_req, res) => res.json({ ok: true }));

// ========== dialogs ==========
app.get("/dialogs", (_req, res) => {
  try {
    const dialogs = getDialogsFromDb()
      .filter((d) => !isBadChatId(d.chatId))
      .map((d) => ({
        chatId: d.chatId,
        name: d.name,
        lastMessage: d.lastMessage || "",
        lastTime: typeof d.lastTime === "number" ? d.lastTime : 0,
        unread: 0,
      }))
      .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

    res.json(dialogs);
  } catch (e) {
    console.error("dialogs fatal:", e.message);
    res.json([]);
  }
});

// ========== messages ==========
app.get("/messages/:chatId", async (req, res) => {
  const chatId = normalizeChatId(req.params.chatId);
  if (!chatId) return res.json([]);

  const limit = Math.max(1, Math.min(200, Number(req.query.limit || 30)));
  const before = Number(req.query.before || 0);

  await backfillChatHistory(chatId);

  if (before > 0) return res.json(getMessagesBefore(chatId, before, limit));
  return res.json(getLatestMessages(chatId, limit));
});

// ========== send text ==========
app.post("/send", async (req, res) => {
  const chatId = normalizeChatId(req.body.chatId);
  const text = String(req.body.text || "").trim();
  const replyTo = req.body.replyTo || null;

  if (!chatId || !text) return res.status(400).json({ detail: "chatId and text are required" });

  try {
    const r = await axios.post(greenUrl("sendMessage"), { chatId, message: text });

    const now = Date.now();
    const msgId = r.data?.idMessage || getGreenId({}, chatId, now);

    const msg = {
      chatId,
      id: msgId,
      from: "me",
      text,
      timestamp: now,
      mediaType: null,
      mediaUrl: null,
      replyTo,
    };

    saveMessage(msg);
    upsertDialog({ chatId, name: chatId, lastMessage: previewText(text, null), lastTime: now });

    res.json({
      id: msg.id,
      from: msg.from,
      text: msg.text,
      timestamp: msg.timestamp,
      mediaType: msg.mediaType,
      mediaUrl: msg.mediaUrl,
      replyTo: msg.replyTo,
    });
  } catch (e) {
    const status = e?.response?.status;
    console.error("sendMessage error:", status || e.message, e.response?.data || "");
    res.status(500).json({ detail: "sendMessage failed", status: status || 500 });
  }
});

// ========== send file ==========
app.post("/send-file", upload.single("file"), async (req, res) => {
  const chatId = normalizeChatId(req.body.chatId);
  const caption = String(req.body.caption || "");
  const file = req.file;

  if (!chatId || !file) {
    if (file?.path) fs.unlink(file.path, () => {});
    return res.status(400).json({ detail: "chatId or file missing" });
  }

  const tmpPath = file.path;

  try {
    const form = new FormData();
    form.append("chatId", chatId);
    form.append("caption", caption || "");
    form.append("file", fs.createReadStream(tmpPath), file.originalname);

    const r = await axios.post(greenUrl("sendFileByUpload"), form, {
      headers: form.getHeaders(),
    });

    const now = Date.now();
    const msgId = r.data?.idMessage || getGreenId({}, chatId, now);

    saveMessage({
      chatId,
      id: msgId,
      from: "me",
      text: caption || "",
      timestamp: now,
      mediaType: "file",
      mediaUrl: null,
      replyTo: null,
    });

    upsertDialog({
      chatId,
      name: chatId,
      lastMessage: previewText(caption || "", "file"),
      lastTime: now,
    });

    res.json(r.data);
  } catch (e) {
    const status = e?.response?.status;
    console.error("sendFile error:", status || e.message, e.response?.data || "");
    res.status(500).json({ detail: "sendFile failed", status: status || 500 });
  } finally {
    if (tmpPath) fs.unlink(tmpPath, () => {});
  }
});

// ===== POLL fallback =====
async function pollNotifications() {
  try {
    const r = await axios.get(greenUrl("receiveNotification"));
    if (!r.data || !r.data.body) return;
    await processWebhookAndMaybeDeleteReceipt(r.data); // тут receiptId будет
  } catch {
    // молчим
  }
}

if (POLL_ENABLED) {
  console.log(`[POLL] enabled, interval=${POLL_INTERVAL}ms`);
  setInterval(pollNotifications, POLL_INTERVAL);
} else {
  console.log("[POLL] disabled");
}

// chats sync
syncChatsFromGreen();
setInterval(syncChatsFromGreen, CHATS_SYNC_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`WhatsApp backend (WEBHOOK+POLL+DB, no WS) on ${PORT}`);
});
