import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { db, transaction } from './db.js';
import { publicSlots, createAppointment, updateAppointment, listAppointments, settings, localToUtc, validDate, toMinutes, toTime } from './booking.js';
import { login, logout, sessionFromCookie, can, inviteUser, acceptInvite, team, changeTeamUser } from './auth.js';
import { deliverOutbox } from './mailer.js';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const port=Number(process.env.PORT||3000);
const publicOrigin=process.env.PUBLIC_ORIGIN||'';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
const json=(res,status,data,headers={})=>{
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});
  res.end(JSON.stringify(data));
};
const fail=(res,error)=>{
  const code=error.message||'SERVER_ERROR';
  const status=({FORBIDDEN:403,AUTH_REQUIRED:401,CSRF_INVALID:403,NOT_FOUND:404,INPUT_INVALID:400,DATE_INVALID:400,PASSWORD_INVALID:400,INVITE_INVALID:400,LOGIN_INVALID:401,SLOT_OCCUPIED:409,RATE_LIMIT:429})[code]||500;
  if (status===500) console.error(error);
  json(res,status,{error:status===500?'SERVER_ERROR':code});
};
const body=async req=>{
  let data='';
  for await (const chunk of req) {
    data+=chunk;
    if (data.length>12000) throw new Error('INPUT_INVALID');
  }
  try {return JSON.parse(data||'{}');} catch {throw new Error('INPUT_INVALID');}
};
const requireUser=(req,permission)=>{
  const user=sessionFromCookie(req.headers.cookie);
  if (!user) throw new Error('AUTH_REQUIRED');
  if (!can(user,permission)) throw new Error('FORBIDDEN');
  if (!['GET','HEAD'].includes(req.method) && req.headers['x-csrf-token']!==user.csrf) throw new Error('CSRF_INVALID');
  return user;
};
let lastRateLimitCleanup=0;
function rateLimit(key,max,windowMs) {
  const now=Date.now();
  if (now-lastRateLimitCleanup>600000) {
    db.prepare('DELETE FROM request_limits WHERE window_start<?').run(now-86400000);
    lastRateLimitCleanup=now;
  }
  const row=db.prepare('SELECT window_start,count FROM request_limits WHERE key=?').get(key);
  if (!row||now-row.window_start>windowMs) {
    db.prepare('INSERT INTO request_limits VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=1').run(key,now);
  } else {
    if (row.count>=max) throw new Error('RATE_LIMIT');
    db.prepare('UPDATE request_limits SET count=count+1 WHERE key=?').run(key);
  }
}
function adminCookie(token,req) {
  const secure=process.env.NODE_ENV==='production'||req.headers['x-forwarded-proto']==='https';
  return `pl_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200${secure?'; Secure':''}`;
}
function validateRange(from,to) {
  if (!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>93*86400000) throw new Error('INPUT_INVALID');
}
async function api(req,res,url) {
  const path=url.pathname;
  if (path.startsWith('/api/public/')) {
    const origin=req.headers.origin;
    if (origin && publicOrigin && origin===publicOrigin) {
      res.setHeader('access-control-allow-origin',origin);
      res.setHeader('vary','Origin');
      res.setHeader('access-control-allow-headers','Content-Type');
      res.setHeader('access-control-allow-methods','GET,POST,OPTIONS');
    } else if (origin && origin!==`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`) {
      throw new Error('FORBIDDEN');
    }
    if (req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
  }
  if (path==='/api/public/days'&&req.method==='GET') {
    const from=url.searchParams.get('from'),to=url.searchParams.get('to');
    validateRange(from,to);
    const days=[];
    for(let date=from;date<=to;date=new Date(Date.parse(date)+86400000).toISOString().slice(0,10)) {
      days.push({date,available:publicSlots(date).slots.length>0});
    }
    json(res,200,{days});return;
  }
  if (path==='/api/public/slots'&&req.method==='GET') {json(res,200,publicSlots(url.searchParams.get('date')));return;}
  if (path==='/api/public/appointments'&&req.method==='POST') {
    rateLimit(`booking:${req.socket.remoteAddress}`,8,3600000);
    json(res,201,createAppointment(await body(req)));return;
  }
  if (path==='/api/admin/invite/accept'&&req.method==='POST') {
    rateLimit(`invite:${req.socket.remoteAddress}`,10,3600000);
    const input=await body(req);acceptInvite(input.token,input.password);
    json(res,200,{ok:true});return;
  }
  if (path==='/api/admin/login'&&req.method==='POST') {
    rateLimit(`login:${req.socket.remoteAddress}`,10,900000);
    const input=await body(req),result=login(input.email,input.password);
    json(res,200,{user:result.user,csrf:result.csrf},{'set-cookie':adminCookie(result.token,req)});return;
  }
  if (path==='/api/admin/me'&&req.method==='GET') {
    const user=sessionFromCookie(req.headers.cookie);
    if (!user) throw new Error('AUTH_REQUIRED');
    json(res,200,{user:{id:user.id,name:user.name,email:user.email,role:user.role},csrf:user.csrf});return;
  }
  if (path==='/api/admin/logout'&&req.method==='POST') {
    const user=requireUser(req,'appointments:read');logout(req.headers.cookie);
    json(res,200,{ok:true},{'set-cookie':'pl_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0'});return;
  }
  if (path==='/api/admin/appointments'&&req.method==='GET') {
    requireUser(req,'appointments:read');
    const from=url.searchParams.get('from'),to=url.searchParams.get('to');validateRange(from,to);
    const timezone=settings().timezone,next=new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    const startUtc=localToUtc(from,'00:00',timezone),endUtc=localToUtc(next,'00:00',timezone);
    const exceptions=db.prepare('SELECT * FROM exceptions WHERE start_utc<? AND end_utc>? ORDER BY start_utc').all(endUtc,startUtc);
    json(res,200,{appointments:listAppointments(from,to),rules:db.prepare('SELECT * FROM availability').all(),exceptions,timezone});return;
  }
  if (path==='/api/admin/stats'&&req.method==='GET') {
    requireUser(req,'appointments:read');
    const timezone=settings().timezone;
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(Date.now()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    const today=`${parts.year}-${parts.month}-${parts.day}`;
    const date=new Date(today+'T12:00:00Z'),start=new Date(date);
    start.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));
    const from=start.toISOString().slice(0,10),end=new Date(start.getTime()+6*86400000).toISOString().slice(0,10);
    const count=(sql,...args)=>db.prepare(sql).get(...args).n;
    json(res,200,{today:count('SELECT COUNT(*) AS n FROM appointments WHERE date=?',today),pending:count("SELECT COUNT(*) AS n FROM appointments WHERE status='PENDING'"),confirmed:count("SELECT COUNT(*) AS n FROM appointments WHERE status='CONFIRMED'"),week:count('SELECT COUNT(*) AS n FROM appointments WHERE date BETWEEN ? AND ?',from,end)});return;
  }
  if (path.startsWith('/api/admin/appointments/')&&req.method==='PATCH') {
    requireUser(req,'appointments:write');
    json(res,200,{appointment:updateAppointment(path.split('/').at(-1),await body(req))});return;
  }
  if (path==='/api/admin/availability'&&req.method==='GET') {
    requireUser(req,'appointments:read');
    json(res,200,{rules:db.prepare('SELECT * FROM availability ORDER BY weekday,start_min').all(),exceptions:db.prepare('SELECT * FROM exceptions WHERE end_utc>? ORDER BY start_utc').all(Date.now()-86400000),settings:settings()});return;
  }
  if (path==='/api/admin/availability'&&req.method==='POST') {
    requireUser(req,'availability:write');
    const input=await body(req),weekday=Number(input.weekday),start=toMinutes(input.start),end=toMinutes(input.end);
    if (!Number.isInteger(weekday)||weekday<0||weekday>6||start===null||end===null||start>=end) throw new Error('INPUT_INVALID');
    const id=randomUUID();
    db.prepare('INSERT INTO availability VALUES(?,?,?,?)').run(id,weekday,start,end);
    json(res,201,{id});return;
  }
  if (/^\/api\/admin\/availability\/[^/]+$/.test(path)&&req.method==='PATCH') {
    requireUser(req,'availability:write');
    const id=path.split('/').at(-1),input=await body(req),weekday=Number(input.weekday),start=toMinutes(input.start),end=toMinutes(input.end);
    if (!Number.isInteger(weekday)||weekday<0||weekday>6||start===null||end===null||start>=end) throw new Error('INPUT_INVALID');
    const result=db.prepare('UPDATE availability SET weekday=?,start_min=?,end_min=? WHERE id=?').run(weekday,start,end,id);
    if (!result.changes) throw new Error('NOT_FOUND');
    json(res,200,{ok:true});return;
  }
  if (path.startsWith('/api/admin/availability/')&&req.method==='DELETE') {
    requireUser(req,'availability:write');
    db.prepare('DELETE FROM availability WHERE id=?').run(path.split('/').at(-1));
    json(res,200,{ok:true});return;
  }
  if (path==='/api/admin/exceptions'&&req.method==='POST') {
    requireUser(req,'availability:write');
    const input=await body(req),timezone=settings().timezone;
    if (!['BLOCK','OPEN'].includes(input.kind)||!validDate(input.startDate)||!validDate(input.endDate)) throw new Error('INPUT_INVALID');
    const start=localToUtc(input.startDate,input.startTime,timezone),end=localToUtc(input.endDate,input.endTime,timezone);
    if (start===null||end===null||end<=start||end-start>366*86400000) throw new Error('INPUT_INVALID');
    const id=randomUUID();
    db.prepare('INSERT INTO exceptions VALUES(?,?,?,?,?)').run(id,start,end,input.kind,String(input.note||'').slice(0,300));
    json(res,201,{id});return;
  }
  if (path.startsWith('/api/admin/exceptions/')&&req.method==='DELETE') {
    requireUser(req,'availability:write');db.prepare('DELETE FROM exceptions WHERE id=?').run(path.split('/').at(-1));json(res,200,{ok:true});return;
  }
  if (path==='/api/admin/settings'&&req.method==='PATCH') {
    requireUser(req,'settings:write');
    const input=await body(req),duration=Number(input.duration),buffer=Number(input.buffer),timezone=String(input.timezone||'');
    if (![15,30,45,60].includes(duration)||!Number.isInteger(buffer)||buffer<0||buffer>60) throw new Error('INPUT_INVALID');
    try {new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw new Error('INPUT_INVALID');}
    db.prepare('UPDATE settings SET duration=?,buffer=?,timezone=? WHERE id=1').run(duration,buffer,timezone);
    json(res,200,{settings:settings()});return;
  }
  if (path==='/api/admin/team'&&req.method==='GET') {
    requireUser(req,'team:write');json(res,200,{users:team()});return;
  }
  if (path==='/api/admin/team'&&req.method==='POST') {
    requireUser(req,'team:write');
    const input=await body(req);
    const host=process.env.ADMIN_BASE_URL||`${process.env.NODE_ENV==='production'?'https':'http'}://${req.headers.host}`;
    let adminOrigin;
    try {const parsed=new URL(host);if(parsed.pathname!=='/'||parsed.search||parsed.hash||(process.env.NODE_ENV==='production'&&parsed.protocol!=='https:'))throw new Error();adminOrigin=parsed.origin;}
    catch {throw new Error('SERVER_ERROR');}
    if(process.env.NODE_ENV==='production'&&!process.env.ADMIN_BASE_URL)throw new Error('SERVER_ERROR');
    const created=transaction(()=>{
      const invitation=inviteUser(input),inviteUrl=`${adminOrigin}/admin/#invite=${invitation.token}`;
      db.prepare('INSERT INTO notification_outbox(id,appointment_id,recipient,subject,body,created_at) VALUES(?,NULL,?,?,?,?)')
        .run(randomUUID(),input.email.trim(),'Invitation à l’espace administrateur',`Bonjour ${input.name.trim()},\n\nPatricia vous invite à rejoindre l’équipe du site. Choisissez votre mot de passe ici :\n${inviteUrl}\n\nCe lien expire dans 48 heures.`,Date.now());
      return {...invitation,inviteUrl};
    });
    json(res,201,{id:created.id,inviteUrl:created.inviteUrl,expires:created.expires});deliverOutbox();return;
  }
  if (path.startsWith('/api/admin/team/')&&req.method==='PATCH') {
    const actor=requireUser(req,'team:write');json(res,200,{user:changeTeamUser(path.split('/').at(-1),await body(req),actor.id)});return;
  }
  throw new Error('NOT_FOUND');
}
async function staticFile(req,res,url) {
  let relative;
  if (url.pathname==='/') relative='index.html';
  else if (url.pathname==='/admin/'||url.pathname==='/admin') relative='admin/index.html';
  else relative=decodeURIComponent(url.pathname).replace(/^\//,'');
  const file=resolve(root,relative);
  const rootFiles=new Set(['index.html','carrieres.html','favicon.png','favicon-tab.png','Logo Patricia Lanctot.png','facebook (1).png','instagram (2).png','tic-toc.png']);
  const publicPath=rootFiles.has(relative)||relative.startsWith('assets/')||relative.startsWith('admin/');
  if (!publicPath||!file.startsWith(root+sep)||relative.includes('..')||relative.startsWith('.')) throw new Error('NOT_FOUND');
  const extension=extname(file).toLowerCase();
  if (!mime[extension]) throw new Error('NOT_FOUND');
  const info=await stat(file).catch(()=>null);
  if (!info?.isFile()) throw new Error('NOT_FOUND');
  const content=await readFile(file);
  res.writeHead(200,{'content-type':mime[extension],'cache-control':extension==='.html'?'no-store':'public, max-age=3600'});
  res.end(content);
}
createServer(async(req,res)=>{
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('referrer-policy','strict-origin-when-cross-origin');
  res.setHeader('x-frame-options','DENY');
  if (process.env.NODE_ENV==='production') res.setHeader('strict-transport-security','max-age=31536000');
  res.setHeader('permissions-policy','camera=(), microphone=(), geolocation=()');
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if (url.pathname.startsWith('/api/')) await api(req,res,url);
    else if (['GET','HEAD'].includes(req.method)) await staticFile(req,res,url);
    else throw new Error('NOT_FOUND');
  } catch(error) {fail(res,error);}
}).listen(port,()=>{
  console.log(`Patricia Lanctot server on :${port}`);
  const timer=setInterval(deliverOutbox,15000);timer.unref();
  deliverOutbox();
});
