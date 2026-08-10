const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, maxHttpBufferSize: 2e6 });

const PORT = process.env.PORT || 3000;
const CHAT_PASSWORD = String(process.env.CHAT_PASSWORD || "1419");
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const PUBLIC_DIR = path.join(__dirname, "public");
const HISTORY_PUBLIC_ID = process.env.CLOUDINARY_HISTORY_PUBLIC_ID || "private-chat-system/message-history.json";

if (!process.env.CLOUDINARY_URL) {
  console.warn("CLOUDINARY_URL is not configured. Persistent uploads/history will not work until it is added in Render.");
}

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "50kb" }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  }
});

app.use(sessionMiddleware);
app.use(express.static(PUBLIC_DIR));

function safeEqual(input, expected) {
  const a = Buffer.from(String(input || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  if (req.session?.allowed === true) return next();
  return res.status(401).json({ ok: false, message: "Session expired. Enter the password again." });
}

app.post("/api/login", (req, res) => {
  if (!safeEqual(req.body?.password, CHAT_PASSWORD)) {
    return res.status(401).json({ ok: false, message: "Incorrect password." });
  }
  req.session.allowed = true;
  req.session.save(() => res.json({ ok: true }));
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = /^(image|video|audio)\//.test(file.mimetype) || file.mimetype === "application/pdf" || file.mimetype === "application/octet-stream";
    cb(ok ? null : new Error("Unsupported file type."), ok);
  }
});

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(buffer);
  });
}

app.post("/api/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "No file uploaded." });
  if (!process.env.CLOUDINARY_URL) return res.status(503).json({ ok: false, message: "Cloudinary is not configured on the server." });
  try {
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      resource_type: "auto",
      folder: "private-chat-uploads",
      use_filename: true,
      unique_filename: true,
      overwrite: false
    });
    res.json({
      ok: true,
      file: {
        url: result.secure_url,
        name: String(req.file.originalname || "file").slice(0, 120),
        type: req.file.mimetype,
        size: req.file.size,
        publicId: result.public_id,
        resourceType: result.resource_type
      }
    });
  } catch (error) {
    console.error("Cloudinary upload failed:", error.message);
    res.status(500).json({ ok: false, message: "Cloud upload failed. Please try again." });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ ok: false, message: "File is too large. Maximum size is 25 MB." });
  }
  if (err) return res.status(400).json({ ok: false, message: err.message || "Upload failed." });
  next();
});

const MAX_MESSAGES = 150;
let recentMessages = [];
let historySaveQueue = Promise.resolve();

