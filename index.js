// import multer from "multer";
// import FormData from "form-data";
// import fs from "fs";

// import express from "express";
// import cors from "cors";
// import axios from "axios";
// import { createServer } from "http";
// import { Server } from "socket.io";

// import { upsertDialog, getDialogsFromDb } from "./db.js";

// const upload = multer({ dest: "uploads/" });

// const API_URL = "https://7105.api.green-api.com";
// const ID = "7105413631";
// const TOKEN = "3b852ee145e54acb8b2357fd933278fc7ba1a99f86c84421ae";

// const app = express();
// app.use(cors({ origin: "*" }));
// app.use(express.json());

// const server = createServer(app);
// const io = new Server(server, { cors: { origin: "*" } });

// // ===== helpers =====

// const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/;

// // ===== /dialogs — список чатов для сайдбара (из БД, с fallback в GreenAPI) =====

// app.get("/dialogs", async (req, res) => {
//   try {
//     // 1) сперва пробуем взять из SQLite
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

//   // 2) если в БД пусто — идём в GreenAPI и сразу заполняем SQLite
//   try {
//     const r = await axios.post(
//       `${API_URL}/waInstance${ID}/getChats/${TOKEN}`,
//       {}
//     );

//     const raw = Array.isArray(r.data) ? r.data : [];

//     const dialogs = raw
//       .filter((c) => c.id && c.id !== "0@s.whatsapp.net")
//       .map((c) => {
//         const last = c.lastMessage || {};
//         const tsRaw =
//           last.timestamp || last.timeMessage || c.lastMessageTime || null;
//         const tsMs = tsRaw ? tsRaw * 1000 : null;

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

//         // записываем в SQLite
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

//     // 3) fallback — ещё раз пытаемся вернуть хоть что-то из БД
//     try {
//       const rows = getDialogsFromDb();
//       if (Array.isArray(rows) && rows.length) {
//         const fromDb = rows
//           .filter((d) => d.chatId && d.chatId !== "0@s.whatsapp.net")
//           .map((d) => ({

//             chatId: d.chatId,
//             name: d.name || d.chatId,
//             lastMessage: d.lastMessage || "",
//             lastTime: d.lastTime || null,
//             unread: 0,
//           }))
//           .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

//         return res.json(fromDb);
//       }
//     } catch (err) {
//       console.error("fallback getDialogsFromDb error:", err.message);
//     }

//     return res.json([]);
//   }
// });

// // ===== /messages/:chatId — история сообщений (журнал, только для восстановления) =====

// app.get("/messages/:chatId", async (req, res) => {
//   const { chatId } = req.params;

//   if (!validChatIdRe.test(chatId)) {
//     return res.json([]);
//   }

//   try {
//     const response = await axios.post(
//       `${API_URL}/waInstance${ID}/getChatHistory/${TOKEN}`,
//       {
//         chatId,
//         count: 50,
//       }
//     );

//     const data = Array.isArray(response.data) ? response.data : [];
//     const result = [];

//     for (const raw of data) {
//       if (!raw || typeof raw !== "object") continue;

//       let tsRaw =
//         raw.timestamp ||
//         raw.timeMessage ||
//         raw.time ||
//         Math.floor(Date.now() / 1000);
//       const ts = tsRaw * 1000;

//       const text =
//         raw.textMessage ||
//         raw.message ||
//         raw.caption ||
//         (raw.extendedTextMessage && raw.extendedTextMessage.text) ||
//         "";

//       const mediaType = raw.typeMessage || raw.type || null;
//       const mediaUrl =
//         raw.downloadUrl || raw.urlFile || raw.url || null;

//       let replyTo = null;
//       const quoted = raw.quotedMessage;
//       if (quoted && typeof quoted === "object") {
//         replyTo = {
//           id: quoted.idMessage || "",
//           from: quoted.type === "outgoing" ? "me" : "client",
//           text: quoted.textMessage || quoted.message || "",
//         };
//       }

//       result.push({
//         id: raw.idMessage || String(ts),
//         from: raw.type === "outgoing" ? "me" : "client",
//         text,
//         timestamp: ts,
//         mediaType,
//         mediaUrl,
//         replyTo,
//       });
//     }

