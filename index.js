// import "dotenv/config";

// import multer from "multer";
// import FormData from "form-data";
// import fs from "fs";

// import express from "express";
// import cors from "cors";
// import axios from "axios";
// import { createServer } from "http";
// import { Server } from "socket.io";

// import { upsertDialog, getDialogsFromDb } from "./db.js";

// const API_URL = process.env.GREEN_API_URL || "https://7105.api.green-api.com";
// const GREEN_ID = process.env.GREEN_ID;
// const GREEN_TOKEN = process.env.GREEN_TOKEN;
// const PORT = Number(process.env.PORT || 3001);

// // интервал long-poll в мс (по умолчанию 25 c)
// const POLL_INTERVAL = Number(process.env.GREEN_POLL_INTERVAL_MS || 25000);

// if (!GREEN_ID || !GREEN_TOKEN) {
//   console.error("[FATAL] GREEN_ID или GREEN_TOKEN не заданы в .env");
// }

// function greenUrl(path) {
//   return `${API_URL}/waInstance${GREEN_ID}/${path}/${GREEN_TOKEN}`;
// }

// // ===== uploads (для отправки файлов) =====
// const UPLOAD_DIR = "uploads";
// if (!fs.existsSync(UPLOAD_DIR)) {
//   fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// }
// const upload = multer({ dest: UPLOAD_DIR });

// const app = express();
// app.use(cors({ origin: "*" }));
// app.use(express.json());

// const server = createServer(app);
// const io = new Server(server, { cors: { origin: "*" } });

// const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/;

// // ================== helpers ==================

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

// // общий парсер сообщения GreenAPI -> наш формат
// function parseGreenMessage(raw) {
//   if (!raw || typeof raw !== "object") return null;

//   // 1) берём только настоящий timestamp
//   let tsRaw = raw.timestamp || raw.timeMessage || raw.time || null;
//   if (typeof tsRaw !== "number") {
//     // нет честного времени — игнорируем это сообщение
//     return null;
//   }

//   const ts =
//     tsRaw.toString().length > 10
//       ? tsRaw             // уже миллисекунды
//       : tsRaw * 1000;     // секунды -> мс

//   // 2) нужен стабильный id, без выдумок
//   const id =
//     raw.idMessage ||
//     raw.id ||
//     (raw.key && (raw.key.idMessage || raw.key.id)) ||
//     null;

//   if (!id) {
//     // нет id -> тоже игнорируем
//     return null;
//   }

//   const text =
//     raw.textMessage ||
//     raw.message ||
//     raw.caption ||
//     (raw.extendedTextMessage && raw.extendedTextMessage.text) ||
//     "";

//   const mediaType = raw.typeMessage || raw.type || null;
//   const mediaUrl = raw.downloadUrl || raw.urlFile || raw.url || null;

//   let replyTo = null;
//   const quoted = raw.quotedMessage;
//   if (quoted && typeof quoted === "object") {
//     replyTo = {
//       id: quoted.idMessage || "",
//       from: quoted.type === "outgoing" ? "me" : "client",
//       text: quoted.textMessage || quoted.message || "",
//     };
//   }

//   return {
//     id,
//     from: raw.type === "outgoing" ? "me" : "client",
//     text,
//     timestamp: ts,
//     mediaType,
//     mediaUrl,
//     replyTo,
//   };
// }


// function handleWebhookBody(rawBody) {
//   const body = rawBody && rawBody.body ? rawBody.body : rawBody;
//   if (!body || typeof body !== "object") return;

//   const type = body.typeWebhook;
//   const senderData = body.senderData || {};
//   const messageData = body.messageData || {};

//   // ВХОДЯЩИЕ
//   if (type === "incomingMessageReceived") {
//     const chatId = senderData.chatId;
//     const name = senderData.senderName || senderData.chatName || chatId;

//     const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
//     if (!chatId || (!text && !mediaUrl)) return;

//     const now = Date.now();
//     const msg = {
//       id: body.idMessage,
//       from: "client",
//       text,
//       timestamp: now,
//       mediaType,
//       mediaUrl,
//     };

