const $ = (id) => document.getElementById(id);
const loginScreen=$('loginScreen'), chatScreen=$('chatScreen'), loginForm=$('loginForm'), passwordInput=$('password'), showPassword=$('showPassword'), loginError=$('loginError'), logoutBtn=$('logoutBtn'), displayName=$('displayName'), presenceText=$('presenceText'), messages=$('messages'), typingIndicator=$('typingIndicator'), messageForm=$('messageForm'), messageInput=$('messageInput'), emojiBtn=$('emojiBtn'), emojiPanel=$('emojiPanel'), stickerBtn=$('stickerBtn'), stickerPanel=$('stickerPanel'), attachBtn=$('attachBtn'), fileInput=$('fileInput'), recordBtn=$('recordBtn'), uploadStatus=$('uploadStatus');
const replyBar=$('replyBar'), replyName=$('replyName'), replyPreview=$('replyPreview'), cancelReplyBtn=$('cancelReplyBtn');
const messageMenu=$('messageMenu'), replyMessageBtn=$('replyMessageBtn'), editMessageBtn=$('editMessageBtn'), deleteForMeBtn=$('deleteForMeBtn'), deleteForEveryoneBtn=$('deleteForEveryoneBtn');
const notificationToggle=$('notificationToggle'), notificationLabel=$('notificationLabel'), notificationToast=$('notificationToast');
const editModal=$('editModal'), editMessageInput=$('editMessageInput'), saveEditBtn=$('saveEditBtn'), cancelEditBtn=$('cancelEditBtn');
const audioCallBtn=$('audioCallBtn'), videoCallBtn=$('videoCallBtn'), callPanel=$('callPanel'), callStatus=$('callStatus'), remoteVideo=$('remoteVideo'), localVideo=$('localVideo'), muteBtn=$('muteBtn'), cameraBtn=$('cameraBtn'), switchCameraBtn=$('switchCameraBtn'), endCallBtn=$('endCallBtn'), incomingCall=$('incomingCall'), incomingTitle=$('incomingTitle'), incomingFrom=$('incomingFrom'), acceptCallBtn=$('acceptCallBtn'), declineCallBtn=$('declineCallBtn');

let socket, typingTimer, recorder, recordingChunks=[];
let typingUsers = new Set();
let onlineUsers = [];
let myName = localStorage.getItem('privateChatName') || '';
let clientId = localStorage.getItem('privateChatClientId') || crypto.randomUUID();
localStorage.setItem('privateChatClientId', clientId);
let peer, localStream, activeTargetId, pendingOffer=null, callMode='audio', currentFacingMode='user';
let replyingTo = null, menuMessage = null, editingMessage = null;
let notificationsEnabled = localStorage.getItem('privateChatNotifications') === 'on';
let ownedMessageIds = new Set();
let deletedForMe = new Set(JSON.parse(localStorage.getItem('privateChatDeletedForMe') || '[]'));
displayName.value = myName;
notificationToggle.checked = notificationsEnabled;
updateNotificationLabel();

