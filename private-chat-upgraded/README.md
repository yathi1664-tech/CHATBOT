# Private Chat V5 — Persistent Chat History

## Default password
`1419`

## What changed
- Chat history is now written to `messages.json` on the server and reloaded after a restart.
- Leaving the chat still signs the user out and requires the password again.
- Re-entering the room reloads the previous messages instead of starting with an empty chat.
- Delete for everyone is also saved permanently in the history store.
- Two-member room limit, replies, stickers, uploads, voice notes, audio/video calls and front/back camera switching are retained.

## Render settings
- Build Command: `npm install`
- Start Command: `npm start`
- `CHAT_PASSWORD=1419`
- `SESSION_SECRET=<a long random secret>`
- `NODE_ENV=production`

## Important for permanent history on Render
The app automatically uses `/var/data` when that folder exists. For history and uploaded files to survive Render service restarts/redeploys, attach a Render Persistent Disk mounted at:

`/var/data`

Without a persistent disk, the app will still save history to its local filesystem and preserve messages across logout/re-entry while the same service instance is running, but Render may erase that local filesystem during a redeploy/rebuild or replacement of the instance.

You can alternatively set:

`CHAT_DATA_DIR=/var/data`

when using a persistent disk.
