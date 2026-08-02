const loginScreen = document.getElementById("loginScreen");
const chatScreen = document.getElementById("chatScreen");
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("password");
const showPassword = document.getElementById("showPassword");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");
const displayName = document.getElementById("displayName");
const presenceText = document.getElementById("presenceText");
const messages = document.getElementById("messages");
const typingIndicator = document.getElementById("typingIndicator");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const emojiBtn = document.getElementById("emojiBtn");
const emojiPanel = document.getElementById("emojiPanel");

let socket;
let typingTimer;
let typingUsers = new Set();
let myName = localStorage.getItem("privateChatName") || "";
displayName.value = myName;

const emojis = ["😀","😂","🥰","😍","😘","😊","😎","🤗","😅","🥹","😢","😭","😡","🤔","🙈","❤️","💜","💕","💖","🔥","✨","🎉","👍","👎","🙏","👏","🤝","💯","😴","🤭","😇","🥳","🌹","💐","🐦","💌","☕","🎵","🌙","⭐"];

emojis.forEach((emoji) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = emoji;
  button.addEventListener("click", () => {
    messageInput.value += emoji;
    messageInput.focus();
    resizeComposer();
  });
  emojiPanel.appendChild(button);
});

emojiBtn.addEventListener("click", () => emojiPanel.classList.toggle("hidden"));

document.addEventListener("click", (event) => {
  if (!emojiPanel.contains(event.target) && event.target !== emojiBtn) {
    emojiPanel.classList.add("hidden");
  }
});

showPassword.addEventListener("click", () => {
  const shown = passwordInput.type === "text";
  passwordInput.type = shown ? "password" : "text";
  showPassword.textContent = shown ? "👁" : "🙈";
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Login failed.");

    passwordInput.value = "";
    openChat();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

logoutBtn.addEventListener("click", async () => {
  if (socket) socket.disconnect();
  await fetch("/api/logout", { method: "POST" });
  chatScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  messages.innerHTML = "";
});

displayName.addEventListener("input", () => {
  myName = displayName.value.trim().slice(0, 24);
  localStorage.setItem("privateChatName", myName);
  if (socket?.connected) socket.emit("set-name", myName || "Guest");
});

messageInput.addEventListener("input", () => {
  resizeComposer();
  if (!socket?.connected) return;
  socket.emit("typing", true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit("typing", false), 900);
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !socket?.connected) return;

  socket.emit("chat-message", {
    name: myName || "Guest",
    text
  });

  socket.emit("typing", false);
  messageInput.value = "";
  resizeComposer();
  emojiPanel.classList.add("hidden");
  messageInput.focus();
});

function resizeComposer() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
}

function openChat() {
  loginScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  connectSocket();
}

function connectSocket() {
  if (socket?.connected) return;
  socket = io();

  socket.on("connect", () => {
    socket.emit("set-name", myName || "Guest");
  });

  socket.on("connect_error", () => {
    chatScreen.classList.add("hidden");
    loginScreen.classList.remove("hidden");
    loginError.textContent = "Session expired. Enter the password again.";
  });

  socket.on("presence", ({ count }) => {
    presenceText.textContent = `${count} ${count === 1 ? "member" : "members"} online`;
  });

  socket.on("chat-history", (history) => {
    messages.innerHTML = "";
    if (!history.length) {
      messages.innerHTML = '<div class="empty">No messages yet.<br>Start the private conversation.</div>';
    } else {
      history.forEach(renderMessage);
    }
    scrollBottom();
  });

  socket.on("chat-message", (message) => {
    messages.querySelector(".empty")?.remove();
    renderMessage(message);
    scrollBottom();
    playNotification();
  });

  socket.on("typing", ({ name, isTyping }) => {
    if (isTyping) typingUsers.add(name);
    else typingUsers.delete(name);
    updateTyping();
  });
}

function updateTyping() {
  const list = [...typingUsers];
  typingIndicator.textContent =
    list.length === 0 ? "" :
    list.length === 1 ? `${list[0]} is typing…` :
    `${list.slice(0, 2).join(" and ")} are typing…`;
}

function renderMessage(message) {
  const article = document.createElement("article");
  article.className = `message${message.name === (myName || "Guest") ? " mine" : ""}`;

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const name = document.createElement("span");
  name.className = "message-name";
  name.textContent = message.name;

  const time = document.createElement("span");
  time.textContent = new Date(message.time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = message.text;

  meta.append(name, time);
  article.append(meta, text);
  messages.appendChild(article);
}

function scrollBottom() {
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

function playNotification() {
  if (document.visibilityState === "visible") return;
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.value = 0.035;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
  } catch (_) {}
}

(async function restoreSession() {
  try {
    const response = await fetch("/api/session");
    const data = await response.json();
    if (data.authenticated) openChat();
  } catch (_) {}
})();
