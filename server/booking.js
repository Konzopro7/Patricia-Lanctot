import { randomUUID } from 'node:crypto';
import { db, transaction } from './db.js';

const DAY = 86400000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SERVICES = [
  'Déclarations d’impôts de particuliers','Crédits d’impôt','Gains en capital',
  'Travailleurs autonomes','Situations particulières','Estimations et calculs fiscaux',
  'Autres formulaires spéciaux','Production de feuillets fiscaux',
  'Déclarations d’impôts de sociétés','Tenue de livres','Rapports de taxes',
  'Paie','Déclarations d’impôts de fiducies','Onvio'
];
const LOCATIONS = ['Saint-Hippolyte','Sainte-Julienne','À distance'];
export const STATUS = ['PENDING','CONFIRMED','REJECTED','CANCELLED','COMPLETED'];
export const settings = () => db.prepare('SELECT duration, buffer, timezone FROM settings WHERE id=1').get();
export const toMinutes = value => {
  const m = TIME_RE.exec(value || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const toTime = mins => `${String(Math.floor(mins / 60)).padStart(2,'0')}:${String(mins % 60).padStart(2,'0')}`;

function formatter(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  });
}
function localParts(epoch, timezone) {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(epoch).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
export function localToUtc(date, time, timezone) {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const [y,m,d] = date.split('-').map(Number);
  if (new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)!==date) return null;
  const base = Date.parse(`${date}T${time}:00Z`);
  const found = [];
  for (let offset=-14*60; offset<=14*60; offset+=15) {
    const epoch = base - offset*60000;
    if (localParts(epoch,timezone)===`${date} ${time}`) found.push(epoch);
  }
  return found.length===1 ? found[0] : null; // Skip missing or ambiguous DST times.
}
function dateInZone(epoch, timezone) {
  return localParts(epoch,timezone).slice(0,10);
}
export function validDate(date) {
  if (!DATE_RE.test(date)) return false;
  const [y,m,d] = date.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)===date;
}
function weekday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
function intervalsForDate(date, config) {
  const dayStart=localToUtc(date,'00:00',config.timezone);
  const next=new Date(Date.parse(date+'T00:00:00Z')+DAY).toISOString().slice(0,10);
  const dayEnd=localToUtc(next,'00:00',config.timezone);
  const regular=db.prepare('SELECT start_min,end_min FROM availability WHERE weekday=? ORDER BY start_min').all(weekday(date))
    .map(row=>[localToUtc(date,toTime(row.start_min),config.timezone),localToUtc(date,toTime(row.end_min),config.timezone)]);
  const exceptions=db.prepare('SELECT start_utc,end_utc,kind FROM exceptions WHERE start_utc < ? AND end_utc > ?').all(dayEnd,dayStart);
  const open=exceptions.filter(x=>x.kind==='OPEN').map(x=>[x.start_utc,x.end_utc]);
  const blocked=exceptions.filter(x=>x.kind==='BLOCK').map(x=>[x.start_utc,x.end_utc]);
  return {windows:[...regular,...open].filter(x=>x[0]!==null&&x[1]!==null),blocked};
}
export function slotsForDate(date, now=Date.now()) {
  if (!validDate(date)) throw new Error('DATE_INVALID');
  const config=settings();
  const {windows,blocked}=intervalsForDate(date,config);
  const busy=db.prepare("SELECT start_utc,end_utc FROM appointments WHERE status IN ('PENDING','CONFIRMED') AND date=?").all(date);
  const duration=config.duration*60000, buffer=config.buffer*60000;
  const slots=new Map();
  for (const [start,end] of windows) {
    for (let at=start; at+duration<=end; at+=15*60000) {
      if (at<=now || dateInZone(at,config.timezone)!==date) continue;
      if (blocked.some(b=>b[0]<at+duration&&at<b[1])) continue;
      if (busy.some(b=>b.start_utc-buffer<at+duration&&at<b.end_utc+buffer)) continue;
      const time=localParts(at,config.timezone).slice(11);
      if (localToUtc(date,time,config.timezone)!==at) continue;
      slots.set(time,{time,startUtc:at,endUtc:at+duration});
    }
  }
  return [...slots.values()].sort((a,b)=>a.startUtc-b.startUtc);
}
export function publicSlots(date) {
  const config=settings();
  return {date,duration:config.duration,timezone:config.timezone,slots:slotsForDate(date).map(x=>x.time)};
}
function clean(value,max=300) {
  return typeof value==='string' ? value.trim().slice(0,max) : '';
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function enqueue(appointmentId, recipient, subject, body) {
  db.prepare('INSERT INTO notification_outbox(id,appointment_id,recipient,subject,body,created_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(),appointmentId,recipient,subject,body,Date.now());
}
export function createAppointment(input) {
  const first=clean(input.firstName,80), last=clean(input.lastName,80), email=clean(input.email,200).toLowerCase();
  const phone=clean(input.phone,40), service=clean(input.service,120), message=clean(input.message,2000), location=clean(input.location,100);
  const date=clean(input.date,10), time=clean(input.time,5);
  if (!first||!last||!validEmail(email)||!/^\+?[0-9().\s-]{7,40}$/.test(phone)||!SERVICES.includes(service)||!LOCATIONS.includes(location)||!validDate(date)||toMinutes(time)===null) throw new Error('INPUT_INVALID');
  return transaction(()=>{
    const slot=slotsForDate(date).find(x=>x.time===time);
    if (!slot) throw new Error('SLOT_OCCUPIED');
    const id=randomUUID(), now=Date.now();
    db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id,first,last,email,phone,service,message,location,date,toMinutes(time),slot.startUtc,slot.endUtc,'PENDING',now,now
    );
    enqueue(id,email,'Demande de rendez-vous reçue','Votre demande de rendez-vous a bien été reçue. Elle est en attente de confirmation.');
    const notificationEmail=(process.env.ADMIN_NOTIFICATION_EMAIL||'patricialanctot@hotmail.com').trim().toLowerCase();
    enqueue(id,notificationEmail,'Nouvelle demande de rendez-vous',`Nouvelle demande : ${first} ${last}, ${date} à ${time} (${service}).`);
    return {id,status:'PENDING',date,time,duration:settings().duration};
  });
}
export function updateAppointment(id, patch) {
  const existing=db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  if (!existing) throw new Error('NOT_FOUND');
  const nextStatus=patch.status || existing.status;
  if (!STATUS.includes(nextStatus)) throw new Error('INPUT_INVALID');
  const first=clean(patch.firstName??existing.first_name,80),last=clean(patch.lastName??existing.last_name,80);
  const email=clean(patch.email??existing.email,200).toLowerCase(),phone=clean(patch.phone??existing.phone,40);
  const service=clean(patch.service??existing.service,120),message=clean(patch.message??existing.message,2000);
  const location=clean(patch.location??existing.location,100);
  if(!first||!last||!validEmail(email)||!/^\+?[0-9().\s-]{7,40}$/.test(phone)||!SERVICES.includes(service)||!LOCATIONS.includes(location))throw new Error('INPUT_INVALID');
  const date=patch.date || existing.date, time=patch.time || toTime(existing.start_min);
  const moving=date!==existing.date||time!==toTime(existing.start_min);
  const detailsChanged=first!==existing.first_name||last!==existing.last_name||email!==existing.email||phone!==existing.phone||service!==existing.service||message!==existing.message||location!==existing.location;
  return transaction(()=>{
    let start=existing.start_utc,end=existing.end_utc,startMin=existing.start_min;
    if (moving) {
      if (!validDate(date)||toMinutes(time)===null) throw new Error('INPUT_INVALID');
      // Exclude the current appointment from the availability query.
      db.prepare("UPDATE appointments SET status='CANCELLED' WHERE id=?").run(id);
      const slot=slotsForDate(date).find(x=>x.time===time);
      if (!slot) throw new Error('SLOT_OCCUPIED');
      start=slot.startUtc;end=slot.endUtc;startMin=toMinutes(time);
    }
    db.prepare('UPDATE appointments SET first_name=?,last_name=?,email=?,phone=?,service=?,message=?,location=?,date=?,start_min=?,start_utc=?,end_utc=?,status=?,updated_at=? WHERE id=?')
      .run(first,last,email,phone,service,message,location,date,startMin,start,end,nextStatus,Date.now(),id);
    const subject=moving||detailsChanged?'Votre rendez-vous a été modifié':nextStatus!==existing.status?({
      CONFIRMED:'Votre rendez-vous est confirmé',
      REJECTED:"Votre demande de rendez-vous n'a pas pu être confirmée",
      CANCELLED:'Votre rendez-vous a été annulé',
      COMPLETED:'Votre rendez-vous est terminé'
    })[nextStatus]:null;
    if (subject) enqueue(id,email,subject,`${subject}. Date : ${date}, heure : ${time}.`);
    return db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  });
}
export function listAppointments(from,to) {
  return db.prepare('SELECT * FROM appointments WHERE date BETWEEN ? AND ? ORDER BY start_utc').all(from,to);
}
