# Private Chat V6 — Cloudinary Persistent History

## Default password
`1419`

## What changed
- Chat history is stored in Cloudinary as a private-chat raw JSON asset instead of Render's temporary filesystem.
- Photos, videos, audio/voice notes, PDFs and other supported files are uploaded to Cloudinary.
- Signing out or closing the browser does NOT delete chat history.
- When the Render service restarts or wakes up, it reloads the latest saved chat history from Cloudinary.
- Delete for Everyone removes the message from the saved history and also requests deletion of its Cloudinary attachment.
- Two-member room limit, left/right messages, replies, stickers, audio/video calls and front/back camera switching are retained.

## Cloudinary setup
Create or open your Cloudinary account. In the Cloudinary Console, copy the API environment variable that looks like:

`cloudinary://API_KEY:API_SECRET@CLOUD_NAME`

Do NOT put this value in `public/app.js` or `index.html`.

## Render environment variables
Add these in Render -> your Web Service -> Environment:

- `CHAT_PASSWORD` = `1419`
- `SESSION_SECRET` = a long random secret
- `NODE_ENV` = `production`
- `CLOUDINARY_URL` = your Cloudinary API environment variable

Optional:
- `CLOUDINARY_HISTORY_PUBLIC_ID` = `private-chat-system/message-history.json`

## Render commands
- Build Command: `npm install`
- Start Command: `npm start`

No Render Persistent Disk is required for the chat history or uploaded media in this version.

## Important
Keep `CLOUDINARY_URL` secret. It contains your Cloudinary API secret and must only be configured as a server-side Render environment variable.

## V7 delivery and activity timestamps
- Every normal message shows its sent time.
- When the other member opens the conversation while it is visible, the message is marked seen and the first seen time is saved to Cloudinary history.
- Login and logout activity is shown to both members and persisted in the same Cloudinary-backed chat history.

## V8 message editing + notification toggle
- A sender can edit only their own text messages from the message options menu.
- Edited messages sync immediately to both members and the new text plus `editedAt` timestamp is saved in Cloudinary history.
- The message footer can show Sent, Edited and Seen times.
- Each browser/member has an independent Notifications on/off switch.
- The notification preference is saved locally on that member's device.
- Turning notifications on requests browser notification permission once. Incoming messages from the other member produce an alert/sound while the site is open; when the tab is in the background, supported browsers can show a system notification.
- No new Render environment variables are required for V8.
