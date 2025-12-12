// // server.js
// import "dotenv/config";

// import multer from "multer";
// import FormData from "form-data";
// import fs from "fs";

// import express from "express";
// import cors from "cors";
// import axios from "axios";

// import {
//   upsertDialog,
//   getDialogsFromDb,
//   saveMessage,
//   countMessages,
//   getLatestMessages,
//   getMessagesBefore,
//   getMessagesAfter,
// } from "./db.js";

// const API_URL = process.env.GREEN_API_URL || "https://7105.api.greenapi.com";
// const GREEN_ID = process.env.GREEN_ID;
// const GREEN_TOKEN = process.env.GREEN_TOKEN;
// const PORT = Number(process.env.PORT || 3001);

// const POLL_INTERVAL = Number(process.env.GREEN_POLL_INTERVAL_MS || 15000);
// const CHATS_SYNC_INTERVAL_MS = Number(process.env.GREEN_CHATS_SYNC_INTERVAL_MS || 60000);

// // ВАЖНО: seed (getChatHistory) разрешаем редко (анти-429)
// const SEED_MIN_INTERVAL_MS = Number(process.env.GREEN_SEED_MIN_INTERVAL_MS || 60000);

// if (!GREEN_ID || !GREEN_TOKEN) {
//   console.error("[FATAL] GREEN_ID или GREEN_TOKEN не заданы в .env");
// }

// function greenUrl(path) {
//   return `${API_URL}/waInstance${GREEN_ID}/${path}/${GREEN_TOKEN}`;
// }

// const UPLOAD_DIR = "uploads";
// if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// const upload = multer({ dest: UPLOAD_DIR });

// const app = express();
// app.use(cors({ origin: "*" }));
// app.use(express.json());

// const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/i;

// const seedLock = new Map(); // chatId -> lastSeedTs

// function normalizeChatId(input) {
//   const raw = String(input || "").trim();
//   if (!raw) return "";

//   // уже нормальный
//   if (validChatIdRe.test(raw)) return raw;

//   // только цифры/+
//   const digits = raw.replace(/[^\d]/g, "");
//   if (!digits) return "";

//   // если "0" или мусор — режем
//   if (digits === "0") return "";

//   // по умолчанию личный чат
//   return `${digits}@c.us`;
// }

// function previewText(text, mediaType) {
//   const t = (text || "").trim();
//   if (t) return t;
//   if (mediaType) return "[MEDIA]";
//   return "";
// }

// function extractWebhookContent(messageData = {}) {
//   const text =
//     messageData?.textMessageData?.textMessage ||
//     messageData?.extendedTextMessageData?.text ||
//     messageData?.captionMessageData?.caption ||
//     "";

//   const mediaType =
//     messageData?.fileMessageData?.typeMessage ||
//     messageData?.typeMessage ||
//     null;

//   const mediaUrl =
//     messageData?.fileMessageData?.downloadUrl ||
//     messageData?.fileMessageData?.urlFile ||
//     null;

//   return { text: text || "", mediaType, mediaUrl };
// }

// function getGreenTimestamp(obj) {
//   const tsRaw =
//     obj?.timestamp ??
//     obj?.timeMessage ??
//     obj?.time ??
//     obj?.messageTimestamp ??
//     null;

//   if (typeof tsRaw !== "number") return Date.now();
//   return tsRaw.toString().length > 10 ? tsRaw : tsRaw * 1000;
// }

// function getGreenId(obj, fallbackPrefix = "msg", fallbackTs) {
//   const direct =
//     obj?.idMessage ||
//     obj?.id ||
//     (obj?.key && (obj.key.idMessage || obj.key.id)) ||
//     null;

//   if (direct) return direct;

//   const ts = typeof fallbackTs === "number" ? fallbackTs : Date.now();
//   return `${fallbackPrefix}_${ts}`;
// }

// function parseGreenMessage(raw) {
//   if (!raw || typeof raw !== "object") return null;

//   const ts = getGreenTimestamp(raw);
//   const id = getGreenId(raw, raw.chatId || "chat", ts);

//   const text =
//     raw.textMessage ||
//     raw.message ||
//     raw.caption ||
//     (raw.extendedTextMessage && raw.extendedTextMessage.text) ||
//     "";

//   const mediaType = raw.typeMessage || raw.type || null;
//   const mediaUrl = raw.downloadUrl || raw.urlFile || raw.url || null;

