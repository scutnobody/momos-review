import http from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { config,configured,createProvider } from './provider.mjs';
import { runReview,validateInput } from './review.mjs';
import { askReview, validateChat } from './chat.mjs';
import { cropEvidence } from './crops.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
try{loadEnvFile(new URL('./.env',import.meta.url));}catch(e){if(e.code!=='ENOENT')throw e;}
const c=config(),ready=configured(c);
const storage=process.env.MOMOS_REVIEW_DIR||fileURLToPath(new URL('./.reviews/',import.meta.url));

async function saveReview(result){
 const path=resolve(storage,result.id+'.json');
 const temporary=path+'.tmp';
 try{
  await mkdir(storage,{recursive:true});
  await writeFile(temporary,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  await rename(temporary,path);
 }catch{
  await rm(temporary,{force:true}).catch(()=>{});
  throw new Error('评审记录保存失败，请检查本地评审目录的写入权限。');
 }
}
const staticFiles={'/rubric.mjs':['../rubric.mjs','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/chat.js':['chat.js','text/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8'],'/lamp.svg':['lamp.svg','image/svg+xml'],'/demo.js':['demo.js','text/javascript; charset=utf-8']};
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
let active=0;
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
 const path=(req.url??'').split('?')[0];
 if(req.method==='GET'&&path==='/api/status')return send(res,200,{configured:ready});
 if(req.method==='POST'&&(path==='/api/review'||path==='/api/chat')){
  const chatting=path==='/api/chat';
  const bodyLimit=chatting?90_000:8_100_000;
  if(!ready)return send(res,503,{error:'尚未配置视觉模型。请配置项目的 .env 后重启服务。'});
  if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return send(res,403,{error:'请从本地评审台提交。'});
  if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'请求格式不受支持。'});
  if(active>=2)return send(res,429,{error:'评审服务正忙，请稍后再试。'});
  active++;
  const controller=new AbortController();
  res.on('close',()=>{if(!res.writableEnded)controller.abort();});
  try{
   let bytes=0;const chunks=[];
   for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>bodyLimit){send(res,413,{error:chatting?'对话内容超过长度限制。':'图片超过上传限制。'});return;}
    chunks.push(chunk);
   }
   let input;
   try{input=(chatting?validateChat:validateInput)(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(e){return send(res,400,{error:e instanceof SyntaxError?'请求 JSON 无效。':e.message});}
   const invoke=createProvider(c,controller.signal);
   if(chatting){
    let report;
    try{report=JSON.parse(await readFile(resolve(storage,input.reviewId+'.json'),'utf8'));}
    catch(error){
     if(error.code==='ENOENT')return send(res,404,{error:'这份评审已找不到，请重新评审。'});
     throw new Error('无法读取本地评审记录。');
    }
    const part=input.partId===null?null:report.parts.find(p=>p.id===input.partId);
    if(part===undefined)return send(res,400,{error:'该部位不属于这份评审。'});
    controller.signal.throwIfAborted();
    return send(res,200,await askReview(report,part,input,invoke));
   }
   const result=await runReview(input,invoke,{
    prepareCrops:(image,parts)=>cropEvidence(image,parts,controller.signal)
   });
   controller.signal.throwIfAborted();
   result.models={scorer:c.score.model,locator:c.locator.model,agents:c.agent.model};
   await saveReview(result);
   send(res,200,result);
  }catch(e){
   if(!res.destroyed)send(res,502,{error:['TimeoutError','AbortError'].includes(e.name)?(chatting?'Agent 回复超时，请重试。':'模型评审超时，请重试。'):e instanceof TypeError?'无法连接模型服务，请检查接口与网络。':e.message});
  }finally{active--;}
  return;
 }
 if(req.method==='GET'&&Object.hasOwn(staticFiles,path)){
  const [file,type]=staticFiles[path];
  try{const body=await readFile(new URL('./public/'+file,import.meta.url));res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(body);}
  catch{send(res,500,{error:'静态资源读取失败。'});}
  return;
 }
 send(res,404,{error:'页面不存在。'});
});
server.listen(Number(process.env.MOMOS_PORT||4173),'127.0.0.1',()=>console.log('MOMOS Local: http://127.0.0.1:'+server.address().port));
