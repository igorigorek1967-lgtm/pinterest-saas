import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {passwordHash,passwordMatches,signSession,validSession,sessionFromCookie,cookieValue,sameOrigin,importObservations,readState,saveBrief,saveProxy,login,queryPinmetrica,closeDatabases,logout,exportBackup,restoreBackup} from '../src/lib/research/server.mjs';

const password='test-owner-password-only';const hash=passwordHash(password);const secret='test-session-secret-that-is-at-least-32';
const cfg={hash,secret,secure:false,origin:'http://localhost:3035'};
const observation={keyword:'Жильё в Ейске',topicId:null,project:'geo-yeisk',language:'ru',country:null,metric:'unmeasured',value:null,trendPercent:null,source:'Тест',sourceUrl:'https://example.com',observedAt:'2026-10-20'};
const temporary=mkdtempSync(path.join(os.tmpdir(),'research-test-'));process.env.RESEARCH_DATA_DIR=temporary;
test.after(()=>{closeDatabases();rmSync(temporary,{recursive:true,force:true});delete process.env.RESEARCH_DATA_DIR;});
test('password hash verifies without plaintext storage',()=>{assert.ok(!hash.includes(password));assert.ok(passwordMatches(password,hash));assert.equal(passwordMatches('wrong',hash),false);assert.equal(passwordMatches(password,'bad'),false);});
test('sessions reject expiry, changes, future issue and malformed Unicode signatures',()=>{const token=signSession(secret,100);assert.equal(validSession(token,secret,101),true);assert.equal(validSession(token,secret,100+43200),false);assert.equal(validSession(token,secret,99),false);assert.equal(validSession(token+'x',secret,101),false);assert.equal(validSession(token.split('.')[0]+'.'+'й'.repeat(43),secret,101),false);assert.equal(sessionFromCookie('research_session='+signSession(secret),secret,hash),false);});
test('session cookies are HttpOnly and Strict',()=>{assert.match(cookieValue('token',true),/HttpOnly; SameSite=Strict/);assert.match(cookieValue('token',true),/; Secure/);assert.match(cookieValue('',true,true),/Max-Age=0/);});
test('cross-origin writes and form submissions fail before mutation',()=>{assert.throws(()=>sameOrigin(new Request('http://localhost:3035/api/research/import',{headers:{origin:'https://bad.example','content-type':'application/json'}}),cfg));assert.throws(()=>sameOrigin(new Request('http://localhost:3035/api/research/import',{headers:{origin:cfg.origin,'content-type':'text/plain'}}),cfg));assert.doesNotThrow(()=>sameOrigin(new Request('http://localhost:3035/api/research/import',{headers:{origin:cfg.origin,'content-type':'application/json'}}),cfg));});
test('SQLite persists after connection closure; repeated imports remain idempotent',()=>{assert.equal(importObservations([observation]).added,1);closeDatabases();assert.equal(readState().observations.length,1);assert.equal(importObservations([observation]).duplicates,1);});
test('invalid imports and conflicts do not modify the database',()=>{assert.throws(()=>importObservations([observation,{...observation,keyword:'bad',value:-1}]));assert.equal(readState().observations.length,1);assert.throws(()=>importObservations([{...observation,metric:'unmeasured',value:1}]));assert.equal(readState().observations.length,1);});
test('server blocks Korean substring matches without explicit related-topic approval',()=>{const korean={...observation,keyword:'Корейский макияж'};assert.throws(()=>importObservations([korean]));assert.equal(importObservations([korean],true).added,1);});
test('brief is persistent and uses stored evidence instead of request-supplied replacements',()=>{const result=saveBrief({...observation,trendPercent:500});assert.equal(result.brief.evidence.trendPercent,null);assert.equal(result.created,true);assert.equal(saveBrief(observation).created,false);closeDatabases();assert.equal(readState().briefs.length,1);});
test('proxy state accepts dates but never accepts secrets or claims an automatic health check',()=>{saveProxy({status:'unknown',checkedAt:null,expiresOn:'2026-11-21',password:'do-not-store'});assert.equal(readState().proxy.password,undefined);assert.throws(()=>saveProxy({status:'working',checkedAt:'not-a-date'}));});
test('invalid login attempts are capped without locking out the correct owner',()=>{for(let i=0;i<10;i++)assert.throws(()=>login('wrong',cfg),e=>e.status===401);assert.throws(()=>login('wrong',cfg),e=>e.status===429);assert.ok(login(password,cfg));});
test('live search adapter quarantines false geographic matches',async()=>{const factory=()=>({listTools:async()=>[{name:'search_keywords'}],call:async()=>({content:[{type:'text',text:'• **Корейский макияж** — объём: 1,200 📈 +3.0% | ID темы: `1234`\n• **Жильё в Ейске** — объём: 12 📈 +1.0% | ID темы: `1235`'}]})});const result=await queryPinmetrica({project:'geo-yeisk',language:'ru',q:'Ейск'},'pm_test_only',factory);assert.equal(result.observations.length,1);assert.equal(result.excluded.length,1);assert.equal(result.observations[0].country,null);assert.equal(result.coverage.complete,false);});
test('source credentials and unknown inputs never appear in upstream failures',async()=>{await assert.rejects(()=>queryPinmetrica({project:'geo-yeisk',language:'ru',q:'Ейск'},'pm_test_only',()=>{throw new Error('private key diagnostic');}),e=>e.status===502&&!e.message.includes('private'));await assert.rejects(()=>queryPinmetrica({project:'other',language:'ru',q:'Ейск'},'pm_test_only'),e=>e.status===400);});

test('logout revokes a copied cookie and password rotation invalidates sessions',()=>{
  const cookie='research_session='+login(password,cfg);
  assert.equal(sessionFromCookie(cookie,secret,hash),true);
  closeDatabases();assert.equal(sessionFromCookie(cookie,secret,hash),true);
  assert.equal(sessionFromCookie(cookie,secret,passwordHash('another-owner-password')),false);
  logout(cookie);assert.equal(sessionFromCookie(cookie,secret,hash),false);
});
test('full backup restores more than 5000 rows, briefs and proxy on a clean database',()=>{
  const source=mkdtempSync(path.join(os.tmpdir(),'research-backup-'));
  const dest=mkdtempSync(path.join(os.tmpdir(),'research-restore-'));
  try{
    process.env.RESEARCH_DATA_DIR=source;
    const rows=Array.from({length:5001},(_,i)=>({...observation,keyword:'Ейск '+i}));
    importObservations(rows.slice(0,5000));importObservations(rows.slice(5000));
    saveBrief(rows[0]);saveProxy({status:'unknown',expiresOn:'2026-11-21'});
    const backup=exportBackup();assert.equal(backup.observations.length,5001);
    process.env.RESEARCH_DATA_DIR=dest;
    const bad={...backup,briefObservationIndexes:[90000]};
    assert.throws(()=>restoreBackup(bad));assert.equal(readState().observations.length,0);
    assert.equal(restoreBackup(backup).added,5001);
    closeDatabases();assert.equal(readState().observations.length,5001);
    assert.equal(readState().briefs.length,1);assert.equal(readState().proxy.expiresOn,'2026-11-21');
    assert.equal(restoreBackup(backup).duplicates,5001);
  }finally{closeDatabases();process.env.RESEARCH_DATA_DIR=temporary;rmSync(source,{recursive:true,force:true});rmSync(dest,{recursive:true,force:true});}
});
