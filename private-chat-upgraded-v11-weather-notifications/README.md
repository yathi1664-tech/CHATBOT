# Private Chat V9 — Real Push Notifications

This version keeps all V8 features and adds real Web Push notifications using a Service Worker.

## Existing Render variables

Keep these:

- `CHAT_PASSWORD=1419`
- `NODE_ENV=production`
- `SESSION_SECRET=<your existing long secret>`
- `CLOUDINARY_URL=<your existing Cloudinary URL>`

## New Render variables required for lock-screen notifications

After downloading this project, run in the project folder:

```bash
npm install
npm run generate-vapid
```

The command prints two values. Add them to Render -> Environment:

- `VAPID_PUBLIC_KEY=<generated public key>`
- `VAPID_PRIVATE_KEY=<generated private key>`

Keep the private key secret. Do not put it in GitHub.

Optional:

- `VAPID_SUBJECT=mailto:your-email@example.com`

Then use Render's **Save, rebuild, and deploy**.

## How notifications work

1. Log into the private chat.
2. Turn **Notifications on**.
3. Allow browser notification permission.
4. The browser creates a push subscription and the server stores it persistently in Cloudinary (encrypted using `SESSION_SECRET`).
5. Pressing **Leave**, closing the tab, or closing Chrome does NOT remove the push subscription.
6. When the other member sends a text, sticker, photo, video, voice note, PDF, or file, the server sends a Web Push notification to the subscribed device.
7. Tapping the notification opens the private chat page; the password is still required to enter the room.

## Android notes

- Use the HTTPS Render URL.
- Chrome must have Notifications permission enabled for the site.
- Android must also allow notifications for Chrome/site notifications.
- Lock-screen visibility depends on the phone's Android notification/lock-screen settings.

## Turning notifications off

Turn the in-chat Notifications toggle OFF. The browser push subscription is removed and the server removes that device from the saved subscriptions.

## Render

Build Command: `npm install`

Start Command: `npm start`


## V10 privacy notification change
Push notifications are intentionally content-free. The lock screen and notification shade show only `Private Chat` and `You have a new message`. Message text, attachment names, stickers, and sender names are never included in the push payload or displayed by the service worker.


## V11 disguised notification text
All new-message notifications are intentionally disguised. The system notification uses the title `Weather` and the body `Weather is now 42° F`. The in-app notification toast uses the same weather sentence. No sender name or chat content is exposed.
