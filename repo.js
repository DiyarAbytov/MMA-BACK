// repo.js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const sortChatsOrder = [
  { pinned: "desc" },
  { unreadCount: "desc" },
  { lastTs: "desc" },
  { name: "asc" },
];

const monthKeyOf = (tsSec) => {
  const d = new Date((Number(tsSec) || Math.floor(Date.now()/1000)) * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

const sanitizeId = (s) => {
  const v = String(s || "");
  if (/@(c|g)\.us$/i.test(v)) return v;
  const d = v.replace(/\D/g, "");
  return d ? d + "@c.us" : v;
};

const niceName = (id) => `+${String(id || "").replace(/\D/g, "")}`;

const upsertChatOnIncoming = async ({ chatId, isGroup, fromMe, last, lastTs }) => {
  const id = sanitizeId(chatId);
  const created = await prisma.chat.upsert({
    where: { id },
    create: {
      id,
      name: niceName(id),
      isGroup: !!isGroup,
      status: !isGroup && !fromMe ? "lead" : "client",
      unreadCount: fromMe ? 0 : 1,
      last: String(last || ""),
      lastTs: Number(lastTs || 0),
    },
    update: {
      last: String(last || ""),
      lastTs: Number(lastTs || 0),
      unreadCount: fromMe ? undefined : { increment: 1 },
    },
  });
  return created;
};

const saveMessages = async (chatId, arr) => {
  if (!Array.isArray(arr) || !arr.length) return;
  const rows = arr.map((m) => ({
    id: String(m.id),
    chatId: sanitizeId(m.chatId),
    from: String(m.from || ""),
    to: m.to ? String(m.to) : null,
    body: m.body ? String(m.body) : null,
    ts: Number(m.timestamp || m.ts || 0),
    fromMe: !!m.fromMe,
    type: String(m.type || "chat"),
    hasMedia: !!m.hasMedia,
    quotedMessageId: m.quotedMessageId ? String(m.quotedMessageId) : null,
    vcard: m.vcard ? String(m.vcard) : null,
    locLat: m.location?.latitude ?? null,
    locLng: m.location?.longitude ?? null,
    locDesc: m.location?.description ?? null,
  }));
  await prisma.message.createMany({ data: rows, skipDuplicates: true });
};

const getMessagesDB = async (chatId, limit = 200) => {
  const id = sanitizeId(chatId);
  const rows = await prisma.message.findMany({
    where: { chatId: id },
    orderBy: { ts: "asc" },
    take: Number(limit),
  });
  return rows.map((r) => ({
    id: r.id,
    chatId: r.chatId,
    from: r.from,
    to: r.to,
    body: r.body || "",
    timestamp: r.ts,
    fromMe: r.fromMe,
    type: r.type,
    hasMedia: r.hasMedia,
    quotedMessageId: r.quotedMessageId || undefined,
    vcard: r.vcard || undefined,
    location: r.locLat != null ? { latitude: r.locLat, longitude: r.locLng, description: r.locDesc || "" } : undefined,
  }));
};

const listChats = async ({ status } = {}) => {
  const where =
    status === "lead" ? { status: "lead" } :
    status === "client" ? { status: "client" } :
    status === "declined" ? { status: "declined" } : {};
  const rows = await prisma.chat.findMany({ where, orderBy: sortChatsOrder });
  return rows;
};

const markSeen = async (chatId) => {
  const id = sanitizeId(chatId);
  await prisma.chat.updateMany({ where: { id }, data: { unreadCount: 0 } });
};

const onSendUpdateChat = async (chatId, text, ts) => {
  const id = sanitizeId(chatId);
  const baseName = niceName(id);
  await prisma.chat.upsert({
    where: { id },
    create: {
      id,
      name: baseName,
      isGroup: false,
      status: "lead",
      unreadCount: 0,
      last: String(text || "").slice(0, 140),
      lastTs: Number(ts || Math.floor(Date.now()/1000)),
    },
    update: {
      last: String(text || "").slice(0, 140),
      lastTs: Number(ts || Math.floor(Date.now()/1000)),
    },
  });
};

const pushStream = async (type, chatId, ts) => {
  await prisma.analyticsStream.create({
    data: {
      chatId: sanitizeId(chatId),
      type: String(type),
      ts: Number(ts || Math.floor(Date.now()/1000)),
      monthKey: monthKeyOf(ts),
    },
  });
};

const pushMonthlyUnique = async (type, chatId, ts) => {
  const key = monthKeyOf(ts);
  try {
    await prisma.analyticsMonthly.create({
      data: {
        chatId: sanitizeId(chatId),
        type: String(type),
        ts: Number(ts || Math.floor(Date.now()/1000)),
        monthKey: key,
      },
    });
  } catch {}
};

const recordLeadNewIfFirstCreate = async ({ chatId, isGroup, fromMe, ts }) => {
  if (isGroup || fromMe) return;
  const id = sanitizeId(chatId);
  const existed = await prisma.chat.findUnique({ where: { id } });
  if (!existed) {
    await pushStream("lead_new", id, ts);
  }
};

const setStatus = async (chatId, status) => {
  const id = sanitizeId(chatId);
  const row = await prisma.chat.findUnique({ where: { id } });
  if (!row) return null;
  const prev = row.status;
  const updated = await prisma.chat.update({
    where: { id },
    data: { status, isGroup: row.isGroup, isLead: undefined, unreadCount: row.unreadCount },
  });
  const nowTs = Math.floor(Date.now()/1000);
  if (prev !== "client" && status === "client") {
    await pushStream("client_new", id, nowTs);
    await pushMonthlyUnique("client_new", id, nowTs);
  }
  if (prev !== "declined" && status === "declined") {
    await pushStream("decline", id, nowTs);
    await pushMonthlyUnique("decline", id, nowTs);
  }
  return updated;
};

const setFlagLead = async (chatId, isLead) => {
  const id = sanitizeId(chatId);
  const row = await prisma.chat.findUnique({ where: { id } });
  if (!row) return null;
  const prev = row.status;
  const status = isLead ? "lead" : "client";
  const updated = await prisma.chat.update({ where: { id }, data: { status } });
  const nowTs = Math.floor(Date.now()/1000);
  if (prev !== "client" && status === "client") {
    await pushStream("client_new", id, nowTs);
    await pushMonthlyUnique("client_new", id, nowTs);
  }
  return updated;
};

const initialUpsertChats = async (items) => {
  if (!Array.isArray(items) || !items.length) return;
  for (const c of items) {
    const id = sanitizeId(c.id);
    await prisma.chat.upsert({
      where: { id },
      create: {
        id,
        name: c.name || niceName(id),
        isGroup: !!c.isGroup,
        status: c.isLead === true ? "lead" : "client",
        unreadCount: Number(c.unreadCount || 0),
        pinned: !!c.pinned,
        archived: !!c.archived,
        last: String(c.last || ""),
        lastTs: Number(c.lastTs || 0),
      },
      update: {
        name: c.name || niceName(id),
        isGroup: !!c.isGroup,
        unreadCount: Number(c.unreadCount || 0),
        pinned: !!c.pinned,
        archived: !!c.archived,
        last: String(c.last || ""),
        lastTs: Number(c.lastTs || 0),
      },
    });
  }
};

const getAnalytics = async ({ fromSec = 0, toSec = Math.floor(Date.now()/1000) }) => {
  const leadsNew = await prisma.analyticsStream.count({
    where: { type: "lead_new", ts: { gte: Number(fromSec), lte: Number(toSec) } },
  });
  const clientsNew = await prisma.analyticsMonthly.count({
    where: { type: "client_new", ts: { gte: Number(fromSec), lte: Number(toSec) } },
  });
  const declines = await prisma.analyticsMonthly.count({
    where: { type: "decline", ts: { gte: Number(fromSec), lte: Number(toSec) } },
  });
  return { leadsNew, clientsNew, declines };
};

module.exports = {
  prisma,
  sanitizeId,
  upsertChatOnIncoming,
  saveMessages,
  getMessagesDB,
  listChats,
  markSeen,
  onSendUpdateChat,
  pushStream,
  pushMonthlyUnique,
  recordLeadNewIfFirstCreate,
  setStatus,
  setFlagLead,
  initialUpsertChats,
  getAnalytics,
  monthKeyOf,
};