//     const msgs = result.reverse();
//     return res.json(msgs);
//   } catch (e) {
//     const status = e.response?.status;
//     const data = e.response?.data;

//     if (status === 429) {
//       console.error("getChatHistory error: 429 Request limit");
//     } else {
//       console.error(
//         "getChatHistory error:",
//         status || "",
//         (data && data.message) || e.message
//       );
//     }

//     return res.json([]);
//   }
// });

// // ===== /send-file — отправка файла =====

// app.post("/send-file", upload.single("file"), async (req, res) => {
//   const { chatId, caption } = req.body;
//   const file = req.file;

//   if (!chatId || !file) {
//     return res.status(400).json({ detail: "chatId or file missing" });
//   }

//   try {
//     const form = new FormData();
//     form.append("chatId", chatId);
//     form.append("caption", caption || "");
//     form.append("file", fs.createReadStream(file.path), file.originalname);

//     const r = await axios.post(
//       `${API_URL}/waInstance${ID}/sendFileByUpload/${TOKEN}`,
//       form,
//       { headers: form.getHeaders() }
//     );

//     fs.unlink(file.path, () => {});
//     res.json(r.data);
//   } catch (e) {
//     console.error(
//       "sendFile error:",
//       e.response?.status,
//       e.response?.data || e.message
//     );
//     res.status(500).json({ detail: "sendFile failed" });
//   }
// });

// // ===== /send — отправка текстового сообщения =====

// app.post("/send", async (req, res) => {
//   const { chatId, text, replyTo } = req.body;

//   try {
//     const r = await axios.post(
//       `${API_URL}/waInstance${ID}/sendMessage/${TOKEN}`,
//       { chatId, message: text }
//     );

//     const now = Date.now();

//     const msg = {
//       id: r.data.idMessage,
//       from: "me",
//       text,
//       timestamp: now,
//       replyTo: replyTo || null,
//     };

//     // обновляем SQLite
//     upsertDialog({
//       chatId,
//       name: chatId,
//       lastMessage: text,
//       lastTime: now,
//     });

//     // отправляем в сокет
//     io.emit("newMessage", { chatId, message: msg });

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: text,
//       lastTime: now,
//       incrementUnread: false,
//     });

//     return res.json(msg);
//   } catch (e) {
//     console.error("sendMessage error:", e.message);
//     return res.status(500).json({ detail: "sendMessage failed" });
//   }
// });

// // ===== /read-chat — пометить чат прочитанным =====

// app.post("/read-chat", async (req, res) => {
//   const { chatId } = req.body;

//   if (!chatId) {
//     return res.status(400).json({ detail: "chatId is required" });
//   }

//   try {
//     const r = await axios.post(
//       `${API_URL}/waInstance${ID}/readChat/${TOKEN}`,
//       { chatId }
//     );

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: undefined,
//       lastTime: Date.now(),
//       incrementUnread: false,
//     });

//     return res.json(r.data);
//   } catch (e) {
//     console.error(
//       "readChat error:",
//       e.response?.status,
//       e.response?.data || e.message
//     );
//     return res.status(500).json({ detail: "readChat failed" });
//   }
// });

// // ===== webhook Green API =====
// // В кабинете Green ставишь http://eva.adam247.webtm.ru/api/green/webhook
// // Поддерживаем и "чистое" тело, и вариант с { body: {...} }

// function handleWebhookBody(rawBody) {
//   const body = rawBody && rawBody.body ? rawBody.body : rawBody;
//   if (!body || typeof body !== "object") return;

//   const type = body.typeWebhook;

//   // ВХОДЯЩИЕ сообщения
//   if (type === "incomingMessageReceived") {
//     const chatId = body.senderData?.chatId;
//     const name =
//       body.senderData?.senderName ||
//       body.senderData?.chatName ||
//       chatId;

//     const text =
//       body.messageData?.textMessageData?.textMessage ||
//       body.messageData?.extendedTextMessageData?.text ||
//       "";

//     if (!chatId || !text) return;

//     const now = Date.now();
//     const msg = {
//       id: body.idMessage,
//       from: "client",
//       text,
//       timestamp: now,
//     };

