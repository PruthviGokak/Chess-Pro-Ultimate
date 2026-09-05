import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const PIECES={w:{p:"♙",n:"♘",b:"♗",r:"♖",q:"♕",k:"♔"},b:{p:"♟",n:"♞",b:"♝",r:"♜",q:"♛",k:"♚"}};
const SETTINGS="chessProSettingsV5",SAVE="chessProSaveV5",PROFILE="chessProProfileV5";
let game=new Chess(),mode="local",difficulty="medium",selected=null,flipped=false;
let undoStack=[],redoStack=[],clocks={w:600,b:600},timer=null,timerEnabled=true,timeControl="10+0",timerLast=0;
let sound=true,music=true,volume=.12,audioUnlocked=false,ambientAudio=null;
let socket=null,onlineColor=null,room=null,onlineReady=false,aiThinking=false;
let modalOpen=false, settingsOpenRequested=false;
let player={name:"Player",rating:1200,games:0,wins:0,losses:0,draws:0};
let session={captures:0,checks:0,started:Date.now()};

function show(id){$$(".screen").forEach(x=>x.classList.remove("active"));$(id).classList.add("active")}
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove("show"),2300)}
function fmt(s){s=Math.max(0,Math.floor(s));return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`}
function escapeHtml(x){return String(x).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function updateHomeUI(){
 const set=(id,text,off=false)=>{const e=$(id);if(!e)return;e.textContent=text;e.classList.toggle("off",!!off)};
 set("#homeMusicState",music?"ON":"OFF",!music);
 set("#homeSoundsState",sound?"ON":"OFF",!sound);
 set("#homeTimeState",timerEnabled?timeControl.replace("+"," + "):"Unlimited",!timerEnabled);
 const boardNames={green:"Classic",blue:"Ocean",purple:"Royal",red:"Crimson",slate:"Slate",gold:"Gold"};
 const themeNames={default:"Classic",midnight:"Midnight",forest:"Forest",rose:"Rose"};
 set("#homeBoardState",boardNames[document.body.dataset.board||"green"]||"Classic");
 set("#homeThemeState",themeNames[document.body.dataset.theme||"default"]||"Classic");
 set("#homeAIState",difficulty.charAt(0).toUpperCase()+difficulty.slice(1));
}

function loadSettings(){
 try{const s=JSON.parse(localStorage.getItem(SETTINGS)||"{}");Object.assign(window,{});
 sound=s.sound!==false;music=s.music!==false;volume=Number.isFinite(s.volume)?s.volume:.12;timerEnabled=s.timerEnabled!==false;timeControl=s.timeControl||"10+0";applyTheme(s.theme||"default");applyBoard(s.board||"green");updateHomeUI()
 }catch{}
 try{player={...player,...JSON.parse(localStorage.getItem(PROFILE)||"{}")}}catch{}
}
function saveSettings(){localStorage.setItem(SETTINGS,JSON.stringify({sound,music,volume,timerEnabled,timeControl,theme:document.body.dataset.theme||"default",board:document.body.dataset.board||"green"}))}
function applyTheme(t){document.body.classList.remove("theme-midnight","theme-forest","theme-rose");document.body.dataset.theme=t;if(t==="midnight")document.body.classList.add("theme-midnight");if(t==="forest")document.body.classList.add("theme-forest");if(t==="rose")document.body.classList.add("theme-rose")}
function applyBoard(b){document.body.dataset.board=b;const el=$("#board");if(!el)return;["blue","purple","red","slate","gold"].forEach(x=>el.classList.toggle("board-"+x,b===x))}
function timeSeconds(){const m=Number((timeControl.split("+")[0]||10));return m*60}
function incrementSeconds(){return Number((timeControl.split("+")[1]||0))}
function resetClocks(){const sec=timeSeconds();clocks={w:sec,b:sec}}
function snapshot(){return {fen:game.fen(),clocks:{...clocks},session:{...session},timeControl}}
function restore(s){if(!s?.fen)return;try{game=new Chess(s.fen);clocks={...s.clocks};if(s.timeControl)timeControl=s.timeControl;session={...session,...(s.session||{})};selected=null;render()}catch{toast("Saved game is invalid")}}
function saveGame(){localStorage.setItem(SAVE,JSON.stringify({snapshot:snapshot(),flipped,mode:"local",difficulty,timeControl,timerEnabled}));toast("Game saved")}
function loadGame(){const x=localStorage.getItem(SAVE);if(!x)return toast("No saved game found");try{const d=JSON.parse(x);mode="local";flipped=!!d.flipped;timeControl=d.timeControl||timeControl;timerEnabled=d.timerEnabled!==false;restore(d.snapshot);show("#game");startTimer();toast("Saved game restored")}catch{toast("Could not load save")}}
function legalFrom(s){return game.moves({square:s,verbose:true})}
function render(){
 const b=$("#board");b.innerHTML="";applyBoard(document.body.dataset.board||"green");
 let rows=[0,1,2,3,4,5,6,7],cols=[0,1,2,3,4,5,6,7];if(flipped){rows.reverse();cols.reverse()}
 const h=game.history({verbose:true}),last=h.at(-1);
 for(const r of rows)for(const c of cols){const el=document.createElement("div");el.className="sq "+((r+c)%2?"dark":"light");const s=String.fromCharCode(97+c)+(8-r),p=game.get(s);
  if(selected===s)el.classList.add("selected");if(last&&last.color==="b"&&(last.from===s||last.to===s))el.classList.add("last");if(p?.type==="k"&&p.color===game.turn()&&game.isCheck())el.classList.add("check");
  if(selected&&legalFrom(selected).some(m=>m.to===s)){el.classList.add("legal");if(p)el.classList.add("capture")}
  if(p){const q=document.createElement("span");q.className="piece "+(p.color==="w"?"wp":"bp");q.textContent=PIECES[p.color][p.type];if(last?.to===s)q.classList.add("moving");el.appendChild(q)}
  el.onclick=()=>clickSquare(s);b.appendChild(el)}
 renderMoves();renderStatus();updatePlayers();renderStats()
}
function clickSquare(s){
 settingsOpenRequested=false;
 closeModal();
 if(game.isGameOver()||aiThinking)return;if(mode==="online"&&(!onlineReady||game.turn()!==onlineColor))return;
 const p=game.get(s);if(selected){const m=legalFrom(selected).find(x=>x.to===s);if(m){makeMove(selected,s,m);return}}
 if(p&&p.color===game.turn()&&(mode!=="online"||p.color===onlineColor))selected=s;else selected=null;render()
}
function makeMove(from,to,m){
 settingsOpenRequested=false;
 closeModal();
 const before=snapshot();let promotion=m.promotion;
 if(promotion){promotion=(prompt("Promote to Q, R, B or N","Q")||"Q").toLowerCase();if(!"qrbn".includes(promotion))promotion="q"}
 try{game.move({from,to,promotion})}catch{return}
 const made=game.history({verbose:true}).at(-1);session.captures+=made.captured?1:0;session.checks+=game.isCheck()?1:0;
 if(timerEnabled){clocks[made.color]+=incrementSeconds()}
 undoStack.push(before);redoStack=[];selected=null;playMoveSound(made,game.isCheck());render();afterMove();
 if(!game.isGameOver())startTimer();
 if(mode==="online"&&socket){const state=snapshot();socket.emit("onlineMove",{from,to,promotion,state})}
 if(mode==="computer"&&game.turn()==="b"&&!game.isGameOver())setTimeout(aiMove,350)
}
function afterMove(){if(game.isGameOver()){stopTimer();setTimeout(()=>gameOver(),120)}}
function renderMoves(){const h=game.history();$("#moves").innerHTML="";for(let i=0;i<h.length;i+=2){const row=document.createElement("div");row.className="move"+(i+1>=h.length?" current":"");row.innerHTML=`<span>${i/2+1}.</span><span>${h[i]||""}</span><span>${h[i+1]||""}</span>`;$("#moves").appendChild(row)}$("#moves").scrollTop=$("#moves").scrollHeight}
function renderStatus(){let t=game.isCheckmate()?"Checkmate!":game.isStalemate()?"Stalemate":game.isThreefoldRepetition()?"Draw by repetition":game.isDraw()?"Draw":game.isCheck()?"Check":game.turn()==="w"?"White to move":"Black to move";$("#status").textContent=t;$("#turnDot").style.background=game.turn()==="w"?"#fff":"#444"}
function updatePlayers(){
 if(mode==="computer"){$("#whiteName").textContent=player.name;$("#whiteSub").textContent="You";$("#blackName").textContent="Computer";$("#blackSub").textContent=difficulty.toUpperCase()+" AI"}
 else if(mode==="online"){$("#whiteName").textContent=onlineColor==="w"?player.name:"Opponent";$("#blackName").textContent=onlineColor==="b"?player.name:"Opponent";$("#whiteSub").textContent=onlineColor==="w"?"You":"Online";$("#blackSub").textContent=onlineColor==="b"?"You":"Online"}
 else{$("#whiteName").textContent=player.name;$("#whiteSub").textContent="White";$("#blackName").textContent="Black";$("#blackSub").textContent="Player"}
 $("#whiteClock").textContent=timerEnabled?fmt(clocks.w):"∞";$("#blackClock").textContent=timerEnabled?fmt(clocks.b):"∞";$("#whiteClock").classList.toggle("active",game.turn()==="w");$("#blackClock").classList.toggle("active",game.turn()==="b")
}
function renderStats(){const h=game.history({verbose:true});$("#statMoves").textContent=h.length;$("#statCaptures").textContent=session.captures;$("#statChecks").textContent=session.checks;$("#statTime").textContent=timerEnabled?fmt(clocks.w+clocks.b):"∞"}
function startTimer(){clearInterval(timer);if(!timerEnabled||game.isGameOver())return;timerLast=performance.now();timer=setInterval(()=>{if(game.isGameOver()||mode==="online"&&!onlineReady)return;const now=performance.now();const elapsed=(now-timerLast)/1000;timerLast=now;const c=game.turn();clocks[c]-=elapsed;if(clocks[c]<=0){clocks[c]=0;updatePlayers();renderStats();gameOver(c==="w"?"Black wins on time":"White wins on time");stopTimer();return}updatePlayers();renderStats()},200)}
function stopTimer(){clearInterval(timer);timer=null;timerLast=0}
function newGame(){stopTimer();game=new Chess();undoStack=[];redoStack=[];selected=null;resetClocks();session={captures:0,checks:0,started:Date.now()};startTimer();render()}
function undo(){if(mode==="online")return toast("Undo is disabled in online games");if(!undoStack.length)return toast("Nothing to undo");redoStack.push(snapshot());restore(undoStack.pop());if(mode==="computer"&&game.turn()==="b"&&undoStack.length){redoStack.push(snapshot());restore(undoStack.pop())}toast("Move undone")}
function redo(){if(!redoStack.length)return toast("Nothing to redo");undoStack.push(snapshot());restore(redoStack.pop());toast("Move restored")}
function gameOver(result){
 stopTimer();if(!result)result=game.isCheckmate()?(game.turn()==="w"?"Black wins by checkmate":"White wins by checkmate"):game.isDraw()?"Draw":"Game over";
 if(mode==="computer"){player.games++;if(/white/i.test(result)){player.wins++;player.rating+=12}else if(/black/i.test(result)){player.losses++;player.rating=Math.max(400,player.rating-8)}else player.draws++;persistProfile()}
 playGameOverSound();openModal(`<div class="eyebrow">GAME COMPLETE</div><h2>${escapeHtml(result)}</h2><p>${game.isCheckmate()?"A decisive checkmate.":game.isDraw()?"A hard-fought draw.":"The game has ended."}</p><div class="stat-grid"><div><span>Moves</span><b>${game.history().length}</b></div><div><span>Rating</span><b>${player.rating}</b></div></div><button class="primary close" id="rematchBtn">↻ New Game</button><button class="close" id="gameHomeBtn">Home</button>`);
 $("#rematchBtn").onclick=()=>{closeModal();newGame()};$("#gameHomeBtn").onclick=()=>{closeModal();show("#home")}
}
const VALUES={p:100,n:320,b:330,r:500,q:900,k:20000};
function evaluate(g){let s=0;for(const row of g.board())for(const p of row)if(p)s+=(p.color==="b"?1:-1)*VALUES[p.type];return s}
function bestMove(moves,depth){let best=moves[0],bs=-Infinity;for(const m of moves){const g=new Chess(game.fen());g.move({from:m.from,to:m.to,promotion:m.promotion||"q"});let sc=minimax(g,depth-1,-Infinity,Infinity,false);if(m.captured)sc+=VALUES[m.captured]*.7;if(m.san.includes("+"))sc+=45;if(sc>bs){bs=sc;best=m}}return best}
function minimax(g,d,a,b,max){if(d===0||g.isGameOver())return evaluate(g);const ms=g.moves({verbose:true});if(max){let v=-Infinity;for(const m of ms){const n=new Chess(g.fen());n.move({from:m.from,to:m.to,promotion:m.promotion||"q"});v=Math.max(v,minimax(n,d-1,a,b,false));a=Math.max(a,v);if(b<=a)break}return v}else{let v=Infinity;for(const m of ms){const n=new Chess(g.fen());n.move({from:m.from,to:m.to,promotion:m.promotion||"q"});v=Math.min(v,minimax(n,d-1,a,b,true));b=Math.min(b,v);if(b<=a)break}return v}}
function aiMove(){if(game.isGameOver()||game.turn()!=="b")return;aiThinking=true;const depth={easy:1,medium:2,hard:3,pro:4}[difficulty]||2;setTimeout(()=>{const ms=game.moves({verbose:true});const pick=difficulty==="easy"?ms[Math.floor(Math.random()*ms.length)]:bestMove(ms,depth);try{game.move({from:pick.from,to:pick.to,promotion:pick.promotion||"q"})}catch{}const h=game.history({verbose:true}).at(-1);session.captures+=h.captured?1:0;session.checks+=game.isCheck()?1:0;if(timerEnabled&&h)clocks[h.color]+=incrementSeconds();aiThinking=false;playMoveSound(h,game.isCheck(),true);render();afterMove();if(!game.isGameOver())startTimer()},Math.min(1500,300+depth*180))}
function openModal(html){
  modalOpen=true;
  $("#modalContent").innerHTML=html;
  $("#modal").classList.remove("hidden");
  $("#modalContent").scrollTop=0;
}
function closeModal(){
  modalOpen=false;
  settingsOpenRequested=false;
  $("#modal").classList.add("hidden");
  $("#modalContent").innerHTML="";
}
function settings(){
 settingsOpenRequested=false;
 openModal(`<h2>Settings</h2>
 <p>Changes below are saved automatically. Changing the time control resets both clocks for the current game.</p>
 <div class="form-row"><label>Sound effects</label><div class="range-row"><button id="soundSet" class="choice" type="button">${sound?"🔊 On":"🔇 Off"}</button><button id="soundTest" class="choice" type="button">Test sound</button></div></div>
 <div class="form-row"><label>Background music</label><button id="musicSet" class="choice" type="button">${music?"♫ On":"♫ Off"}</button></div>
 <div class="form-row"><label>Music volume</label><div class="range-row"><input id="volumeSet" type="range" min="0" max=".35" step=".01" value="${volume}"><b id="volLabel">${Math.round(volume*100)}%</b></div></div>
 <div class="form-row"><label>Timer</label><select id="timerSet"><option value="on" ${timerEnabled?"selected":""}>On</option><option value="off" ${!timerEnabled?"selected":""}>Off / Unlimited</option></select></div>
 <div class="form-row"><label>Time control</label><select id="timeSet"><option value="3+0" ${timeControl==="3+0"?"selected":""}>3 + 0 • Blitz</option><option value="5+0" ${timeControl==="5+0"?"selected":""}>5 + 0 • Fast</option><option value="10+0" ${timeControl==="10+0"?"selected":""}>10 + 0 • Standard</option><option value="15+10" ${timeControl==="15+10"?"selected":""}>15 + 10 • Classical</option></select></div>
 <div class="form-row"><label>Game theme</label><div class="theme-grid"><button class="theme-swatch" type="button" data-theme="default">Classic dark</button><button class="theme-swatch" type="button" data-theme="midnight">Midnight blue</button><button class="theme-swatch" type="button" data-theme="forest">Forest</button><button class="theme-swatch" type="button" data-theme="rose">Rose</button></div></div>
 <div class="form-row"><label>Board style</label><div class="theme-grid"><button class="theme-swatch" type="button" data-board="green"><div class="board-swatch green"></div>Classic</button><button class="theme-swatch" type="button" data-board="blue"><div class="board-swatch blue"></div>Ocean</button><button class="theme-swatch" type="button" data-board="purple"><div class="board-swatch purple"></div>Royal</button><button class="theme-swatch" type="button" data-board="red"><div class="board-swatch red"></div>Crimson</button><button class="theme-swatch" type="button" data-board="slate"><div class="board-swatch slate"></div>Slate</button><button class="theme-swatch" type="button" data-board="gold"><div class="board-swatch gold"></div>Gold</button></div></div>
 <button class="close" data-close="1" id="closeSet" type="button">Close</button>`);
 $("#soundSet").onclick=()=>{audioUnlock();sound=!sound;saveSettings();updateHomeUI();if(sound)sfx("move.wav");toast(sound?"Sounds on":"Sounds off");settings()};
 $("#soundTest").onclick=()=>{audioUnlock();if(sound)sfx("move.wav");else toast("Turn sound effects on first")};
 $("#musicSet").onclick=()=>{audioUnlock();music=!music;saveSettings();updateHomeUI();if(music){startAmbient();toast("Background music on")}else{stopAmbient();toast("Background music off")};settings()};
 $("#volumeSet").oninput=e=>{volume=+e.target.value;$("#volLabel").textContent=Math.round(volume*100)+"%";saveSettings();if(ambientAudio)ambientAudio.volume=volume};
 $("#timerSet").onchange=e=>{timerEnabled=e.target.value==="on";resetClocks();saveSettings();updateHomeUI();if(timerEnabled)startTimer();else stopTimer();render();toast(timerEnabled?"Timer enabled":"Unlimited time enabled")};
 $("#timeSet").onchange=e=>{timeControl=e.target.value;resetClocks();saveSettings();updateHomeUI();if(timerEnabled)startTimer();render();toast(`Time control ${timeControl} applied`)};
 $$(`[data-theme]`).forEach(b=>b.onclick=()=>{applyTheme(b.dataset.theme);saveSettings();updateHomeUI();});
 $$(`[data-board]`).forEach(b=>b.onclick=()=>{applyBoard(b.dataset.board);saveSettings();updateHomeUI();});
}function profileModal(){openModal(`<h2>Profile & Stats</h2><div class="form-row"><label>Player name</label><input id="profileName" value="${escapeHtml(player.name)}" maxlength="24"></div><div class="stat-grid"><div><span>Rating</span><b>${player.rating}</b></div><div><span>Games</span><b>${player.games}</b></div><div><span>Wins</span><b>${player.wins}</b></div><div><span>Draws</span><b>${player.draws}</b></div></div><button class="primary close" id="profileSave">Save profile</button><button class="close" id="profileClose" data-close="1" type="button">Close</button>`);$("#profileSave").onclick=()=>{player.name=$("#profileName").value.trim()||"Player";persistProfile();closeModal();updatePlayers();toast("Profile updated")};}
function persistProfile(){localStorage.setItem(PROFILE,JSON.stringify(player))}
function onlineSetup(){
 openModal(`<h2>Online Multiplayer</h2><p><b>Create room:</b> you receive a 6-character code and play White. Send that code to your friend. <b>Join room:</b> enter the same code and play Black.</p><div class="choices"><button id="create" class="choice" type="button"><strong>Create room</strong><small>Play as White</small></button><button id="join" class="choice" type="button"><strong>Join room</strong><small>Enter a room code</small></button></div><p class="online-note">For two computers on the same Wi-Fi, both devices use the host PC's local IP and port. For Internet play, deploy this Node server to a public host.</p>`);
 ensureSocket();
 $("#create").onclick=()=>{audioUnlock();socket.emit("createRoom",{...player,timeControl},r=>{if(!r.ok)return toast("Could not create room");onlineColor="w";room=r.code;onlineReady=false;closeModal();$("#onlinePanel").classList.remove("hidden");$("#roomInfo").textContent=`Room ${room} • waiting for opponent`;newGame()})};
 $("#join").onclick=()=>{audioUnlock();const c=prompt("Enter the 6-character room code");if(c)socket.emit("joinRoom",{code:c,profile:{...player,timeControl}},r=>{if(!r.ok)return toast(r.message);onlineColor="b";room=r.code;onlineReady=true;closeModal();$("#onlinePanel").classList.remove("hidden");$("#roomInfo").textContent=`Room ${room} • connected`;newGame()})};
}
function ensureSocket(){
 if(socket)return;
 socket=io();
 socket.on("onlineReady",d=>{onlineReady=true;$("#roomInfo").textContent=`Room ${room} • opponent connected`;toast("Opponent connected!");render()});
 socket.on("onlineMove",d=>{try{if(d.state?.fen)restore(d.state);else game.move({from:d.from,to:d.to,promotion:d.promotion||"q"});selected=null;const h=game.history({verbose:true}).at(-1);playMoveSound(h,game.isCheck(),true);render();afterMove();if(!game.isGameOver())startTimer()}catch{toast("Received move could not be applied")}});
 socket.on("onlineState",s=>{if(s?.fen&&s.fen!==game.fen()){restore(s);if(timerEnabled)startTimer()}});
 socket.on("opponentLeft",()=>{onlineReady=false;stopTimer();toast("Opponent left the room");$("#roomInfo").textContent=`Room ${room} • opponent left`});
 socket.on("chat",d=>{$("#chatLog").innerHTML+=`<div><b>${escapeHtml(d.name)}:</b> ${escapeHtml(d.message)}</div>`;$("#chatLog").scrollTop=$("#chatLog").scrollHeight})
}
function pgn(){const text=game.pgn({maxWidth:80,newline:"\n"});navigator.clipboard?.writeText(text).catch(()=>{});openModal(`<h2>Full game history</h2><p>Your PGN is shown below and copied when the browser allows clipboard access.</p><div class="form-row"><textarea style="min-height:180px">${escapeHtml(text)}</textarea></div><button class="close" id="closePgn" data-close="1" type="button">Close</button>`);}
function audioUnlock(){if(audioUnlocked)return;audioUnlocked=true;if(music)startAmbient()}
function startAmbient(){if(!music||ambientAudio)return;ambientAudio=new Audio("audio/ambient-chess.wav");ambientAudio.loop=true;ambientAudio.volume=volume;ambientAudio.preload="auto";ambientAudio.addEventListener("error",()=>toast("Music file could not be loaded — check public/audio/ambient-chess.wav"));ambientAudio.play().catch(()=>toast("Click Music again to allow background audio"))}
function stopAmbient(){if(ambientAudio){ambientAudio.pause();ambientAudio.currentTime=0;ambientAudio=null}}
function sfx(file){if(!sound||!audioUnlocked)return;const a=new Audio("audio/"+file);a.volume=.35;a.preload="auto";a.play().catch(()=>toast("Sound could not play — click the Sound test button once"))}
function playMoveSound(m,check,isAI=false){if(check)sfx("check.wav");else if(m?.captured)sfx("capture.wav");else sfx("move.wav")}
function playGameOverSound(){sfx("gameover.wav")}
function chooseMode(m){mode=m;show("#game");$("#onlinePanel").classList.toggle("hidden",m!=="online");if(m==="computer")openDifficulty();else if(m==="online")onlineSetup();else newGame()}
function openDifficulty(){openModal(`<h2>Choose your opponent</h2><p>Pro searches deeper and may use more CPU.</p><div class="choices"><button class="choice" data-d="easy"><strong>Easy</strong><small>Relaxed</small></button><button class="choice" data-d="medium"><strong>Medium</strong><small>Balanced</small></button><button class="choice" data-d="hard"><strong>Hard</strong><small>Deeper tactics</small></button><button class="choice" data-d="pro"><strong>Pro</strong><small>Deep browser search</small></button></div>`);$$("[data-d]").forEach(b=>b.onclick=()=>{difficulty=b.dataset.d;updateHomeUI();closeModal();newGame()})}
function init(){
 loadSettings();
 render();
 $$("[data-mode]").forEach(b=>b.onclick=()=>{audioUnlock();chooseMode(b.dataset.mode)});
 $$("[data-open]").forEach(b=>b.onclick=profileModal);
 $("#homeProfile").onclick=profileModal;$("#homeSettings").onclick=()=>{settings()};$("#homeThemes")?.addEventListener("click",()=>{settings()});$("#loadHome")?.addEventListener("click",loadGame);
 $("#homeMusic").onclick=()=>{audioUnlock();music=!music;saveSettings();updateHomeUI();if(music){startAmbient();toast("Background music on")}else stopAmbient();}; $("#homeSounds").onclick=()=>{audioUnlock();sound=!sound;saveSettings();updateHomeUI();if(sound)sfx("move.wav");toast(sound?"Sounds on":"Sounds off")}; $("#homeTime").onclick=()=>{settings()}; $("#homeBoard").onclick=()=>{settings()}; $("#homeTheme").onclick=()=>{settings()}; $("#homeAI").onclick=()=>{settings()};
 $("#homeBtn").onclick=()=>{closeModal();stopTimer();show("#home")};$("#newBtn").onclick=newGame;$("#saveBtn").onclick=saveGame;$("#settingsBtn").onclick=()=>{settings()};$("#musicBtn").onclick=()=>{audioUnlock();music=!music;saveSettings();if(music){startAmbient();toast("Background music on")}else{stopAmbient();toast("Background music off")}};
 $("#flipBtn").onclick=()=>{flipped=!flipped;render()};$("#undoBtn").onclick=undo;$("#redoBtn").onclick=redo;$("#pgnBtn").onclick=pgn;
 $("#resignBtn").onclick=()=>{if(!game.isGameOver()&&confirm("Resign this game?"))gameOver(game.turn()==="w"?"Black wins by resignation":"White wins by resignation")};
 $("#modalClose").onclick=(e)=>{e.preventDefault();e.stopPropagation();closeModal()};
 $("#modal").addEventListener("click",e=>{
   e.stopPropagation();
   if(e.target===e.currentTarget || e.target.closest("#modalClose") || e.target.closest("[data-close]")){
     e.preventDefault();e.stopPropagation();closeModal();
   }
 });
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#modal").classList.contains("hidden"))closeModal()});
 $("#chatSend").onclick=()=>{const i=$("#chatInput");if(i.value.trim()&&socket){socket.emit("chat",{name:player.name,message:i.value.trim()});i.value=""}};$("#chatInput").onkeydown=e=>{if(e.key==="Enter")$("#chatSend").click()};
 $("#copyRoom").onclick=()=>{if(room)navigator.clipboard?.writeText(room).then(()=>toast("Room code copied")).catch(()=>toast(`Room code: ${room}`))}
 window.addEventListener("pointerdown",audioUnlock,{once:true});
 window.addEventListener("keydown",audioUnlock,{once:true});
}
init();
