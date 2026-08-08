# Private Chat Upgraded

Default password: `1419`

## Features
- Password-protected real-time chat
- Fresh password entry whenever the page is opened again
- Photo, video, PDF and common file sharing (up to 25 MB each)
- Voice messages using the browser microphone
- Peer-to-peer audio and video calls using WebRTC
- Emoji, typing indicator and online presence

## Render
- Root Directory: folder containing `package.json`
- Build Command: `npm install`
- Start Command: `npm start`

Environment variables:
- `CHAT_PASSWORD=1419`
- `SESSION_SECRET=<a long random secret>`
- `NODE_ENV=production`

## Important deployment notes
- Camera and microphone need HTTPS. Render provides HTTPS.
- Uploaded files are stored on the server filesystem. On Render's default ephemeral filesystem they can disappear after a restart/redeploy. For permanent attachments, connect persistent object storage later.
- WebRTC uses a public STUN server. Most calls will work, but fully reliable calling across restrictive networks requires a TURN server.
