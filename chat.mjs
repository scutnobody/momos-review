const validId=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/;
const within=(text,max)=>typeof text==='string'&&text.length<=max&&text.trim().length>0;

export function validateChat(body){
 const {reviewId,partId=null,question,history=[]}=body??{};
 if(typeof reviewId!=='string'||reviewId.length!==36||!validId.test(reviewId)){
  throw new Error('评审编号无效，请重新打开评审结果。');
 }
 if(partId!==null&&!within(partId,24))throw new Error('部位编号无效。');
 if(!within(question,1000))throw new Error('请输入 1–1000 字的问题。');
 if(!Array.isArray(history)||history.length>6||history.some(turn=>!within(turn?.question,1000)||!within(turn?.answer,1500))){
  throw new Error('对话历史格式或长度无效。');
 }
 return {reviewId,partId,question:question.trim(),history:history.map(({question,answer})=>({question,answer}))};
}

export async function askReview(report,part,{question,history},invoke){
 const evidence=report.evidence.filter(e=>!part||e.type!=='region'||e.partId===part.id);
 const ids=new Set(evidence.map(e=>e.id));
 const refs=entry=>(entry.evidenceIds??[]).filter(id=>ids.has(id));
 const dimensions=report.dimensions.filter(d=>!part||part.dimensions.includes(d.id)).map(d=>({
  id:d.id,label:d.label,score:d.score,basis:d.basis,
  items:d.items.map(i=>({
   id:i.id,name:i.name,score:i.score,basis:i.basis,unassessable:i.unassessable,audit:i.audit,
   evidenceIds:refs(i)
  }))
 }));
 const annotations=report.annotations.filter(n=>!part||n.partId===part.id).map(n=>({
  partId:n.partId,itemId:n.itemId,title:n.title,score:n.score,explanation:n.explanation,
  suggestion:n.suggestion,status:n.status,auditReason:n.auditReason,evidenceIds:refs(n)
 }));
 const reply=await invoke({kind:'chat',product:report.product,part,question,history,dimensions,annotations,evidence});
 if(!within(reply?.answer,1500)||!Array.isArray(reply.evidenceIds)||reply.evidenceIds.length>12||reply.evidenceIds.some(id=>!ids.has(id))){
  throw new Error('Agent 回复格式或证据引用无效，请重试。');
 }
 return {answer:reply.answer.trim(),evidenceIds:[...new Set(reply.evidenceIds)]};
}