//     upsertDialog({
//       chatId,
//       name,
//       lastMessage: text || "[MEDIA]",
//       lastTime: now,
//     });

//     io.emit("newMessage", { chatId, message: msg });

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: text || "[MEDIA]",
//       lastTime: now,
//       incrementUnread: true,
//     });
//   }

//   // ИСХОДЯЩИЕ (с телефона или API)
//   if (
//     type === "outgoingMessageReceived" ||
//     type === "outgoingAPIMessageReceived"
//   ) {
//     const chatId = senderData.chatId;
//     const name = senderData.senderName || senderData.chatName || chatId;

//     const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
//     if (!chatId || (!text && !mediaUrl)) return;

//     const now = Date.now();
//     const msg = {
//       id: body.idMessage,
//       from: "me",
//       text,
//       timestamp: now,
//       mediaType,
//       mediaUrl,
//     };

//     upsertDialog({
//       chatId,
//       name,
//       lastMessage: text || "[MEDIA]",
//       lastTime: now,
//     });

//     io.emit("newMessage", { chatId, message: msg });

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: text || "[MEDIA]",
//       lastTime: now,
//       incrementUnread: false,
//     });
//   }
// }

// // ================== /dialogs ==================

// app.get("/dialogs", async (_req, res) => {
//   try {
//     const rows = getDialogsFromDb();
//     if (Array.isArray(rows) && rows.length) {
//       const fromDb = rows
//         .filter((d) => d.chatId && d.chatId !== "0@s.whatsapp.net")
//         .map((d) => ({
//           chatId: d.chatId,
//           name: d.name || d.chatId,
//           lastMessage: d.lastMessage || "",
//           lastTime: d.lastTime || null,
//           unread: 0,
//         }))
//         .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

//       return res.json(fromDb);
//     }
//   } catch (e) {
//     console.error("getDialogsFromDb error:", e.message);
//   }

//   try {
//     const r = await axios.post(greenUrl("getChats"), {});
//     const raw = Array.isArray(r.data) ? r.data : [];

//     const dialogs = raw
//       .filter((c) => c.id && c.id !== "0@s.whatsapp.net")
//       .map((c) => {
//         const last = c.lastMessage || {};
//         const tsRaw =
//           last.timestamp || last.timeMessage || c.lastMessageTime || null;
//         const tsMs =
//           typeof tsRaw === "number"
//             ? tsRaw.toString().length > 10
//               ? tsRaw
//               : tsRaw * 1000
//             : null;

//         const text =
//           last.textMessage ||
//           last.message ||
//           last.caption ||
//           last.extendedTextMessage?.text ||
//           "";

//         const dialog = {
//           chatId: c.id,
//           name: c.name || c.chatName || c.id,
//           lastMessage: text,
//           lastTime: tsMs,
//           unread: c.unreadMessages || 0,
//         };

//         upsertDialog({
//           chatId: dialog.chatId,
//           name: dialog.name,
//           lastMessage: dialog.lastMessage,
//           lastTime: dialog.lastTime || Date.now(),
//         });

//         return dialog;
//       })
//       .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

//     return res.json(dialogs);
//   } catch (e) {
//     console.error(
//       "getChats error:",
//       e.response?.status,
//       e.response?.data || e.message
//     );
//   }

//   return res.json([]);
// });

// // ================== /messages/:chatId ==================

// app.get("/messages/:chatId", async (req, res) => {
//   const { chatId } = req.params;

//   if (!validChatIdRe.test(chatId)) {
//     return res.json([]);
//   }

//   try {
//     const response = await axios.post(greenUrl("getChatHistory"), {
//       chatId,
//       count: 50,
//     });

//     const data = Array.isArray(response.data) ? response.data : [];
//     const result = [];

//     for (const raw of data) {
//       const m = parseGreenMessage(raw);
//       if (m) result.push(m);
//     }

//     return res.json(result.reverse());
//   } catch (e) {
//     console.error("getChatHistory error:", e.response?.status || e.message);
//     return res.json([]);
//   }
// });

