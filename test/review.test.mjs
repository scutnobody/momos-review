import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview, validateInput } from '../review.mjs';
import { askReview } from '../chat.mjs';
import { DIMENSIONS } from '../rubric.mjs';
import { input, part, respond } from './fixtures.mjs';

test('复现专家表三维十项及逐分锚点，并建立证据目录',async()=>{
 const report=await runReview(validateInput(input),respond);
 assert.deepEqual(DIMENSIONS.map(d=>[d.label,d.items.map(i=>i.id)]),[
  ['形式与美学',['A1','A2','A3']],['功能与使用',['F1','F2','F3','F4']],['安全与实现',['S1','S2','S3']]
 ]);
 assert.equal(report.scoreMax,5);
 assert.equal(report.projectName,'灯具方案 A');
 assert.deepEqual(report.focusItemIds,['F2','S1']);
 for(const d of DIMENSIONS)for(const i of d.items) {
  assert.equal(d.items.length,d.id==='utility'?4:3);
  assert.deepEqual(Object.keys(i.anchors),['1','2','3','4','5']);
  assert.ok(i.unassessable);
 }
 assert.deepEqual(report.evidence.map(e=>[e.id,e.type]),[
  ['IMG','image'],['R:p1','region'],['D1','description'],['D2','description'],['G1','description'],['P1','parameter'],['T1','test']
 ]);
 assert.deepEqual(report.evidence[1].region,part.region);
 assert.equal(report.annotations.find(n=>n.itemId==='F2').score,4);
 assert.equal(report.trace.scoreRevisions.length,0);
});

test('仅原专家复评争议条目，评分变更由专用模型完成，保留三态与两轮历史',async()=>{
 const calls=[];
 const report=await runReview(validateInput({...input,testResults:''}),async job=>{
  calls.push(job);
  const result=respond(job);
  if(job.kind==='score')Object.assign(result.ratings.find(x=>x.id==='S2'),{score:5,basis:'用补充记录推断真实稳定性',evidenceIds:['T1']});
  if(job.kind==='audit'&&job.round===1)for(const v of result.verdicts){
   if(v.id==='C:p1:S2')Object.assign(v,{status:'insufficient',reason:'不能从图片验证实际稳定性'});
   if(v.id==='C:p1:F2')Object.assign(v,{status:'contradicted',reason:'把旋钮误判为按钮'});
  }
  return result;
 });
 assert.deepEqual(calls.filter(c=>c.kind==='revise').map(c=>[c.group.id,c.targets.map(t=>t.id)]).sort(),[
  ['engineering',['C:p1:S2']],['use',['C:p1:F2']]
 ]);
 assert.deepEqual(calls.find(c=>c.kind==='rescore').targets.map(t=>t.id),['S2']);
 const [change]=report.trace.scoreRevisions;
 assert.equal(change.before.score,5);
 assert.equal(change.after.score,null);
 assert.equal(change.auditBefore.status,'insufficient');
 assert.equal(change.auditAfter.status,'supported');
 assert.deepEqual(new Set(report.trace.claimRevisions.map(x=>x.auditBefore.status)),new Set(['insufficient','contradicted']));
 assert.equal(report.trace.claimRevisions[0].before.explanation,'产品局部判断');
 assert.equal(report.annotations.find(x=>x.itemId==='S2').score,null);
 assert.equal(report.annotations.find(x=>x.itemId==='F2').score,4);
 assert.equal(report.annotations.find(x=>x.itemId==='F2').status,'supported');
 assert.equal(report.annotations.find(x=>x.itemId==='A2').status,'supported');
});

test('未知引用或二审仍矛盾时撤下结论并暂缓发布子项评分',async()=>{
 const report=await runReview(validateInput(input),async job=>{
  const result=respond(job);
  if(job.kind==='score')result.ratings.find(x=>x.id==='F2').evidenceIds=['fake'];
  if(job.kind==='explain'&&job.group.id==='use')result.notes.find(x=>x.itemId==='F2').evidenceIds=['fake'];
  if(job.kind==='audit'&&job.round===2)for(const verdict of result.verdicts)Object.assign(verdict,{status:'contradicted',reason:'与证据不一致'});
  return result;
 });
 const claim=report.annotations.find(n=>n.itemId==='F2');
 const rating=report.dimensions.find(d=>d.id==='utility').items.find(i=>i.id==='F2');
 assert.equal(rating.score,null);
 assert.equal(rating.audit.status,'contradicted');
 assert.equal(claim.status,'contradicted');
 assert.equal(claim.explanation,null);
 assert.equal(report.trace.scoreRevisions[0].before.score,4);
 assert.equal(report.trace.claimRevisions[0].auditBefore.status,'insufficient');
});

test('拒绝无效图片及不完整的评分、解释或审核',async()=>{
 assert.throws(()=>validateInput({image:'data:image/png;base64,YWJj'}),/图片/);
 await assert.rejects(runReview(validateInput(input),async job=>({...respond(job),ratings:[]})),/子项/);
 await assert.rejects(runReview(validateInput(input),async job=>job.kind==='explain'?{notes:[]}:respond(job)),/子项/);
 await assert.rejects(runReview(validateInput(input),async job=>job.kind==='audit'?{verdicts:[]}:respond(job)),/审核/);
 await assert.rejects(runReview(validateInput(input),async job=>job.kind==='explain'?{notes:respond(job).notes.map(n=>({...n,partId:null}))}:respond(job)),/部位解释不完整/);
});