//     // обновляем БД
//     upsertDialog({
//       chatId,
//       name,
//       lastMessage: text,
//       lastTime: now,
//     });

//     // шлём в сокет
//     io.emit("newMessage", { chatId, message: msg });

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: text,
//       lastTime: now,
//       incrementUnread: true,
//     });
//   }

//   // ИСХОДЯЩИЕ с телефона или через API (чтобы видеть, если пишешь не через наш /send)
//   if (
//     type === "outgoingMessageReceived" ||
//     type === "outgoingAPIMessageReceived"
//   ) {
//     const chatId = body.senderData?.chatId;
//     const name =
//       body.senderData?.senderName ||
//       body.senderData?.chatName ||
//       chatId;

//     const text =
//       body.messageData?.textMessageData?.textMessage ||
//       body.messageData?.extendedTextMessageData?.text ||
//       "";

//     if (!chatId || !text) return;

//     const now = Date.now();
//     const msg = {
//       id: body.idMessage,
//       from: "me",
//       text,
//       timestamp: now,
//     };

//     upsertDialog({
//       chatId,
//       name,
//       lastMessage: text,
//       lastTime: now,
//     });

//     io.emit("newMessage", { chatId, message: msg });

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: text,
//       lastTime: now,
//       incrementUnread: false,
//     });
//   }
// }

// // основной путь, который прописываешь в Green API
// app.post("/api/green/webhook", (req, res) => {
//   try {
//     handleWebhookBody(req.body);
//   } catch (e) {
//     console.error("webhook error:", e.message);
//   }
//   res.sendStatus(200);
// });

// // старый путь оставим как заглушку, если где-то был указан
// app.post("/webhook", (req, res) => {
//   res.sendStatus(200);
// });

// // ===== long-poll Green API (опционально, для локалки / отладки) =====

// async function pollNotifications() {
//   try {
//     const r = await axios.get(
//       `${API_URL}/waInstance${ID}/receiveNotification/${TOKEN}`
//     );

//     if (!r.data || !r.data.body) return;

//     // используем ту же обработку, что и для вебхука
//     handleWebhookBody(r.data);

//     const receiptId = r.data.receiptId;
//     if (receiptId) {
//       await axios.delete(
//         `${API_URL}/waInstance${ID}/deleteNotification/${TOKEN}/${receiptId}`
//       );
//     }
//   } catch (e) {
//     // 429 и сетевые ошибки просто тихо игнорируем
//   }
// }

// // если хочешь — оставляй для дев-режима, для проды можно выключить
// setInterval(pollNotifications, 1000);

// io.on("connection", () => {
//   console.log("WS client connected");
// });

// server.listen(3001, () => {
//   console.log("WhatsApp backend on 3001");
// });






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

// // простая проверка, чтобы сразу видеть, если .env не настроен
// if (!GREEN_ID || !GREEN_TOKEN) {
//   console.error(
//     "[FATAL] GREEN_ID или GREEN_TOKEN не заданы в .env. Проверь .env."
//   );
// }

// // гарантируем наличие папки uploads
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

// // ===== helpers =====

// const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/;

// // нормализация текста/медиа из webhook
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

// function greenUrl(path) {
//   // path без / в начале, например "getChats", "sendMessage"
//   return `${API_URL}/waInstance${GREEN_ID}/${path}/${GREEN_TOKEN}`;
// }

// // ===== /dialogs — список чатов для сайдбара (из БД, с fallback в GreenAPI) =====

// app.get("/dialogs", async (req, res) => {
//   try {
//     // 1) сперва пробуем взять из SQLite
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

//   // 2) если в БД пусто — идём в GreenAPI и сразу заполняем SQLite
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
//               ? tsRaw // уже мс
//               : tsRaw * 1000 // секунды -> мс
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

//         // записываем в SQLite
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

//     // 3) fallback — ещё раз пытаемся вернуть хоть что-то из БД
//     try {
//       const rows = getDialogsFromDb();
//       if (Array.isArray(rows) && rows.length) {
//         const fromDb = rows
//           .filter((d) => d.chatId && d.chatId !== "0@s.whatsapp.net")
//           .map((d) => ({
//             chatId: d.chatId,
//             name: d.name || d.chatId,
//             lastMessage: d.lastMessage || "",
//             lastTime: d.lastTime || null,
//             unread: 0,
//           }))
//           .sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));

