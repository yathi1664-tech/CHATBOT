const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false }
});

const PORT = process.env.PORT || 3000;
const CHAT_PASSWORD = String(process.env.CHAT_PASSWORD || "1419");
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "25kb" }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

function safeEqual(input, expected) {
  const a = Buffer.from(String(input || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post("/api/login", (req, res) => {
  if (!safeEqual(req.body?.password, CHAT_PASSWORD)) {
    return res.status(401).json({ ok: false, message: "Incorrect password." });
  }
  req.session.allowed = true;
  req.session.save(() => res.json({ ok: true }));
});

app.get("/api/session", (req, res) => {
  res.json({ authenticated: req.session?.allowed === true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

io.engine.use(sessionMiddleware);

io.use((socket, next) => {
  if (socket.request.session?.allowed === true) return next();
  next(new Error("unauthorized"));
});

const recentMessages = [];
const MAX_MESSAGES = 150;
const connectedUsers = new Map();

function emitPresence() {
  const names = [...connectedUsers.values()].filter(Boolean);
  io.emit("presence", {
    count: connectedUsers.size,
    names: [...new Set(names)].slice(0, 20)
  });
}

io.on("connection", (socket) => {
  connectedUsers.set(socket.id, "Guest");
  socket.emit("chat-history", recentMessages);
  emitPresence();

  socket.on("set-name", (rawName) => {
    const name = String(rawName || "Guest").trim().slice(0, 24) || "Guest";
    connectedUsers.set(socket.id, name);
    emitPresence();
  });

  socket.on("typing", (isTyping) => {
    socket.broadcast.emit("typing", {
      name: connectedUsers.get(socket.id) || "Guest",
      isTyping: Boolean(isTyping)
    });
  });

  socket.on("chat-message", (payload) => {
    const name = String(payload?.name || connectedUsers.get(socket.id) || "Guest")
      .trim()
      .slice(0, 24) || "Guest";
    const text = String(payload?.text || "").trim().slice(0, 1200);
    if (!text) return;

    connectedUsers.set(socket.id, name);

    const message = {
      id: crypto.randomUUID(),
      senderId: socket.id,
      name,
      text,
      time: new Date().toISOString()
    };

    recentMessages.push(message);
    if (recentMessages.length > MAX_MESSAGES) recentMessages.shift();

    io.emit("chat-message", message);
    socket.broadcast.emit("typing", { name, isTyping: false });
  });

  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    emitPresence();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Private chat running on port ${PORT}`);
});
