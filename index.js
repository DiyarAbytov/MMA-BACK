// index.js
import multer from "multer";
import FormData from "form-data";
import fs from "fs";

import express from "express";
import cors from "cors";
import axios from "axios";
import { createServer } from "http";
import { Server } from "socket.io";

import { upsertDialog, getDialogsFromDb } from "./db.js";

const upload = multer({ dest: "uploads/" });
// ---- ВВЕРХУ файла рядом с остальными переменными ----
let dialogsCache = []; // чтобы не терять список диалогов при 429 / ошибках
// ------------------------------------------------------

const API_URL = "https://7105.api.green-api.com";
const ID = "7105410024";
const TOKEN = "0e6dcbd545e54401991d71569516e218d8498c9b7714467e8a";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ===== helpers =====

const validChatIdRe = /@(c\.us|s\.whatsapp\.net|g\.us)$/;

// ===== /dialogs — список чатов для сайдбара (из БД, с fallback в GreenAPI) =====

// список диалогов для сайдбара
// ===== /dialogs — список чатов для сайдбара (из БД, с fallback в GreenAPI) =====
app.get("/dialogs", async (req, res) => {
  try {
    // 1) сперва пробуем взять из SQLite
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

  // 2) если в БД пусто — идём в GreenAPI и сразу заполняем SQLite
  try {
    const r = await axios.post(
      `${API_URL}/waInstance${ID}/getChats/${TOKEN}`,
      {}
    );

    const raw = Array.isArray(r.data) ? r.data : [];

    const dialogs = raw
      .filter((c) => c.id && c.id !== "0@s.whatsapp.net")
      .map((c) => {
        const last = c.lastMessage || {};
        const tsRaw =
          last.timestamp || last.timeMessage || c.lastMessageTime || null;
        const tsMs = tsRaw ? tsRaw * 1000 : null;

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

        // записываем в SQLite
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

    // 3) fallback — ещё раз пытаемся вернуть хоть что-то из БД
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
    } catch (err) {
      console.error("fallback getDialogsFromDb error:", err.message);
    }

    return res.json([]);
  }
});



// ===== /messages/:chatId — история сообщений чата =====
// ===== /messages/:chatId — история сообщений чата =====
app.get("/messages/:chatId", async (req, res) => {
  const { chatId } = req.params;

  // чатId должен быть валидным WhatsApp ID
  const valid = /@(c\.us|s\.whatsapp\.net|g\.us)$/;
  if (!valid.test(chatId)) {
    return res.json([]);
  }

  try {
    const response = await axios.post(
      `${API_URL}/waInstance${ID}/getChatHistory/${TOKEN}`,
      {
        chatId,
        count: 50,
      }
    );

    const data = Array.isArray(response.data) ? response.data : [];
    const result = [];

    // Green API обычно отдаёт от нового к старому.
    // Мы собираем, а потом развернём, чтобы в чате было "снизу вверх".
    for (const raw of data) {
      if (!raw || typeof raw !== "object") {
        continue;
      }

      let tsRaw =
        raw.timestamp ||
        raw.timeMessage ||
        raw.time ||
        Math.floor(Date.now() / 1000);
      const ts = tsRaw * 1000;

      const text =
        raw.textMessage ||
        raw.message ||
        raw.caption ||
        (raw.extendedTextMessage &&
          raw.extendedTextMessage.text) ||
        "";

      const mediaType = raw.typeMessage || raw.type || null;
      const mediaUrl =
        raw.downloadUrl || raw.urlFile || raw.url || null;

      let replyTo = null;
      const quoted = raw.quotedMessage;
      if (quoted && typeof quoted === "object") {
        replyTo = {
          id: quoted.idMessage || "",
          from: quoted.type === "outgoing" ? "me" : "client",
          text:
            quoted.textMessage ||
            quoted.message ||
            "",
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

    // делаем порядок от старых к новым (как раньше через .reverse())
    const msgs = result.reverse();

    // можно здесь же обновлять SQLite, если нужно:
    // if (msgs.length) {
    //   const last = msgs[msgs.length - 1];
    //   upsertDialog({
    //     chatId,
    //     name: chatId,
    //     lastMessage: last.text || "",
    //     lastTime: last.timestamp || Date.now(),
    //   });
    // }

    return res.json(msgs);
  } catch (e) {
    const status = e.response?.status;
    const data = e.response?.data;

    // 429 — просто лимит Green API, не шумим лишними данными
    if (status === 429) {
      console.error("getChatHistory error: 429 Request limit");
    } else {
      console.error(
        "getChatHistory error:",
        status || "",
        (data && data.message) || e.message
      );
    }

    // чтобы фронт не падал
    return res.json([]);
  }
});



// ===== /send-file — отправка файла =====

app.post("/send-file", upload.single("file"), async (req, res) => {
  const { chatId, caption } = req.body;
  const file = req.file;

  if (!chatId || !file) {
    return res.status(400).json({ detail: "chatId or file missing" });
  }

  try {
    const form = new FormData();
    form.append("chatId", chatId);
    form.append("caption", caption || "");
    form.append("file", fs.createReadStream(file.path), file.originalname);

    const r = await axios.post(
      `${API_URL}/waInstance${ID}/sendFileByUpload/${TOKEN}`,
      form,
      { headers: form.getHeaders() }
    );

    fs.unlink(file.path, () => {});
    res.json(r.data);
  } catch (e) {
    console.error(
      "sendFile error:",
      e.response?.status,
      e.response?.data || e.message
    );
    res.status(500).json({ detail: "sendFile failed" });
  }
});

// ===== /send — отправка текстового сообщения =====

// ====== отправка сообщения ======
app.post("/send", async (req, res) => {
  const { chatId, text, replyTo } = req.body;

  try {
    const r = await axios.post(
      `${API_URL}/waInstance${ID}/sendMessage/${TOKEN}`,
      { chatId, message: text }
    );

    const now = Date.now();

    const msg = {
      id: r.data.idMessage,
      from: "me",
      text,
      timestamp: now,
      replyTo: replyTo || null,
    };

    // сохраняем последнее сообщение в SQLite
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


// ===== /read-chat — пометить чат прочитанным =====
app.post("/read-chat", async (req, res) => {
  const { chatId } = req.body;

  if (!chatId) {
    return res.status(400).json({ detail: "chatId is required" });
  }

  try {
    const r = await axios.post(
      `${API_URL}/waInstance${ID}/readChat/${TOKEN}`,
      { chatId }
    );

    // можем дополнительно разослать событие, если нужно
    io.emit("dialogUpdated", {
      chatId,
      lastMessage: undefined,
      lastTime: Date.now(),
      incrementUnread: false,
    });

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



// ===== webhook (если когда-нибудь понадобится) =====

app.post("/webhook", (req, res) => {
  res.sendStatus(200);
});

// ===== long-poll Green API (приём входящих) =====
async function pollNotifications() {
  try {
    const r = await axios.get(
      `${API_URL}/waInstance${ID}/receiveNotification/${TOKEN}`
    );

    if (!r.data || !r.data.body) return;

    const { receiptId, body } = r.data;

    if (body.typeWebhook === "incomingMessageReceived") {
      const chatId = body.senderData?.chatId;

      const text =
        body.messageData?.textMessageData?.textMessage ||
        body.messageData?.extendedTextMessageData?.text ||
        "";

      if (chatId && text) {
        const now = Date.now();

        const msg = {
          id: body.idMessage,
          from: "client",
          text,
          timestamp: now,
        };

        // отправляем в окно чата
        io.emit("newMessage", { chatId, message: msg });

        // и сразу обновляем карточку диалога
        io.emit("dialogUpdated", {
          chatId,
          lastMessage: text,
          lastTime: now,
          incrementUnread: true,
        });
      }
    }

    await axios.delete(
      `${API_URL}/waInstance${ID}/deleteNotification/${TOKEN}/${receiptId}`
    );
  } catch (e) {
    // 429 и сетевые ошибки просто тихо игнорируем
  }
}





setInterval(pollNotifications, 1000);

io.on("connection", () => {
  console.log("WS client connected");
});

server.listen(3001, () => {
  console.log("WhatsApp backend on 3001");
});
