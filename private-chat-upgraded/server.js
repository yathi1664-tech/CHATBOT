const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, maxHttpBufferSize: 2e6 });

const PORT = process.env.PORT || 3000;
const CHAT_PASSWORD = String(process.env.CHAT_PASSWORD || "1419");
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_DATA_DIR = path.join(__dirname, "data");
const DATA_DIR = process.env.CHAT_DATA_DIR || (fs.existsSync("/var/data") ? "/var/data" : DEFAULT_DATA_DIR);
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const MESSAGE_STORE = path.join(DATA_DIR, "messages.json");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
app.use("/uploads", express.static(UPLOAD_DIR, { fallthrough: false, maxAge: "1h" }));

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

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = /^(image|video|audio)\//.test(file.mimetype) || file.mimetype === "application/pdf" || file.mimetype === "application/octet-stream";
    cb(ok ? null : new Error("Unsupported file type."), ok);
  }
});

app.post("/api/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: "No file uploaded." });
  res.json({
    ok: true,
    file: {
      url: `/uploads/${encodeURIComponent(req.file.filename)}`,
      name: String(req.file.originalname || "file").slice(0, 120),
      type: req.file.mimetype,
      size: req.file.size
    }
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ ok: false, message: "File is too large. Maximum size is 25 MB." });
  }
  if (err) return res.status(400).json({ ok: false, message: err.message || "Upload failed." });
  next();
});

const MAX_MESSAGES = 150;
function loadMessages() {
  try {
    if (!fs.existsSync(MESSAGE_STORE)) return [];
    const parsed = JSON.parse(fs.readFileSync(MESSAGE_STORE, "utf8"));
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
  } catch (error) {
    console.error("Could not load chat history:", error.message);
    return [];
  }
}
function saveMessages() {
  try {
    const temp = `${MESSAGE_STORE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(recentMessages, null, 2));
    fs.renameSync(temp, MESSAGE_STORE);
  } catch (error) {
    console.error("Could not save chat history:", error.message);
  }
}
const recentMessages = loadMessages();
const connectedUsers = new Map();
const connectedClients = new Map();
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
  emitPresence();

  socket.on("set-client-id", (rawId) => {
    const clientId = String(rawId || "").trim().slice(0, 100);
    if (!clientId) return;
    connectedClients.set(socket.id, clientId);
    socket.emit("chat-history", recentMessages.map(publicMessage));
    socket.emit("owned-message-ids", recentMessages.filter((m) => m.ownerId === clientId).map((m) => m.id));
  });

  socket.on("set-name", (rawName) => {
    const name = String(rawName || "Guest").trim().slice(0, 24) || "Guest";
    connectedUsers.set(socket.id, name);
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
    if (!url.startsWith("/uploads/")) return;
    pushMessage({
      id: crypto.randomUUID(), senderId: socket.id, ownerId: connectedClients.get(socket.id) || "", name, kind: "attachment",
      file: { url, name: String(file.name || "file").slice(0,120), type: String(file.type || "application/octet-stream").slice(0,100), size: Number(file.size || 0) },
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

  socket.on("delete-message-everyone", ({ messageId }) => {
    const index = recentMessages.findIndex((m) => m.id === String(messageId || ""));
    if (index < 0) return;
    const message = recentMessages[index];
    const clientId = connectedClients.get(socket.id) || "";
    if (!clientId || message.ownerId !== clientId) return;
    if (message.kind === "attachment" && message.file?.url?.startsWith("/uploads/")) {
      const filename = decodeURIComponent(message.file.url.replace("/uploads/", ""));
      const full = path.join(UPLOAD_DIR, path.basename(filename));
      fs.unlink(full, () => {});
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
    connectedUsers.delete(socket.id);
    connectedClients.delete(socket.id);
    emitPresence();
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Private chat running on port ${PORT}`));
