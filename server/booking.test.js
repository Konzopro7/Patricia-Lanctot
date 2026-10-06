import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const folder=mkdtempSync(join(tmpdir(),'patricia-booking-'));
process.env.DB_FILE=join(folder,'test.sqlite');
const {db}=await import('./db.js');
const booking=await import('./booking.js');
const auth=await import('./auth.js');
const monday='2099-01-05';

test('weekly schedule produces slots and a pending appointment reserves its time',()=>{
  const mondayWeekday=new Date(monday+'T12:00:00Z').getUTCDay();
  db.prepare('INSERT INTO availability VALUES(?,?,?,?)').run('rule-test',mondayWeekday,9*60,12*60);
  assert.deepEqual(booking.publicSlots(monday).slots.slice(0,3),['09:00','09:15','09:30']);
  const payload={firstName:'Test',lastName:'Cliente',email:'test@example.com',phone:'5145550100',service:'Tenue de livres',location:'À distance',date:monday,time:'10:00'};
  const result=booking.createAppointment(payload);
  assert.equal(result.status,'PENDING');
  assert.throws(()=>booking.createAppointment(payload),{message:'SLOT_OCCUPIED'});
  assert.equal(booking.publicSlots(monday).slots.includes('10:00'),false);
});

test('blocked periods and buffers remove overlapping availability',()=>{
  const date='2099-01-06',weekday=new Date(date+'T12:00:00Z').getUTCDay();
  db.prepare('INSERT INTO availability VALUES(?,?,?,?)').run('rule-tuesday',weekday,9*60,12*60);
  const start=booking.localToUtc(date,'09:45',booking.settings().timezone);
  const end=booking.localToUtc(date,'10:15',booking.settings().timezone);
  db.prepare('INSERT INTO exceptions VALUES(?,?,?,?,?)').run('block-test',start,end,'BLOCK','pause');
  db.prepare('UPDATE settings SET buffer=15 WHERE id=1').run();
  booking.createAppointment({firstName:'Alex',lastName:'Client',email:'alex@example.com',phone:'5145550123',service:'Tenue de livres',location:'À distance',date,time:'10:30'});
  const slots=booking.publicSlots(date).slots;
  assert.equal(slots.includes('09:45'),false);
  assert.equal(slots.includes('10:00'),false);
  assert.equal(slots.includes('10:15'),false);
  assert.equal(slots.includes('11:15'),true);
});

test('unavailable times are rejected and appointment changes reserve the new time',()=>{
  const mondayWeekday=new Date(monday+'T12:00:00Z').getUTCDay();
  const id=booking.createAppointment({firstName:'Ada',lastName:'Client',email:'ada@example.com',phone:'5145550101',service:'Tenue de livres',location:'À distance',date:monday,time:'11:00'}).id;
  assert.throws(()=>booking.createAppointment({firstName:'Test',lastName:'Client',email:'other@example.com',phone:'5145550102',service:'Tenue de livres',location:'À distance',date:monday,time:'12:00'}),{message:'SLOT_OCCUPIED'});
  const moved=booking.updateAppointment(id,{date:monday,time:'09:00'});
  assert.equal(moved.start_min,540);
  assert.equal(booking.publicSlots(monday).slots.includes('09:00'),false);
  booking.updateAppointment(id,{status:'CONFIRMED'});
  assert.equal(db.prepare('SELECT status FROM appointments WHERE id=?').get(id).status,'CONFIRMED');
  booking.updateAppointment(id,{status:'CANCELLED'});
  assert.equal(booking.publicSlots(monday).slots.includes('09:00'),true);
});

test('roles restrict team and schedule access; invitations activate an account',()=>{
  const ownerToken=auth.createOwnerInvite('owner@example.com');
  const ownerInvite=auth.inviteUser({name:'Assistant',email:'assistant@example.com',role:'STAFF'});
  const invited=auth.team().find(x=>x.email==='assistant@example.com');
  assert.equal(auth.can({role:'STAFF'},'appointments:write'),true);
  assert.equal(auth.can({role:'STAFF'},'availability:write'),false);
  assert.equal(auth.can({role:'VIEWER'},'appointments:write'),false);
  assert.equal(auth.can({role:'OWNER'},'team:write'),true);
  auth.acceptInvite(ownerToken,'Owner-password-123');
  auth.acceptInvite(ownerInvite.token,'Assistant-password-123');
  const session=auth.login('assistant@example.com','Assistant-password-123');
  assert.equal(session.user.id,invited.id);
});

test.after(()=>{db.close();rmSync(folder,{recursive:true,force:true});});
