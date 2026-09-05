const path=require("path");
const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const {Chess}=require("chess.js");

const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.static(path.join(__dirname,"public")));
const rooms=new Map();

function code(){let c;do c=Math.random().toString(36).slice(2,8).toUpperCase();while(rooms.has(c));return c}
function roomInfo(r){return {code:r.code,players:r.players.map(p=>({color:p.color,name:p.name}))};}
function cleanProfile(p){return {name:String(p?.name||"Player").slice(0,24)}}
function initialState(timeControl="10+0"){
  const minutes=Math.max(1,Number(String(timeControl).split("+")[0])||10);
  const sec=minutes*60;
  return {fen:new Chess().fen(),clocks:{w:sec,b:sec},session:{captures:0,checks:0,started:Date.now()},timeControl:String(timeControl||"10+0")};
}

io.on("connection",socket=>{
  socket.on("createRoom",(profile,cb)=>{
    const c=code(), r={code:c,players:[{id:socket.id,color:"w",...cleanProfile(profile)}],state:initialState(profile?.timeControl)};
    rooms.set(c,r);socket.join(c);socket.data.room=c;socket.data.color="w";
    cb?.({ok:true,code:c,color:"w"});
  });

  socket.on("joinRoom",(data,cb)=>{
    const c=String(data?.code||"").trim().toUpperCase(),r=rooms.get(c);
    if(!r)return cb?.({ok:false,message:"Room not found. Check the code."});
    if(r.players.length>=2)return cb?.({ok:false,message:"This room is already full."});
    r.players.push({id:socket.id,color:"b",...cleanProfile(data?.profile)});
    socket.join(c);socket.data.room=c;socket.data.color="b";
    cb?.({ok:true,code:c,color:"b"});
    socket.emit("onlineState",r.state);
    io.to(c).emit("onlineReady",roomInfo(r));
  });

  socket.on("onlineMove",data=>{
    const r=rooms.get(socket.data.room);
    if(!r||!data)return;
    const g=new Chess(r.state?.fen||new Chess().fen());
    if(g.isGameOver()||g.turn()!==socket.data.color)return;
    const move={from:String(data.from||""),to:String(data.to||"")};
    if(data.promotion)move.promotion=String(data.promotion).toLowerCase();
    let made;
    try{made=g.move(move)}catch{return}
    const incoming=data.state||{};
    r.state={
      fen:g.fen(),
      clocks:incoming.clocks||r.state.clocks,
      session:incoming.session||r.state.session
    };
    socket.to(socket.data.room).emit("onlineMove",{from:made.from,to:made.to,promotion:made.promotion||null,state:r.state});
  });

  socket.on("chat",m=>{
    if(!socket.data.room)return;
    io.to(socket.data.room).emit("chat",{
      name:String(m?.name||"Player").slice(0,24),
      message:String(m?.message||"").slice(0,300)
    });
  });

  socket.on("disconnect",()=>{
    const c=socket.data.room,r=rooms.get(c);if(!r)return;
    r.players=r.players.filter(p=>p.id!==socket.id);
    if(r.players.length)io.to(c).emit("opponentLeft");else rooms.delete(c);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Chess Pro Ultimate running at http://localhost:${PORT}`));