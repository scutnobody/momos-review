import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview, validateInput } from '../review.mjs';
import { DIMENSIONS } from '../rubric.mjs';
import { input, part, respond } from './fixtures.mjs';

test('每维三个独立量表子项，并建立图像、段落、参数和测试来源',async()=>{
 const report=await runReview(validateInput(input),respond);
 assert.equal(DIMENSIONS.length,9);
 for(const d of DIMENSIONS)for(const i of d.items) {
  assert.equal(d.items.length,3);
  assert.deepEqual(Object.keys(i.anchors),['40','70','90']);
  assert.ok(i.unassessable);
 }
 assert.deepEqual(report.evidence.map(e=>[e.id,e.type]),[
  ['IMG','image'],['R:p1','region'],['D1','description'],['D2','description'],['P1','parameter'],['T1','test']
 ]);
 assert.deepEqual(report.evidence[1].region,part.region);
 assert.equal(report.annotations.find(n=>n.itemId==='usability.controls').score,80);
 assert.equal(report.trace.scoreRevisions.length,0);
});

test('仅原专家复评争议条目，评分变更由专用模型完成，保留三态与两轮历史',async()=>{
 const calls=[];
 const report=await runReview(validateInput({...input,testResults:''}),async job=>{
  calls.push(job);
  const result=respond(job);
  if(job.kind==='score')Object.assign(result.ratings.find(x=>x.id==='material.durability'),{score:92,basis:'金属外观说明耐腐蚀',evidenceIds:['IMG']});
  if(job.kind==='audit'&&job.round===1)for(const v of result.verdicts){
   if(v.id==='C:p1:material.durability')Object.assign(v,{status:'insufficient',reason:'没有耐腐蚀试验'});
   if(v.id==='C:p1:usability.controls')Object.assign(v,{status:'contradicted',reason:'把旋钮误判为按钮'});
  }
  return result;
 });
 assert.deepEqual(calls.filter(c=>c.kind==='revise').map(c=>[c.group.id,c.targets.map(t=>t.id)]).sort(),[
  ['engineering',['C:p1:material.durability']],['use',['C:p1:usability.controls']]
 ]);
 assert.deepEqual(calls.find(c=>c.kind==='rescore').targets.map(t=>t.id),['material.durability']);
 const [change]=report.trace.scoreRevisions;
 assert.equal(change.before.score,92);
 assert.equal(change.after.score,null);
 assert.equal(change.auditBefore.status,'insufficient');
 assert.equal(change.auditAfter.status,'supported');
 assert.deepEqual(new Set(report.trace.claimRevisions.map(x=>x.auditBefore.status)),new Set(['insufficient','contradicted']));
 assert.equal(report.trace.claimRevisions[0].before.explanation,'产品局部判断');
 assert.equal(report.annotations.find(x=>x.itemId==='material.durability').score,null);
 assert.equal(report.annotations.find(x=>x.itemId==='usability.controls').score,80);
 assert.equal(report.annotations.find(x=>x.itemId==='usability.controls').status,'supported');
 assert.equal(report.annotations.find(x=>x.itemId==='design.language').status,'supported');
});

test('未知引用或二审仍矛盾时撤下结论并暂缓发布子项评分',async()=>{
 const report=await runReview(validateInput(input),async job=>{
  const result=respond(job);
  if(job.kind==='score')result.ratings.find(x=>x.id==='usability.controls').evidenceIds=['fake'];
  if(job.kind==='explain'&&job.group.id==='use')result.notes.find(x=>x.itemId==='usability.controls').evidenceIds=['fake'];
  if(job.kind==='audit'&&job.round===2)for(const verdict of result.verdicts)Object.assign(verdict,{status:'contradicted',reason:'与证据不一致'});
  return result;
 });
 const claim=report.annotations.find(n=>n.itemId==='usability.controls');
 const rating=report.dimensions.find(d=>d.id==='usability').items.find(i=>i.id==='usability.controls');
 assert.equal(rating.score,null);
 assert.equal(rating.audit.status,'contradicted');
 assert.equal(claim.status,'contradicted');
 assert.equal(claim.explanation,null);
 assert.equal(report.trace.scoreRevisions[0].before.score,80);
 assert.equal(report.trace.claimRevisions[0].auditBefore.status,'insufficient');
});

test('拒绝无效图片及不完整的评分、解释或审核',async()=>{
 assert.throws(()=>validateInput({image:'data:image/png;base64,YWJj'}),/图片/);
 await assert.rejects(runReview(validateInput(input),async job=>({...respond(job),ratings:[]})),/子项/);
 await assert.rejects(runReview(validateInput(input),async job=>job.kind==='explain'?{notes:[]}:respond(job)),/子项/);
 await assert.rejects(runReview(validateInput(input),async job=>job.kind==='audit'?{verdicts:[]}:respond(job)),/审核/);
 await assert.rejects(runReview(validateInput(input),async job=>job.kind==='explain'?{notes:respond(job).notes.map(n=>({...n,partId:null}))}:respond(job)),/部位解释不完整/);
});

