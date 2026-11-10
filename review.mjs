import { createHash, randomUUID } from 'node:crypto';
import { DIMENSIONS, GROUPS, RUBRIC_VERSION } from './rubric.mjs';

const items = new Map(DIMENSIONS.flatMap(d=>d.items.map(item=>[item.id,{...item,dimension:d.id}])));
const str = (v,n=400)=>typeof v==='string'?v.trim().slice(0,n):'';
const severity = new Set(['risk','attention','ok','unknown']);
const statuses = new Set(['supported','contradicted','insufficient']);

export function validateInput(value){
 const image=value?.image;
 const m=typeof image==='string'&&/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
 if(!m||m[2].length>8_000_000||m[2].length%4)throw new Error('请上传 6 MB 以内的 JPG、PNG 或 WebP 图片。');
 const b=Buffer.from(m[2],'base64');
 const good=m[1]==='png'?b.length>=33&&b.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):m[1]==='jpeg'?b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255:b.length>=20&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
 if(!good)throw new Error('图片内容与格式不符。');
 const parameters=value.parameters??[];
 if(!Array.isArray(parameters)||parameters.length>20||parameters.some(p=>!str(p?.name,80)||!str(p?.value,300))){
  throw new Error('请填写有效的参数名和参数值，最多 20 项。');
 }
 return {
  image,brief:str(value.brief,1500),testResults:str(value.testResults,3000),
  parameters:parameters.map(p=>({name:str(p.name,80),value:str(p.value,300)}))
 };
}

function parseParts(raw){
 if(!Array.isArray(raw)||raw.length>10)throw new Error('定位 Agent 返回的部位清单无效。');
 const ids=new Set();
 return raw.map(p=>{
  const {x,y,w,h}=p?.region??{};
  if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||x>=1||y>=1||w<=0||h<=0||x+w>1.000001||y+h>1.000001){
   throw new Error('模型返回的部位坐标不在图片范围内。');
  }
  if(typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,24}$/.test(p.id)||p.id==='general'||ids.has(p.id)||!str(p.name)){
   throw new Error('模型返回的部位标识无效。');
  }
  ids.add(p.id);
  const dimensions=Array.isArray(p.dimensions)?[...new Set(p.dimensions)]:[];
  if(!dimensions.length||dimensions.some(id=>!DIMENSIONS.some(d=>d.id===id))){
   throw new Error('模型返回的部位维度无效。');
  }
  return {id:p.id,name:str(p.name,45),region:{x,y,w:Math.min(w,1-x),h:Math.min(h,1-y)},dimensions};
 });
}

