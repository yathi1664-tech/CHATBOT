# Private Chat Upgraded

## Default password
1419

## Features
- Real-time password-protected chat with Socket.IO
- Photos, videos, audio, PDFs and common files (up to 25 MB)
- Voice messages
- Audio calls and video calls with WebRTC
- Front/back camera switching during video calls (when the device/browser supports it)
- Reply to a particular message
- Delete for me (local to that browser/device)
- Delete for everyone (available for messages sent from the same browser/device)
- Sticker picker plus emoji picker
- Automatic sign-out when leaving/closing the chat so the password is required on a fresh open

## Render settings
- Root Directory: the folder containing `package.json`
- Build Command: `npm install`
- Start Command: `npm start`

## Environment variables
- `CHAT_PASSWORD` = `1419` (or your preferred password)
- `SESSION_SECRET` = a long random secret
- `NODE_ENV` = `production`

## Important notes
- Camera and microphone access require HTTPS on normal hosted deployments. Render provides HTTPS.
- Rear camera switching depends on the device/browser having an environment-facing camera available.
- Chat history and message ownership are stored in server memory and reset when the server restarts.
- Uploaded files are stored in the local `uploads` folder. On Render's default ephemeral filesystem they may disappear after service restarts/redeploys. Use persistent/cloud storage for permanent media history.