// // ================== /poll-dialog/:chatId ==================

// app.get("/poll-dialog/:chatId", async (req, res) => {
//   const { chatId } = req.params;

//   if (!validChatIdRe.test(chatId)) {
//     return res.json(null);
//   }

//   try {
//     const r = await axios.post(greenUrl("getChatHistory"), {
//       chatId,
//       count: 1,
//     });

//     const data = Array.isArray(r.data) ? r.data : [];
//     const raw = data[0];
//     if (!raw) {
//       return res.json(null);
//     }

//     const m = parseGreenMessage(raw);
//     if (!m) return res.json(null);

//     upsertDialog({
//       chatId,
//       name: chatId,
//       lastMessage: m.text || "[MEDIA]",
//       lastTime: m.timestamp,
//     });

//     return res.json(m);
//   } catch (e) {
//     console.error("poll-dialog error:", e.response?.status || e.message);
//     return res.json(null);
//   }
// });

// // ================== /send-file ==================

// app.post("/send-file", upload.single("file"), async (req, res) => {
//   const { chatId, caption } = req.body;
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

//     return res.json(r.data);
//   } catch (e) {
//     console.error(
//       "sendFile error:",
//       e.response?.status,
//       e.response?.data || e.message
//     );
//     return res.status(500).json({ detail: "sendFile failed" });
//   } finally {
//     if (tmpPath) fs.unlink(tmpPath, () => {});
//   }
// });

// // ================== /send ==================

// app.post("/send", async (req, res) => {
//   const { chatId, text, replyTo } = req.body;

//   if (!chatId || !text) {
//     return res.status(400).json({ detail: "chatId and text are required" });
//   }

//   try {
//     const r = await axios.post(greenUrl("sendMessage"), {
//       chatId,
//       message: text,
//     });

//     const now = Date.now();

//     const msg = {
//       id: r.data.idMessage,
//       from: "me",
//       text,
//       timestamp: now,
//       replyTo: replyTo || null,
//     };

//     upsertDialog({
//       chatId,
//       name: chatId,
//       lastMessage: text,
//       lastTime: now,
//     });

//     io.emit("newMessage", { chatId, message: msg });

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: text || "[MEDIA]",
//       lastTime: now,
//       incrementUnread: false,
//     });

//     return res.json(msg);
//   } catch (e) {
//     console.error("sendMessage error:", e.message);
//     return res.status(500).json({ detail: "sendMessage failed" });
//   }
// });

// // ================== /read-chat ==================

// app.post("/read-chat", async (req, res) => {
//   const { chatId } = req.body;

//   if (!chatId) {
//     return res.status(400).json({ detail: "chatId is required" });
//   }

//   // ❗ не дёргаем GreenAPI для кривых chatId
//   const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/;
//   if (!validChatIdRe.test(chatId)) {
//     return res.json({ ok: false, reason: "invalid_chat_id" });
//   }

//   try {
//     await axios
//       .post(greenUrl("readChat"), { chatId })
//       .catch((e) => {
//         console.error(
//           "readChat error:",
//           e.response?.status,
//           e.response?.data || e.message
//         );
//       });

//     return res.json({ ok: true });
//   } catch (e) {
//     console.error("read-chat internal error:", e.message);
//     return res.json({ ok: false });
//   }
// });

// // ================== webhook endpoints ==================

// app.post("/api/green/webhook", (req, res) => {
//   try {
//     handleWebhookBody(req.body);
//   } catch (e) {
//     console.error("webhook error:", e.message);
//   }
//   res.sendStatus(200);
// });

// app.post("/webhook", (_req, res) => res.sendStatus(200));

// // ================== long-poll notifications ==================

// async function pollNotifications() {
//   try {
//     const r = await axios.get(greenUrl("receiveNotification"));
//     if (!r.data || !r.data.body) return;

//     handleWebhookBody(r.data);

//     const receiptId = r.data.receiptId;
//     if (receiptId) {
//       await axios.delete(greenUrl(`deleteNotification/${receiptId}`));
//     }
//   } catch (_e) {
//     // молча
//   }
// }

