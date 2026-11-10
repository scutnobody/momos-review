import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { input, respond } from './fixtures.mjs';

test('HTTP 上传分开评分和定位，并接通裁切、复评、留档和问答', {timeout:20_000},async t=>{
 const requests=[];
 const upstreamErrors=[];
 const mock=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=JSON.parse(Buffer.concat(chunks));
   const content=body.messages[1].content;
   const prompt=content[0].text;
   const job=JSON.parse(prompt.split('\n评审数据（JSON）\n')[1]);
   requests.push({job,model:body.model});
   if(job.kind==='locate'){
    assert.equal(req.url,'/locator/chat/completions');
    assert.equal(req.headers.authorization,'Bearer locator-test');
    assert.equal(body.model,'dedicated-locator');
    assert.equal(content[1].image_url.url,input.image);
    assert.equal(job.evidence,undefined);
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(respond(job))}}]}));
    return;
   }
   assert.equal(req.url,'/v1/chat/completions');
   assert.equal(body.model,['score','rescore'].includes(job.kind)?'dedicated-scorer':'review-agent');
   if(job.kind==='score')assert.doesNotMatch(prompt,/"parts"|"region"/);
   if(job.kind==='chat'){
    assert.equal(content.length,1);
    assert.equal(job.product,'台灯');
    assert.equal(job.part?.id,'p1');
    assert.equal(job.annotations.find(n=>n.itemId==='material.durability').score,null);
    assert.equal(job.trace,undefined);
    const evidenceIds=job.question==='测试错误引用' ? ['unknown'] : ['R:p1','T1'];
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'耐腐蚀需要对应的试验依据。',evidenceIds})}}]}));
    return;
   }
   assert.equal(content[1].image_url.url,input.image);
   const sources=job.evidence.map(e=>e.id);
   assert.ok(sources.includes('D2')&&sources.includes('P1')&&sources.includes('T1'));
   if(job.group?.id==='use'||job.kind==='rescore'){
    assert.equal(content[2].text,'图像区域 R:p1');
    assert.match(content[3].image_url.url,/^data:image\/jpeg;base64,\/9j\//);
   }
   const result=respond(job);
   if(job.kind==='score')Object.assign(result.ratings.find(x=>x.id==='material.durability'),{score:90,basis:'由外观推断耐腐蚀',evidenceIds:['IMG']});
   if(job.kind==='audit'&&job.round===1&&job.group.id==='engineering'){
    const v=result.verdicts.find(v=>v.id==='C:p1:material.durability');
    Object.assign(v,{status:'contradicted',reason:'误将外观当作试验结果'});
   }
   res.setHeader('content-type','application/json');
   res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));
  }catch(e){upstreamErrors.push(e);res.statusCode=500;res.end();}
 });
 mock.listen(0,'127.0.0.1');await once(mock,'listening');
 t.after(()=>{mock.closeAllConnections();mock.close();});
 const directory=await mkdtemp(join(tmpdir(),'momos-route-a-'));
 const base='http://127.0.0.1:'+mock.address().port+'/v1';
 const server=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,
  MOMOS_REVIEW_DIR:directory,MOMOS_PORT:'0',MOMOS_SCORE_BASE_URL:base,MOMOS_AGENT_BASE_URL:base,
  MOMOS_SCORE_MODEL:'dedicated-scorer',MOMOS_AGENT_MODEL:'review-agent',MOMOS_SCORE_API_KEY:'local-test',MOMOS_AGENT_API_KEY:'local-test',
  MOMOS_LOCATOR_MODEL:'dedicated-locator',MOMOS_LOCATOR_BASE_URL:base.replace('/v1','/locator'),MOMOS_LOCATOR_API_KEY:'locator-test'}});
 t.after(async()=>{
  server.kill();if(server.exitCode===null&&server.signalCode===null)await once(server,'exit');
  await rm(directory,{recursive:true,force:true});
 });
 const url=await new Promise((resolve,reject)=>{
  let out='';server.stdout.on('data',d=>{out+=d;const m=/http:\/\/127\.0\.0\.1:\d+/.exec(out);if(m)resolve(m[0]);});
  server.on('error',reject);server.on('exit',c=>reject(new Error('Server exited: '+c)));
 });
 const health=await fetch(url+'/api/status');assert.deepEqual(await health.json(),{configured:true});
 const rubric=await fetch(url+'/rubric.mjs');assert.equal(rubric.status,200);await rubric.text();
 const post=value=>fetch(url+'/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 const req=await post(input);
 const report=await req.json();
 assert.deepEqual(upstreamErrors,[]);
 assert.equal(req.status,200,report.error);
 assert.equal(report.source,'model');assert.equal(report.dimensions.length,9);
 assert.equal(report.localization.status,'located');
 assert.deepEqual(report.models,{scorer:'dedicated-scorer',locator:'dedicated-locator',agents:'review-agent'});
 assert.equal(requests.filter(r=>r.job.kind==='locate').length,1);
 assert.equal(report.dimensions.find(d=>d.id==='material').items.find(i=>i.id==='material.durability').score,null);
 assert.equal(report.trace.claimRevisions[0].auditBefore.status,'contradicted');
 assert.equal(report.trace.scoreRevisions[0].before.score,90);
 assert.deepEqual(requests.filter(r=>r.model==='dedicated-scorer').map(r=>r.job.kind),['score','rescore']);
 assert.deepEqual(requests.filter(r=>r.job.kind==='revise').map(r=>r.job.group.id),['engineering']);
 assert.equal((await post({image:'garbage'})).status,400);
 assert.deepEqual(await readdir(directory),[report.id+'.json']);
 const stored=await readFile(join(directory,report.id+'.json'),'utf8');
 assert.deepEqual(JSON.parse(stored),report);
 assert.doesNotMatch(stored,/data:image\//);

 const ask=(overrides={})=>fetch(url+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({reviewId:report.id,partId:'p1',question:'为什么这个部位暂不评分？',...overrides})});
 const chat=await ask();
 assert.equal(chat.status,200);
 const reply=await chat.json();
 assert.deepEqual(reply,{answer:'耐腐蚀需要对应的试验依据。',evidenceIds:['R:p1','T1']});
 const history=[{question:'为什么这个部位暂不评分？',answer:reply.answer}];
 const follow=await ask({question:'那要补什么资料？',history});
 assert.equal(follow.status,200);
 await follow.json();
 assert.deepEqual(requests.at(-1).job.history,history);
 assert.equal((await ask({question:'测试错误引用'})).status,502);
 const count=requests.length;
 assert.equal((await ask({partId:'missing'})).status,400);
 assert.equal((await ask({reviewId:'../server.mjs'})).status,400);
 assert.equal((await ask({reviewId:'87c85a3c-9326-4e21-bfcc-2d7ec705c30b'})).status,404);
 assert.equal(requests.length,count);
 assert.equal(await readFile(join(directory,report.id+'.json'),'utf8'),stored);
});
