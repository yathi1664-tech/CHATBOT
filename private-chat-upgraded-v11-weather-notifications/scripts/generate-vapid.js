const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\nAdd these to Render -> Environment:\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('\nKeep VAPID_PRIVATE_KEY secret. Do not put it in GitHub.\n');