// if (process.env.GREEN_POLL_ENABLED === "1") {
//   setInterval(pollNotifications, POLL_INTERVAL);
// }

// io.on("connection", () => {
//   console.log("WS client connected");
// });

// server.listen(PORT, () => {
//   console.log(`WhatsApp backend on ${PORT}`);
// });




import "dotenv/config";

import multer from "multer";
import FormData from "form-data";
import fs from "fs";

import express from "express";
import cors from "cors";
import axios from "axios";
import { createServer } from "http";
import { Server } from "socket.io";

import { upsertDialog, getDialogsFromDb } from "./db.js";

const API_URL = process.env.GREEN_API_URL || "https://7105.api.green-api.com";
const GREEN_ID = process.env.GREEN_ID;
const GREEN_TOKEN = process.env.GREEN_TOKEN;
const PORT = Number(process.env.PORT || 3001);

// интервал long-poll в мс (по умолчанию 25 c)
const POLL_INTERVAL = Number(process.env.GREEN_POLL_INTERVAL_MS || 25000);

if (!GREEN_ID || !GREEN_TOKEN) {
  console.error("[FATAL] GREEN_ID или GREEN_TOKEN не заданы в .env");
}

function greenUrl(path) {
  return `${API_URL}/waInstance${GREEN_ID}/${path}/${GREEN_TOKEN}`;
}

// ===== uploads (для отправки файлов) =====
const UPLOAD_DIR = "uploads";
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
const upload = multer({ dest: UPLOAD_DIR });

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/;

// ================== helpers ==================

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

// единый способ достать timestamp из любого green-объекта
function getGreenTimestamp(obj) {
  if (!obj || typeof obj !== "object") return Date.now();

  let tsRaw =
    obj.timestamp ??
    obj.timeMessage ??
    obj.time ??
    obj.messageTimestamp ??
    null;

  if (typeof tsRaw !== "number") {
    return Date.now();
  }

  return tsRaw.toString().length > 10 ? tsRaw : tsRaw * 1000;
}

// единый способ достать/сгенерировать id
function getGreenId(obj, fallbackPrefix = "msg", fallbackTs) {
  if (!obj || typeof obj !== "object") {
    const ts = typeof fallbackTs === "number" ? fallbackTs : Date.now();
    return `${fallbackPrefix}_${ts}`;
  }

  const direct =
    obj.idMessage ||
    obj.id ||
    (obj.key && (obj.key.idMessage || obj.key.id)) ||
    null;

  if (direct) return direct;

  const ts =
    typeof fallbackTs === "number" ? fallbackTs : getGreenTimestamp(obj);

  return `${fallbackPrefix}_${ts}`;
}

// общий парсер сообщения GreenAPI -> наш формат
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

  let replyTo = null;
  const quoted = raw.quotedMessage;
  if (quoted && typeof quoted === "object") {
    replyTo = {
      id: quoted.idMessage || "",
      from: quoted.type === "outgoing" ? "me" : "client",
      text: quoted.textMessage || quoted.message || "",
    };
  }

  return {
    id,
    from: raw.type === "outgoing" ? "me" : "client",
    text,
    timestamp: ts,
    mediaType,
    mediaUrl,
    replyTo,
  };
}

