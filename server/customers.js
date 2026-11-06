import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { hashPassword, verifyPassword } from './store.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const dummyHash = hashPassword(randomBytes(32).toString('hex'));
const email = z.string().trim().toLowerCase().pipe(z.email().max(200));
const password = z.string().min(12, 'Use at least 12 characters.').max(200);
const name = z.string().trim().min(1).max(80);
const phone = z.string().trim().max(30).refine(v => !v || (/^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 10), 'Enter a valid phone number.');
const client = z.enum(['web', 'mobile']).default('web');
const publicUser = row => ({ id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone });
function error(res, status, message) { return res.status(status).json({ error: message }); }
function parse(schema, body, res) {
  const result = schema.safeParse(body);
  if (!result.success) { error(res,400,result.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join(' ')); return null; }
  return result.data;
}

export function customerAuth({store, rateLimits = true}) {
  const router = Router();
  const db = store.db;
  const cookie = { httpOnly:true, sameSite:'strict', secure:process.env.COOKIE_SECURE === 'true', path:'/api' };
  const lifetime = 7 * 86400000;
  const limiter = rateLimit({windowMs:15*60000,limit:15,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many account attempts. Please try again in 15 minutes.'},skip:()=>!rateLimits});
  function credentials(req) {
    const auth = req.headers.authorization;
    if (auth !== undefined) return { token: /^Bearer ([a-f0-9]{64})$/.exec(auth)?.[1], kind:'mobile', present:true };
    const value=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('cwash_customer='));
    return {token:value?.slice('cwash_customer='.length),kind:'web',present:!!value};
  }
  function resolve(req) {
    const credential=credentials(req);
    if (!credential.token || !/^[a-f0-9]{64}$/.test(credential.token)) return null;
    const session=db.prepare('SELECT * FROM customer_sessions WHERE token=? AND kind=? AND expires>?').get(digest(credential.token),credential.kind,Date.now());
    if (!session) return null;
    const user=db.prepare('SELECT * FROM customers WHERE id=?').get(session.user_id);
    return user ? {session,user:publicUser(user)} : null;
  }
  function authorize(req,res,next) {
    const account=resolve(req);
    if (!account) return error(res,401,'Please sign in to your customer account.');
    if (account.session.kind==='web' && !['GET','HEAD','OPTIONS'].includes(req.method)) {
      const token=req.headers['x-csrf-token'];
      if (typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token),Buffer.from(account.session.csrf))) return error(res,403,'Please refresh your session and try again.');
    }
    req.customer=account;
    next();
  }
  function optionalBookingAuth(req,res,next) {
    // An expired or malformed session must never silently become a guest booking.
    if (!credentials(req).present && req.headers['x-csrf-token'] === undefined) return next();
    return authorize(req,res,next);
  }
  function issue(req,res,user,kind,status=200) {
    const previous=resolve(req);
    if(previous) db.prepare('DELETE FROM customer_sessions WHERE token=?').run(previous.session.token);
    db.prepare('DELETE FROM customer_sessions WHERE expires<=?').run(Date.now());
    const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
    db.prepare('INSERT INTO customer_sessions(token,user_id,csrf,expires,kind) VALUES (?,?,?,?,?)').run(digest(token),user.id,csrf,Date.now()+lifetime,kind);
    if (kind==='web') {
      res.cookie('cwash_customer',token,{...cookie,maxAge:lifetime});
      return res.status(status).json({user,csrfToken:csrf});
    }
    return res.status(status).json({user,token});
  }
  router.get('/session',(req,res)=>{
    const account=resolve(req);
    if(!account){if(credentials(req).kind==='web')res.clearCookie('cwash_customer',cookie);return res.json({authenticated:false});}
    res.json({authenticated:true,user:account.user,...(account.session.kind==='web'?{csrfToken:account.session.csrf}:{})});
  });
  router.post('/register',limiter,(req,res)=>{
    const input=parse(z.object({firstName:name,lastName:name,email,password,phone:phone.default(''),client}).strict(),req.body,res);if(!input)return;
    if(db.prepare('SELECT id FROM customers WHERE email=?').get(input.email))return error(res,409,'An account with that email already exists. Please sign in.');
    const row={id:randomUUID(),email:input.email,first_name:input.firstName,last_name:input.lastName,phone:input.phone};
    db.prepare('INSERT INTO customers(id,email,password,first_name,last_name,phone,created_at) VALUES (?,?,?,?,?,?,?)').run(row.id,row.email,hashPassword(input.password),row.first_name,row.last_name,row.phone,new Date().toISOString());
    issue(req,res,publicUser(row),input.client,201);
  });
  router.post('/login',limiter,(req,res)=>{
    const input=parse(z.object({email,password:z.string().min(1).max(200),client}).strict(),req.body,res);if(!input)return;
    const row=db.prepare('SELECT * FROM customers WHERE email=?').get(input.email);
    const valid=verifyPassword(input.password,row?.password||dummyHash);
    if(!row||!valid)return error(res,401,'Email or password is incorrect.');
    issue(req,res,publicUser(row),input.client);
  });
  router.use(authorize);
  router.post('/logout',(req,res)=>{
    db.prepare('DELETE FROM customer_sessions WHERE token=?').run(req.customer.session.token);
    if(req.customer.session.kind==='web')res.clearCookie('cwash_customer',cookie);
    res.json({ok:true});
  });
  router.get('/bookings',(req,res)=>{
    const bookings=db.prepare('SELECT bookings.value FROM bookings JOIN booking_customers ON bookings.id=booking_customers.booking_id WHERE booking_customers.user_id=? ORDER BY bookings.date DESC,bookings.time DESC').all(req.customer.user.id).map(r=>JSON.parse(r.value));
    res.json({bookings});
  });
  router.patch('/profile',(req,res)=>{
    const input=parse(z.object({firstName:name,lastName:name,phone}).strict(),req.body,res);if(!input)return;
    db.prepare('UPDATE customers SET first_name=?,last_name=?,phone=? WHERE id=?').run(input.firstName,input.lastName,input.phone,req.customer.user.id);
    res.json({user:publicUser(db.prepare('SELECT * FROM customers WHERE id=?').get(req.customer.user.id))});
  });
  router.post('/password',limiter,(req,res)=>{
    const input=parse(z.object({currentPassword:z.string().min(1).max(200),newPassword:password}).strict(),req.body,res);if(!input)return;
    const row=db.prepare('SELECT * FROM customers WHERE id=?').get(req.customer.user.id);
    if(!verifyPassword(input.currentPassword,row.password))return error(res,400,'Current password is incorrect.');
    const hashed=hashPassword(input.newPassword);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE customers SET password=? WHERE id=?').run(hashed,row.id);
      db.prepare('DELETE FROM customer_sessions WHERE user_id=?').run(row.id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    if(req.customer.session.kind==='web')res.clearCookie('cwash_customer',cookie);
    res.json({ok:true});
  });
  return {router,optionalBookingAuth,authorize};
}