function evidenceCatalog(input,parts=[]){
 const paragraphs=(value,prefix,type,label)=>(value??'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
  .map((text,index)=>({id:prefix+(index+1),type,label:label+(index+1),text}));
 return [
  {id:'IMG',type:'image',label:'原始产品图'},
  ...parts.map(p=>({id:'R:'+p.id,type:'region',label:p.name,partId:p.id,region:p.region})),
  ...paragraphs(input.brief,'D','description','设计说明段落 '),
  ...(input.parameters??[]).map((p,i)=>({id:'P'+(i+1),type:'parameter',label:p.name,text:p.value})),
  ...paragraphs(input.testResults,'T','test','用户提交的测试记录段落 ')
 ];
}

function refs(raw,evidence){
 if(!Array.isArray(raw)||raw.length>12||raw.some(id=>typeof id!=='string'||id.length>80)){
  throw new Error('模型返回的证据引用格式无效。');
 }
 const ids=[...new Set(raw)];
 return {evidenceIds:ids.filter(id=>evidence.has(id)),invalidEvidenceIds:ids.filter(id=>!evidence.has(id))};
}

function exactRows(raw,ids,message){
 if(!Array.isArray(raw)||raw.length!==ids.length)throw new Error(message);
 const rows=new Map(raw.map(row=>[row?.id,row]));
 if(rows.size!==ids.length||ids.some(id=>!rows.has(id)))throw new Error(message);
 return ids.map(id=>rows.get(id));
}

function parseRatings(raw,ids,evidence){
 return exactRows(raw,ids,'评分模型返回的子项缺失、重复或越权。').map(r=>{
  if(!(r.score===null||(Number.isInteger(r.score)&&r.score>=0&&r.score<=100))||!str(r.basis)){
   throw new Error('评分模型返回的子项评分或依据无效。');
  }
  return {id:r.id,score:r.score,basis:str(r.basis,650),...refs(r.evidenceIds,evidence)};
 });
}

function parseNotes(raw,group,parts,evidence,prior){
 if(!Array.isArray(raw)||raw.length>60)throw new Error('解释 Agent 返回的子项格式无效。');
 const seen=new Set();
 const notes=raw.map(n=>{
  const item=items.get(n?.itemId);
  const part=n?.partId===null?null:parts.find(p=>p.id===n?.partId);
  if(!item||!group.dimensions.includes(item.dimension)||part===undefined||(part&&!part.dimensions.includes(item.dimension))){
   throw new Error('解释 Agent 引用了不属于自身的子项或无效部位。');
  }
  const id='C:'+(part?.id??'general')+':'+item.id;
  if(seen.has(id)||!str(n.explanation)||!['finding','limit'].includes(n.conclusion)){
   throw new Error('解释 Agent 返回的子项论点无效或重复。');
  }
  seen.add(id);
  return {
   id,itemId:item.id,dimension:item.dimension,partId:part?.id??null,expert:group.id,expertLabel:group.label,
   title:str(n.title,65)||item.name,severity:severity.has(n.severity)?n.severity:'unknown',
   explanation:str(n.explanation,700),conclusion:n.conclusion,suggestion:str(n.suggestion,400),
   ...refs(n.evidenceIds,evidence)
  };
 });
 if(prior)return exactRows(notes,prior.map(n=>n.id),'复评只能返回原专家被质疑的论点，且不得缺漏。');
 const covered=new Set(notes.map(n=>n.itemId));
 if([...items.values()].some(i=>group.dimensions.includes(i.dimension)&&!covered.has(i.id))){
  throw new Error('解释 Agent 未覆盖分配给它的全部子项。');
 }
 return notes;
}

function enforceEvidence(target,verdict,evidence){
 if(verdict.status==='contradicted')return verdict;
 const isClaim=target.itemId!==undefined;
 const item=items.get(target.itemId??target.id);
 const makesAssertion=isClaim?target.conclusion==='finding':target.score!==null;
 const sources=target.evidenceIds.map(id=>evidence.get(id));
 let gateReason='';
 if(target.invalidEvidenceIds.length)gateReason='引用了证据目录中不存在的编号。';
 else if(makesAssertion&&!sources.length)gateReason='结论没有可追溯的证据引用。';
 else if(makesAssertion&&item.requiredEvidence.length&&!sources.some(e=>item.requiredEvidence.includes(e.type))){
  gateReason='引用未包含子项要求的资料。'+item.unassessable;
 }else if(isClaim&&makesAssertion&&target.partId&&!sources.some(e=>e.partId===target.partId)){
  gateReason='部位结论没有引用该部位的图像区域。';
 }
 return gateReason?{...verdict,status:'insufficient',reason:gateReason,modelVerdict:verdict}:verdict;
}

function publishedDimensions(ratings,audits){
 return DIMENSIONS.map(d=>{
  const result=d.items.map(i=>{
   const {score,basis,evidenceIds}=ratings.get(i.id);
   const audit=audits.get(i.id);
   return {...i,score:audit.status==='supported'?score:null,
    basis:audit.status==='supported'?basis:'评分依据未通过审核，暂缓发布。',evidenceIds,audit};
  });
  const scores=result.filter(i=>i.score!==null).map(i=>i.score);
  return {...d,items:result,score:scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null,
   basis:'已发布 '+scores.length+' / '+result.length+' 个子项；维度分为已发布子项的等权平均。'};
 });
}

export async function runReview(input,invoke,{prepareCrops=async()=>({}),onProgress=()=>{}}={}){
 const call=async(kind,data)=>invoke({kind,input,...data});
 onProgress('score');
 const baseEvidence=evidenceCatalog(input);
 const [first,{parts,status:localizationStatus}]=await Promise.all([
  call('score',{rubric:DIMENSIONS,evidence:baseEvidence}),
  call('locate',{dimensions:DIMENSIONS.map(({id,label})=>({id,label}))})
   .then(raw=>{
    const parts=parseParts(raw?.parts);
    return {parts,status:parts.length?'located':'no_parts'};
   })
   .catch(()=>({parts:[],status:'unavailable'}))
 ]);
 const evidence=evidenceCatalog(input,parts);
 const byEvidence=new Map(evidence.map(e=>[e.id,e]));
 const initialRatings=parseRatings(first?.ratings,[...items.keys()],new Map(baseEvidence.map(e=>[e.id,e])));
 const ratings=new Map(initialRatings.map(r=>[r.id,r]));
 const crops=await prepareCrops(input.image,parts);
 const rubricFor=group=>DIMENSIONS.filter(d=>group.dimensions.includes(d.id));
 const partsFor=group=>parts.filter(p=>p.dimensions.some(d=>group.dimensions.includes(d)));
 const modelContext=(partIds)=>({
  evidence:evidence.filter(e=>e.type!=='region'||partIds.has(e.partId)),
  images:parts.filter(p=>partIds.has(p.id)&&crops[p.id]).map(p=>({id:'R:'+p.id,url:crops[p.id]}))
 });
 const evidenceFor=targets=>modelContext(new Set(targets.flatMap(t=>[
  ...t.evidenceIds.map(id=>byEvidence.get(id)?.partId).filter(Boolean),...(t.partId?[t.partId]:[])
 ])));
 const audit=async(group,targets,round)=>{
  if(!targets.length)return [];
  const ids=new Set(targets.map(t=>t.itemId??t.id));
  const raw=await call('audit',{group,round,targets,rubric:[...ids].map(id=>items.get(id)),...evidenceFor(targets)});
  return exactRows(raw?.verdicts,targets.map(t=>t.id),'审核 Agent 必须逐条返回完整、唯一的审核结果。').map((v,index)=>{
   if(!statuses.has(v.status)||!str(v.reason))throw new Error('审核 Agent 返回的状态或理由无效。');
   return enforceEvidence(targets[index],{id:v.id,status:v.status,reason:str(v.reason,600)},byEvidence);
  });
 };

 onProgress('explain');
 const initialNotes=(await Promise.all(GROUPS.map(async group=>{
  const groupParts=partsFor(group);
  const groupRatings=initialRatings.filter(r=>group.dimensions.includes(items.get(r.id).dimension));
  const relevantParts=new Set(groupParts.map(p=>p.id));
  const result=await call('explain',{group,ratings:groupRatings,parts:groupParts,rubric:rubricFor(group),...modelContext(relevantParts)});
  return parseNotes(result?.notes,group,groupParts,byEvidence);
 }))).flat();
 if(parts.some(p=>!initialNotes.some(n=>n.partId===p.id)))throw new Error('部位解释不完整，请重试。');

 const owner=(group,target)=>group.dimensions.includes(items.get(target.itemId??target.id).dimension);
 const initialTargets=[...initialRatings,...initialNotes];
 const auditAll=async(targets,round)=>(await Promise.all(GROUPS.map(group=>audit(group,targets.filter(t=>owner(group,t)),round)))).flat();
 onProgress('audit');
 const firstAudit=new Map((await auditAll(initialTargets,1)).map(v=>[v.id,v]));
 const disputed=initialTargets.filter(t=>firstAudit.get(t.id).status!=='supported');
 const disputedRatings=disputed.filter(t=>t.itemId===undefined);
 const disputedNotes=disputed.filter(t=>t.itemId!==undefined);
 const auditReasons=targets=>targets.map(t=>firstAudit.get(t.id));
 let rerated=[],revised=[];
 if(disputed.length)onProgress('revise');
 if(disputedRatings.length){
  const affectedItems=disputedRatings.map(t=>items.get(t.id));
  const affectedDimensions=new Set(affectedItems.map(i=>i.dimension));
  const context=modelContext(new Set(parts.filter(p=>p.dimensions.some(d=>affectedDimensions.has(d))).map(p=>p.id)));
  const raw=await call('rescore',{targets:disputedRatings,issues:auditReasons(disputedRatings),rubric:affectedItems,...context});
  rerated=parseRatings(raw?.ratings,disputedRatings.map(t=>t.id),new Map(context.evidence.map(e=>[e.id,e])));
  for(const r of rerated)ratings.set(r.id,r);
 }
 revised=(await Promise.all(GROUPS.map(async group=>{
  const targets=disputedNotes.filter(n=>n.expert===group.id);
  if(!targets.length)return [];
  const relevantRatings=[...new Set(targets.map(n=>n.itemId))].map(id=>ratings.get(id));
  const raw=await call('revise',{group,targets,issues:auditReasons(targets),ratings:relevantRatings,
   rubric:relevantRatings.map(r=>items.get(r.id)),...evidenceFor([...targets,...relevantRatings])});
  return parseNotes(raw?.notes,group,partsFor(group),byEvidence,targets);
 }))).flat();

 const rechecked=await auditAll([...rerated,...revised],2);
 const secondAudit=new Map(rechecked.map(v=>[v.id,v]));
 const finalAudits=new Map([...firstAudit,...secondAudit]);
 const notes=new Map([...initialNotes,...revised].map(n=>[n.id,n]));
 const dimensions=publishedDimensions(ratings,finalAudits);
 const releasedScores=new Map(dimensions.flatMap(d=>d.items.map(i=>[i.id,i.score])));
 const annotations=[...notes.values()].map(n=>{
  const {status,reason}=finalAudits.get(n.id);
  return {...n,score:releasedScores.get(n.itemId),status,auditReason:reason,
   ...(status!=='supported'?{title:items.get(n.itemId).name,explanation:null,suggestion:'',severity:'unknown'}:{})};
 });
 const revisions=(before,after)=>{
  const old=new Map(before.map(x=>[x.id,x]));
  return after.map(x=>({id:x.id,before:old.get(x.id),after:x,auditBefore:firstAudit.get(x.id),auditAfter:secondAudit.get(x.id)}));
 };
 return {
  id:randomUUID(),createdAt:new Date().toISOString(),source:'model',rubricVersion:RUBRIC_VERSION,
  imageHash:createHash('sha256').update(Buffer.from(input.image.split(',')[1],'base64')).digest('hex'),
  product:str(first.product,65)||'上传产品',dimensions,parts,localization:{status:localizationStatus},evidence,annotations,
  trace:{initial:{ratings:initialRatings,claims:initialNotes,audits:[...firstAudit.values()]},
   scoreRevisions:revisions(initialRatings,rerated),claimRevisions:revisions(initialNotes,revised)}
 };
}
