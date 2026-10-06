import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, transaction } from './db.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const now = () => Date.now();
export const ROLES = ['OWNER','ADMIN','STAFF','VIEWER'];
const PERMISSIONS = {
  OWNER: ['appointments:read','appointments:write','availability:write','settings:write','team:write'],
  ADMIN: ['appointments:read','appointments:write','availability:write','settings:write'],
  STAFF: ['appointments:read','appointments:write'],
  VIEWER: ['appointments:read']
};
export const can = (user,permission) => Boolean(user && PERMISSIONS[user.role]?.includes(permission));
export function passwordHash(password) {
  if (typeof password!=='string'||password.length<12||password.length>200) throw new Error('PASSWORD_INVALID');
  const salt=randomBytes(16);
  const key=scryptSync(password,salt,64);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}
function passwordMatches(password,stored) {
  if (!stored||typeof password!=='string') return false;
  const [,saltHex,keyHex]=stored.split(':');
  const expected=Buffer.from(keyHex||'','hex');
  if (expected.length!==64) return false;
  return timingSafeEqual(scryptSync(password,Buffer.from(saltHex,'hex'),64),expected);
}
export function inviteUser({name,email,role}) {
  if (!ROLES.includes(role)||role==='OWNER'||!email||!name||!/^\S+@\S+\.\S+$/.test(email)) throw new Error('INPUT_INVALID');
  const token=random(), id=randomUUID(), expires=now()+48*3600000;
  db.prepare('INSERT INTO users(id,name,email,role,invite_hash,invite_expires,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id,name.trim().slice(0,100),email.trim().toLowerCase(),role,hash(token),expires,now());
  return {id,token,expires};
}
export function createOwnerInvite(email,name='Patricia Lanctot') {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n!==0) throw new Error('OWNER_EXISTS');
  const token=random(),id=randomUUID();
  db.prepare('INSERT INTO users(id,name,email,role,invite_hash,invite_expires,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id,name,email.toLowerCase(),'OWNER',hash(token),now()+48*3600000,now());
  return token;
}
export function acceptInvite(token,password) {
  if (typeof token!=='string'||token.length>200) throw new Error('INVITE_INVALID');
  return transaction(()=>{
    const user=db.prepare('SELECT id FROM users WHERE invite_hash=? AND invite_expires>? AND active=1').get(hash(token),now());
    if (!user) throw new Error('INVITE_INVALID');
    db.prepare('UPDATE users SET password_hash=?,invite_hash=NULL,invite_expires=NULL WHERE id=?')
      .run(passwordHash(password),user.id);
  });
}
export function login(email,password) {
  const user=db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(String(email||'').toLowerCase());
  if (!user||!passwordMatches(password,user.password_hash)) throw new Error('LOGIN_INVALID');
  const token=random(), csrf=random();
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),user.id,csrf,now()+12*3600000);
  return {token,csrf,user:{id:user.id,name:user.name,email:user.email,role:user.role}};
}
export function sessionFromCookie(cookie='') {
  const token=/(?:^|;\s*)pl_session=([^;]+)/.exec(cookie)?.[1];
  if (!token) return null;
  const row=db.prepare(`SELECT s.csrf,s.token_hash,u.id,u.name,u.email,u.role FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`).get(hash(token),now());
  return row||null;
}
export function logout(cookie='') {
  const token=/(?:^|;\s*)pl_session=([^;]+)/.exec(cookie)?.[1];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
}
export function team() {
  return db.prepare('SELECT id,name,email,role,active,created_at,password_hash IS NOT NULL AS enrolled FROM users ORDER BY created_at').all();
}
export function changeTeamUser(id,patch,actorId) {
  return transaction(()=>{
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!user) throw new Error('NOT_FOUND');
    if (user.role==='OWNER'||id===actorId) throw new Error('FORBIDDEN');
    const role=patch.role??user.role,active=patch.active===undefined?user.active:Number(Boolean(patch.active));
    if (!ROLES.includes(role)||role==='OWNER') throw new Error('INPUT_INVALID');
    db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(role,active,id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    return {id,role,active};
  });
}
