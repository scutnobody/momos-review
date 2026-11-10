import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function cropEvidence(image,parts,signal){
 if(!parts.length)return {};
 const python=process.env.MOMOS_PYTHON||(process.platform==='win32'?'python':'python3');
 const script=fileURLToPath(new URL('./crop_image.py',import.meta.url));
 return new Promise((resolve,reject)=>{
  const child=spawn(python,[script],{
   stdio:['pipe','pipe','ignore'],windowsHide:true,
   signal:AbortSignal.any([AbortSignal.timeout(20_000),...(signal?[signal]:[])])
  });
  const chunks=[];
  let bytes=0;
  const failed=()=>new Error('无法生成图像证据裁切。请检查图片以及 Python/Pillow 配置。');
  child.stdout.on('data',chunk=>{
   bytes+=chunk.length;
   if(bytes>8_000_000){child.kill();reject(failed());return;}
   chunks.push(chunk);
  });
  child.on('error',error=>reject(error.name==='AbortError'?error:failed()));
  child.stdin.on('error',()=>reject(failed()));
  child.on('close',code=>{
   if(code!==0){reject(failed());return;}
   try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
   catch{reject(failed());}
  });
  child.stdin.end(JSON.stringify({image,parts}));
 });
}