function handleWebhookBody(rawBody) {
  const body = rawBody && rawBody.body ? rawBody.body : rawBody;
  if (!body || typeof body !== "object") return;

  const type = body.typeWebhook;
  const senderData = body.senderData || {};
  const messageData = body.messageData || {};

  // ВХОДЯЩИЕ
  if (type === "incomingMessageReceived") {
    const chatId = senderData.chatId;
    const name = senderData.senderName || senderData.chatName || chatId;

    const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
    if (!chatId || (!text && !mediaUrl)) return;

    const ts = getGreenTimestamp(messageData || body);
    const id = body.idMessage || getGreenId(messageData, chatId, ts);

    const msg = {
      id,
      from: "client",
      text,
      timestamp: ts,
      mediaType,
      mediaUrl,
    };

    upsertDialog({
      chatId,
      name,
      lastMessage: text || "[MEDIA]",
      lastTime: ts,
    });

    io.emit("newMessage", { chatId, message: msg });

    io.emit("dialogUpdated", {
      chatId,
      lastMessage: text || "[MEDIA]",
      lastTime: ts,
      incrementUnread: true,
    });
  }

  // ИСХОДЯЩИЕ (с телефона или API)
  if (
    type === "outgoingMessageReceived" ||
    type === "outgoingAPIMessageReceived"
  ) {
    const chatId = senderData.chatId;
    const name = senderData.senderName || senderData.chatName || chatId;

    const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
    if (!chatId || (!text && !mediaUrl)) return;

    const ts = getGreenTimestamp(messageData || body);
    const id = body.idMessage || getGreenId(messageData, chatId, ts);

    const msg = {
      id,
      from: "me",
      text,
      timestamp: ts,
      mediaType,
      mediaUrl,
    };

    upsertDialog({
      chatId,
      name,
      lastMessage: text || "[MEDIA]",
      lastTime: ts,
    });

    io.emit("newMessage", { chatId, message: msg });

    io.emit("dialogUpdated", {
      chatId,
      lastMessage: text || "[MEDIA]",
      lastTime: ts,
      incrementUnread: false,
    });
  }
}

// ================== /dialogs ==================

app.get("/dialogs", async (_req, res) => {
  try {
    const rows = getDialogsFromDb();
    if (Array.isArray(rows) && rows.length) {
      const fromDb = rows
        .filter((d) => d.chatId && d.chatId !== "0@s.whatsapp.net")
        .map((d) => ({
          chatId: d.chatId,
          name: d.name || d.chatId,
          lastMessage: d.lastMessage || "",
          lastTime: d.lastTime || null,
          unread: 0,
        }))
        .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

      return res.json(fromDb);
    }
  } catch (e) {
    console.error("getDialogsFromDb error:", e.message);
  }

  try {
    const r = await axios.post(greenUrl("getChats"), {});
    const raw = Array.isArray(r.data) ? r.data : [];

    const dialogs = raw
      .filter((c) => c.id && c.id !== "0@s.whatsapp.net")
      .map((c) => {
        const last = c.lastMessage || {};
        const tsRaw =
          last.timestamp || last.timeMessage || c.lastMessageTime || null;
        const tsMs =
          typeof tsRaw === "number"
            ? tsRaw.toString().length > 10
              ? tsRaw
              : tsRaw * 1000
            : null;

        const text =
          last.textMessage ||
          last.message ||
          last.caption ||
          last.extendedTextMessage?.text ||
          "";

        const dialog = {
          chatId: c.id,
          name: c.name || c.chatName || c.id,
          lastMessage: text,
          lastTime: tsMs,
          unread: c.unreadMessages || 0,
        };

        upsertDialog({
          chatId: dialog.chatId,
          name: dialog.name,
          lastMessage: dialog.lastMessage,
          lastTime: dialog.lastTime || Date.now(),
        });

        return dialog;
      })
      .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

    return res.json(dialogs);
  } catch (e) {
    console.error(
      "getChats error:",
      e.response?.status,
      e.response?.data || e.message
    );
  }

  return res.json([]);
});

// ================== /messages/:chatId ==================

app.get("/messages/:chatId", async (req, res) => {
  const { chatId } = req.params;

  if (!validChatIdRe.test(chatId)) {
    return res.json([]);
  }

  try {
    const response = await axios.post(greenUrl("getChatHistory"), {
      chatId,
      count: 50,
    });

    const data = Array.isArray(response.data) ? response.data : [];
    const result = [];

    for (const raw of data) {
      const m = parseGreenMessage(raw);
      if (m) result.push(m);
    }

    return res.json(result.reverse());
  } catch (e) {
    console.error("getChatHistory error:", e.response?.status || e.message);
    return res.json([]);
  }
});

// ================== /poll-dialog/:chatId ==================

