// Disposable CI-only container test. No production credentials or MCP requests.
import assert from 'node:assert/strict';
import {randomBytes,scryptSync} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const name='research-ci-'+randomBytes(6).toString('hex');
const volumes=[name+'-source',name+'-restore'];
const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex');
const origin='http://127.0.0.1:3039';
const env={...process.env,RESEARCH_OWNER_PASSWORD_HASH:`scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`,RESEARCH_SESSION_SECRET:randomBytes(32).toString('hex'),RESEARCH_PUBLIC_ORIGIN:origin,RESEARCH_SECURE_COOKIES:'false'};
const docker=(...args)=>execFileSync('docker',args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let cookie='';
async function request(action,body,auth=cookie,requestOrigin=origin){
  const response=await fetch(origin+'/api/research/'+action,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:requestOrigin}),...(auth?{Cookie:auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {response,data:await response.json()};
}
async function start(volume){
  docker('run','-d','--name',name,'-p','127.0.0.1:3039:3000','--mount',`type=volume,src=${volume},dst=/app/var/research`,...Object.keys(env).filter(key=>key.startsWith('RESEARCH_')).flatMap(key=>['-e',key]),'pinterest-research:test');
  for(let attempt=0;attempt<75;attempt++){
    try{if((await fetch(origin+'/research')).status===200)return;}catch{/* startup */}
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  throw new Error('Container startup failed.');
}
try{
  for(const volume of volumes)docker('volume','create',volume);
  await start(volumes[0]);
  assert.equal((await request('state',undefined,'')).response.status,401);
  assert.equal((await request('login',{password},'','https://other.example')).response.status,403);
  const login=await request('login',{password},'');assert.equal(login.response.status,200);
  cookie=login.response.headers.get('set-cookie').split(';')[0];
  const row={keyword:'Ейск: контейнерная проверка',topicId:null,project:'geo-yeisk',language:'ru',country:null,metric:'unmeasured',value:null,trendPercent:null,source:'CI fixture',sourceUrl:'https://example.com',observedAt:'2026-10-20'};
  assert.equal((await request('import',{observations:[row]})).data.added,1);
  assert.equal((await request('brief',{observation:row})).data.created,true);
  assert.equal((await request('proxy',{proxy:{status:'unknown',checkedAt:null,expiresOn:'2026-11-21'}})).response.status,200);
  assert.equal((await request('query',{mode:'categories',project:'geo-yeisk',language:'ru'})).response.status,503);
  const backup=(await request('backup')).data;
  assert.equal(backup.schema,'pinterest-research.backup.v2');assert.equal(backup.briefObservationIndexes.length,1);
  docker('rm','-f',name);await start(volumes[0]);
  const restarted=await request('state');assert.equal(restarted.response.status,200);assert.equal(restarted.data.observations.length,1);assert.equal(restarted.data.briefs.length,1);
  assert.equal((await request('logout',{})).response.status,200);assert.equal((await request('state')).response.status,401);
  docker('rm','-f',name);await start(volumes[1]);
  const next=await request('login',{password},'');cookie=next.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('restore',backup)).data.added,1);
  const restored=(await request('state')).data;
  assert.deepEqual(restored.observations,[row]);assert.equal(restored.briefs.length,1);assert.equal(restored.proxy.expiresOn,'2026-11-21');
  console.log('PASS: Docker build runtime, auth, origin, import, brief, backup, named volume after container recreation, persistent session, logout revocation, clean restore. MCP not called.');
}finally{
  try{docker('rm','-f',name);}catch{/* only our disposable container */}
  for(const volume of volumes)try{docker('volume','rm',volume);}catch{/* only our disposable volumes */}
}
