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
   const prompt=typeof content==='string'?content:content[0].text;
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
   if(job.kind==='chat'){
    assert.equal(req.url,'/chat-service/chat/completions');
    assert.equal(req.headers.authorization,'Bearer chat-test');
    assert.equal(body.model,'dedicated-chat');
    assert.equal(typeof content,'string');
    assert.equal(job.product,'台灯');
    assert.equal(job.projectName,'灯具方案 A');
    assert.ok(job.part===null||job.part.id==='p1');
    assert.equal(job.annotations.find(n=>n.itemId==='S2').score,null);
    assert.equal(job.trace,undefined);
    assert.equal(job.scoreMax,5);
    assert.match(prompt,/历史评分.*不代表当前结论/);
    const {ratingRevisions,claimRevisions}=job.reviewHistory;
    const rating=ratingRevisions.find(r=>r.itemId==='S2');
    assert.equal(rating.before.score,5);
    assert.equal(rating.auditBefore.status,'insufficient');
    assert.match(rating.auditBefore.reason,/证据/);
    assert.equal(rating.after.score,null);
    assert.equal(rating.auditAfter.status,'supported');
    const claim=claimRevisions.find(n=>n.partId==='p1');
    assert.equal(claim.expert,'engineering');
    assert.equal(claim.before.explanation,'产品局部判断');
    assert.equal(claim.auditBefore.reason,'原论点超出了图像可见范围');
    assert.equal(claim.after.explanation,'目前无法确认');
    assert.equal(claim.auditAfter.status,'supported');
    assert.equal(claimRevisions.some(n=>n.partId===null),job.part===null);
    const evidenceIds=job.question==='测试错误引用' ? ['unknown'] : ['R:p1','T1'];
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'当前图像无法确认实际稳定性。',evidenceIds})}}]}));
    return;
   }
   assert.equal(req.url,'/v1/chat/completions');
   assert.equal(body.model,['score','rescore'].includes(job.kind)?'dedicated-scorer':'review-agent');
   if(job.kind==='score'||job.kind==='rescore'){
    assert.match(prompt,/1–5/);
    assert.doesNotMatch(prompt,/0–100/);
   }
   if(job.kind==='score')assert.doesNotMatch(prompt,/"parts"|"region"/);
   assert.equal(content[1].image_url.url,input.image);
   if(job.kind==='score')assert.deepEqual(job.rubric.map(d=>d.items.length),[3,4,3]);
   const sources=job.evidence.map(e=>e.id);
   if(job.kind==='score')assert.deepEqual(sources,['IMG']);
   else if(job.kind==='rescore')assert.ok(job.evidence.every(e=>['image','region'].includes(e.type)));
   else assert.ok(sources.includes('D2')&&sources.includes('G1')&&sources.includes('P1')&&sources.includes('T1'));
   if(job.group?.id==='use'||job.kind==='rescore'){
    assert.equal(content[2].text,'图像区域 R:p1');
    assert.match(content[3].image_url.url,/^data:image\/jpeg;base64,\/9j\//);
   }
   const result=respond(job);
   if(job.kind==='score')Object.assign(result.ratings.find(x=>x.id==='S2'),{score:5,basis:'由文字资料推断实际稳定性',evidenceIds:['T1']});
   if(job.kind==='audit'&&job.round===1&&job.group.id==='engineering'){
    const v=result.verdicts.find(v=>v.id==='C:p1:S2');
    Object.assign(v,{status:'contradicted',reason:'原论点超出了图像可见范围'});
    const general=result.verdicts.find(v=>v.id==='C:general:S1');
    Object.assign(general,{status:'insufficient',reason:'边缘不够清晰'});
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
  MOMOS_LOCATOR_MODEL:'dedicated-locator',MOMOS_LOCATOR_BASE_URL:base.replace('/v1','/locator'),MOMOS_LOCATOR_API_KEY:'locator-test',
  MOMOS_CHAT_MODEL:'dedicated-chat',MOMOS_CHAT_BASE_URL:base.replace('/v1','/chat-service'),MOMOS_CHAT_API_KEY:'chat-test'}});
 t.after(async()=>{
  server.kill();if(server.exitCode===null&&server.signalCode===null)await once(server,'exit');
  await rm(directory,{recursive:true,force:true});
 });
 const url=await new Promise((resolve,reject)=>{
  let out='';server.stdout.on('data',d=>{out+=d;const m=/http:\/\/127\.0\.0\.1:\d+/.exec(out);if(m)resolve(m[0]);});
  server.on('error',reject);server.on('exit',c=>reject(new Error('Server exited: '+c)));
 });
 const health=await fetch(url+'/api/status');assert.deepEqual(await health.json(),{configured:true,chatConfigured:true});
 const rubric=await fetch(url+'/rubric.mjs');assert.equal(rubric.status,200);await rubric.text();
 const post=value=>fetch(url+'/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 const req=await post(input);
 const report=await req.json();
 assert.deepEqual(upstreamErrors,[]);
 assert.equal(req.status,200,report.error);
 assert.equal(report.source,'model');assert.equal(report.dimensions.length,3);
 assert.equal(report.localization.status,'located');
 assert.equal(report.scoreMax,5);
 assert.deepEqual(report.models,{scorer:'dedicated-scorer',locator:'dedicated-locator',agents:'review-agent'});
 assert.equal(requests.filter(r=>r.job.kind==='locate').length,1);
 assert.equal(report.dimensions.find(d=>d.id==='material').items.find(i=>i.id==='S2').score,null);
 assert.equal(report.trace.claimRevisions.find(r=>r.before.partId==='p1').auditBefore.status,'contradicted');
 assert.equal(report.trace.scoreRevisions[0].before.score,5);
 assert.deepEqual(requests.filter(r=>r.model==='dedicated-scorer').map(r=>r.job.kind),['score','rescore']);
 assert.deepEqual(requests.filter(r=>r.job.kind==='revise').map(r=>r.job.group.id),['engineering']);
 assert.equal((await post({image:'garbage'})).status,400);
 assert.deepEqual(await readdir(directory),[report.id+'.json']);
 const stored=await readFile(join(directory,report.id+'.json'),'utf8');
 assert.deepEqual(JSON.parse(stored),report);
 assert.doesNotMatch(stored,/data:image\//);

 const ask=(overrides={})=>fetch(url+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({reviewId:report.id,partId:'p1',question:'为什么这个部位的稳定性暂不评分？',...overrides})});
 const chat=await ask({reviewHistory:{ratingRevisions:[],claimRevisions:[]}});
 assert.equal(chat.status,200);
 const reply=await chat.json();
 assert.deepEqual(reply,{answer:'当前图像无法确认实际稳定性。',evidenceIds:['R:p1','T1']});
 const history=[{question:'为什么这个部位的稳定性暂不评分？',answer:reply.answer}];
 const follow=await ask({question:'那要补什么资料？',history});
 assert.equal(follow.status,200);
 await follow.json();
 assert.deepEqual(requests.at(-1).job.history,history);
 const whole=await ask({partId:null,question:'整机评审有哪些结论被修订？'});
 assert.equal(whole.status,200);
 await whole.json();
 assert.equal((await ask({question:'测试错误引用'})).status,502);
 assert.deepEqual(upstreamErrors,[]);
 const count=requests.length;
 assert.equal((await ask({partId:'missing'})).status,400);
 assert.equal((await ask({reviewId:'../server.mjs'})).status,400);
 assert.equal((await ask({reviewId:'87c85a3c-9326-4e21-bfcc-2d7ec705c30b'})).status,404);
 assert.equal(requests.length,count);
 assert.equal(await readFile(join(directory,report.id+'.json'),'utf8'),stored);
});
