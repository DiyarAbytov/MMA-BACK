// // db.js
// import Database from "better-sqlite3";

// const db = new Database("whatsapp.db");

// // ================= dialogs =================
// db.exec(`
//   CREATE TABLE IF NOT EXISTS dialogs (
//     chatId      TEXT PRIMARY KEY,
//     name        TEXT,
//     lastMessage TEXT,
//     lastTime    INTEGER
//   );
// `);

// // ================= messages =================
// db.exec(`
//   CREATE TABLE IF NOT EXISTS messages (
//     id         INTEGER PRIMARY KEY AUTOINCREMENT,
//     chatId     TEXT NOT NULL,
//     msgId      TEXT NOT NULL,
//     sender     TEXT NOT NULL,     -- "me" | "client"
//     text       TEXT,
//     timestamp  INTEGER NOT NULL,
//     mediaType  TEXT,
//     mediaUrl   TEXT,
//     replyTo    TEXT,
//     UNIQUE(chatId, msgId)
//   );
// `);

// db.exec(`
//   CREATE INDEX IF NOT EXISTS idx_messages_chat_ts
//   ON messages(chatId, timestamp);
// `);

// const upsertDialogStmt = db.prepare(`
//   INSERT INTO dialogs (chatId, name, lastMessage, lastTime)
//   VALUES (@chatId, @name, @lastMessage, @lastTime)
//   ON CONFLICT(chatId) DO UPDATE SET
//     name = COALESCE(excluded.name, dialogs.name),
//     lastTime = MAX(COALESCE(dialogs.lastTime, 0), COALESCE(excluded.lastTime, 0)),
//     lastMessage = CASE
//       WHEN COALESCE(excluded.lastTime, 0) >= COALESCE(dialogs.lastTime, 0)
//       THEN COALESCE(excluded.lastMessage, dialogs.lastMessage)
//       ELSE dialogs.lastMessage
//     END
// `);

// const insertMsgStmt = db.prepare(`
//   INSERT OR IGNORE INTO messages
//   (chatId, msgId, sender, text, timestamp, mediaType, mediaUrl, replyTo)
//   VALUES (@chatId, @msgId, @sender, @text, @timestamp, @mediaType, @mediaUrl, @replyTo)
// `);

// const getDialogsStmt = db.prepare(`
//   SELECT chatId, name, lastMessage, lastTime
//   FROM dialogs
//   ORDER BY lastTime DESC
// `);

// const countMessagesStmt = db.prepare(`
//   SELECT COUNT(*) as c FROM messages WHERE chatId = ?
// `);

// const getLatestStmt = db.prepare(`
//   SELECT msgId as id, sender as "from", text, timestamp, mediaType, mediaUrl, replyTo
//   FROM messages
//   WHERE chatId = ?
//   ORDER BY timestamp DESC
//   LIMIT ?
// `);

// const getBeforeStmt = db.prepare(`
//   SELECT msgId as id, sender as "from", text, timestamp, mediaType, mediaUrl, replyTo
//   FROM messages
//   WHERE chatId = ? AND timestamp < ?
//   ORDER BY timestamp DESC
//   LIMIT ?
// `);

// const getAfterStmt = db.prepare(`
//   SELECT msgId as id, sender as "from", text, timestamp, mediaType, mediaUrl, replyTo
//   FROM messages
//   WHERE chatId = ? AND timestamp > ?
//   ORDER BY timestamp ASC
//   LIMIT ?
// `);

// function safeJsonParse(s) {
//   try {
//     return JSON.parse(s);
//   } catch {
//     return null;
//   }
// }

// function normalizeRows(rows) {
//   const list = rows.slice().reverse();
//   return list.map((r) => ({
//     ...r,
//     replyTo: r.replyTo ? safeJsonParse(r.replyTo) : null,
//   }));
// }

// export function upsertDialog({ chatId, name, lastMessage, lastTime }) {
//   if (!chatId) return;
//   upsertDialogStmt.run({
//     chatId,
//     name: name ?? null,
//     lastMessage: typeof lastMessage === "string" ? lastMessage : null,
//     lastTime: typeof lastTime === "number" ? lastTime : null,
//   });
// }

// export function getDialogsFromDb() {
//   return getDialogsStmt.all();
// }

// export function saveMessage(message) {
//   if (!message?.chatId || !message?.id) return;

//   insertMsgStmt.run({
//     chatId: message.chatId,
//     msgId: String(message.id),
//     sender: message.from === "me" ? "me" : "client",
//     text: message.text || "",
//     timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
//     mediaType: message.mediaType || null,
//     mediaUrl: message.mediaUrl || null,
//     replyTo: message.replyTo ? JSON.stringify(message.replyTo) : null,
//   });
// }

// export function countMessages(chatId) {
//   return countMessagesStmt.get(chatId)?.c || 0;
// }

// export function getLatestMessages(chatId, limit = 15) {
//   const rows = getLatestStmt.all(chatId, limit);
//   return normalizeRows(rows);
// }

// export function getMessagesBefore(chatId, beforeTs, limit = 15) {
//   const rows = getBeforeStmt.all(chatId, beforeTs, limit);
//   return normalizeRows(rows);
// }

