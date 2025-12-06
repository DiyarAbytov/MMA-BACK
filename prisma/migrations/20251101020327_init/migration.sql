-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'lead',
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "last" TEXT NOT NULL DEFAULT '',
    "lastTs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "body" TEXT,
    "ts" INTEGER NOT NULL,
    "fromMe" BOOLEAN NOT NULL,
    "type" TEXT NOT NULL,
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "quotedMessageId" TEXT,
    "vcard" TEXT,
    "locLat" REAL,
    "locLng" REAL,
    "locDesc" TEXT,
    CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalyticsStream" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ts" INTEGER NOT NULL,
    "monthKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AnalyticsMonthly" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ts" INTEGER NOT NULL,
    "monthKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Chat_status_idx" ON "Chat"("status");

-- CreateIndex
CREATE INDEX "Chat_lastTs_idx" ON "Chat"("lastTs");

-- CreateIndex
CREATE INDEX "Message_chatId_ts_idx" ON "Message"("chatId", "ts");

-- CreateIndex
CREATE INDEX "AnalyticsStream_ts_idx" ON "AnalyticsStream"("ts");

-- CreateIndex
CREATE INDEX "AnalyticsStream_monthKey_type_idx" ON "AnalyticsStream"("monthKey", "type");

-- CreateIndex
CREATE INDEX "AnalyticsMonthly_monthKey_type_idx" ON "AnalyticsMonthly"("monthKey", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsMonthly_chatId_type_monthKey_key" ON "AnalyticsMonthly"("chatId", "type", "monthKey");
