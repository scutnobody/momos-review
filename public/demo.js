import { DIMENSIONS, GROUPS, RUBRIC_VERSION, SCORE_MAX } from './rubric.mjs';
const entries=[
 ['shade','灯头与出光面',.365,.25,'design','ok','灯头与支架采用一致的圆角语言，较宽的出光面提供了明确的视觉重心。','可见的椭圆形灯罩、连续的外轮廓和浅色扩散面。','用不同视角验证灯罩边缘和支架连接处的视觉一致性。'],
 ['joint','灯臂连接',.497,.207,'material','attention','连接处将灯头悬挑于工作区上方。图中能看到过渡结构，但无法确认内部固定方式或长期受力表现。','灯头右侧可见一段短连接件，并与弧形支架相接。','补充连接剖面或装配图，并验证悬臂在长期使用下的稳定性。'],
 ['arm','弧形支架',.664,.51,'design','unknown','支架呈浅色哑光，视觉上与灯头一致；仅凭渲染图无法确认材料、表面工艺或耐刮表现。','可见浅色表面与柔和高光。','补充材质牌号、表面工艺和样板。'],
 ['dial','操作旋钮',.382,.787,'utility','attention','前置旋钮易于发现，但图中的短刻线未说明档位或控制范围。','底座前方有一枚深色旋钮和一处细短刻线。','提供控制状态标识，并验证旋钮手感与反馈。'],
 ['base','桌面底座',.515,.807,'material','ok','较宽的底座让产品有明确的桌面支撑区域；实际抗倾覆表现需结合重量和尺寸验证。','椭圆底座明显宽于支架，接触桌面的区域可见。','补充底座尺寸与重量，进行稳定性测试。']
];

const mapping={
 shade:['A2',5],
 joint:['S3',4],
 arm:['A3',4],
 dial:['F2',4],
 base:['S2',4]
};
const regionSizes={shade:[.34,.13],joint:[.08,.09],arm:[.075,.34],dial:[.075,.085],base:[.43,.165]};
const parts=entries.map(([id,name,x,y])=>{
 const [w,h]=regionSizes[id];
 return {id,name,region:{x:x-w/2,y:y-h/2,w,h}};
});
const evidence=[{id:'IMG',type:'image',label:'原始产品图'},...parts.map(p=>({id:'R:'+p.id,type:'region',label:p.name,region:p.region}))];
const annotations=entries.map(([partId,title,x,y,dimension,severity,explanation,observation,suggestion])=>{
 const [itemId,score]=mapping[partId];
 return {id:'C:'+partId+':'+itemId,partId,title,dimension,itemId,score,severity,explanation,evidence:observation,
  evidenceIds:['R:'+partId],suggestion,status:'demo',expertLabel:GROUPS.find(g=>g.dimensions.includes(dimension)).label};
});
const understanding='F3';
const firstRating={id:understanding,score:5,basis:'把旋钮上的短刻线当作明确的调节方向。',evidenceIds:['R:dial']};
const finalRating={id:understanding,score:null,basis:'能看到短刻线，但看不清操作方向和反馈。',evidenceIds:['R:dial']};
const auditBefore={id:understanding,status:'insufficient',reason:'一条可见刻线不足以确认旋钮的方向与控制结果。'};
const auditAfter={id:understanding,status:'supported',reason:'复评准确指出了操作方向和反馈信息的缺口。'};
annotations.push({id:'C:dial:'+understanding,partId:'dial',dimension:'utility',itemId:understanding,title:'操作线索待确认',
 score:null,severity:'unknown',explanation:finalRating.basis,evidenceIds:['R:dial'],
 suggestion:'补充操作面特写或提供明确的方向标识。',status:'demo',expertLabel:'使用体验专家'});
const dimensions=DIMENSIONS.map(d=>{
 const items=d.items.map(item=>{
  const claim=annotations.find(n=>n.itemId===item.id);
  return {...item,score:claim?.score??null,basis:claim?.evidence??(claim?.explanation||'此子项未在示例中评分。'),
   evidenceIds:claim?.evidenceIds??[]};
 });
 const rated=items.filter(i=>i.score!==null);
 return {...d,items,score:rated.length?Math.round(rated.reduce((sum,i)=>sum+i.score,0)*10/rated.length)/10:null,basis:'示例覆盖 '+rated.length+' / '+items.length+' 个子项。'};
});
export const demo={product:'ARC 01 · 桌面照明',source:'demo',rubricVersion:RUBRIC_VERSION,scoreMax:SCORE_MAX,dimensions,parts,evidence,annotations,
 trace:{scoreRevisions:[{id:understanding,before:firstRating,after:finalRating,auditBefore,auditAfter}],claimRevisions:[]}};
