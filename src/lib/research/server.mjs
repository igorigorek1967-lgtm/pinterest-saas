import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { validateObservation, mergeObservations, makeBrief, observationId, isYeiskQuery, proxyReadiness, PROJECTS } from './core.ts';
import { PinmetricaClient, parseSearchResult } from '../../../scripts/research/mcp-client.mjs';

const COOKIE = 'research_session';
const LIFETIME = 12 * 60 * 60;
const databases = new Map();
export class ResearchError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Пароль: от 12 до 1024 символов.');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password, encoded) {
  if (typeof password !== 'string' || password.length > 1024 || typeof encoded !== 'string') return false;
  const match = encoded.match(/^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/);
  if (!match) return false;
  return timingSafeEqual(scryptSync(password, match[1], 64), Buffer.from(match[2], 'hex'));
}
export function config() {
  const hash = process.env.RESEARCH_OWNER_PASSWORD_HASH || '';
  const secret = process.env.RESEARCH_SESSION_SECRET || '';
  if (!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash) || secret.length < 32) throw new ResearchError(503, 'Вход владельца ещё не настроен на сервере.');
  return { hash, secret, secure: process.env.RESEARCH_SECURE_COOKIES !== 'false', origin: process.env.RESEARCH_PUBLIC_ORIGIN || '' };
}
export function signSession(secret, now = Math.floor(Date.now()/1000)) {
  const body = Buffer.from(JSON.stringify({iat:now,exp:now+LIFETIME,nonce:randomBytes(16).toString('hex')})).toString('base64url');
  return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
}
export function validSession(token, secret, now = Math.floor(Date.now()/1000)) {
  if (typeof token !== 'string' || token.length > 512) return false;
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return false;
  const expected = createHmac('sha256',secret).update(body).digest('base64url');
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature) || !timingSafeEqual(Buffer.from(signature),Buffer.from(expected))) return false;
  try { const data=JSON.parse(Buffer.from(body,'base64url').toString());return Number.isInteger(data.iat)&&Number.isInteger(data.exp)&&data.iat<=now&&data.exp>now&&data.exp-data.iat===LIFETIME&&typeof data.nonce==='string'; } catch {return false;}
}
export function sessionFromCookie(cookie, secret, hash, db=database()) {
  const token=(cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if (!validSession(token,secret)) return false;
  const row=db.prepare('SELECT credential, expires FROM sessions WHERE id=?').get(digest(token));
  return !!row && row.expires>Date.now() && row.credential===digest(hash || '');
}
const digest = value => createHash('sha256').update(value).digest('hex');
export function logout(cookie, db=database()) {
  const token=(cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(token)db.prepare('DELETE FROM sessions WHERE id=?').run(digest(token));
}
export function cookieValue(token, secure, logout=false) {
  return `${COOKIE}=${logout?'':token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${logout?0:LIFETIME}${secure?'; Secure':''}`;
}
export function sameOrigin(request, cfg=config()) {
  const origin=request.headers.get('origin');
  const allowed=cfg.origin || (process.env.NODE_ENV==='production' ? '' : new URL(request.url).origin);
  if (!allowed || origin!==allowed) throw new ResearchError(403,'Запрос должен исходить из этого приложения.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ResearchError(415,'Нужен JSON-запрос.');
}
export function requireOwner(request) {
  const cfg=config();
  if (!sessionFromCookie(request.headers.get('cookie'),cfg.secret,cfg.hash)) throw new ResearchError(401,'Войдите как владелец.');
  return cfg;
}
export async function bodyJson(request, limit=2_000_000) {
  const reader=request.body?.getReader();if(!reader)throw new ResearchError(400,'Пустой запрос.');
  const decoder=new TextDecoder();let body='',size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new ResearchError(413,'Запрос превышает допустимый размер.');}body+=decoder.decode(value,{stream:true});}
  body+=decoder.decode();
  try {const parsed=JSON.parse(body);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();return parsed;}catch{throw new ResearchError(400,'Неверный JSON-запрос.');}
}
export function database() {
  const directory=path.resolve(/* turbopackIgnore: true */ process.env.RESEARCH_DATA_DIR||'./var/research');
  if(databases.has(directory))return databases.get(directory);
  mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'research.sqlite');
  const db=new DatabaseSync(file);chmodSync(file,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS briefs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, credential TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_failures (occurred INTEGER NOT NULL);`);
  databases.set(directory,db);return db;
}
export function readState(db=database()) {
  const proxyRow=db.prepare('SELECT payload FROM settings WHERE id=?').get('proxy');
  return { observations:db.prepare('SELECT payload FROM observations ORDER BY rowid DESC').all().map(row=>JSON.parse(row.payload)), briefs:db.prepare('SELECT payload FROM briefs ORDER BY rowid DESC').all().map(row=>JSON.parse(row.payload)), proxy:proxyRow?JSON.parse(proxyRow.payload):{status:'unknown',checkedAt:null,expiresOn:null} };
}
export function importObservations(incoming, allowRelated=false, db=database(), limit=5000, transaction=true) {
  if(!Array.isArray(incoming)||!incoming.length||incoming.length>limit)throw new ResearchError(400,'Нужно от 1 до 5000 наблюдений.');
  let validated;try{validated=incoming.map(validateObservation);}catch(e){throw new ResearchError(400,e.message);}
  if(!allowRelated&&validated.some(row=>row.project==='geo-yeisk'&&!isYeiskQuery(row.keyword)))throw new ResearchError(400,'Есть темы без названия города. Проверьте и подтвердите смежные темы.');
  if(transaction)db.exec('BEGIN IMMEDIATE');
  try {
    const existing=readState(db).observations;
    let merged;try{merged=mergeObservations(existing,validated);}catch(e){throw new ResearchError(409,e.message);}
    if(merged.rows.length>20000)throw new ResearchError(400,'Достигнут предел 20 000 наблюдений. Сохраните архив перед продолжением.');
    const insert=db.prepare('INSERT OR IGNORE INTO observations(id,payload) VALUES (?,?)');
    for(const row of validated)insert.run(observationId(row),JSON.stringify(row));
    if(transaction)db.exec('COMMIT');return {added:merged.added,duplicates:merged.duplicates};
  }catch(e){if(transaction)db.exec('ROLLBACK');throw e;}
}
export function saveBrief(observation, db=database()) {
  let row;try{row=validateObservation(observation);}catch(e){throw new ResearchError(400,e.message);}
  const stored=db.prepare('SELECT payload FROM observations WHERE id=?').get(observationId(row));
  if(!stored)throw new ResearchError(400,'Сначала сохраните наблюдение.');
  const brief=makeBrief(JSON.parse(stored.payload));
  const result=db.prepare('INSERT OR IGNORE INTO briefs(id,payload) VALUES (?,?)').run(brief.idempotencyKey,JSON.stringify(brief));
  return {brief,created:result.changes>0};
}
export function saveProxy(value, db=database()) {
  if(!value||!['unknown','working','failed'].includes(value.status))throw new ResearchError(400,'Неверный статус проверки прокси.');
  const proxy={status:value.status,checkedAt:value.checkedAt||null,expiresOn:value.expiresOn||null};
  if(proxy.checkedAt&&(typeof proxy.checkedAt!=='string'||!Number.isFinite(Date.parse(proxy.checkedAt))||Date.parse(proxy.checkedAt)>Date.now()))throw new ResearchError(400,'Неверное время проверки.');
  if(proxy.expiresOn&&(typeof proxy.expiresOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(proxy.expiresOn)||!Number.isFinite(Date.parse(proxy.expiresOn))||new Date(proxy.expiresOn).toISOString().slice(0,10)!==proxy.expiresOn))throw new ResearchError(400,'Неверная дата окончания.');
  db.prepare('INSERT INTO settings(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run('proxy',JSON.stringify(proxy));
  return {proxy,readiness:proxyReadiness(proxy)};
}
export const BACKUP_LIMIT = 200_000_000;
export function exportBackup(db=database()) {
  const {observations,briefs,proxy}=readState(db);
  const indexes=new Map(observations.map((row,index)=>[observationId(row),index]));
  return {schema:'pinterest-research.backup.v2',exportedAt:new Date().toISOString(),observations,briefObservationIndexes:briefs.map(brief=>indexes.get(brief.idempotencyKey)),proxy};
}
export function restoreBackup(input, db=database()) {
  if(input?.schema!=='pinterest-research.backup.v2'||!Array.isArray(input.observations)||input.observations.length>20000||!Array.isArray(input.briefObservationIndexes)||input.briefObservationIndexes.length>20000)throw new ResearchError(400,'Неверный формат резервной копии.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result=input.observations.length?importObservations(input.observations,true,db,20000,false):{added:0,duplicates:0};
    for(const index of input.briefObservationIndexes){
      if(!Number.isInteger(index)||index<0||index>=input.observations.length)throw new ResearchError(400,'Задание без наблюдения в резервной копии.');
      saveBrief(input.observations[index],db);
    }
    saveProxy(input.proxy,db);
    db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function login(password, cfg=config(), db=database()) {
  const now=Date.now();db.prepare('DELETE FROM login_failures WHERE occurred < ?').run(now-600000);
  if(!passwordMatches(password,cfg.hash)){
    const limited=db.prepare('SELECT COUNT(*) AS count FROM login_failures').get().count>=10;
    if(!limited)db.prepare('INSERT INTO login_failures(occurred) VALUES (?)').run(now);
    throw new ResearchError(limited?429:401,limited?'Слишком много неверных попыток.':'Неверный пароль.');
  }
  db.exec('DELETE FROM login_failures');
  db.prepare('DELETE FROM sessions WHERE expires <= ? OR credential != ?').run(now,digest(cfg.hash));
  const token=signSession(cfg.secret);
  db.prepare('INSERT INTO sessions(id,credential,expires) VALUES (?,?,?)').run(digest(token),digest(cfg.hash),now+LIFETIME*1000);
  return token;
}
export async function queryPinmetrica(input, apiKey=process.env.PINMETRICA_API_KEY, factory=key=>new PinmetricaClient(key)) {
  if(!apiKey)throw new ResearchError(503,'Источник Pinmetrica ещё не подключён на сервере.');
  const mode=input.mode||'search';
  if(!['search','suggest','categories','theme'].includes(mode))throw new ResearchError(400,'Неизвестный режим исследования.');
  if(!PROJECTS.includes(input.project))throw new ResearchError(400,'Неизвестный проект.');
  if(!['ru','en'].includes(input.language))throw new ResearchError(400,'Выберите язык результатов.');
  let name,args;
  if(mode==='categories'){name='get_categories';args={};}
  else if(mode==='theme'){
    if(typeof input.themeId!=='string'||!/^\d{1,30}$/.test(input.themeId))throw new ResearchError(400,'Нужен ID темы из поиска.');
    name='get_theme';args={theme_id:input.themeId};
  }else{
    if(typeof input.q!=='string'||input.q.trim().length<(mode==='search'?2:1)||input.q.length>200)throw new ResearchError(400,'Проверьте поисковый запрос.');
    if(mode==='search'){
      const page=input.page??1;if(!Number.isInteger(page)||page<1||page>5)throw new ResearchError(400,'Страница: от 1 до 5.');
      name='search_keywords';args={q:input.q.trim(),page,per_page:20};
    }else{name='suggest_keywords';args={q:input.q.trim(),limit:20};}
  }
  try {
    const client=factory(apiKey);const tools=await client.listTools();if(!tools.some(tool=>tool.name===name))throw new Error('Tool missing');
    const result=await client.call(name,args);
    const text=result.content.filter(item=>item.type==='text'&&typeof item.text==='string').map(item=>item.text).join('\n');
    if(mode!=='search')return {mode,text,observations:[],excluded:[],tools:tools.map(t=>t.name)};
    const candidates=parseSearchResult(result),observations=[],excluded=[];
    for(const row of candidates){
      if(input.project==='geo-yeisk'&&!isYeiskQuery(row.keyword)){excluded.push({keyword:row.keyword,reason:'Нет отдельного названия города. Требуется ручная проверка.'});continue;}
      observations.push(validateObservation({...row,project:input.project,language:input.language,country:null,metric:'monthly_searches',source:'Pinmetrica MCP · search_keywords',sourceUrl:'https://api.pinmetrica.com/pinterest-api/mcp',observedAt:new Date().toISOString().slice(0,10)}));
    }
    return {mode,text,observations,excluded,tools:tools.map(t=>t.name),coverage:{page:args.page,pageSize:20,complete:false}};
  }catch(e){if(e instanceof ResearchError)throw e;throw new ResearchError(502,'Источник не вернул проверяемый ответ. Повторите запрос позже или используйте импорт.');}
}
export function closeDatabases() {for(const db of databases.values())db.close();databases.clear();}
