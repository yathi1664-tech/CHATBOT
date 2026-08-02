const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CHAT_PASSWORD = process.env.CHAT_PASSWORD || "1419";
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: false
  })
);
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24
  }
});

app.use(sessionMiddleware);

function timingSafePasswordCheck(input) {
  const entered = Buffer.from(String(input || ""));
  const expected = Buffer.from(String(CHAT_PASSWORD));
  if (entered.length !== expected.length) return false;
  return crypto.timingSafeEqual(entered, expected);
}

function requireAuth(req, res, next) {
  if (req.session?.chatAccess === true) return next();
  res.status(401).json({ ok: false, message: "Password required." });
}

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/login", (req, res) => {
  if (!timingSafePasswordCheck(req.body.password)) {
    return res.status(401).json({ ok: false, message: "Incorrect password." });
  }
  req.session.chatAccess = true;
  req.session.save(() => res.json({ ok: true }));
});

app.get("/api/session", (req, res) => {
  res.json({ authenticated: req.session?.chatAccess === true });
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

const wrap = (middleware) => (socket, next) =>
  middleware(socket.request, {}, next);

io.engine.use(sessionMiddleware);

const recentMessages = [];
const MAX_MESSAGES = 100;

io.use((socket, next) => {
  if (socket.request.session?.chatAccess === true) return next();
  next(new Error("unauthorized"));
});

io.on("connection", (socket) => {
  socket.emit("chat-history", recentMessages);
  io.emit("online-count", io.engine.clientsCount);

  socket.on("chat-message", (payload) => {
    const name = String(payload?.name || "Guest").trim().slice(0, 24);
    const text = String(payload?.text || "").trim().slice(0, 1000);
    if (!text) return;

    const message = {
      id: crypto.randomUUID(),
      name: name || "Guest",
      text,
      time: new Date().toISOString()
    };

    recentMessages.push(message);
    if (recentMessages.length > MAX_MESSAGES) recentMessages.shift();
    io.emit("chat-message", message);
  });

  socket.on("disconnect", () => {
    io.emit("online-count", io.engine.clientsCount);
  });
});

server.listen(PORT, () => {
  console.log(`Private chat running on http://localhost:${PORT}`);
});