app.get("/poll-dialog/:chatId", async (req, res) => {
  const { chatId } = req.params;

  if (!validChatIdRe.test(chatId)) {
    return res.json(null);
  }

  try {
    const r = await axios.post(greenUrl("getChatHistory"), {
      chatId,
      count: 1,
    });

    const data = Array.isArray(r.data) ? r.data : [];
    const raw = data[0];
    if (!raw) {
      return res.json(null);
    }

    const m = parseGreenMessage(raw);
    if (!m) return res.json(null);

    upsertDialog({
      chatId,
      name: chatId,
      lastMessage: m.text || "[MEDIA]",
      lastTime: m.timestamp,
    });

    return res.json(m);
  } catch (e) {
    console.error("poll-dialog error:", e.response?.status || e.message);
    return res.json(null);
  }
});

// ================== /send-file ==================

app.post("/send-file", upload.single("file"), async (req, res) => {
  const { chatId, caption } = req.body;
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

    return res.json(r.data);
  } catch (e) {
    console.error(
      "sendFile error:",
      e.response?.status,
      e.response?.data || e.message
    );
    return res.status(500).json({ detail: "sendFile failed" });
  } finally {
    if (tmpPath) fs.unlink(tmpPath, () => {});
  }
});

// ================== /send ==================

app.post("/send", async (req, res) => {
  const { chatId, text, replyTo } = req.body;

  if (!chatId || !text) {
    return res.status(400).json({ detail: "chatId and text are required" });
  }

  try {
    const r = await axios.post(greenUrl("sendMessage"), {
      chatId,
      message: text,
    });

    const now = Date.now();

    const msg = {
      id: r.data.idMessage || getGreenId({}, chatId, now),
      from: "me",
      text,
      timestamp: now,
      replyTo: replyTo || null,
    };

    upsertDialog({
      chatId,
      name: chatId,
      lastMessage: text,
      lastTime: now,
    });

    io.emit("newMessage", { chatId, message: msg });

    io.emit("dialogUpdated", {
      chatId,
      lastMessage: text || "[MEDIA]",
      lastTime: now,
      incrementUnread: false,
    });

    return res.json(msg);
  } catch (e) {
    console.error("sendMessage error:", e.message);
    return res.status(500).json({ detail: "sendMessage failed" });
  }
});

// ================== /read-chat ==================

app.post("/read-chat", async (req, res) => {
  const { chatId } = req.body;

  if (!chatId) {
    return res.status(400).json({ detail: "chatId is required" });
  }

  // ❗ не дёргаем GreenAPI для кривых chatId
  const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/;
  if (!validChatIdRe.test(chatId)) {
    return res.json({ ok: false, reason: "invalid_chat_id" });
  }

  try {
    await axios
      .post(greenUrl("readChat"), { chatId })
      .catch((e) => {
        console.error(
          "readChat error:",
          e.response?.status,
          e.response?.data || e.message
        );
      });

    return res.json({ ok: true });
  } catch (e) {
    console.error("read-chat internal error:", e.message);
    return res.json({ ok: false });
  }
});

// ================== webhook endpoints ==================

app.post("/api/green/webhook", (req, res) => {
  try {
    handleWebhookBody(req.body);
  } catch (e) {
    console.error("webhook error:", e.message);
  }
  res.sendStatus(200);
});

app.post("/webhook", (_req, res) => res.sendStatus(200));

// ================== long-poll notifications ==================

async function pollNotifications() {
  try {
    const r = await axios.get(greenUrl("receiveNotification"));
    if (!r.data || !r.data.body) return;

    handleWebhookBody(r.data);

    const receiptId = r.data.receiptId;
    if (receiptId) {
      await axios.delete(greenUrl(`deleteNotification/${receiptId}`));
    }
  } catch (_e) {
    // молча
  }
}

if (process.env.GREEN_POLL_ENABLED === "1") {
  setInterval(pollNotifications, POLL_INTERVAL);
}

io.on("connection", () => {
  console.log("WS client connected");
});

server.listen(PORT, () => {
  console.log(`WhatsApp backend on ${PORT}`);
});
