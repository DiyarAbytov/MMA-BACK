import express from "express";
import axios from "axios";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const API_URL = "https://7105.api.green-api.com";
const ID = "7105410024";
const TOKEN = "0e6dcbd545e54401991d71569516e218d8498c9b7714467e8a";

let dialogs = {};
let messages = {};

// ✅ SOCKET
io.on("connection", (socket) => {
  console.log("Client connected to WS");
});

// ✅ WEBHOOK
app.post("/webhook", (req, res) => {
  const data = req.body;

  if (data.typeWebhook === "incomingMessageReceived") {
    const chatId = data.senderData.chatId;
    const text =
      data.messageData?.textMessageData?.textMessage || "";

    if (!messages[chatId]) messages[chatId] = [];
    messages[chatId].push({ from: "client", text });

    dialogs[chatId] = {
      chatId,
      phone: data.senderData.sender,
    };

    // ✅ PUSH НА ФРОНТ
    io.emit("new-message", {
      chatId,
      message: { from: "client", text },
    });
  }

  res.sendStatus(200);
});

// ✅ ЧАТЫ
app.get("/dialogs", (req, res) => {
  res.json(Object.values(dialogs));
});

// ✅ СООБЩЕНИЯ
app.get("/messages/:chatId", (req, res) => {
  res.json(messages[req.params.chatId] || []);
});

// ✅ ОТПРАВКА
app.post("/send", async (req, res) => {
  const { chatId, text } = req.body;

  await axios.post(
    `${API_URL}/waInstance${ID}/sendMessage/${TOKEN}`,
    { chatId, message: text }
  );

  if (!messages[chatId]) messages[chatId] = [];
  messages[chatId].push({ from: "me", text });

  io.emit("new-message", {
    chatId,
    message: { from: "me", text },
  });

  res.sendStatus(200);
});

server.listen(3001, () => {
  console.log("Backend on 3001");
});