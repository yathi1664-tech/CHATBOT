const $ = (id) => document.getElementById(id);
const loginScreen=$('loginScreen'), chatScreen=$('chatScreen'), loginForm=$('loginForm'), passwordInput=$('password'), showPassword=$('showPassword'), loginError=$('loginError'), logoutBtn=$('logoutBtn'), displayName=$('displayName'), presenceText=$('presenceText'), messages=$('messages'), typingIndicator=$('typingIndicator'), messageForm=$('messageForm'), messageInput=$('messageInput'), emojiBtn=$('emojiBtn'), emojiPanel=$('emojiPanel'), attachBtn=$('attachBtn'), fileInput=$('fileInput'), recordBtn=$('recordBtn'), uploadStatus=$('uploadStatus');
const audioCallBtn=$('audioCallBtn'), videoCallBtn=$('videoCallBtn'), callPanel=$('callPanel'), callStatus=$('callStatus'), remoteVideo=$('remoteVideo'), localVideo=$('localVideo'), muteBtn=$('muteBtn'), cameraBtn=$('cameraBtn'), endCallBtn=$('endCallBtn'), incomingCall=$('incomingCall'), incomingTitle=$('incomingTitle'), incomingFrom=$('incomingFrom'), acceptCallBtn=$('acceptCallBtn'), declineCallBtn=$('declineCallBtn');

let socket, typingTimer, recorder, recordingChunks=[];
let typingUsers = new Set();
let onlineUsers = [];
let myName = localStorage.getItem('privateChatName') || '';
let peer, localStream, activeTargetId, pendingOffer=null, callMode='audio';
displayName.value = myName;

const emojis=["😀","😂","🥰","😍","😘","😊","😎","🤗","😅","🥹","😢","😭","😡","🤔","🙈","❤️","💜","💕","💖","🔥","✨","🎉","👍","👎","🙏","👏","🤝","💯","😴","🤭","😇","🥳","🌹","💐","🐦","💌","☕","🎵","🌙","⭐"];
emojis.forEach(e=>{const b=document.createElement('button');b.type='button';b.textContent=e;b.onclick=()=>{messageInput.value+=e;messageInput.focus();resizeComposer();};emojiPanel.appendChild(b);});
emojiBtn.onclick=()=>emojiPanel.classList.toggle('hidden');
document.addEventListener('click',e=>{if(!emojiPanel.contains(e.target)&&e.target!==emojiBtn)emojiPanel.classList.add('hidden');});
showPassword.onclick=()=>{const shown=passwordInput.type==='text';passwordInput.type=shown?'password':'text';showPassword.textContent=shown?'👁':'🙈';};

loginForm.addEventListener('submit',async e=>{e.preventDefault();loginError.textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:passwordInput.value})});const d=await r.json();if(!r.ok)throw new Error(d.message||'Login failed.');passwordInput.value='';openChat();}catch(err){loginError.textContent=err.message;}});

async function leaveChat(){if(socket)socket.disconnect();stopCall(false);try{await fetch('/api/logout',{method:'POST',keepalive:true});}catch(_){} chatScreen.classList.add('hidden');loginScreen.classList.remove('hidden');messages.innerHTML='';}
logoutBtn.onclick=leaveChat;
window.addEventListener('pagehide',()=>{if(!chatScreen.classList.contains('hidden')) navigator.sendBeacon('/api/logout');});

function openChat(){loginScreen.classList.add('hidden');chatScreen.classList.remove('hidden');connectSocket();}

displayName.addEventListener('input',()=>{myName=displayName.value.trim().slice(0,24);localStorage.setItem('privateChatName',myName);if(socket?.connected)socket.emit('set-name',myName||'Guest');});
messageInput.addEventListener('input',()=>{resizeComposer();if(!socket?.connected)return;socket.emit('typing',true);clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit('typing',false),900);});
messageInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();messageForm.requestSubmit();}});
messageForm.addEventListener('submit',e=>{e.preventDefault();const text=messageInput.value.trim();if(!text||!socket?.connected)return;socket.emit('chat-message',{name:myName||'Guest',text});socket.emit('typing',false);messageInput.value='';resizeComposer();emojiPanel.classList.add('hidden');messageInput.focus();});
function resizeComposer(){messageInput.style.height='auto';messageInput.style.height=`${Math.min(messageInput.scrollHeight,120)}px`;}

