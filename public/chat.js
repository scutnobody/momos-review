export function setupReviewChat(root,evidenceList){
 const find=name=>root.querySelector('[data-chat-'+name+']');
 const scope=find('scope'),thread=find('thread'),context=find('context');
 const input=find('input'),send=find('send'),prompts=find('prompts'),status=find('status');
 const selectedScope=()=>scope?.value??'';
 const histories=new Map();
 let report,available=false,pending=null,error='';

 function message(role,text,evidenceIds=[]){
  const bubble=document.createElement('article');
  bubble.className='chat-message '+role;
  const title=document.createElement('strong');
  title.textContent=role==='user'?'你':'评审 Agent';
  const content=document.createElement('p');
  content.textContent=text;
  bubble.append(title,content);
  if(evidenceIds.length)bubble.append(evidenceList(evidenceIds));
  return bubble;
 }

 function render(){
  const enabled=available&&report?.source==='model';
  const key=selectedScope(),turns=histories.get(key)??[];
  const part=report?.parts.find(p=>p.id===key);
  if(context)context.textContent=report?.source==='model'?(report.projectName||report.product):'等待评审结果';
  thread.replaceChildren();
  if(!turns.length&&!pending){
   const greeting=document.createElement('p');
   greeting.className='chat-greeting';
   greeting.textContent=part?'可以追问「'+part.name+'」的判断依据、改进建议和待补资料。':'可以追问当前产品的子项评分、审核理由和改进建议。';
   thread.append(greeting);
  }
  for(const turn of turns){
   thread.append(message('user',turn.question),message('agent',turn.answer,turn.evidenceIds));
  }
  if(pending)thread.append(message('user',pending.question),message('agent','正在查阅评审记录…'));
  thread.scrollTop=thread.scrollHeight;
  input.disabled=send.disabled=!enabled||Boolean(pending);
  if(scope)scope.disabled=Boolean(pending);
  prompts.replaceChildren();
  if(enabled&&!turns.length&&!pending){
   for(const question of part?['这个部位有哪些证据？','这个部位可以怎么改进？']:['哪些子项需要补充证据？','下一步优先验证什么？']){
    const button=document.createElement('button');
    button.type='button';button.className='chat-prompt';button.textContent=question;
    button.onclick=()=>{input.value=question;input.focus();};
    prompts.append(button);
   }
  }
  status.textContent=error||(!available?'配置 Agent 模型后可使用问答。':!enabled?'完成一次产品评审后可开始问答。':'问答结合评分、审核和复评记录，最近 6 轮用于理解追问。');
  status.classList.toggle('error',Boolean(error));
 }

 function setReview(next){
  if(report===next)return;
  pending?.controller.abort();
  pending=null;error='';input.value='';histories.clear();
  report=next;
  if(scope)scope.replaceChildren(...report.parts.map(p=>new Option(p.name,p.id)));
  render();
 }

 function open(partId){
  if(!pending&&scope.value!==partId){
   scope.value=partId;input.value='';error='';
  }
  root.showModal();
  render();
  if(!input.disabled)input.focus();
 }

 if(scope){
  scope.onchange=()=>{input.value='';error='';render();if(!input.disabled)input.focus();};
  find('close').onclick=()=>root.close();
 }
 find('form').onsubmit=async event=>{
  event.preventDefault();
  const question=input.value.trim();
  if(pending||!available||report?.source!=='model'||!question)return;
  const key=selectedScope(),turns=histories.get(key)??[];
  const history=turns.slice(-6).map(({question,answer})=>({question,answer}));
  const request={question,controller:new AbortController()};
  pending=request;error='';render();
  try{
   const response=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},
    signal:request.controller.signal,body:JSON.stringify({reviewId:report.id,partId:key||null,question,history})});
   const reply=await response.json();
   if(pending!==request)return;
   if(!response.ok)throw new Error(reply.error||'Agent 回复失败，请重试。');
   histories.set(key,[...turns,{question,...reply}]);
   input.value='';
  }catch(failure){
   if(pending===request)error=failure.message||'Agent 回复失败，请重试。';
  }finally{
   if(pending===request){
    pending=null;render();
    if(root.getClientRects().length)input.focus();
   }
  }
 };

 return {setReview,open,setAvailable(value){available=value;render();}};
}