//   return {
//     id,
//     from: raw.type === "outgoing" ? "me" : "client",
//     text,
//     timestamp: ts,
//     mediaType,
//     mediaUrl,
//     replyTo: null,
//   };
// }

// // ===== webhook/notification handler =====
// function handleWebhookBody(rawBody) {
//   const body = rawBody?.body ? rawBody.body : rawBody;
//   if (!body || typeof body !== "object") return;

//   const type = body.typeWebhook;
//   const senderData = body.senderData || {};
//   const messageData = body.messageData || {};

//   if (type === "incomingMessageReceived") {
//     const chatId = normalizeChatId(senderData.chatId);
//     if (!chatId) return;

//     const name = senderData.senderName || senderData.chatName || chatId;
//     const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
//     if (!text && !mediaUrl) return;

//     const ts = getGreenTimestamp(messageData || body);
//     const id = body.idMessage || getGreenId(messageData, chatId, ts);

//     saveMessage({
//       chatId,
//       id,
//       from: "client",
//       text,
//       timestamp: ts,
//       mediaType,
//       mediaUrl,
//       replyTo: null,
//     });

//     upsertDialog({
//       chatId,
//       name,
//       lastMessage: previewText(text, mediaType),
//       lastTime: ts,
//     });
//     return;
//   }

//   if (type === "outgoingMessageReceived" || type === "outgoingAPIMessageReceived") {
//     const chatId = normalizeChatId(senderData.chatId);
//     if (!chatId) return;

//     const name = senderData.senderName || senderData.chatName || chatId;
//     const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
//     if (!text && !mediaUrl) return;

//     const ts = getGreenTimestamp(messageData || body);
//     const id = body.idMessage || getGreenId(messageData, chatId, ts);

//     saveMessage({
//       chatId,
//       id,
//       from: "me",
//       text,
//       timestamp: ts,
//       mediaType,
//       mediaUrl,
//       replyTo: null,
//     });

//     upsertDialog({
//       chatId,
//       name,
//       lastMessage: previewText(text, mediaType),
//       lastTime: ts,
//     });
//   }
// }

// // ===== sync chats list редко (чтобы новые чаты появлялись) =====
// async function syncChatsFromGreen() {
//   try {
//     const r = await axios.post(greenUrl("getChats"), {});
//     const raw = Array.isArray(r.data) ? r.data : [];

//     for (const c of raw) {
//       const chatId = normalizeChatId(c?.id);
//       if (!chatId) continue;

//       const last = c.lastMessage || {};
//       const text =
//         last.textMessage ||
//         last.message ||
//         last.caption ||
//         (last.extendedTextMessage && last.extendedTextMessage.text) ||
//         "";

//       const mediaType = last.typeMessage || last.type || null;

//       const tsRaw = last.timestamp ?? last.timeMessage ?? c.lastMessageTime ?? null;
//       let ts = null;
//       if (typeof tsRaw === "number") ts = tsRaw.toString().length > 10 ? tsRaw : tsRaw * 1000;

//       upsertDialog({
//         chatId,
//         name: c.name || c.chatName || chatId,
//         lastMessage: previewText(text, mediaType) || null,
//         lastTime: typeof ts === "number" ? ts : null,
//       });
//     }
//   } catch (e) {
//     console.error("syncChatsFromGreen error:", e.response?.status || e.message);
//   }
// }

// // ===== seed history ONE TIME if DB empty (анти-400/429) =====
// async function seedChatHistoryIfEmpty(chatId) {
//   if (!chatId) return;

//   const has = countMessages(chatId);
//   if (has > 0) return;

//   const lastSeed = seedLock.get(chatId) || 0;
//   const now = Date.now();
//   if (now - lastSeed < SEED_MIN_INTERVAL_MS) return;
//   seedLock.set(chatId, now);

//   try {
//     const response = await axios.post(greenUrl("getChatHistory"), {
//       chatId,
//       count: 50,
//     });

//     const data = Array.isArray(response.data) ? response.data : [];
//     for (const raw of data) {
//       const m = parseGreenMessage(raw);
//       if (!m) continue;
//       saveMessage({ ...m, chatId });
//     }

//     // обновим диалог по последнему сообщению (если появилось)
//     const lastList = getLatestMessages(chatId, 1);
//     const last = lastList[lastList.length - 1];
//     if (last) {
//       upsertDialog({
//         chatId,
//         name: chatId,
//         lastMessage: previewText(last.text, last.mediaType),
//         lastTime: last.timestamp,
//       });
//     }
//   } catch (e) {
//     const status = e.response?.status;

