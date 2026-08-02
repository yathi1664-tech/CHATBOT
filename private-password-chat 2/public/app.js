const loginView = document.getElementById("loginView");
const chatView = document.getElementById("chatView");
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("loginError");
const togglePassword = document.getElementById("togglePassword");
const logoutButton = document.getElementById("logoutButton");
const displayName = document.getElementById("displayName");
const messages = document.getElementById("messages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const onlineCount = document.getElementById("onlineCount");

let socket = null;
let ownName = localStorage.getItem("privateChatName") || "";
displayName.value = ownName;

togglePassword.addEventListener("click", () => {
  const visible = passwordInput.type === "text";
  passwordInput.type = visible ? "password" : "text";
  togglePassword.textContent = visible ? "👁" : "🙈";
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
    if (!response.ok) throw new Error(data.message || "Could not enter room.");

    passwordInput.value = "";
    openChat();
  } catch (error) {
    loginError.textContent = error.message;
    passwordInput.select();
  }
});

logoutButton.addEventListener("click", async () => {
  if (socket) socket.disconnect();
  await fetch("/api/logout", { method: "POST" });
  chatView.classList.add("hidden");
  loginView.classList.remove("hidden");
  messages.innerHTML = "";
});

displayName.addEventListener("input", () => {
  ownName = displayName.value.trim().slice(0, 24);
  localStorage.setItem("privateChatName", ownName);
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !socket) return;

  socket.emit("chat-message", {
    name: ownName || "Guest",
    text
  });

  messageInput.value = "";
  resizeComposer();
  messageInput.focus();
});

messageInput.addEventListener("input", resizeComposer);
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

function resizeComposer() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 130)}px`;
}

function openChat() {
  loginView.classList.add("hidden");
  chatView.classList.remove("hidden");
  connectSocket();
}

function connectSocket() {
  socket = io();

  socket.on("connect_error", () => {
    chatView.classList.add("hidden");
    loginView.classList.remove("hidden");
    loginError.textContent = "Your session expired. Enter the password again.";
  });

  socket.on("chat-history", (history) => {
    messages.innerHTML = "";
    if (!history.length) {
      messages.innerHTML = '<div class="empty">No messages yet.<br>Start the private conversation.</div>';
      return;
    }
    history.forEach(renderMessage);
    scrollToBottom();
  });

  socket.on("chat-message", (message) => {
    const empty = messages.querySelector(".empty");
    if (empty) empty.remove();
    renderMessage(message);
    scrollToBottom();
  });

  socket.on("online-count", (count) => {
    onlineCount.textContent = `${count} online`;
  });
}

function renderMessage(message) {
  const article = document.createElement("article");
  const isMine = message.name === (ownName || "Guest");
  article.className = `message${isMine ? " mine" : ""}`;

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

function scrollToBottom() {
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

(async function restoreSession() {
  try {
    const response = await fetch("/api/session");
    const data = await response.json();
    if (data.authenticated) openChat();
  } catch (_) {}
})();
