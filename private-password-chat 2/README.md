# Private Password Chat

A real-time chat website that opens only after the server verifies the shared password.

## Default password

`1419`

For deployment, set it as an environment variable instead of leaving it in source code:

- `CHAT_PASSWORD=1419`
- `SESSION_SECRET=replace-with-a-long-random-secret`
- `NODE_ENV=production`

## Run locally

1. Install Node.js 18 or newer.
2. Open this folder in Terminal.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`

## Deploy on Render

1. Upload this folder to a GitHub repository.
2. Create a new **Web Service** on Render and connect the repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables:
   - `CHAT_PASSWORD` = `1419`
   - `SESSION_SECRET` = a long random value
   - `NODE_ENV` = `production`
6. Deploy and share the Render URL only with trusted people.

## Important behavior

- The password is checked by the Node.js server, not exposed in the browser JavaScript.
- Only an authenticated browser session can connect to the Socket.IO chat.
- Messages are kept in server memory, up to the latest 100 messages.
- Messages disappear whenever the server restarts or redeploys.
- Anyone who knows the shared password can read new messages and the messages still held in memory.
- For permanent message history, connect a database such as MongoDB, PostgreSQL, or Firebase.