//         return res.json(fromDb);
//       }
//     } catch (err) {
//       console.error("fallback getDialogsFromDb error:", err.message);
//     }

//     return res.json([]);
//   }
// });

// // ===== /messages/:chatId — история сообщений (журнал, только для восстановления) =====

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
//       if (!raw || typeof raw !== "object") continue;

//       let tsRaw =
//         raw.timestamp ||
//         raw.timeMessage ||
//         raw.time ||
//         Math.floor(Date.now() / 1000);
//       // защита от секунд/миллисекунд
//       let ts =
//         typeof tsRaw === "number"
//           ? tsRaw.toString().length > 10
//             ? tsRaw
//             : tsRaw * 1000
//           : Date.now();

//       const text =
//         raw.textMessage ||
//         raw.message ||
//         raw.caption ||
//         (raw.extendedTextMessage && raw.extendedTextMessage.text) ||
//         "";

//       const mediaType = raw.typeMessage || raw.type || null;
//       const mediaUrl = raw.downloadUrl || raw.urlFile || raw.url || null;

//       let replyTo = null;
//       const quoted = raw.quotedMessage;
//       if (quoted && typeof quoted === "object") {
//         replyTo = {
//           id: quoted.idMessage || "",
//           from: quoted.type === "outgoing" ? "me" : "client",
//           text: quoted.textMessage || quoted.message || "",
//         };
//       }

//       result.push({
//         id: raw.idMessage || String(ts),
//         from: raw.type === "outgoing" ? "me" : "client",
//         text,
//         timestamp: ts,
//         mediaType,
//         mediaUrl,
//         replyTo,
//       });
//     }

//     const msgs = result.reverse();
//     return res.json(msgs);
//   } catch (e) {
//     const status = e.response?.status;
//     const data = e.response?.data;

//     if (status === 429) {
//       console.error("getChatHistory error: 429 Request limit");
//     } else {
//       console.error(
//         "getChatHistory error:",
//         status || "",
//         (data && data.message) || e.message
//       );
//     }

//     return res.json([]);
//   }
// });

// // ===== /send-file — отправка файла =====

// app.post("/send-file", upload.single("file"), async (req, res) => {
//   const { chatId, caption } = req.body;
//   const file = req.file;

//   if (!chatId || !file) {
//     if (file?.path) fs.unlink(file.path, () => {});
//     return res.status(400).json({ detail: "chatId or file missing" });
//   }

//   let tmpPath = file.path;

//   try {
//     const form = new FormData();
//     form.append("chatId", chatId);
//     form.append("caption", caption || "");
//     form.append("file", fs.createReadStream(tmpPath), file.originalname);

//     const r = await axios.post(greenUrl("sendFileByUpload"), form, {
//       headers: form.getHeaders(),
//     });

//     res.json(r.data);
//   } catch (e) {
//     console.error(
//       "sendFile error:",
//       e.response?.status,
//       e.response?.data || e.message
//     );
//     res.status(500).json({ detail: "sendFile failed" });
//   } finally {
//     if (tmpPath) fs.unlink(tmpPath, () => {});
//   }
// });

// // ===== /send — отправка текстового сообщения =====

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

//     // обновляем SQLite
//     upsertDialog({
//       chatId,
//       name: chatId,
//       lastMessage: text,
//       lastTime: now,
//     });

//     // отправляем в сокет
//     io.emit("newMessage", { chatId, message: msg });

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: text,
//       lastTime: now,
//       incrementUnread: false,
//     });

//     return res.json(msg);
//   } catch (e) {
//     console.error("sendMessage error:", e.message);
//     return res.status(500).json({ detail: "sendMessage failed" });
//   }
// });

// // ===== /read-chat — пометить чат прочитанным =====

// app.post("/read-chat", async (req, res) => {
//   const { chatId } = req.body;

//   if (!chatId) {
//     return res.status(400).json({ detail: "chatId is required" });
//   }

//   try {
//     const r = await axios.post(greenUrl("readChat"), { chatId });

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: undefined,
//       lastTime: Date.now(),
//       incrementUnread: false,
//     });