test('文字测试记录可留档，但初评和复评均只能引用图像',async()=>{
 const report=await runReview(validateInput({...input,testResults:'用户补充了稳定性测试。'}),async job=>{
  const result=respond(job);
  if(job.kind==='score')Object.assign(result.ratings.find(r=>r.id==='S2'),{
   score:3,basis:'引用补充测试判断实际稳定性',evidenceIds:['T1']
  });
  if(job.kind==='rescore'){
   assert.ok(job.evidence.every(e=>['image','region'].includes(e.type)));
   return {ratings:[{id:'S2',score:4,basis:'从可见底座和支撑关系判断视觉稳定线索',evidenceIds:['R:p1']}]};
  }
  return result;
 });
 const claim=report.annotations.find(x=>x.itemId==='S2');
 assert.equal(claim.score,4);
 assert.equal(claim.status,'supported');
 assert.deepEqual(report.trace.scoreRevisions[0].before.invalidEvidenceIds,['T1']);
 assert.deepEqual(report.trace.scoreRevisions[0].after.evidenceIds,['R:p1']);
 assert.match(report.evidence.find(e=>e.id==='T1').label,/用户提交/);
});

test('复评不能添加未被退回的论点或评分子项',async()=>{
 const disputed=kind=>async job=>{
  const result=respond(job);
  if(job.kind==='audit'&&job.round===1){
   const id=kind==='revise'?'C:p1:F2':'F2';
   const verdict=result.verdicts.find(v=>v.id===id);
   if(verdict)Object.assign(verdict,{status:'contradicted',reason:'需复核'});
  }
  if(job.kind===kind&&kind==='revise')result.notes.push({...result.notes[0],partId:null});
  if(job.kind===kind&&kind==='rescore')result.ratings.push({...result.ratings[0],id:'F3'});
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
 assert.deepEqual(calls[0].evidence.map(e=>e.id),['IMG']);
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
  assert.equal(report.dimensions.find(d=>d.id==='utility').score,4);
 }
});

test('初评分不能引用未发给评分模型的区域，定向复核可以使用相应裁切',async()=>{
 const calls=[];
 const report=await runReview(validateInput(input),async job=>{
  calls.push(job);
  const result=respond(job);
  if(job.kind==='score')result.ratings.find(r=>r.id==='F2').evidenceIds=['R:p1'];
  if(job.kind==='rescore')return {ratings:[{id:'F2',score:4,basis:'已核对控制件区域',evidenceIds:['R:p1']}]};
  return result;
 },{prepareCrops:async()=>({p1:'data:image/jpeg;base64,fixture'})});
 const [change]=report.trace.scoreRevisions;
 assert.deepEqual(change.before.invalidEvidenceIds,['R:p1']);
 assert.equal(change.auditBefore.status,'insufficient');
 assert.deepEqual(change.after.evidenceIds,['R:p1']);
 assert.equal(change.auditAfter.status,'supported');
 assert.deepEqual(calls.find(job=>job.kind==='rescore').images.map(image=>image.id),['R:p1']);
});

test('子项只接受 1 至 5 的整数或 null，维度均分保留一位小数',async()=>{
 const evaluate=score=>runReview(validateInput(input),async job=>{
  const result=respond(job);
  if(job.kind==='score')result.ratings.find(r=>r.id==='F2').score=score;
  return result;
 });
 const report=await evaluate(5);
 assert.equal(report.dimensions.find(d=>d.id==='utility').score,4.3);
 for(const score of [0,6,80,3.5,'4']){
  await assert.rejects(evaluate(score),/子项评分/);
 }
 const missing=await evaluate(null);
 assert.equal(missing.annotations.find(n=>n.itemId==='F2').score,null);
});

test('问答按报告中的满分解释分数，兼容未记录满分的旧报告',async()=>{
 const report=await runReview(validateInput(input),respond);
 const question={question:'评分是多少？',history:[]};
 const check=async (data,max,score)=>askReview(data,part,question,async job=>{
  assert.equal(job.scoreMax,max);
  assert.equal(job.annotations.find(n=>n.itemId==='F2').score,score);
  return {answer:'评分已列在评审记录中。',evidenceIds:[]};
 });
 await check(report,5,4);
 const historical=structuredClone(report);
 delete historical.scoreMax;
 historical.rubricVersion='route-a-1';
 historical.annotations.find(n=>n.itemId==='F2').score=80;
 await check(historical,100,80);
});

test('准备页的评审重点只交给负责该子项的解释 Agent',async()=>{
 const calls=[];
 await runReview(validateInput({...input,focusItemIds:['F2','F2','S1']}),async job=>{
  calls.push(job);
  return respond(job);
 });
 assert.deepEqual(calls.find(j=>j.kind==='explain'&&j.group.id==='use').focusItemIds,['F2']);
 assert.deepEqual(calls.find(j=>j.kind==='explain'&&j.group.id==='engineering').focusItemIds,['S1']);
 assert.deepEqual(calls.find(j=>j.kind==='explain'&&j.group.id==='design').focusItemIds,[]);
 assert.equal(calls.find(j=>j.kind==='score').focusItemIds,undefined);
 assert.throws(()=>validateInput({...input,focusItemIds:['unknown']}),/评审重点/);
});