function updateNotificationLabel(){
  if(!notificationLabel)return;
  notificationLabel.textContent=notificationsEnabled?'🔔 Notifications on':'🔕 Notifications off';
}
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
}
async function getPushRegistration(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push notifications are not supported on this browser.');
  return navigator.serviceWorker.register('/service-worker.js');
}
async function enablePushNotifications({silent=false}={}){
  if(!('Notification' in window)) throw new Error('Notifications are not supported on this device.');
  let permission=Notification.permission;
  if(permission==='default' && !silent) permission=await Notification.requestPermission();
  if(permission!=='granted') throw new Error('Notification permission was not allowed.');
  const registration=await getPushRegistration();
  const keyResponse=await fetch('/api/push/public-key',{cache:'no-store'});
  const keyData=await keyResponse.json();
  if(!keyResponse.ok || !keyData.enabled || !keyData.publicKey) throw new Error('Push notifications are not configured on the server yet.');
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription){
    subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(keyData.publicKey)});
  }
  const response=await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,subscription:subscription.toJSON()})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.message||'Could not enable push notifications.');
  notificationsEnabled=true;
  localStorage.setItem('privateChatNotifications','on');
  notificationToggle.checked=true;
  updateNotificationLabel();
  return true;
}
async function disablePushNotifications(){
  try{
    if('serviceWorker' in navigator){
      const registration=await navigator.serviceWorker.getRegistration('/');
      const subscription=await registration?.pushManager?.getSubscription();
      const endpoint=subscription?.endpoint||'';
      try{await fetch('/api/push/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,endpoint})});}catch(_){}
      if(subscription) await subscription.unsubscribe();
    }
  }finally{
    notificationsEnabled=false;
    localStorage.setItem('privateChatNotifications','off');
    notificationToggle.checked=false;
    updateNotificationLabel();
  }
}
notificationToggle.addEventListener('change',async()=>{
  notificationToggle.disabled=true;
  try{
    if(notificationToggle.checked){
      await enablePushNotifications();
      showNotificationToast('Lock-screen notifications turned on.');
    }else{
      await disablePushNotifications();
      showNotificationToast('Notifications turned off.');
    }
  }catch(err){
    notificationsEnabled=false;
    localStorage.setItem('privateChatNotifications','off');
    notificationToggle.checked=false;
    updateNotificationLabel();
    showStatus(err.message||'Could not enable notifications.',true);
  }finally{notificationToggle.disabled=false;}
});
function showNotificationToast(text){
  if(!notificationToast)return;
  notificationToast.textContent=text;notificationToast.classList.remove('hidden');
  clearTimeout(showNotificationToast._timer);showNotificationToast._timer=setTimeout(()=>notificationToast.classList.add('hidden'),2600);
}
function notifyIncomingMessage(message){
  if(!notificationsEnabled || !message || message.kind==='activity' || message.senderId===socket?.id)return;
  // Privacy-first: even the in-app notification toast does not reveal message content.
  if(document.visibilityState==='visible') showNotificationToast('Weather is now 42° F');
}

const emojis=["😀","😂","🥰","😍","😘","😊","😎","🤗","😅","🥹","😢","😭","😡","🤔","🙈","❤️","💜","💕","💖","🔥","✨","🎉","👍","👎","🙏","👏","🤝","💯","😴","🤭","😇","🥳","🌹","💐","🐦","💌","☕","🎵","🌙","⭐"];
const stickers=["❤️","😂","😍","🥰","😘","🔥","🎉","👍","👏","🙏","💯","🌹","💐","🐦","😎","🥳","😭","😡","🤗","✨","💜","💕","💖"];

emojis.forEach(e=>{const b=document.createElement('button');b.type='button';b.textContent=e;b.onclick=()=>{messageInput.value+=e;messageInput.focus();resizeComposer();};emojiPanel.appendChild(b);});
stickers.forEach(s=>{const b=document.createElement('button');b.type='button';b.textContent=s;b.onclick=()=>sendSticker(s);stickerPanel.appendChild(b);});
emojiBtn.onclick=()=>{emojiPanel.classList.toggle('hidden');stickerPanel.classList.add('hidden');};
stickerBtn.onclick=()=>{stickerPanel.classList.toggle('hidden');emojiPanel.classList.add('hidden');};
document.addEventListener('click',e=>{
  if(!emojiPanel.contains(e.target)&&e.target!==emojiBtn) emojiPanel.classList.add('hidden');
  if(!stickerPanel.contains(e.target)&&e.target!==stickerBtn) stickerPanel.classList.add('hidden');
  if(!messageMenu.contains(e.target) && !e.target.closest('.message-actions')) closeMessageMenu();
});
showPassword.onclick=()=>{const shown=passwordInput.type==='text';passwordInput.type=shown?'password':'text';showPassword.textContent=shown?'👁':'🙈';};

loginForm.addEventListener('submit',async e=>{e.preventDefault();loginError.textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:passwordInput.value})});const d=await r.json();if(!r.ok)throw new Error(d.message||'Login failed.');passwordInput.value='';openChat();}catch(err){loginError.textContent=err.message;}});