test('可定位的相关测试证据允许性能评分，并保留用户提交来源',async()=>{
 const report=await runReview(validateInput({...input,testResults:'48 小时盐雾试验无锈蚀，达到无可见锈蚀要求。'}),async job=>{
  const result=respond(job);
  if(job.kind==='score')Object.assign(result.ratings.find(r=>r.id==='material.durability'),{
   score:70,basis:'48 小时盐雾试验达到无可见锈蚀要求',evidenceIds:['T1']
  });
  if(job.kind==='explain'&&job.group.id==='engineering')Object.assign(result.notes.find(n=>n.itemId==='material.durability'),{
   conclusion:'finding',explanation:'用户提交的 48 小时盐雾测试显示该部位无可见锈蚀。',evidenceIds:['R:p1','T1']
  });
  return result;
 });
 const claim=report.annotations.find(x=>x.itemId==='material.durability');
 assert.equal(claim.score,70);
 assert.equal(claim.status,'supported');
 assert.deepEqual(claim.evidenceIds,['R:p1','T1']);
 assert.equal(report.trace.scoreRevisions.length,0);
 assert.match(report.evidence.find(e=>e.id==='T1').label,/用户提交/);
});

test('复评不能添加未被退回的论点或评分子项',async()=>{
 const disputed=kind=>async job=>{
  const result=respond(job);
  if(job.kind==='audit'&&job.round===1){
   const id=kind==='revise'?'C:p1:usability.controls':'usability.controls';
   const verdict=result.verdicts.find(v=>v.id===id);
   if(verdict)Object.assign(verdict,{status:'contradicted',reason:'需复核'});
  }
  if(job.kind===kind&&kind==='revise')result.notes.push({...result.notes[0],partId:null});
  if(job.kind===kind&&kind==='rescore')result.ratings.push({...result.ratings[0],id:'usability.signage'});
  return result;
 };
 await assert.rejects(runReview(validateInput(input),disputed('revise')),/只能返回原专家被质疑的论点/);
 await assert.rejects(runReview(validateInput(input),disputed('rescore')),/评分模型返回的子项/);
});

test('评分与定位并行，评分输出不包含部位且定位结果进入裁切和解释',async()=>{
 const calls=[];
 const gate=Promise.withResolvers();
 const review=runReview(validateInput(input),async job=>{
  calls.push(job);
  if(job.kind==='score'){
   await gate.promise;
   return respond(job);
  }
  return respond(job);
 },{prepareCrops:async(image,parts)=>{
  assert.equal(image,input.image);
  assert.deepEqual(parts,[part]);
  return {p1:'data:image/jpeg;base64,fixture'};
 }});
 await new Promise(resolve=>setImmediate(resolve));
 const firstCalls=calls.map(job=>job.kind);
 gate.resolve();
 const report=await review;
 assert.deepEqual(firstCalls,['score','locate']);
 assert.deepEqual(report.parts,[part]);
 assert.equal(report.localization.status,'located');
 assert.ok(!calls[0].evidence.some(e=>e.type==='region'));
 assert.ok(calls.find(job=>job.kind==='explain'&&job.group.id==='use').images.some(image=>image.id==='R:p1'));
});

test('定位无结果、返回越界或服务异常时仍发布整体分析，不生成热点',async()=>{
 const scenarios=[
  ['no_parts',()=>({parts:[]})],
  ['unavailable',()=>({parts:[{...part,region:{x:.96,y:.4,w:.2,h:.1}}]})],
  ['unavailable',()=>{throw new Error('定位服务异常');}]
 ];
 for(const [status,locate] of scenarios){
  const report=await runReview(validateInput(input),async job=>{
   if(job.kind==='locate')return locate();
   const result=respond(job);
   if(job.kind==='score')return {...result,parts:[part]};
   return result;
  });
  assert.equal(report.localization.status,status);
  assert.deepEqual(report.parts,[]);
  assert.ok(report.annotations.every(n=>n.partId===null));
  assert.equal(report.dimensions.find(d=>d.id==='usability').score,80);
 }
});

test('初评分不能引用未发给评分模型的区域，定向复核可以使用相应裁切',async()=>{
 const calls=[];
 const report=await runReview(validateInput(input),async job=>{
  calls.push(job);
  const result=respond(job);
  if(job.kind==='score')result.ratings.find(r=>r.id==='usability.controls').evidenceIds=['R:p1'];
  if(job.kind==='rescore')return {ratings:[{id:'usability.controls',score:80,basis:'已核对控制件区域',evidenceIds:['R:p1']}]};
  return result;
 },{prepareCrops:async()=>({p1:'data:image/jpeg;base64,fixture'})});
 const [change]=report.trace.scoreRevisions;
 assert.deepEqual(change.before.invalidEvidenceIds,['R:p1']);
 assert.equal(change.auditBefore.status,'insufficient');
 assert.deepEqual(change.after.evidenceIds,['R:p1']);
 assert.equal(change.auditAfter.status,'supported');
 assert.deepEqual(calls.find(job=>job.kind==='rescore').images.map(image=>image.id),['R:p1']);
});