attachBtn.onclick=()=>fileInput.click();
fileInput.addEventListener('change',async()=>{const file=fileInput.files?.[0];fileInput.value='';if(file)await uploadAndSend(file);});
async function uploadAndSend(file){if(file.size>25*1024*1024){showStatus('Maximum file size is 25 MB.',true);return;}showStatus(`Uploading ${file.name}…`);const fd=new FormData();fd.append('file',file);try{const r=await fetch('/api/upload',{method:'POST',body:fd});const d=await r.json();if(!r.ok)throw new Error(d.message||'Upload failed.');socket.emit('attachment-message',{name:myName||'Guest',file:d.file});showStatus('Sent.');setTimeout(()=>uploadStatus.classList.add('hidden'),1200);}catch(err){showStatus(err.message,true);}}
function showStatus(text,error=false){uploadStatus.textContent=text;uploadStatus.classList.remove('hidden');uploadStatus.classList.toggle('status-error',error);}

recordBtn.onclick=async()=>{if(recorder?.state==='recording'){recorder.stop();return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});recordingChunks=[];recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data);};recorder.onstop=async()=>{stream.getTracks().forEach(t=>t.stop());recordBtn.classList.remove('recording');recordBtn.textContent='🎙️';const blob=new Blob(recordingChunks,{type:recorder.mimeType||'audio/webm'});const file=new File([blob],`voice-${Date.now()}.webm`,{type:blob.type});await uploadAndSend(file);};recorder.start();recordBtn.classList.add('recording');recordBtn.textContent='⏹️';}catch(_){showStatus('Microphone permission is required for voice messages.',true);}};

function connectSocket(){if(socket?.connected)return;socket=io();socket.on('connect',()=>socket.emit('set-name',myName||'Guest'));socket.on('connect_error',()=>{chatScreen.classList.add('hidden');loginScreen.classList.remove('hidden');loginError.textContent='Session expired. Enter the password again.';});
socket.on('presence',({count,users})=>{onlineUsers=users||[];presenceText.textContent=`${count} ${count===1?'member':'members'} online`;});
socket.on('chat-history',history=>{messages.innerHTML='';if(!history.length)messages.innerHTML='<div class="empty">No messages yet.<br>Start the private conversation.</div>';else history.forEach(renderMessage);scrollBottom();});
socket.on('chat-message',m=>{messages.querySelector('.empty')?.remove();renderMessage(m);scrollBottom();playNotification();});
socket.on('typing',({name,isTyping})=>{if(isTyping)typingUsers.add(name);else typingUsers.delete(name);updateTyping();});
socket.on('call-offer',async data=>{if(activeTargetId){socket.emit('call-decline',{targetId:data.fromId});return;}pendingOffer=data;incomingTitle.textContent=`Incoming ${data.mode} call`;incomingFrom.textContent=`${data.fromName} is calling you`;incomingCall.classList.remove('hidden');});
socket.on('call-answer',async({fromId,answer})=>{if(peer&&fromId===activeTargetId)await peer.setRemoteDescription(answer);});
socket.on('ice-candidate',async({fromId,candidate})=>{if(peer&&fromId===activeTargetId&&candidate)try{await peer.addIceCandidate(candidate);}catch(_){}});
socket.on('call-decline',({fromId})=>{if(fromId===activeTargetId){callStatus.textContent='Call declined';setTimeout(()=>stopCall(false),900);}});
socket.on('call-end',({fromId})=>{if(fromId===activeTargetId)stopCall(false);});}