async function leaveChat(){if(socket)socket.disconnect();stopCall(false);try{await fetch('/api/logout',{method:'POST',keepalive:true});}catch(_){} chatScreen.classList.add('hidden');loginScreen.classList.remove('hidden');messages.innerHTML='';clearReply();}
logoutBtn.onclick=leaveChat;
window.addEventListener('pagehide',()=>{if(!chatScreen.classList.contains('hidden')) navigator.sendBeacon('/api/logout');});

function openChat(){loginScreen.classList.add('hidden');chatScreen.classList.remove('hidden');connectSocket();if(notificationsEnabled&&'Notification' in window&&Notification.permission==='granted'){enablePushNotifications({silent:true}).catch(()=>{});}}

displayName.addEventListener('input',()=>{myName=displayName.value.trim().slice(0,24);localStorage.setItem('privateChatName',myName);if(socket?.connected)socket.emit('set-name',myName||'Guest');});
messageInput.addEventListener('input',()=>{resizeComposer();if(!socket?.connected)return;socket.emit('typing',true);clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit('typing',false),900);});
messageInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();messageForm.requestSubmit();}});
messageForm.addEventListener('submit',e=>{e.preventDefault();const text=messageInput.value.trim();if(!text||!socket?.connected)return;socket.emit('chat-message',{name:myName||'Guest',text,replyToId:replyingTo?.id||null});socket.emit('typing',false);messageInput.value='';resizeComposer();emojiPanel.classList.add('hidden');stickerPanel.classList.add('hidden');clearReply();messageInput.focus();});
function resizeComposer(){messageInput.style.height='auto';messageInput.style.height=`${Math.min(messageInput.scrollHeight,120)}px`;}

function setReply(message){replyingTo=message;replyName.textContent=message.name||'Message';replyPreview.textContent=messagePreview(message);replyBar.classList.remove('hidden');messageInput.focus();}
function clearReply(){replyingTo=null;replyBar.classList.add('hidden');replyName.textContent='';replyPreview.textContent='';}
cancelReplyBtn.onclick=clearReply;
function messagePreview(message){if(message.kind==='text')return message.text||'Message';if(message.kind==='attachment')return message.file?.name||'Attachment';if(message.kind==='sticker')return message.sticker||'Sticker';return 'Message';}

attachBtn.onclick=()=>fileInput.click();
fileInput.addEventListener('change',async()=>{const file=fileInput.files?.[0];fileInput.value='';if(file)await uploadAndSend(file);});
async function uploadAndSend(file){if(file.size>25*1024*1024){showStatus('Maximum file size is 25 MB.',true);return;}showStatus(`Uploading ${file.name}…`);const fd=new FormData();fd.append('file',file);try{const r=await fetch('/api/upload',{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.message||'Upload failed.');socket.emit('attachment-message',{name:myName||'Guest',file:d.file,replyToId:replyingTo?.id||null});clearReply();showStatus('Sent.');setTimeout(()=>uploadStatus.classList.add('hidden'),1200);}catch(err){showStatus(err.message,true);}}
function showStatus(text,error=false){uploadStatus.textContent=text;uploadStatus.classList.remove('hidden');uploadStatus.classList.toggle('status-error',error);}

function sendSticker(sticker){if(!socket?.connected)return;socket.emit('sticker-message',{name:myName||'Guest',sticker,replyToId:replyingTo?.id||null});stickerPanel.classList.add('hidden');clearReply();}

recordBtn.onclick=async()=>{if(recorder?.state==='recording'){recorder.stop();return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});recordingChunks=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data);};recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());recordBtn.classList.remove('recording');recordBtn.textContent='🎙️';const blob=new Blob(recordingChunks,{type:recorder.mimeType||'audio/webm'});const file=new File([blob],`voice-${Date.now()}.webm`,{type:blob.type});await uploadAndSend(file);};recorder.start();recordBtn.classList.add('recording');recordBtn.textContent='⏹️';}catch(_){showStatus('Microphone permission is required for voice messages.',true);}};