// export function getMessagesAfter(chatId, afterTs, limit = 100) {
//   const rows = getAfterStmt.all(chatId, afterTs, limit);
//   return rows.map((r) => ({
//     ...r,
//     replyTo: r.replyTo ? safeJsonParse(r.replyTo) : null,
//   }));
// }



// db.js
import Database from "better-sqlite3";

const db = new Database("whatsapp.db");

// ================= dialogs =================
db.exec(`
  CREATE TABLE IF NOT EXISTS dialogs (
    chatId      TEXT PRIMARY KEY,
    name        TEXT,
    lastMessage TEXT,
    lastTime    INTEGER
  );
`);

// ================= messages =================
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chatId     TEXT NOT NULL,
    msgId      TEXT NOT NULL,
    sender     TEXT NOT NULL,     -- "me" | "client"
    text       TEXT,
    timestamp  INTEGER NOT NULL,
    mediaType  TEXT,
    mediaUrl   TEXT,
    replyTo    TEXT,
    UNIQUE(chatId, msgId)
  );
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_chat_ts
  ON messages(chatId, timestamp);
`);

const upsertDialogStmt = db.prepare(`
  INSERT INTO dialogs (chatId, name, lastMessage, lastTime)
  VALUES (@chatId, @name, @lastMessage, @lastTime)
  ON CONFLICT(chatId) DO UPDATE SET
    name = COALESCE(excluded.name, dialogs.name),
    lastTime = MAX(COALESCE(dialogs.lastTime, 0), COALESCE(excluded.lastTime, 0)),
    lastMessage = CASE
      WHEN COALESCE(excluded.lastTime, 0) >= COALESCE(dialogs.lastTime, 0)
      THEN COALESCE(excluded.lastMessage, dialogs.lastMessage)
      ELSE dialogs.lastMessage
    END
`);

const insertMsgStmt = db.prepare(`
  INSERT OR IGNORE INTO messages
  (chatId, msgId, sender, text, timestamp, mediaType, mediaUrl, replyTo)
  VALUES (@chatId, @msgId, @sender, @text, @timestamp, @mediaType, @mediaUrl, @replyTo)
`);

const getDialogsStmt = db.prepare(`
  SELECT chatId, name, lastMessage, lastTime
  FROM dialogs
  ORDER BY lastTime DESC
`);

const countMessagesStmt = db.prepare(`
  SELECT COUNT(*) as c FROM messages WHERE chatId = ?
`);

const getLatestStmt = db.prepare(`
  SELECT msgId as id, sender as "from", text, timestamp, mediaType, mediaUrl, replyTo
  FROM messages
  WHERE chatId = ?
  ORDER BY timestamp DESC
  LIMIT ?
`);

const getBeforeStmt = db.prepare(`
  SELECT msgId as id, sender as "from", text, timestamp, mediaType, mediaUrl, replyTo
  FROM messages
  WHERE chatId = ? AND timestamp < ?
  ORDER BY timestamp DESC
  LIMIT ?
`);

const getAfterStmt = db.prepare(`
  SELECT msgId as id, sender as "from", text, timestamp, mediaType, mediaUrl, replyTo
  FROM messages
  WHERE chatId = ? AND timestamp > ?
  ORDER BY timestamp ASC
  LIMIT ?
`);

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeRows(rows) {
  const list = rows.slice().reverse(); // из DESC в нормальный порядок
  return list.map((r) => ({
    ...r,
    replyTo: r.replyTo ? safeJsonParse(r.replyTo) : null,
  }));
}

export function upsertDialog({ chatId, name, lastMessage, lastTime }) {
  if (!chatId) return;
  upsertDialogStmt.run({
    chatId,
    name: name ?? null,
    lastMessage: typeof lastMessage === "string" ? lastMessage : null,
    lastTime: typeof lastTime === "number" ? lastTime : null,
  });
}

export function getDialogsFromDb() {
  return getDialogsStmt.all();
}

export function saveMessage(message) {
  if (!message?.chatId || !message?.id) return;

  insertMsgStmt.run({
    chatId: message.chatId,
    msgId: String(message.id),
    sender: message.from === "me" ? "me" : "client",
    text: message.text || "",
    timestamp: typeof message.timestamp === "number" ? message.timestamp : Date.now(),
    mediaType: message.mediaType || null,
    mediaUrl: message.mediaUrl || null,
    replyTo: message.replyTo ? JSON.stringify(message.replyTo) : null,
  });
}

export function countMessages(chatId) {
  return countMessagesStmt.get(chatId)?.c || 0;
}

export function getLatestMessages(chatId, limit = 15) {
  const rows = getLatestStmt.all(chatId, limit);
  return normalizeRows(rows);
}

export function getMessagesBefore(chatId, beforeTs, limit = 15) {
  const rows = getBeforeStmt.all(chatId, beforeTs, limit);
  return normalizeRows(rows);
}

export function getMessagesAfter(chatId, afterTs, limit = 100) {
  const rows = getAfterStmt.all(chatId, afterTs, limit);
  return rows.map((r) => ({
    ...r,
    replyTo: r.replyTo ? safeJsonParse(r.replyTo) : null,
  }));
}
