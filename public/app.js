import {demo} from './demo.js';
import {DIMENSIONS,REVIEW_PERSPECTIVES,reportScoreMax} from './rubric.mjs';
import {setupReviewChat} from './chat.js';
const el=id=>document.getElementById(id);
const create=(tag,className,text)=>{const x=document.createElement(tag);if(className)x.className=className;if(text!==undefined)x.textContent=text;return x;};
const level={risk:'问题',attention:'关注',ok:'表现良好',unknown:'待核验'};
const auditNames={supported:'有支持',contradicted:'与证据矛盾',insufficient:'信息不足'};
const evidenceTypes={image:'原图观察',region:'图像区域',description:'用户说明',parameter:'用户声明参数',test:'用户提交测试'};
const itemLabel=item=>/^[AFS]\d$/.test(item.id)?item.id+' '+item.name:item.name;
const scoreText=score=>score===null?'N/A · 无法判断':score+' / '+reportScoreMax(report);
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
function claimPanel(note,partName){
 const article=create('article','claim');
 const item=report.dimensions.find(d=>d.id===note.dimension)?.items?.find(i=>i.id===note.itemId);
 const label=create('div','detail-label');
 label.append(create('span','',(note.expertLabel?note.expertLabel+' · ':'')+(item?itemLabel(item):note.title)));
 const verdict=note.status==='demo'?'示例说明':auditNames[note.status];
 label.append(create('span','verdict '+note.status,verdict));
 article.append(label);
 if(note.title!==partName)article.append(create('h4','',note.title));
 if(note.score!==undefined)article.append(create('p','claim-score','对应子项 '+scoreText(note.score)));
 article.append(create('p','',note.explanation??'该结论未通过证据审核，已撤回。'));
 if(note.evidence)article.append(create('p','',note.evidence));
 if(note.evidenceIds?.length)article.append(evidenceList(note.evidenceIds));
 if(note.suggestion){
  const suggestion=disclosure('改进建议','suggestion-list');
  suggestion.append(create('p','',note.suggestion));
  article.append(suggestion);
 }
 if(note.auditReason)article.append(create('h4','','审核意见'),create('p','',note.auditReason));
 const change=report.trace?.claimRevisions.find(x=>x.id===note.id);
 if(change)article.append(historyPanel(change,false));
 return article;
}
let report=demo, imageSrc='/lamp-studio.png', selected='joint', view='points', ready=false, busy=false;
const overallChat=setupReviewChat(el('overall-chat'),evidenceList);
const partChat=setupReviewChat(el('chat-dialog'),evidenceList);
const stage=document.querySelector('.stage'), image=el('product-image');
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
 ask.setAttribute('aria-haspopup','dialog');ask.onclick=()=>partChat.open(active.id);
 heading.append(create('h3','',active.name),ask);
 target.append(heading);
 for(const note of active.notes)target.append(claimPanel(note,active.name));
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
  pin.onclick=()=>{select(p.id);if(matchMedia('(max-width:840px)').matches)document.querySelector('.inspector').scrollIntoView({block:'start'});};
  pins.append(pin);
  const b=create('button','part '+p.severity);
  b.type='button';b.dataset.part=p.id;b.setAttribute('aria-pressed',String(p.id===selected));b.onclick=()=>select(p.id);
  b.append(create('span','part-no',n),create('span','part-title',p.name),create('span','level',level[p.severity]),create('span','chev','›'));
  list.append(b);
 }
 renderDetail(parts);
}
function renderScores(){
 const list=el('score-cards'),max=reportScoreMax(report);list.replaceChildren();
 const allItems=report.dimensions.flatMap(d=>d.items??[]);
 const rated=allItems.filter(i=>i.score!==null);
 const overall=rated.length?Math.round(rated.reduce((sum,i)=>sum+i.score,0)*10/rated.length)/10:null;
 const focus=rated.reduce((lowest,item)=>!lowest||item.score<lowest.score?item:lowest,null);
 el('overall-score').textContent=overall===null?'N/A':overall+' / '+max;
 el('overall-bar').style.width=(100*(overall??0)/max)+'%';
 el('overall-coverage').textContent=rated.length+' / '+allItems.length+' 项已评分 · 子项等权';
 el('overall-focus').textContent=!focus?'待补充可见证据':focus.score===max?'已评分项均为满分':itemLabel(focus);
 for(const d of report.dimensions){
  const items=d.items??[];
  const card=create('details','card score-card'),head=create('summary','dimension-summary');
  card.open=true;
  const name=create('span','dimension-name'),rating=create('span','score-value'+(d.score===null?' na':''),d.score===null?'N/A':String(d.score));
  name.append(create('strong','',d.label),create('small','',items.filter(i=>i.score!==null).length+' / '+items.length+' 项已评分'));
  if(d.score!==null)rating.append(create('small','',' / '+max));
  const bar=create('span','bar'),fill=create('span');fill.style.width=(100*(d.score??0)/max)+'%';bar.append(fill);
  bar.setAttribute('aria-hidden','true');
  const arrow=create('span','dimension-chevron','›');arrow.setAttribute('aria-hidden','true');
  head.append(name,bar,rating,arrow);
  const body=create('div','dimension-items');
  body.append(create('p','',d.basis));
  for(const item of items){
   const detail=disclosure(itemLabel(item)+' · '+scoreText(item.score),'rubric-item');
   if(item.audit)detail.append(create('p','verdict '+item.audit.status,auditNames[item.audit.status]+' · '+item.audit.reason));
   detail.append(create('p','',item.basis));
   if(item.evidenceIds?.length)detail.append(evidenceList(item.evidenceIds));
   const scale=disclosure('评分锚点与不可评价条件','anchor-list');
   if(item.visualEvidence)scale.append(create('p','','观察重点 · '+item.visualEvidence));
   for(const [value,anchor] of Object.entries(item.anchors))scale.append(create('p','',value+' 分 · '+anchor));
   scale.append(create('p','','N/A · '+item.unassessable));
   if(item.prohibitedInference)scale.append(create('p','','推断限制 · '+item.prohibitedInference));
   detail.append(scale);
   const change=report.trace?.scoreRevisions.find(x=>x.id===item.id);
   if(change)detail.append(historyPanel(change,true));
   for(const note of report.annotations.filter(n=>n.partId===null&&n.itemId===item.id))detail.append(claimPanel(note));
   body.append(detail);
  }
  card.append(head,body);
  list.append(card);
 }
}
function render(){
 const displayName=report.projectName||report.product;
 el('product').textContent=displayName;
 el('source').textContent=report.source==='demo'?'示例评审':'模型评审';
 el('score-caption').textContent=(report.source==='demo'?'示例评分':'专用模型评分')+' · 满分 '+reportScoreMax(report);
 el('sample').hidden=report.source==='demo';
 overallChat.setReview(report);partChat.setReview(report);renderParts();renderScores();
}
const viewFromUrl=()=>location.hash==='#prepare'?'prepare':'points';
function setView(next,updateUrl=true){
 const changed=view!==next;
 view=next;
 const targetHash=next==='prepare'?'#prepare':'';
 const moved=updateUrl&&location.hash!==targetHash;
 if(moved)history.pushState(null,'',targetHash||location.pathname+location.search);
 el('prepare-page').hidden=view!=='prepare';
 el('review-page').hidden=view==='prepare';
 el('page-crumb').textContent=view==='prepare'?'建立设计':'产品评审';
 for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));
 if(!updateUrl&&location.hash==='#scores')requestAnimationFrame(()=>el('scores').scrollIntoView());
 else if(changed||moved)window.scrollTo(0,0);
 sizeImage();
}
window.addEventListener('popstate',()=>setView(viewFromUrl(),false));
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
el('markers-visible').onchange=e=>{el('pins').hidden=!e.target.checked;};
el('sample').onclick=()=>{report=demo;selected='joint';setImage('/lamp-studio.png','ARC 01 台灯示意图');setView('points');render();};
el('download').onclick=()=>{
 const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
 const a=create('a');a.href=url;a.download='momos-'+(report.source==='demo'?'sample':'review')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
};
function status(text,error=false){el('upload-status').textContent=text;el('upload-status').classList.toggle('error',error);}
async function check(){
 try{const res=await fetch('/api/status');if(!res.ok)throw new Error();const settings=await res.json();ready=settings.configured;overallChat.setAvailable(settings.chatConfigured);partChat.setAvailable(settings.chatConfigured);el('connection').classList.toggle('live',ready);el('connection').innerHTML='<i></i> '+(ready?'模型已配置':'示例模式');}
 catch{ready=false;overallChat.setAvailable(false);partChat.setAvailable(false);el('connection').textContent='服务未连接';}
}
el('upload').onclick=()=>setView('prepare');
const defaultStatus=()=>ready?'开始评审后，主图和填写的资料将发送给模型。参考文件保留在本页草稿。':'可准备资料；发起真实评审前需配置评审所需模型。';
for(const dimension of DIMENSIONS){
 for(const item of dimension.items){
  const label=create('label','focus-option');
  const option=create('input');option.type='checkbox';option.name='focusItemIds';option.value=item.id;
  label.append(option,create('span','',itemLabel(item)));
  el('focus-items').append(label);
 }
}
const perspectiveIcons={
 craft:'m4 17 12-12 3 3L7 20H4zM14 7l3 3',
 experience:'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 20v-2a7 7 0 0 1 14 0v2',
 cost:'m12 3 9 5-9 5-9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5'
};
for(const perspective of REVIEW_PERSPECTIVES){
 const label=create('label','expert-card');
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
 icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
 const path=document.createElementNS(icon.namespaceURI,'path');path.setAttribute('d',perspectiveIcons[perspective.id]);icon.append(path);
 const text=create('span','expert-text');
 text.append(create('strong','',perspective.label),create('small','',perspective.description));
 const option=create('input');option.type='checkbox';option.name='perspectiveIds';option.value=perspective.id;
 option.checked=perspective.id==='craft';
 label.append(icon,text,option);el('perspective-options').append(label);
}