function connectSocket(){if(socket?.connected)return;socket=io();socket.on('connect',()=>{socket.emit('set-client-id',clientId);socket.emit('set-name',myName||'Guest');});socket.on('connect_error',async(err)=>{chatScreen.classList.add('hidden');loginScreen.classList.remove('hidden');if(err?.message==='room-full'){loginError.textContent='This private chat is full. Only 2 members can be inside at the same time.';try{await fetch('/api/logout',{method:'POST'});}catch(_){}}else{loginError.textContent='Session expired. Enter the password again.';}});
socket.on('presence',({count,users})=>{onlineUsers=users||[];presenceText.textContent=`${count}/2 ${count===1?'member':'members'} online`;});
socket.on('room-entry-blocked',({message})=>showSecurityAlert(message||'Someone tried to enter this full private room.'));
socket.on('chat-history',history=>{messages.innerHTML='';const visible=(history||[]).filter(m=>!deletedForMe.has(m.id));if(!visible.length)messages.innerHTML='<div class="empty">No messages yet.<br>Start the private conversation.</div>';else visible.forEach(renderMessage);scrollBottom();setTimeout(markMessagesSeen,120);});
socket.on('owned-message-ids',ids=>{ownedMessageIds=new Set(ids||[]);refreshOwnershipButtons();refreshMessageSides();});
socket.on('message-owned',({messageId})=>{ownedMessageIds.add(messageId);refreshOwnershipButtons();refreshMessageSides();});
socket.on('chat-message',m=>{if(deletedForMe.has(m.id))return;messages.querySelector('.empty')?.remove();renderMessage(m);scrollBottom();notifyIncomingMessage(m);setTimeout(markMessagesSeen,80);});
socket.on('message-deleted-everyone',({messageId})=>{document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)?.remove();deletedForMe.delete(messageId);saveDeletedForMe();if(replyingTo?.id===messageId)clearReply();if(!messages.querySelector('.message'))messages.innerHTML='<div class="empty">No messages yet.<br>Start the private conversation.</div>';});
socket.on('message-edited',update=>updateEditedMessage(update));
socket.on('messages-seen-update',({updates})=>{(updates||[]).forEach(updateSeenStatus);});
socket.on('typing',({name,isTyping})=>{if(isTyping)typingUsers.add(name);else typingUsers.delete(name);updateTyping();});
socket.on('call-offer',async data=>{if(activeTargetId){socket.emit('call-decline',{targetId:data.fromId});return;}pendingOffer=data;incomingTitle.textContent=`Incoming ${data.mode} call`;incomingFrom.textContent=`${data.fromName} is calling you`;incomingCall.classList.remove('hidden');});
socket.on('call-answer',async({fromId,answer})=>{if(peer&&fromId===activeTargetId)await peer.setRemoteDescription(answer);});
socket.on('ice-candidate',async({fromId,candidate})=>{if(peer&&fromId===activeTargetId&&candidate)try{await peer.addIceCandidate(candidate);}catch(_){}});
socket.on('call-decline',({fromId})=>{if(fromId===activeTargetId){callStatus.textContent='Call declined';setTimeout(()=>stopCall(false),900);}});
socket.on('call-end',({fromId})=>{if(fromId===activeTargetId)stopCall(false);});}