function updateTyping(){const list=[...typingUsers];typingIndicator.textContent=list.length===0?'':list.length===1?`${list[0]} is typing…`:`${list.slice(0,2).join(' and ')} are typing…`;}
function renderMessage(message){const article=document.createElement('article');article.className=`message${message.senderId===socket?.id?' mine':''}`;const meta=document.createElement('div');meta.className='message-meta';const name=document.createElement('span');name.className='message-name';name.textContent=message.name;const time=document.createElement('span');time.textContent=new Date(message.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});meta.append(name,time);article.append(meta);
if(message.kind==='attachment')article.append(renderAttachment(message.file));else{const text=document.createElement('div');text.className='message-text';text.textContent=message.text;article.append(text);}messages.appendChild(article);}
function renderAttachment(file){const wrap=document.createElement('div');wrap.className='attachment';const type=file.type||'';if(type.startsWith('image/')){const img=document.createElement('img');img.src=file.url;img.alt=file.name;img.loading='lazy';wrap.append(img);}else if(type.startsWith('video/')){const v=document.createElement('video');v.src=file.url;v.controls=true;v.playsInline=true;wrap.append(v);}else if(type.startsWith('audio/')){const a=document.createElement('audio');a.src=file.url;a.controls=true;wrap.append(a);}const link=document.createElement('a');link.href=file.url;link.target='_blank';link.rel='noopener';link.download=file.name;link.textContent=`📄 ${file.name}`;wrap.append(link);return wrap;}
function scrollBottom(){requestAnimationFrame(()=>messages.scrollTop=messages.scrollHeight);}
function playNotification(){if(document.visibilityState==='visible')return;try{const c=new(window.AudioContext||window.webkitAudioContext)();const o=c.createOscillator(),g=c.createGain();o.frequency.value=660;g.gain.value=.035;o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.08);}catch(_){}}

function chooseTarget(){const others=onlineUsers.filter(u=>u.id!==socket?.id);if(!others.length){showStatus('No other member is online to call.',true);return null;}if(others.length===1)return others[0];const names=others.map((u,i)=>`${i+1}. ${u.name}`).join('\n');const choice=Number(prompt(`Who do you want to call?\n${names}`));return others[choice-1]||null;}
audioCallBtn.onclick=()=>startCall('audio');videoCallBtn.onclick=()=>startCall('video');
async function startCall(mode){const target=chooseTarget();if(!target)return;try{callMode=mode;activeTargetId=target.id;localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:mode==='video'});await createPeer();localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));localVideo.srcObject=localStream;localVideo.classList.toggle('hidden',mode!=='video');remoteVideo.classList.toggle('audio-only',mode!=='video');callPanel.classList.remove('hidden');callStatus.textContent=`Calling ${target.name}…`;const offer=await peer.createOffer();await peer.setLocalDescription(offer);socket.emit('call-offer',{targetId:target.id,offer,mode});}catch(_){showStatus('Camera/microphone permission is required for calls.',true);stopCall(false);}}
async function createPeer(){peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});peer.onicecandidate=e=>{if(e.candidate&&activeTargetId)socket.emit('ice-candidate',{targetId:activeTargetId,candidate:e.candidate});};peer.ontrack=e=>{remoteVideo.srcObject=e.streams[0];callStatus.textContent='Connected';};peer.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(peer.connectionState))stopCall(false);};}
acceptCallBtn.onclick=async()=>{const data=pendingOffer;if(!data)return;incomingCall.classList.add('hidden');pendingOffer=null;try{activeTargetId=data.fromId;callMode=data.mode;localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:data.mode==='video'});await createPeer();localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));localVideo.srcObject=localStream;localVideo.classList.toggle('hidden',data.mode!=='video');remoteVideo.classList.toggle('audio-only',data.mode!=='video');callPanel.classList.remove('hidden');callStatus.textContent=`In call with ${data.fromName}`;await peer.setRemoteDescription(data.offer);const answer=await peer.createAnswer();await peer.setLocalDescription(answer);socket.emit('call-answer',{targetId:data.fromId,answer});}catch(_){socket.emit('call-decline',{targetId:data.fromId});stopCall(false);showStatus('Could not access camera/microphone.',true);}};
declineCallBtn.onclick=()=>{if(pendingOffer)socket.emit('call-decline',{targetId:pendingOffer.fromId});pendingOffer=null;incomingCall.classList.add('hidden');};
endCallBtn.onclick=()=>stopCall(true);
function stopCall(notify=true){if(notify&&activeTargetId&&socket?.connected)socket.emit('call-end',{targetId:activeTargetId});peer?.close();peer=null;localStream?.getTracks().forEach(t=>t.stop());localStream=null;remoteVideo.srcObject=null;localVideo.srcObject=null;activeTargetId=null;pendingOffer=null;callPanel.classList.add('hidden');incomingCall.classList.add('hidden');}
muteBtn.onclick=()=>{const t=localStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;muteBtn.textContent=t.enabled?'🎙️':'🔇';}};
cameraBtn.onclick=()=>{const t=localStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;cameraBtn.textContent=t.enabled?'📷':'🚫';}};

// Deliberately do not restore a previous session. Every fresh page open starts at the password screen.