async function loadMessagesFromCloudinary() {
  if (!process.env.CLOUDINARY_URL) return [];
  try {
    const asset = await cloudinary.api.resource(HISTORY_PUBLIC_ID, { resource_type: "raw", type: "upload" });
    const response = await fetch(`${asset.secure_url}?v=${asset.version || Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`History download returned ${response.status}`);
    const parsed = await response.json();
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch (error) {
    const notFound = error?.http_code === 404 || /not found/i.test(String(error?.message || ""));
    if (!notFound) console.error("Could not load Cloudinary chat history:", error.message);
    return [];
  }
}

function saveMessages() {
  if (!process.env.CLOUDINARY_URL) return Promise.resolve();
  const snapshot = JSON.stringify(recentMessages, null, 2);
  historySaveQueue = historySaveQueue
    .catch(() => {})
    .then(() => uploadBufferToCloudinary(Buffer.from(snapshot, "utf8"), {
      resource_type: "raw",
      public_id: HISTORY_PUBLIC_ID,
      overwrite: true,
      invalidate: true
    }))
    .catch((error) => console.error("Could not save Cloudinary chat history:", error.message));
  return historySaveQueue;
}

const connectedUsers = new Map();
const connectedClients = new Map();
const connectedMeta = new Map();
const MAX_CHAT_MEMBERS = 2;

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  if (socket.request.session?.allowed !== true) return next(new Error("unauthorized"));
  if (connectedUsers.size >= MAX_CHAT_MEMBERS) {
    io.emit("room-entry-blocked", {
      message: "Someone tried to enter, but this private room already has 2 members."
    });
    return next(new Error("room-full"));
  }
  next();
});

function emitPresence() {
  io.emit("presence", {
    count: connectedUsers.size,
    users: [...connectedUsers.entries()].map(([id, name]) => ({ id, name }))
  });
}

function publicMessage(message) {
  const { ownerId, ...safe } = message;
  return safe;
}

function pushActivity(action, name, clientId = "") {
  const safeName = String(name || "Guest").trim().slice(0, 24) || "Guest";
  pushMessage({
    id: crypto.randomUUID(),
    ownerId: "",
    name: safeName,
    kind: "activity",
    action: action === "logout" ? "logout" : "login",
    clientId: String(clientId || "").slice(0, 100),
    time: new Date().toISOString()
  });
}

function pushMessage(message) {
  recentMessages.push(message);
  if (recentMessages.length > MAX_MESSAGES) recentMessages.shift();
  saveMessages();
  io.emit("chat-message", publicMessage(message));
  if (message.ownerId) {
    for (const [socketId, clientId] of connectedClients.entries()) {
      if (clientId === message.ownerId) io.to(socketId).emit("message-owned", { messageId: message.id });
    }
  }
}

function replySnapshot(replyToId) {
  if (!replyToId) return null;
  const original = recentMessages.find((m) => m.id === replyToId);
  if (!original || original.deletedForEveryone) return null;
  let preview = "Message";
  if (original.kind === "text") preview = original.text.slice(0, 140);
  else if (original.kind === "attachment") preview = original.file?.name || "Attachment";
  else if (original.kind === "sticker") preview = original.sticker || "Sticker";
  return { id: original.id, name: original.name, kind: original.kind, preview };
}

io.on("connection", (socket) => {
  connectedUsers.set(socket.id, "Guest");
  connectedMeta.set(socket.id, { clientId: "", name: "Guest", loginRecorded: false });
  emitPresence();

  socket.on("set-client-id", (rawId) => {
    const clientId = String(rawId || "").trim().slice(0, 100);
    if (!clientId) return;
    connectedClients.set(socket.id, clientId);
    const meta = connectedMeta.get(socket.id) || { name: "Guest", loginRecorded: false };
    meta.clientId = clientId;
    connectedMeta.set(socket.id, meta);
    socket.emit("chat-history", recentMessages.map(publicMessage));
    socket.emit("owned-message-ids", recentMessages.filter((m) => m.ownerId === clientId).map((m) => m.id));
  });

  socket.on("set-name", (rawName) => {
    const name = String(rawName || "Guest").trim().slice(0, 24) || "Guest";
    connectedUsers.set(socket.id, name);
    const meta = connectedMeta.get(socket.id) || { clientId: connectedClients.get(socket.id) || "", loginRecorded: false };
    meta.name = name;
    if (!meta.loginRecorded) {
      meta.loginRecorded = true;
      connectedMeta.set(socket.id, meta);
      pushActivity("login", name, meta.clientId);
    } else {
      connectedMeta.set(socket.id, meta);
    }
    emitPresence();
  });

  socket.on("typing", (isTyping) => {
    socket.broadcast.emit("typing", { name: connectedUsers.get(socket.id) || "Guest", isTyping: Boolean(isTyping) });
  });

  socket.on("chat-message", (payload) => {
    const name = String(payload?.name || connectedUsers.get(socket.id) || "Guest").trim().slice(0, 24) || "Guest";
    const text = String(payload?.text || "").trim().slice(0, 1200);
    if (!text) return;
    connectedUsers.set(socket.id, name);
    pushMessage({ id: crypto.randomUUID(), senderId: socket.id, ownerId: connectedClients.get(socket.id) || "", name, kind: "text", text, reply: replySnapshot(payload?.replyToId), time: new Date().toISOString() });
    socket.broadcast.emit("typing", { name, isTyping: false });
  });

  socket.on("attachment-message", (payload) => {
    const name = String(payload?.name || connectedUsers.get(socket.id) || "Guest").trim().slice(0, 24) || "Guest";
    const file = payload?.file || {};
    const url = String(file.url || "");
    if (!/^https:\/\/res\.cloudinary\.com\//i.test(url)) return;
    pushMessage({
      id: crypto.randomUUID(), senderId: socket.id, ownerId: connectedClients.get(socket.id) || "", name, kind: "attachment",
      file: {
        url,
        name: String(file.name || "file").slice(0,120),
        type: String(file.type || "application/octet-stream").slice(0,100),
        size: Number(file.size || 0),
        publicId: String(file.publicId || "").slice(0,300),
        resourceType: String(file.resourceType || "auto").slice(0,30)
      },
      reply: replySnapshot(payload?.replyToId),
      time: new Date().toISOString()
    });
  });



  socket.on("sticker-message", (payload) => {
    const allowed = new Set(["❤️","😂","😍","🥰","😘","🔥","🎉","👍","👏","🙏","💯","🌹","💐","🐦","😎","🥳","😭","😡","🤗","✨","💜","💕","💖"]);
    const sticker = String(payload?.sticker || "");
    if (!allowed.has(sticker)) return;
    const name = String(payload?.name || connectedUsers.get(socket.id) || "Guest").trim().slice(0, 24) || "Guest";
    pushMessage({
      id: crypto.randomUUID(), senderId: socket.id, ownerId: connectedClients.get(socket.id) || "",
      name, kind: "sticker", sticker, reply: replySnapshot(payload?.replyToId), time: new Date().toISOString()
    });
  });

  socket.on("edit-message", ({ messageId, text }) => {
    const id = String(messageId || "");
    const nextText = String(text || "").trim().slice(0, 1200);
    if (!id || !nextText) return;
    const message = recentMessages.find((m) => m.id === id);
    const clientId = connectedClients.get(socket.id) || "";
    if (!message || !clientId || message.ownerId !== clientId || message.kind !== "text") return;
    if (message.text === nextText) return;
    message.text = nextText;
    message.editedAt = new Date().toISOString();
    saveMessages();
    io.emit("message-edited", { messageId: message.id, text: message.text, editedAt: message.editedAt });
  });

  socket.on("messages-seen", ({ messageIds }) => {
    const clientId = connectedClients.get(socket.id) || "";
    if (!clientId || !Array.isArray(messageIds)) return;
    const seenName = connectedUsers.get(socket.id) || "Guest";
    const now = new Date().toISOString();
    const updates = [];
    for (const rawId of messageIds.slice(0, 200)) {
      const message = recentMessages.find((m) => m.id === String(rawId || ""));
      if (!message || message.kind === "activity" || !message.ownerId || message.ownerId === clientId || message.seenAt) continue;
      message.seenAt = now;
      message.seenBy = seenName;
      updates.push({ messageId: message.id, seenAt: now, seenBy: seenName });
    }
    if (updates.length) {
      saveMessages();
      io.emit("messages-seen-update", { updates });
    }
  });

  socket.on("delete-message-everyone", ({ messageId }) => {
    const index = recentMessages.findIndex((m) => m.id === String(messageId || ""));
    if (index < 0) return;
    const message = recentMessages[index];
    const clientId = connectedClients.get(socket.id) || "";
    if (!clientId || message.ownerId !== clientId) return;
    if (message.kind === "attachment" && message.file?.publicId && process.env.CLOUDINARY_URL) {
      cloudinary.uploader.destroy(message.file.publicId, {
        resource_type: message.file.resourceType || "image",
        invalidate: true
      }).catch((error) => console.error("Could not delete Cloudinary attachment:", error.message));
    }
    recentMessages.splice(index, 1);
    saveMessages();
    io.emit("message-deleted-everyone", { messageId: message.id });
  });

  socket.on("call-offer", ({ targetId, offer, mode }) => {
    if (!connectedUsers.has(targetId)) return;
    io.to(targetId).emit("call-offer", { fromId: socket.id, fromName: connectedUsers.get(socket.id) || "Guest", offer, mode: mode === "video" ? "video" : "audio" });
  });
  socket.on("call-answer", ({ targetId, answer }) => io.to(targetId).emit("call-answer", { fromId: socket.id, answer }));
  socket.on("ice-candidate", ({ targetId, candidate }) => io.to(targetId).emit("ice-candidate", { fromId: socket.id, candidate }));
  socket.on("call-decline", ({ targetId }) => io.to(targetId).emit("call-decline", { fromId: socket.id }));
  socket.on("call-end", ({ targetId }) => io.to(targetId).emit("call-end", { fromId: socket.id }));

  socket.on("disconnect", () => {
    const meta = connectedMeta.get(socket.id);
    if (meta?.loginRecorded) pushActivity("logout", meta.name || connectedUsers.get(socket.id) || "Guest", meta.clientId || connectedClients.get(socket.id) || "");
    connectedUsers.delete(socket.id);
    connectedClients.delete(socket.id);
    connectedMeta.delete(socket.id);
    emitPresence();
  });
});

async function startServer() {
  recentMessages = await loadMessagesFromCloudinary();
  console.log(`Loaded ${recentMessages.length} saved chat messages from Cloudinary.`);
  server.listen(PORT, "0.0.0.0", () => console.log(`Private chat running on port ${PORT}`));
}

startServer().catch((error) => {
  console.error("Failed to start private chat:", error);
  process.exit(1);
});