function updateTyping(){const list=[...typingUsers];typingIndicator.textContent=list.length===0?'':list.length===1?`${list[0]} is typing…`:`${list.slice(0,2).join(' and ')} are typing…`;}
function formatTime(value){return new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function formatDateTime(value){return new Date(value).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function renderMessage(message){
  if(message.kind==='activity'){
    const event=document.createElement('div');
    event.className=`activity-event ${message.action==='logout'?'logout':''}`;
    event.dataset.messageId=message.id;
    const verb=message.action==='logout'?'logged out':'logged in';
    event.innerHTML=`<span>${message.action==='logout'?'↪':'↩'}</span><strong></strong><span>${verb}</span><time></time>`;
    event.querySelector('strong').textContent=message.name||'Guest';
    event.querySelector('time').textContent=formatDateTime(message.time);
    messages.appendChild(event);
    return;
  }
  const article=document.createElement('article');
  article.className=`message${ownedMessageIds.has(message.id)?' mine':''}`;
  article.dataset.messageId=message.id;
  article._messageData=message;
  const meta=document.createElement('div');meta.className='message-meta';
  const name=document.createElement('span');name.className='message-name';name.textContent=message.name;
  meta.append(name);
  const actions=document.createElement('div');actions.className='message-actions';
  const menuBtn=document.createElement('button');menuBtn.type='button';menuBtn.textContent='⋮';menuBtn.setAttribute('aria-label','Message options');menuBtn.onclick=(e)=>{e.stopPropagation();openMessageMenu(article,message,menuBtn);};actions.appendChild(menuBtn);
  article.append(meta,actions);
  if(message.reply){const rp=document.createElement('div');rp.className='reply-preview';const strong=document.createElement('strong');strong.textContent=message.reply.name||'Reply';const span=document.createElement('span');span.textContent=message.reply.preview||'Message';rp.append(strong,span);rp.onclick=()=>document.querySelector(`[data-message-id="${CSS.escape(message.reply.id)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});article.append(rp);}
  if(message.kind==='attachment')article.append(renderAttachment(message.file));else if(message.kind==='sticker'){const st=document.createElement('div');st.className='sticker-message';st.textContent=message.sticker;article.append(st);}else{const text=document.createElement('div');text.className='message-text';text.textContent=message.text;article.append(text);}
  const delivery=document.createElement('div');delivery.className='delivery-status';delivery.dataset.deliveryFor=message.id;
  delivery.textContent=deliveryText(message);
  if(message.seenAt)delivery.title=`Seen by ${message.seenBy||'the other member'} at ${formatDateTime(message.seenAt)}`;
  article.appendChild(delivery);
  messages.appendChild(article);
}
function updateSeenStatus(update){
  const article=document.querySelector(`.message[data-message-id="${CSS.escape(update.messageId)}"]`);
  if(!article)return;
  article._messageData={...(article._messageData||{}),seenAt:update.seenAt,seenBy:update.seenBy};
  const status=article.querySelector('.delivery-status');
  if(status){status.textContent=deliveryText(article._messageData);status.title=`Seen by ${update.seenBy||'the other member'} at ${formatDateTime(update.seenAt)}`;}
}
function markMessagesSeen(){
  if(!socket?.connected||document.visibilityState!=='visible'||chatScreen.classList.contains('hidden'))return;
  const ids=[...messages.querySelectorAll('.message[data-message-id]')].map(el=>el.dataset.messageId).filter(Boolean);
  if(ids.length)socket.emit('messages-seen',{messageIds:ids});
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')setTimeout(markMessagesSeen,100);});
function renderAttachment(file){const wrap=document.createElement('div');wrap.className='attachment';const type=file.type||'';if(type.startsWith('image/')){const img=document.createElement('img');img.src=file.url;img.alt=file.name;img.loading='lazy';wrap.append(img);}else if(type.startsWith('video/')){const v=document.createElement('video');v.src=file.url;v.controls=true;v.playsInline=true;wrap.append(v);}else if(type.startsWith('audio/')){const a=document.createElement('audio');a.src=file.url;a.controls=true;wrap.append(a);}const link=document.createElement('a');link.href=file.url;link.target='_blank';link.rel='noopener';link.download=file.name;link.textContent=`📄 ${file.name}`;wrap.append(link);return wrap;}
function scrollBottom(){requestAnimationFrame(()=>messages.scrollTop=messages.scrollHeight);}
function playNotification(force=false){if(!force&&document.visibilityState==='visible')return;try{const c=new(window.AudioContext||window.webkitAudioContext)();const o=c.createOscillator(),g=c.createGain();o.frequency.value=660;g.gain.value=.035;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.08);}catch(_){}}
function deliveryText(message){return `Sent ${formatTime(message.time)}${message.editedAt?` · Edited ${formatTime(message.editedAt)}`:''}${message.seenAt?` · Seen ${formatTime(message.seenAt)}`:''}`;}
function updateEditedMessage(update){const article=document.querySelector(`.message[data-message-id="${CSS.escape(update.messageId)}"]`);if(!article)return;article._messageData={...(article._messageData||{}),text:update.text,editedAt:update.editedAt};const text=article.querySelector('.message-text');if(text)text.textContent=update.text;const status=article.querySelector('.delivery-status');if(status)status.textContent=deliveryText(article._messageData);if(replyingTo?.id===update.messageId){replyingTo={...replyingTo,text:update.text};replyPreview.textContent=messagePreview(replyingTo);}}

function refreshMessageSides(){document.querySelectorAll('.message[data-message-id]').forEach(article=>{article.classList.toggle('mine',ownedMessageIds.has(article.dataset.messageId));});}
function showSecurityAlert(text){const box=document.getElementById('securityAlert');if(!box)return;box.textContent=`🔒 ${text}`;box.classList.remove('hidden');clearTimeout(showSecurityAlert._timer);showSecurityAlert._timer=setTimeout(()=>box.classList.add('hidden'),5000);}

function openMessageMenu(article,message,button){menuMessage={article,message};const mine=ownedMessageIds.has(message.id);deleteForEveryoneBtn.classList.toggle('hidden',!mine);editMessageBtn.classList.toggle('hidden',!mine||message.kind!=='text');const rect=button.getBoundingClientRect();messageMenu.classList.remove('hidden');const menuRect=messageMenu.getBoundingClientRect();let left=Math.min(rect.right-menuRect.width,window.innerWidth-menuRect.width-8);left=Math.max(8,left);let top=rect.bottom+6;if(top+menuRect.height>window.innerHeight-8)top=Math.max(8,rect.top-menuRect.height-6);messageMenu.style.left=`${left}px`;messageMenu.style.top=`${top}px`;}
function closeMessageMenu(){messageMenu.classList.add('hidden');menuMessage=null;}
function refreshOwnershipButtons(){if(menuMessage){const mine=ownedMessageIds.has(menuMessage.message.id);deleteForEveryoneBtn.classList.toggle('hidden',!mine);editMessageBtn.classList.toggle('hidden',!mine||menuMessage.message.kind!=='text');}}
replyMessageBtn.onclick=()=>{if(menuMessage)setReply(menuMessage.message);closeMessageMenu();};
editMessageBtn.onclick=()=>{
  if(!menuMessage||!ownedMessageIds.has(menuMessage.message.id)||menuMessage.message.kind!=='text')return;
  editingMessage=menuMessage.message;
  editMessageInput.value=editingMessage.text||'';
  editModal.classList.remove('hidden');
  closeMessageMenu();
  setTimeout(()=>{editMessageInput.focus();editMessageInput.setSelectionRange(editMessageInput.value.length,editMessageInput.value.length);},30);
};
cancelEditBtn.onclick=()=>closeEditModal();
saveEditBtn.onclick=()=>saveMessageEdit();
editMessageInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();saveMessageEdit();}if(e.key==='Escape'){e.preventDefault();closeEditModal();}});
editModal.addEventListener('click',e=>{if(e.target===editModal)closeEditModal();});
function closeEditModal(){editModal.classList.add('hidden');editingMessage=null;editMessageInput.value='';}
function saveMessageEdit(){
  if(!editingMessage||!socket?.connected)return;
  const text=editMessageInput.value.trim();
  if(!text){showNotificationToast('A message cannot be empty.');return;}
  if(text===(editingMessage.text||'')){closeEditModal();return;}
  socket.emit('edit-message',{messageId:editingMessage.id,text});
  closeEditModal();
}

deleteForMeBtn.onclick=()=>{if(!menuMessage)return;const id=menuMessage.message.id;deletedForMe.add(id);saveDeletedForMe();menuMessage.article.remove();if(replyingTo?.id===id)clearReply();closeMessageMenu();if(!messages.querySelector('.message'))messages.innerHTML='<div class="empty">No messages yet.<br>Start the private conversation.</div>';};
deleteForEveryoneBtn.onclick=()=>{if(!menuMessage||!ownedMessageIds.has(menuMessage.message.id))return;socket.emit('delete-message-everyone',{messageId:menuMessage.message.id});closeMessageMenu();};
function saveDeletedForMe(){localStorage.setItem('privateChatDeletedForMe',JSON.stringify([...deletedForMe].slice(-500)));}

function chooseTarget(){const others=onlineUsers.filter(u=>u.id!==socket?.id);if(!others.length){showStatus('No other member is online to call.',true);return null;}if(others.length===1)return others[0];const names=others.map((u,i)=>`${i+1}. ${u.name}`).join('\n');const choice=Number(prompt(`Who do you want to call?\n${names}`));return others[choice-1]||null;}
audioCallBtn.onclick=()=>startCall('audio');videoCallBtn.onclick=()=>startCall('video');
async function startCall(mode){const target=chooseTarget();if(!target)return;try{callMode=mode;activeTargetId=target.id;currentFacingMode='user';localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:mode==='video'?{facingMode:{ideal:'user'}}:false});await createPeer();localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));localVideo.srcObject=localStream;localVideo.classList.toggle('hidden',mode!=='video');switchCameraBtn.classList.toggle('hidden',mode!=='video');remoteVideo.classList.toggle('audio-only',mode!=='video');callPanel.classList.remove('hidden');callStatus.textContent=`Calling ${target.name}…`;const offer=await peer.createOffer();await peer.setLocalDescription(offer);socket.emit('call-offer',{targetId:target.id,offer,mode});}catch(_){showStatus('Camera/microphone permission is required for calls.',true);stopCall(false);}}
async function createPeer(){peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});peer.onicecandidate=e=>{if(e.candidate&&activeTargetId)socket.emit('ice-candidate',{targetId:activeTargetId,candidate:e.candidate});};peer.ontrack=e=>{remoteVideo.srcObject=e.streams[0];callStatus.textContent='Connected';};peer.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(peer.connectionState))stopCall(false);};}
acceptCallBtn.onclick=async()=>{const data=pendingOffer;if(!data)return;incomingCall.classList.add('hidden');pendingOffer=null;try{activeTargetId=data.fromId;callMode=data.mode;currentFacingMode='user';localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:data.mode==='video'?{facingMode:{ideal:'user'}}:false});await createPeer();localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));localVideo.srcObject=localStream;localVideo.classList.toggle('hidden',data.mode!=='video');switchCameraBtn.classList.toggle('hidden',data.mode!=='video');remoteVideo.classList.toggle('audio-only',data.mode!=='video');callPanel.classList.remove('hidden');callStatus.textContent=`In call with ${data.fromName}`;await peer.setRemoteDescription(data.offer);const answer=await peer.createAnswer();await peer.setLocalDescription(answer);socket.emit('call-answer',{targetId:data.fromId,answer});}catch(_){socket.emit('call-decline',{targetId:data.fromId});stopCall(false);showStatus('Could not access camera/microphone.',true);}};
declineCallBtn.onclick=()=>{if(pendingOffer)socket.emit('call-decline',{targetId:pendingOffer.fromId});pendingOffer=null;incomingCall.classList.add('hidden');};
endCallBtn.onclick=()=>stopCall(true);
function stopCall(notify=true){if(notify&&activeTargetId&&socket?.connected)socket.emit('call-end',{targetId:activeTargetId});peer?.close();peer=null;localStream?.getTracks().forEach(t=>t.stop());localStream=null;remoteVideo.srcObject=null;localVideo.srcObject=null;activeTargetId=null;pendingOffer=null;callPanel.classList.add('hidden');incomingCall.classList.add('hidden');switchCameraBtn.classList.add('hidden');}
muteBtn.onclick=()=>{const t=localStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;muteBtn.textContent=t.enabled?'🎙️':'🔇';}};
cameraBtn.onclick=()=>{const t=localStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;cameraBtn.textContent=t.enabled?'📷':'🚫';}};
switchCameraBtn.onclick=async()=>{if(callMode!=='video'||!peer||!localStream)return;const next=currentFacingMode==='user'?'environment':'user';try{const replacement=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:next}},audio:false});const newTrack=replacement.getVideoTracks()[0];if(!newTrack)throw new Error('No camera');const sender=peer.getSenders().find(s=>s.track?.kind==='video');if(sender)await sender.replaceTrack(newTrack);const oldTrack=localStream.getVideoTracks()[0];if(oldTrack){localStream.removeTrack(oldTrack);oldTrack.stop();}localStream.addTrack(newTrack);localVideo.srcObject=localStream;currentFacingMode=next;switchCameraBtn.textContent=next==='environment'?'🤳':'🔄';}catch(_){showStatus('Back camera is not available on this device/browser.',true);}};

// Deliberately do not restore a previous session. Every fresh page open starts at the password screen.