//     return res.json(r.data);
//   } catch (e) {
//     console.error(
//       "readChat error:",
//       e.response?.status,
//       e.response?.data || e.message
//     );
//     return res.status(500).json({ detail: "readChat failed" });
//   }
// });

// // ===== webhook Green API =====

// function handleWebhookBody(rawBody) {
//   const body = rawBody && rawBody.body ? rawBody.body : rawBody;
//   if (!body || typeof body !== "object") return;

//   const type = body.typeWebhook;
//   const senderData = body.senderData || {};
//   const messageData = body.messageData || {};

//   // ВХОДЯЩИЕ сообщения
//   if (type === "incomingMessageReceived") {
//     const chatId = senderData.chatId;
//     const name =
//       senderData.senderName ||
//       senderData.chatName ||
//       chatId;

//     const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);

//     // если совсем пусто — игнорим (нет текста и нет медиа)
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

//     // обновляем БД
//     upsertDialog({
//       chatId,
//       name,
//       lastMessage: text || "[MEDIA]",
//       lastTime: now,
//     });

//     // шлём в сокет
//     io.emit("newMessage", { chatId, message: msg });

//     io.emit("dialogUpdated", {
//       chatId,
//       lastMessage: text || "[MEDIA]",
//       lastTime: now,
//       incrementUnread: true,
//     });
//   }

//   // ИСХОДЯЩИЕ с телефона или через API
//   if (
//     type === "outgoingMessageReceived" ||
//     type === "outgoingAPIMessageReceived"
//   ) {
//     const chatId = senderData.chatId;
//     const name =
//       senderData.senderName ||
//       senderData.chatName ||
//       chatId;

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

// // основной путь, который прописываешь в Green API
// app.post("/api/green/webhook", (req, res) => {
//   try {
//     handleWebhookBody(req.body);
//   } catch (e) {
//     console.error("webhook error:", e.message);
//   }
//   res.sendStatus(200);
// });

// // старый путь оставим как заглушку, если где-то был указан
// app.post("/webhook", (req, res) => {
//   res.sendStatus(200);
// });

// // ===== long-poll Green API (опционально, для локалки / отладки) =====

// async function pollNotifications() {
//   try {
//     const r = await axios.get(greenUrl("receiveNotification"));

//     if (!r.data || !r.data.body) return;

//     // используем ту же обработку, что и для вебхука
//     handleWebhookBody(r.data);

//     const receiptId = r.data.receiptId;
//     if (receiptId) {
//       await axios.delete(greenUrl(`deleteNotification/${receiptId}`));
//     }
//   } catch (e) {
//     // 429 и сетевые ошибки просто тихо игнорируем
//   }
// }

// // включение через .env
// if (process.env.GREEN_POLL_ENABLED === "1") {
//   setInterval(pollNotifications, 1000);
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

if (!GREEN_ID || !GREEN_TOKEN) {
  console.error("[FATAL] GREEN_ID или GREEN_TOKEN не заданы в .env");
}

function greenUrl(path) {
  return `${API_URL}/waInstance${GREEN_ID}/${path}/${GREEN_TOKEN}`;
}

// гарантируем uploads
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

// ===== helpers для webhook/notifications =====

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