const imageTypes=new Set(['image/png','image/jpeg','image/webp']);
const materialFiles=[];
const materialList=el('material-files');
const materialLimit=6;
let primaryMaterial=null;
function renderMaterials(focus){
 const scroll=materialList.scrollLeft;
 materialList.replaceChildren();
 if(!materialFiles.length){
  materialList.append(create('li','materials-empty','添加后可在这里查看文件'));
 }
 let focused;
 for(const entry of materialFiles){
  const {file,url}=entry;
  const card=create('li','file-preview');
  const media=create(url?'button':'div','file-preview-media');
  if(url){
   media.type='button';media.setAttribute('aria-label','将 '+file.name+' 设为评审主图');
   media.setAttribute('aria-pressed',String(entry===primaryMaterial));
   const img=create('img');img.src=url;img.alt='';media.append(img);
   media.onclick=()=>{if(!busy){primaryMaterial=entry;renderMaterials(entry);}};
   if(entry===focus)focused=media;
  }else{
   media.append(create('span','file-icon','PDF'));
  }
  const footer=create('div','file-preview-footer');
  const name=create('span','file-name',file.name);name.title=file.name;
  const tag=create('small','file-kind',entry===primaryMaterial?'评审主图':url?'参考图':'参考文件');
  footer.append(name,tag);
  const remove=create('button','file-remove','×');
  remove.type='button';remove.setAttribute('aria-label','移除 '+file.name);
  remove.onclick=()=>{
   if(busy)return;
   if(url)URL.revokeObjectURL(url);
   materialFiles.splice(materialFiles.indexOf(entry),1);
   if(primaryMaterial===entry)primaryMaterial=materialFiles.find(material=>material.url)??null;
   renderMaterials();
   status(defaultStatus());
  };
  card.append(media,footer,remove);materialList.append(card);
 }
 materialList.scrollLeft=scroll;
 focused?.focus({preventScroll:true});
}
function addMaterials(files,imagesOnly){
 if(busy||!files?.length)return;
 let message='';
 for(const file of files){
  const image=imageTypes.has(file.type);
  const pdf=!imagesOnly&&(file.type==='application/pdf'||(!file.type&&/\.pdf$/i.test(file.name)));
  if(!(image||pdf)||file.size===0||file.size>6_000_000){
   message=imagesOnly?'请选择 6 MB 以内的 JPG、PNG 或 WebP 图片。':'请选择 6 MB 以内的 JPG、PNG、WebP 或 PDF 文件。';
   continue;
  }
  if(materialFiles.some(entry=>entry.file.name===file.name&&entry.file.size===file.size&&entry.file.lastModified===file.lastModified))continue;
  if(materialFiles.length>=materialLimit){message='最多添加 '+materialLimit+' 个文件。';break;}
  const entry={file,url:image?URL.createObjectURL(file):null};
  materialFiles.push(entry);
  if(image&&!primaryMaterial)primaryMaterial=entry;
 }
 renderMaterials();
 status(message||defaultStatus(),Boolean(message));
}
for(const [id,imagesOnly] of [['file',true],['extra-file',false]]){
 el(id).onchange=e=>{addMaterials(e.target.files,imagesOnly);e.target.value='';};
}
for(const n of ['dragenter','dragover'])el('drop').addEventListener(n,e=>{e.preventDefault();if(!busy)el('drop').classList.add('drag');});
for(const n of ['dragleave','drop'])el('drop').addEventListener(n,e=>{e.preventDefault();el('drop').classList.remove('drag');if(n==='drop')addMaterials(e.dataTransfer.files,true);});
renderMaterials();
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
  field.setAttribute('aria-label',label);row.append(field);
 }
 const remove=create('button','close','×');remove.type='button';remove.setAttribute('aria-label','移除此参数');
 remove.onclick=()=>{row.remove();el('add-parameter').disabled=false;};
 row.append(remove);parameterRows.append(row);row.firstElementChild.focus();
 el('add-parameter').disabled=parameterRows.children.length>=20;
}
el('add-parameter').onclick=addParameter;
el('upload-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;
 const file=primaryMaterial?.file;
 if(!file){status('请先选择产品图片。',true);return;}
 if(!ready){status('尚未配置模型。请参阅 README 并重启本地服务。',true);return;}
 const parameters=[...parameterRows.children].map(row=>({
  name:row.querySelector('[name=name]').value.trim(),value:row.querySelector('[name=value]').value.trim()
 }));
 if(parameters.some(p=>!p.name||!p.value)){
  parameterRows.closest('details').open=true;
  status('请补全每个产品参数的名称和值，或移除空白参数。',true);
  return;
 }
 const focusItemIds=[...el('focus-items').querySelectorAll('input:checked')].map(input=>input.value);
 const perspectiveIds=[...el('perspective-options').querySelectorAll('input:checked')].map(input=>input.value);
 busy=true;el('submit').disabled=true;el('prepare-fields').disabled=true;
 status('正在评分、定位部位并核查证据，可能需要几分钟。');
 try{
  const dataUrl=await normalizedImage(file).catch(()=>{throw new Error('无法读取这张图片，请重新导出为 JPG 或 PNG。');});
  const payload={image:dataUrl,projectName:el('project-name').value,brief:el('brief').value,
   designGoals:el('design-goals').value,focusItemIds,perspectiveIds,parameters,testResults:el('test-results').value};
  const res=await fetch('/api/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'评审失败。');
  report=data;selected=null;el('markers-visible').checked=true;el('pins').hidden=false;
  setImage(dataUrl,report.product+'产品图');setView('points');render();
  status(defaultStatus());
 }catch(e){status(e.message||'评审失败，请稍后重试。',true);}
 finally{busy=false;el('submit').disabled=false;el('prepare-fields').disabled=false;}
};
render();setView(viewFromUrl(),false);
check().then(()=>{if(!el('upload-status').textContent)status(defaultStatus());});
