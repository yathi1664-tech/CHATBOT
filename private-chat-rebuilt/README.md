# Private Chat Rebuilt

## Default password
1419

## Render settings
- Root Directory: the folder containing `package.json`
- Build Command: `npm install`
- Start Command: `npm start`

## Environment variables
- `CHAT_PASSWORD` = `1419`
- `SESSION_SECRET` = any long random secret
- `NODE_ENV` = `production`

## Notes
- The chat is real-time using Socket.IO.
- The latest 150 messages are kept in server memory.
- Messages disappear when Render restarts the service.
- The message composer is pinned inside the visible mobile viewport.