//     // 429 — молча выходим, НЕ ломаем фронт
//     if (status === 429) {
//       console.error("seedChatHistory 429 (rate limited)");
//       return;
//     }

//     // 400 — чаще всего chatId кривой (теперь почти не будет)
//     console.error("seedChatHistory error:", status || e.message, e.response?.data || "");
//   }
// }

// // ========== /dialogs ==========
// app.get("/dialogs", (_req, res) => {
//   try {
//     const dialogs = getDialogsFromDb()
//       .filter((d) => d.chatId && validChatIdRe.test(d.chatId))
//       .map((d) => ({
//         chatId: d.chatId,
//         name: d.name,
//         lastMessage: d.lastMessage || "",
//         lastTime: typeof d.lastTime === "number" ? d.lastTime : 0,
//       }))
//       .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

//     res.json(dialogs);
//   } catch (e) {
//     console.error("dialogs fatal:", e.message);
//     res.json([]);
//   }
// });

// // ========== /messages/:chatId (pagination) ==========
// // query:
// //   limit=15
// //   before=timestamp   -> older page
// //   after=timestamp    -> newer (for polling)
// // По умолчанию: latest page
// app.get("/messages/:chatId", async (req, res) => {
//   const chatId = normalizeChatId(req.params.chatId);
//   if (!chatId) return res.json([]);

//   const limit = Math.max(1, Math.min(100, Number(req.query.limit || 15)));

//   const before = Number(req.query.before || 0);
//   const after = Number(req.query.after || 0);

//   // если БД пустая — пробуем seed один раз
//   await seedChatHistoryIfEmpty(chatId);

//   if (after > 0) {
//     return res.json(getMessagesAfter(chatId, after, 200));
//   }

//   if (before > 0) {
//     return res.json(getMessagesBefore(chatId, before, limit));
//   }

//   return res.json(getLatestMessages(chatId, limit));
// });


// // ========== /poll-dialog/:chatId ==========
// // берём 1 последнее сообщение чата и обновляем dialogs в БД
// app.get("/poll-dialog/:chatId", async (req, res) => {
//   const chatId = req.params.chatId;

//   if (!chatId || !validChatIdRe.test(chatId)) {
//     return res.status(400).json({ detail: "bad chatId" });
//   }

//   try {
//     const r = await axios.post(greenUrl("getChatHistory"), {
//       chatId,
//       count: 1,
//     });

//     const data = Array.isArray(r.data) ? r.data : [];
//     const raw = data[0];
//     if (!raw) return res.json(null);

//     const m = parseGreenMessage(raw);
//     if (!m) return res.json(null);

//     upsertDialog({
//       chatId,
//       name: chatId,
//       lastMessage: m.text || "[MEDIA]",
//       lastTime: m.timestamp,
//     });

//     return res.json({
//       chatId,
//       lastMessage: m.text || "[MEDIA]",
//       lastTime: m.timestamp,
//       from: m.from,
//     });
//   } catch (e) {
//     const status = e?.response?.status;
//     // 429/400 не превращаем в 404 — отдаём понятный ответ
//     return res.status(status || 500).json({
//       detail: "poll-dialog failed",
//       status: status || 500,
//     });
//   }
// });


// // ========== /send ==========
// app.post("/send", async (req, res) => {
//   const chatId = normalizeChatId(req.body.chatId);
//   const text = String(req.body.text || "").trim();
//   const replyTo = req.body.replyTo || null;

//   if (!chatId || !text) return res.status(400).json({ detail: "chatId and text are required" });

//   try {
//     const r = await axios.post(greenUrl("sendMessage"), { chatId, message: text });

//     const now = Date.now();
//     const msgId = r.data?.idMessage || getGreenId({}, chatId, now);

//     const msg = {
//       chatId,
//       id: msgId,
//       from: "me",
//       text,
//       timestamp: now,
//       mediaType: null,
//       mediaUrl: null,
//       replyTo,
//     };

//     saveMessage(msg);
//     upsertDialog({ chatId, name: chatId, lastMessage: previewText(text, null), lastTime: now });

