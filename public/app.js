import {demo} from './demo.js';
import {setupReviewChat} from './chat.js';
const el=id=>document.getElementById(id);
const create=(tag,className,text)=>{const x=document.createElement(tag);if(className)x.className=className;if(text!==undefined)x.textContent=text;return x;};
const level={risk:'问题',attention:'关注',ok:'表现良好',unknown:'待核验'};
const auditNames={supported:'有支持',contradicted:'与证据矛盾',insufficient:'信息不足'};
const evidenceTypes={image:'原图观察',region:'图像区域',description:'用户说明',parameter:'用户声明参数',test:'用户提交测试'};
const scoreText=score=>score===null?'暂不评分':score+' / 100';
function disclosure(title,className){
 const node=create('details',className);
 node.append(create('summary','',title));
 return node;
}
function cropPreview(source){
 const canvas=create('canvas','evidence-crop');
 canvas.setAttribute('role','img');canvas.setAttribute('aria-label',source.label+'局部图');
 const original=new Image();
 original.onload=()=>{
  const {x,y,w,h}=source.region, iw=original.naturalWidth, ih=original.naturalHeight;
  const left=Math.floor(x*iw),top=Math.floor(y*ih);
  const width=Math.max(1,Math.min(iw,Math.ceil((x+w)*iw))-left);
  const height=Math.max(1,Math.min(ih,Math.ceil((y+h)*ih))-top);
  const scale=Math.min(1,320/Math.max(width,height));
  canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
  canvas.getContext('2d').drawImage(original,left,top,width,height,0,0,canvas.width,canvas.height);
 };
 original.onerror=()=>canvas.replaceWith(create('p','','该区域预览不可用。'));
 original.src=imageSrc;
 return canvas;
}
function evidenceList(ids){
 const details=disclosure('证据来源 · '+ids.length,'evidence-list');
 for(const id of ids){
  const source=report.evidence?.find(e=>e.id===id);
  if(!source)continue;
  const entry=create('div','evidence-entry');
  entry.append(create('strong','',source.id+' · '+evidenceTypes[source.type]+' · '+source.label));
  if(source.text)entry.append(create('p','',source.text));
  if(source.region)entry.append(cropPreview(source));
  if(source.type==='image'){
   const thumbnail=create('img','evidence-crop');
   thumbnail.src=imageSrc;thumbnail.alt='评审原图';thumbnail.loading='lazy';entry.append(thumbnail);
  }
  details.append(entry);
 }
 return details;
}
function historyPanel(change,score){
 const details=disclosure(score?'评分复核记录':'论点复核记录','review-history');
 for(const [label,version,audit] of [['初评',change.before,change.auditBefore],['复评',change.after,change.auditAfter]]){
  const content=score?scoreText(version.score)+' · '+version.basis:version.explanation;
  details.append(create('strong','',label+' · '+auditNames[audit.status]),create('p','',content),create('p','','审核意见：'+audit.reason));
  if(version.evidenceIds.length)details.append(evidenceList(version.evidenceIds));
 }
 return details;
}
function claimPanel(note){
 const article=create('article','claim');
 const item=report.dimensions.find(d=>d.id===note.dimension)?.items?.find(i=>i.id===note.itemId);
 const label=create('div','detail-label');
 label.append(create('span','',(note.expertLabel?note.expertLabel+' · ':'')+(item?.name??note.title)));
 const verdict=note.status==='demo'?'示例说明':auditNames[note.status];
 label.append(create('span','verdict '+note.status,verdict));
 article.append(label,create('h4','',note.title));
 if(note.score!==undefined)article.append(create('p','claim-score','对应子项 '+scoreText(note.score)));
 article.append(create('p','',note.explanation??'该结论未通过证据审核，已撤回。'));
 if(note.evidence)article.append(create('p','',note.evidence));
 if(note.evidenceIds?.length)article.append(evidenceList(note.evidenceIds));
 if(note.suggestion)article.append(create('h4','','改进建议'),create('p','',note.suggestion));
 if(note.auditReason)article.append(create('h4','','审核意见'),create('p','',note.auditReason));
 const change=report.trace?.claimRevisions.find(x=>x.id===note.id);
 if(change)article.append(historyPanel(change,false));
 return article;
}
let report=demo, imageSrc='/lamp.svg', selected='joint', view='points', ready=false, file=null, preview='', busy=false;
const chat=setupReviewChat(evidenceList);
el('open-chat').onclick=()=>chat.open();
const stage=document.querySelector('.stage'), image=el('product-image'), dialog=el('upload-dialog');
function sizeImage(){
 if(!image.naturalWidth||!stage.clientWidth)return;
 const ratio=image.naturalWidth/image.naturalHeight;
 const width=Math.min(stage.clientWidth,stage.clientHeight*ratio);
 el('viewport').style.width=width+'px';
 el('viewport').style.aspectRatio=String(ratio);
}
new ResizeObserver(sizeImage).observe(stage);
image.addEventListener('load',sizeImage);
function setImage(src,alt){
 if(imageSrc!==src&&imageSrc.startsWith('blob:'))URL.revokeObjectURL(imageSrc);
 imageSrc=src;image.src=src;image.alt=alt;
}
function getParts(){
 return report.parts.filter(p=>report.annotations.some(n=>n.partId===p.id)).map(p=>{
  const notes=report.annotations.filter(n=>n.partId===p.id);
  return {...p,notes,severity:['risk','attention','unknown','ok'].find(s=>notes.some(n=>(['contradicted','insufficient'].includes(n.status)?'unknown':n.severity)===s))??'unknown'};
 });
}
function renderDetail(parts){
 const target=el('detail');target.replaceChildren();
 const active=parts.find(p=>p.id===selected);
 if(!active)return;
 const heading=create('div','part-detail-head');
 const ask=create('button','text-button','问这个部位');ask.type='button';
 ask.setAttribute('aria-haspopup','dialog');ask.onclick=()=>chat.open(active.id);
 heading.append(create('h3','',active.name),ask);
 target.append(heading);
 for(const note of active.notes)target.append(claimPanel(note));
}
function select(id){
 selected=id;
 for(const b of document.querySelectorAll('[data-part]'))b.setAttribute('aria-pressed',String(b.dataset.part===id));
 renderDetail(getParts());
}
function renderParts(){
 const list=el('parts'),pins=el('pins');list.replaceChildren();pins.replaceChildren();
 const parts=getParts();
 if(!parts.some(p=>p.id===selected))selected=parts[0]?.id??null;
 el('point-count').textContent=String(parts.length).padStart(2,'0')+' 个可定位部位';
 if(!parts.length){
  const message=report.localization?.status==='unavailable'
   ?'部位定位暂不可用。本次仍提供维度评分及整体分析。'
   :'未能可靠定位具体部位，请查看维度评分及整体分析。';
  list.append(create('p','detail',message));
 }
 for(const [i,p] of parts.entries()){
  const n=String(i+1).padStart(2,'0');
  const pin=create('button','pin '+p.severity,n);
  pin.type='button';pin.dataset.part=p.id;pin.title=p.name;pin.setAttribute('aria-label','标注 '+n+' '+p.name);pin.setAttribute('aria-pressed',String(p.id===selected));
  pin.style.left=100*(p.region.x+p.region.w/2)+'%';pin.style.top=100*(p.region.y+p.region.h/2)+'%';
  pin.onclick=()=>{select(p.id);if(matchMedia('(max-width:800px)').matches)document.querySelector('.inspector').scrollIntoView({block:'start'});};
  pins.append(pin);
  const b=create('button','part '+p.severity);
  b.type='button';b.dataset.part=p.id;b.setAttribute('aria-pressed',String(p.id===selected));b.onclick=()=>select(p.id);
  b.append(create('span','part-no',n),create('span','part-title',p.name),create('span','level',level[p.severity]),create('span','chev','›'));
  list.append(b);
 }
 renderDetail(parts);
}
function renderScores(){
 const list=el('scores');list.replaceChildren();
 for(const d of report.dimensions){
  const a=create('article','card score-card'),head=create('div'),rating=create('span','score-value'+(d.score===null?' na':''),d.score===null?'证据不足':String(d.score));
  if(d.score!==null)rating.append(create('small','',' / 100'));
  head.append(create('h3','',d.label),rating);
  const bar=create('div','bar'),fill=create('span');fill.style.width=(d.score??0)+'%';bar.append(fill);
  a.append(head,bar,create('p','',d.basis));
  for(const item of d.items??[]){
   const detail=disclosure(item.name+' · '+scoreText(item.score),'rubric-item');
   if(item.audit)detail.append(create('p','verdict '+item.audit.status,auditNames[item.audit.status]+' · '+item.audit.reason));
   detail.append(create('p','',item.basis));
   if(item.evidenceIds?.length)detail.append(evidenceList(item.evidenceIds));
   const scale=disclosure('评分锚点与不可评价条件','anchor-list');
   for(const [value,anchor] of Object.entries(item.anchors))scale.append(create('p','',value+' 分 · '+anchor));
   scale.append(create('p','','暂不评分 · '+item.unassessable));
   detail.append(scale);
   const change=report.trace?.scoreRevisions.find(x=>x.id===item.id);
   if(change)detail.append(historyPanel(change,true));
   for(const note of report.annotations.filter(n=>n.partId===null&&n.itemId===item.id))detail.append(claimPanel(note));
   a.append(detail);
  }
  list.append(a);
 }
}
function render(){
 el('product').textContent=report.product;
 el('source').textContent=report.source==='demo'?'示例评审':'模型评审';
 el('sample').hidden=report.source==='demo';
 chat.setReview(report);renderParts();renderScores();
}
function setView(next){
 view=next;el('workspace').hidden=view==='scores';
 for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));
 sizeImage();
}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
el('markers-visible').onchange=e=>{el('pins').hidden=!e.target.checked;};
el('sample').onclick=()=>{report=demo;selected='joint';setImage('/lamp.svg','ARC 01 台灯示意图');setView('points');render();};
el('download').onclick=()=>{
 const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
 const a=create('a');a.href=url;a.download='momos-'+(report.source==='demo'?'sample':'review')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
};
function status(text,error=false){el('upload-status').textContent=text;el('upload-status').classList.toggle('error',error);}
async function check(){
 try{const res=await fetch('/api/status');if(!res.ok)throw new Error();ready=(await res.json()).configured;el('connection').classList.toggle('live',ready);el('connection').innerHTML='<i></i> '+(ready?'模型已配置':'示例模式');}
 catch{ready=false;el('connection').textContent='服务未连接';}
 finally{chat.setAvailable(ready);}
}
el('upload').onclick=()=>{status(ready?'开始评审后，图片和填写的资料将发送给已配置的模型服务。':'可预览图片；生成真实评分前需配置项目 .env 并重启。');dialog.showModal();};
el('close-dialog').onclick=()=>dialog.close();
dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
function setFile(f){
 if(busy||!f)return;
 if(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>6_000_000){status('请选择 6 MB 以内的 JPG、PNG 或 WebP 图片。',true);return;}
 if(preview)URL.revokeObjectURL(preview);
 file=f;preview=URL.createObjectURL(file);
 el('upload-preview').src=preview;el('upload-preview').hidden=false;el('file-label').textContent=file.name;
 status(ready?'开始评审后，图片和填写的资料将发送给已配置的模型服务。':'尚未配置视觉模型，请参阅项目 README。');
}
el('file').onchange=e=>{setFile(e.target.files[0]);e.target.value='';};
for(const n of ['dragenter','dragover'])el('drop').addEventListener(n,e=>{e.preventDefault();el('drop').classList.add('drag');});
for(const n of ['dragleave','drop'])el('drop').addEventListener(n,e=>{e.preventDefault();el('drop').classList.remove('drag');if(n==='drop')setFile(e.dataTransfer.files[0]);});
async function normalizedImage(f){
 const bitmap=await createImageBitmap(f);
 try{
  const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=create('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  return canvas.toDataURL('image/jpeg',.9);
 }finally{bitmap.close();}
}
const parameterRows=el('parameter-rows');
function addParameter(){
 if(parameterRows.children.length>=20)return;
 const row=create('div','parameter-row');
 for(const [kind,label,max] of [['name','参数名',80],['value','参数值',300]]){
  const field=create('input');field.name=kind;field.maxLength=max;field.placeholder=label;
  field.setAttribute('aria-label',label);field.required=true;row.append(field);
 }
 const remove=create('button','close','×');remove.type='button';remove.setAttribute('aria-label','移除此参数');
 remove.onclick=()=>{row.remove();el('add-parameter').disabled=false;};
 row.append(remove);parameterRows.append(row);row.firstElementChild.focus();
 el('add-parameter').disabled=parameterRows.children.length>=20;
}
el('add-parameter').onclick=addParameter;
el('upload-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;
 if(!file){status('请先选择产品图片。',true);return;}
 if(!ready){status('尚未配置模型。请参阅 README 并重启本地服务。',true);return;}
 busy=true;el('submit').disabled=true;el('file').disabled=true;el('close-dialog').disabled=true;
 status('正在评分、定位部位并核查证据，可能需要几分钟。');
 try{
  const dataUrl=await normalizedImage(file).catch(()=>{throw new Error('无法读取这张图片，请重新导出为 JPG 或 PNG。');});
  const parameters=[...parameterRows.children].map(row=>({
   name:row.querySelector('[name=name]').value,value:row.querySelector('[name=value]').value
  }));
  const res=await fetch('/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:dataUrl,brief:el('brief').value,parameters,testResults:el('test-results').value})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'评审失败。');
  report=data;selected=null;el('markers-visible').checked=true;el('pins').hidden=false;
  setImage(dataUrl,report.product+'产品图');setView('points');render();
  dialog.close();
 }catch(e){status(e.message||'评审失败，请稍后重试。',true);}
 finally{busy=false;el('submit').disabled=false;el('file').disabled=false;el('close-dialog').disabled=false;}
};
render();sizeImage();check();
