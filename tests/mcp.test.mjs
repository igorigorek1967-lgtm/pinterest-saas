import test from 'node:test';
import assert from 'node:assert/strict';
import {PinmetricaClient,decodeRpc,parseSearchResult,ENDPOINT} from '../scripts/research/mcp-client.mjs';
import {isYeiskQuery} from '../src/lib/research/core.ts';

test('Ейск не совпадает с корейским',()=>{for(const word of ['Корейский макияж','Корейская еда','Корейский язык'])assert.equal(isYeiskQuery(word),false);for(const word of ['Ейск','Отдых в Ейске','Ейская коса','жильё — Ейск','Yeisk apartments'])assert.equal(isYeiskQuery(word),true);});
test('MCP JSON и SSE связываются с ID запроса',()=>{assert.deepEqual(decodeRpc('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}','application/json',2),{ok:true});assert.deepEqual(decodeRpc('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n','text/event-stream',2),{ok:true});assert.throws(()=>decodeRpc('{"jsonrpc":"2.0","id":7,"result":{}}','application/json',2));});
test('сохраняет ID темы и тип числа из наблюдавшегося формата',()=>{const rows=parseSearchResult({content:[{type:'text',text:'• **Ейск** — объём: 1,200 📈 +3.0%  | ID темы: `1234`  | https://www.pinterest.com/ideas/yeisk/1234/'}]});assert.equal(rows[0].value,1200);assert.equal(rows[0].topicId,'1234');assert.equal(rows[0].trendPercent,3);});
test('неизвестный формат не превращается в пустой результат',()=>assert.throws(()=>parseSearchResult({content:[{type:'text',text:'Новый формат'}]})));
test('credential remains in fixed-origin header; client follows initialization sequence',async()=>{const calls=[];const client=new PinmetricaClient('pm_test_only',async(url,options)=>{assert.equal(url,ENDPOINT);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer pm_test_only');const request=JSON.parse(options.body);calls.push(request.method);if(request.method==='notifications/initialized')return new Response(null,{status:202});const result=request.method==='initialize'?{protocolVersion:'2024-11-05'}:{tools:[]};return Response.json({jsonrpc:'2.0',id:request.id,result});});assert.deepEqual(await client.listTools(),[]);assert.deepEqual(calls,['initialize','notifications/initialized','tools/list']);await assert.rejects(()=>client.call('delete_account',{}));});
test('HTTP errors do not expose response bodies',async()=>{const client=new PinmetricaClient('pm_test_only',async()=>new Response('secret server diagnostic',{status:401}));await assert.rejects(()=>client.listTools(),error=>error.message==='Pinmetrica MCP: HTTP 401.');});

test('unknown volume formats never silently change numeric values',()=>{
  for(const value of ['1.5K','1 200','1,5','1,,200','1234,567','9007199254740992'])
    assert.throws(()=>parseSearchResult({content:[{type:'text',text:`• Ейск — объём: ${value} | ID темы: \`123\``}]}),value);
  for(const [value,expected] of [['0',0],['12',12],['1,200',1200],['—',null]])
    assert.equal(parseSearchResult({content:[{type:'text',text:`• Ейск — объём: ${value} | ID темы: \`123\``}]} )[0].value,expected);
});
test('SSE completes on matching response while upstream stream remains open',async()=>{
  let cancelled=false;
  const client=new PinmetricaClient('pm_test_only',async(url,options)=>{
    const request=JSON.parse(options.body);
    if(request.method==='notifications/initialized')return new Response(null,{status:202});
    if(request.method==='initialize')return Response.json({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2024-11-05'}});
    const encoder=new TextEncoder();const data=`: heartbeat\n\ndata: ${JSON.stringify({jsonrpc:'2.0',method:'progress'})}\n\ndata: ${JSON.stringify({jsonrpc:'2.0',id:request.id,result:{tools:[]}})}\n\n`;
    return new Response(new ReadableStream({start(controller){const bytes=encoder.encode(data);controller.enqueue(bytes.slice(0,30));controller.enqueue(bytes.slice(30));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}});
  });
  let timer;try{assert.deepEqual(await Promise.race([client.listTools(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('SSE did not finish')),1000);})]),[]);}finally{clearTimeout(timer);}
  assert.equal(cancelled,true);
});
