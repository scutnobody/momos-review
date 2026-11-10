import { DIMENSIONS, GROUPS } from '../rubric.mjs';

export const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE9sAAAAASUVORK5CYII=';
export const part = {id:'p1',name:'控制旋钮',region:{x:.3,y:.4,w:.3,h:.3},dimensions:['utility','material']};
export const input = {image,projectName:'灯具方案 A',designGoals:'为书写提供照明。',focusItemIds:['F2','S1'],brief:'第一段。\n\n第二段。',parameters:[{name:'牌号',value:'304'}],testResults:'盐雾 48 小时无锈蚀'};
export const allItems = DIMENSIONS.flatMap(d=>d.items);
export const baseScore = id=>({
 id,score:id==='S2'||id==='F4'?null:4,
 basis:'量表依据',evidenceIds:['IMG']
});
export const note = id=>({
 itemId:id,partId:['F2','S2'].includes(id)?'p1':null,
 title:'专家判断',severity:'attention',explanation:'产品局部判断',
 evidenceIds:[['F2','S2'].includes(id)?'R:p1':'IMG'],
 conclusion:id==='S2'?'limit':'finding',suggestion:'补充实验',score:99
});
export function respond(job) {
 if(job.kind==='score')return {product:'台灯',ratings:allItems.map(i=>baseScore(i.id))};
 if(job.kind==='locate')return {parts:[part]};
 if(job.kind==='explain'){
  const group = GROUPS.find(g=>g.id===job.group.id);
  return {notes:DIMENSIONS.filter(d=>group.dimensions.includes(d.id)).flatMap(d=>d.items).map(i=>{
   const entry=note(i.id);
   return entry.partId&&!job.parts.some(p=>p.id===entry.partId)?{...entry,partId:null,evidenceIds:['IMG']}:entry;
  })};
 }
 if(job.kind==='audit')return {verdicts:job.targets.map(t=>({id:t.id,status:'supported',reason:'符合资料'}))};
 if(job.kind==='rescore')return {ratings:job.targets.map(t=>({...t,score:null,basis:'缺少性能试验',evidenceIds:[]}))};
 if(job.kind==='revise')return {notes:job.targets.map(t=>({...t,explanation:'目前无法确认',conclusion:'limit',evidenceIds:[]}))};
 throw new Error(job.kind);
}