//     res.json({
//       id: msg.id,
//       from: msg.from,
//       text: msg.text,
//       timestamp: msg.timestamp,
//       mediaType: msg.mediaType,
//       mediaUrl: msg.mediaUrl,
//       replyTo: msg.replyTo,
//     });
//   } catch (e) {
//     console.error("sendMessage error:", e.response?.status || e.message);
//     res.status(500).json({ detail: "sendMessage failed" });
//   }
// });

// // ========== /send-file ==========
// app.post("/send-file", upload.single("file"), async (req, res) => {
//   const chatId = normalizeChatId(req.body.chatId);
//   const caption = String(req.body.caption || "");
//   const file = req.file;

//   if (!chatId || !file) {
//     if (file?.path) fs.unlink(file.path, () => {});
//     return res.status(400).json({ detail: "chatId or file missing" });
//   }

//   const tmpPath = file.path;

//   try {
//     const form = new FormData();
//     form.append("chatId", chatId);
//     form.append("caption", caption || "");
//     form.append("file", fs.createReadStream(tmpPath), file.originalname);

//     const r = await axios.post(greenUrl("sendFileByUpload"), form, {
//       headers: form.getHeaders(),
//     });

//     const now = Date.now();
//     const msgId = r.data?.idMessage || getGreenId({}, chatId, now);

//     saveMessage({
//       chatId,
//       id: msgId,
//       from: "me",
//       text: caption || "",
//       timestamp: now,
//       mediaType: "file",
//       mediaUrl: null,
//       replyTo: null,
//     });

//     upsertDialog({
//       chatId,
//       name: chatId,
//       lastMessage: previewText(caption || "", "file"),
//       lastTime: now,
//     });

//     res.json(r.data);
//   } catch (e) {
//     console.error("sendFile error:", e.response?.status || e.message);
//     res.status(500).json({ detail: "sendFile failed" });
//   } finally {
//     if (tmpPath) fs.unlink(tmpPath, () => {});
//   }
// });

// // webhook endpoints
// app.post("/api/green/webhook", (req, res) => {
//   try {
//     handleWebhookBody(req.body);
//   } catch (e) {
//     console.error("webhook error:", e.message);
//   }
//   res.sendStatus(200);
// });

// app.post("/webhook", (_req, res) => res.sendStatus(200));

// // long-poll GreenAPI
// async function pollNotifications() {
//   try {
//     const r = await axios.get(greenUrl("receiveNotification"));
//     if (!r.data || !r.data.body) return;

//     handleWebhookBody(r.data);

//     const receiptId = r.data.receiptId;
//     if (receiptId) {
//       await axios.delete(greenUrl(`deleteNotification/${receiptId}`));
//     }
//   } catch {
//     // quiet
//   }
// }

// if (process.env.GREEN_POLL_ENABLED === "1") {
//   setInterval(pollNotifications, POLL_INTERVAL);
// }

// // chats sync
// syncChatsFromGreen();
// setInterval(syncChatsFromGreen, CHATS_SYNC_INTERVAL_MS);

// app.listen(PORT, () => {
//   console.log(`WhatsApp backend (paging 15, DB-first, no WS) on ${PORT}`);
// });


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
  countMessages,
  getLatestMessages,
  getMessagesBefore,
  getMessagesAfter,
} from "./db.js";

const API_URL = process.env.GREEN_API_URL || "https://7105.api.greenapi.com";
const GREEN_ID = process.env.GREEN_ID;
const GREEN_TOKEN = process.env.GREEN_TOKEN;
const PORT = Number(process.env.PORT || 3001);

const CHATS_SYNC_INTERVAL_MS = Number(process.env.GREEN_CHATS_SYNC_INTERVAL_MS || 5000);
const SEED_MIN_INTERVAL_MS = Number(process.env.GREEN_SEED_MIN_INTERVAL_MS || 5000);

// Poll (на всякий случай оставим, но по умолчанию OFF если webhook)
const POLL_INTERVAL = Number(process.env.GREEN_POLL_INTERVAL_MS || 15000);
const POLL_ENABLED = process.env.GREEN_POLL_ENABLED === "1";

if (!GREEN_ID || !GREEN_TOKEN) {
  console.error("[FATAL] GREEN_ID или GREEN_TOKEN не заданы в .env");
}

function greenUrl(path) {
  // ВАЖНО: у GreenAPI такая схема
  // https://{host}/waInstance{ID}/{method}/{token}
  return `${API_URL}/waInstance${GREEN_ID}/${path}/${GREEN_TOKEN}`;
}

const UPLOAD_DIR = "uploads";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR });

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));