function handleWebhookBody(rawBody) {
  const body = rawBody && rawBody.body ? rawBody.body : rawBody;
  if (!body || typeof body !== "object") return;

  const type = body.typeWebhook;
  const senderData = body.senderData || {};
  const messageData = body.messageData || {};

  // ВХОДЯЩИЕ
  if (type === "incomingMessageReceived") {
    const chatId = senderData.chatId;
    const name =
      senderData.senderName ||
      senderData.chatName ||
      chatId;

    const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
    if (!chatId || (!text && !mediaUrl)) return;

    const now = Date.now();
    const msg = {
      id: body.idMessage,
      from: "client",
      text,
      timestamp: now,
      mediaType,
      mediaUrl,
    };

    upsertDialog({
      chatId,
      name,
      lastMessage: text || "[MEDIA]",
      lastTime: now,
    });

    io.emit("newMessage", { chatId, message: msg });

    io.emit("dialogUpdated", {
      chatId,
      lastMessage: text || "[MEDIA]",
      lastTime: now,
      incrementUnread: true,
    });
  }

  // ИСХОДЯЩИЕ (с телефона или API)
  if (
    type === "outgoingMessageReceived" ||
    type === "outgoingAPIMessageReceived"
  ) {
    const chatId = senderData.chatId;
    const name =
      senderData.senderName ||
      senderData.chatName ||
      chatId;

    const { text, mediaType, mediaUrl } = extractWebhookContent(messageData);
    if (!chatId || (!text && !mediaUrl)) return;

    const now = Date.now();
    const msg = {
      id: body.idMessage,
      from: "me",
      text,
      timestamp: now,
      mediaType,
      mediaUrl,
    };

    upsertDialog({
      chatId,
      name,
      lastMessage: text || "[MEDIA]",
      lastTime: now,
    });

    io.emit("newMessage", { chatId, message: msg });

    io.emit("dialogUpdated", {
      chatId,
      lastMessage: text || "[MEDIA]",
      lastTime: now,
      incrementUnread: false,
    });
  }
}

// ===== /dialogs =====

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

// ===== /messages/:chatId (журнал) =====

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
      if (!raw || typeof raw !== "object") continue;

      let tsRaw =
        raw.timestamp ||
        raw.timeMessage ||
        raw.time ||
        Math.floor(Date.now() / 1000);

      const ts =
        typeof tsRaw === "number"
          ? tsRaw.toString().length > 10
            ? tsRaw
            : tsRaw * 1000
          : Date.now();

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

      result.push({
        id: raw.idMessage || String(ts),
        from: raw.type === "outgoing" ? "me" : "client",
        text,
        timestamp: ts,
        mediaType,
        mediaUrl,
        replyTo,
      });
    }

    return res.json(result.reverse());
  } catch (e) {
    console.error("getChatHistory error:", e.response?.status || e.message);
    return res.json([]);
  }
});

// ===== /send-file =====

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

// ===== /send =====

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
      id: r.data.idMessage,
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
      lastMessage: text,
      lastTime: now,
      incrementUnread: false,
    });

    return res.json(msg);
  } catch (e) {
    console.error("sendMessage error:", e.message);
    return res.status(500).json({ detail: "sendMessage failed" });
  }
});

// ===== /read-chat =====

app.post("/read-chat", async (req, res) => {
  const { chatId } = req.body;

  if (!chatId) {
    return res.status(400).json({ detail: "chatId is required" });
  }

  try {
    const r = await axios.post(greenUrl("readChat"), { chatId });
    // здесь НИЧЕГО не шлём в сокет — фронт сам обнуляет unread
    return res.json(r.data);
  } catch (e) {
    console.error(
      "readChat error:",
      e.response?.status,
      e.response?.data || e.message
    );
    return res.status(500).json({ detail: "readChat failed" });
  }
});



// ===== /read-chat — пометить чат прочитанным =====

app.post("/read-chat", async (req, res) => {
  const { chatId } = req.body;

  if (!chatId) {
    return res.status(400).json({ detail: "chatId is required" });
  }

  try {
    // пробуем дернуть GreenAPI, но НЕ роняем сервер
    await axios
      .post(greenUrl("readChat"), { chatId })
      .catch((e) => {
        console.error(
          "readChat error:",
          e.response?.status,
          e.response?.data || e.message
        );
      });

    // всегда отвечаем 200, чтобы фронт не видел 500
    return res.json({ ok: true });
  } catch (e) {
    console.error("read-chat internal error:", e.message);
    return res.json({ ok: false });
  }
});



// ===== webhook endpoint (если вдруг настроишь) =====

app.post("/api/green/webhook", (req, res) => {
  try {
    handleWebhookBody(req.body);
  } catch (e) {
    console.error("webhook error:", e.message);
  }
  res.sendStatus(200);
});

app.post("/webhook", (_req, res) => res.sendStatus(200));

// ===== long-poll HTTP notifications =====

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
  setInterval(pollNotifications, 1000);
}

io.on("connection", () => {
  console.log("WS client connected");
});

server.listen(PORT, () => {
  console.log(`WhatsApp backend on ${PORT}`);
});
