import nodemailer from 'nodemailer';
import { db, transaction } from './db.js';

const smtpReady=Boolean(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS&&process.env.SMTP_FROM);
const transporter=smtpReady?nodemailer.createTransport({
  host:process.env.SMTP_HOST,
  port:Number(process.env.SMTP_PORT||587),
  secure:process.env.SMTP_SECURE==='true',
  auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},
  connectionTimeout:10000,
  greetingTimeout:10000,
  socketTimeout:20000,
  disableFileAccess:true,
  disableUrlAccess:true
}):null;
let sending=false;

export async function deliverOutbox() {
  if (!transporter||sending) return;
  sending=true;
  try {
    const now=Date.now();
    const batch=db.prepare('SELECT * FROM notification_outbox WHERE sent_at IS NULL AND attempts<8 AND next_attempt<=? AND locked_until<=? ORDER BY created_at LIMIT 10').all(now,now);
    for (const message of batch) {
      const lockUntil=Date.now()+60000;
      const claimed=transaction(()=>db.prepare('UPDATE notification_outbox SET locked_until=? WHERE id=? AND sent_at IS NULL AND locked_until<=?').run(lockUntil,message.id,Date.now()).changes);
      if (!claimed) continue;
      try {
        await transporter.sendMail({
          from:process.env.SMTP_FROM,
          to:message.recipient,
          subject:message.subject,
          text:message.body
        });
        db.prepare('UPDATE notification_outbox SET sent_at=?,locked_until=0,last_error=? WHERE id=?').run(Date.now(),'',message.id);
      } catch(error) {
        const attempts=message.attempts+1,delay=Math.min(3600000,30000*2**Math.min(attempts-1,7));
        db.prepare('UPDATE notification_outbox SET attempts=?,next_attempt=?,locked_until=0,last_error=? WHERE id=?')
          .run(attempts,Date.now()+delay,String(error.code||'SMTP_ERROR').slice(0,80),message.id);
        console.error('Notification delivery failed:',error.code||'SMTP_ERROR');
      }
    }
  } finally {sending=false;}
}
