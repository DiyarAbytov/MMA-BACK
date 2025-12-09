// // db.js
// import Database from "better-sqlite3";

// const db = new Database("whatsapp.db");

// // одна таблица: последний статус по каждому чату
// db.exec(`
//   CREATE TABLE IF NOT EXISTS dialogs (
//     chatId      TEXT PRIMARY KEY,
//     name        TEXT,
//     lastMessage TEXT,
//     lastTime    INTEGER
//   );
// `);

// const upsertStmt = db.prepare(`
//   INSERT INTO dialogs (chatId, name, lastMessage, lastTime)
//   VALUES (@chatId, @name, @lastMessage, @lastTime)
//   ON CONFLICT(chatId) DO UPDATE SET
//     name        = excluded.name,
//     lastMessage = excluded.lastMessage,
//     lastTime    = excluded.lastTime
// `);

// const getAllStmt = db.prepare(`
//   SELECT chatId, name, lastMessage, lastTime
//   FROM dialogs
//   ORDER BY lastTime DESC
// `);

// export function upsertDialog({ chatId, name, lastMessage, lastTime }) {
//   if (!chatId) return;
//   upsertStmt.run({
//     chatId,
//     name: name || chatId,
//     lastMessage: lastMessage || "",
//     lastTime: lastTime || Date.now(),
//   });
// }

// export function getDialogsFromDb() {
//   return getAllStmt.all();
// }



import Database from "better-sqlite3";

const db = new Database("whatsapp.db");

// одна таблица: последний статус по каждому чату
db.exec(`
  CREATE TABLE IF NOT EXISTS dialogs (
    chatId      TEXT PRIMARY KEY,
    name        TEXT,
    lastMessage TEXT,
    lastTime    INTEGER
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO dialogs (chatId, name, lastMessage, lastTime)
  VALUES (@chatId, @name, @lastMessage, @lastTime)
  ON CONFLICT(chatId) DO UPDATE SET
    name        = excluded.name,
    lastMessage = excluded.lastMessage,
    lastTime    = excluded.lastTime
`);

const getAllStmt = db.prepare(`
  SELECT chatId, name, lastMessage, lastTime
  FROM dialogs
  ORDER BY lastTime DESC
`);

export function upsertDialog({ chatId, name, lastMessage, lastTime }) {
  if (!chatId) return;
  upsertStmt.run({
    chatId,
    name: name || chatId,
    lastMessage: lastMessage || "",
    lastTime: lastTime || Date.now(),
  });
}

export function getDialogsFromDb() {
  return getAllStmt.all();
}