const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/i;
const seedLock = new Map(); // chatId -> lastSeedTs

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
  // отсекаем мусор типа 0@c.us
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

  return {
    id,
    from: raw.type === "outgoing" ? "me" : "client",
    text,
    timestamp: ts,
    mediaType,
    mediaUrl,
    replyTo: null,
  };
}

// ====== Webhook handler (GreenAPI -> наш сервер) ======
function handleWebhookBody(rawBody) {
  // GreenAPI иногда шлёт { receiptId, body: {...} }
  const body = rawBody?.body ? rawBody.body : rawBody;
  if (!body || typeof body !== "object") return;

  const type = body.typeWebhook;
  const senderData = body.senderData || {};
  const messageData = body.messageData || {};

  // входящее
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

  // исходящее (и ручное, и из API)
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

// ===== sync chats list (чтобы появлялись новые чаты) =====
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

// ===== seed history ONLY when открыли чат и БД пустая =====
async function seedChatHistoryIfEmpty(chatId) {
  if (!chatId) return;
  const has = countMessages(chatId);
  if (has > 0) return;

  const lastSeed = seedLock.get(chatId) || 0;
  const now = Date.now();
  if (now - lastSeed < SEED_MIN_INTERVAL_MS) return;
  seedLock.set(chatId, now);

  try {
    const response = await axios.post(greenUrl("getChatHistory"), {
      chatId,
      count: 50,
    });

    const data = Array.isArray(response.data) ? response.data : [];
    for (const raw of data) {
      const m = parseGreenMessage(raw);
      if (!m) continue;
      saveMessage({ ...m, chatId });
    }

    const lastList = getLatestMessages(chatId, 1);
    const last = lastList[lastList.length - 1];
    if (last) {
      upsertDialog({
        chatId,
        name: chatId,
        lastMessage: previewText(last.text, last.mediaType),
        lastTime: last.timestamp,
      });
    }
  } catch (e) {
    const status = e?.response?.status;
    if (status === 429) {
      console.error("[seed] 429 rate limited");
      return;
    }
    if (status === 401) {
      console.error("[seed] 401 => проверь GREEN_ID/GREEN_TOKEN и API_URL");
      return;
    }
    console.error("seedChatHistory error:", status || e.message, e.response?.data || "");
  }
}

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
        unread: 0, // пока так (если захочешь — добавим нормальный подсчёт)
      }))
      .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

    res.json(dialogs);
  } catch (e) {
    console.error("dialogs fatal:", e.message);
    res.json([]);
  }
});

// ========== messages paging ==========
app.get("/messages/:chatId", async (req, res) => {
  const chatId = normalizeChatId(req.params.chatId);
  if (!chatId) return res.json([]);

  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 15)));

  const before = Number(req.query.before || 0);
  const after = Number(req.query.after || 0);

  await seedChatHistoryIfEmpty(chatId);

  if (after > 0) return res.json(getMessagesAfter(chatId, after, 200));
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

// ===== WEBHOOK endpoint (это то что ставишь в GreenAPI) =====
// URL: https://test2007.tw1.su/api/green/webhook
app.post("/api/green/webhook", (req, res) => {
  try {
    handleWebhookBody(req.body);
  } catch (e) {
    console.error("webhook error:", e.message);
  }
  res.sendStatus(200);
});

// ===== OPTIONAL long-poll (если вдруг webhook временно не пашет) =====
async function pollNotifications() {
  try {
    const r = await axios.get(greenUrl("receiveNotification"));
    if (!r.data || !r.data.body) return;

    handleWebhookBody(r.data);

    const receiptId = r.data.receiptId;
    if (receiptId) {
      await axios.delete(greenUrl(`deleteNotification/${receiptId}`));
    }
  } catch (e) {
    const status = e?.response?.status;
    if (status === 401) {
      console.error("[POLL] 401 => проверь GREEN_ID/GREEN_TOKEN и API_URL");
      return;
    }
    // молчим на обычные таймауты
  }
}

if (POLL_ENABLED) {
  console.log(`[POLL] enabled, interval=${POLL_INTERVAL}ms`);
  setInterval(pollNotifications, POLL_INTERVAL);
} else {
  console.log("[POLL] disabled (webhook mode)");
}

// chats sync
syncChatsFromGreen();
setInterval(syncChatsFromGreen, CHATS_SYNC_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`WhatsApp backend (WEBHOOK+DB, paging 15, no WS) on ${PORT}`);
});
