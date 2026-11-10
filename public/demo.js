import { DIMENSIONS, GROUPS, RUBRIC_VERSION } from './rubric.mjs';
const entries=[
 ['shade','灯头与出光面',.38,.295,'aesthetics','ok','灯头与支架采用一致的圆角语言，较宽的出光面提供了明确的视觉重心。','可见的椭圆形灯罩、连续的外轮廓和浅色扩散面。','用不同视角验证灯罩边缘和支架连接处的视觉一致性。'],
 ['joint','灯臂连接',.588,.225,'structure','attention','连接处将灯头悬挑于工作区上方。图中能看到过渡结构，但无法确认内部固定方式或长期受力表现。','灯头右侧可见一段短连接件，并与弧形支架相接。','补充连接剖面或装配图，并验证悬臂在长期使用下的稳定性。'],
 ['arm','弧形支架',.659,.52,'material','unknown','支架呈浅色哑光，视觉上与灯头一致；仅凭渲染图无法确认材料、表面工艺或耐刮表现。','可见浅色表面与柔和高光。','补充材质牌号、表面工艺和样板。'],
 ['dial','操作旋钮',.495,.796,'usability','attention','前置旋钮易于发现，但图中的短刻线未说明档位或控制范围。','底座前方有一枚深色旋钮和一处细短刻线。','提供控制状态标识，并验证旋钮手感与反馈。'],
 ['base','桌面底座',.716,.793,'utility','ok','较宽的底座让产品有明确的桌面支撑区域；实际抗倾覆表现需结合重量和尺寸验证。','椭圆底座明显宽于支架，接触桌面的区域可见。','补充底座尺寸与重量，进行稳定性测试。']
];

const mapping={
 shade:['aesthetics.detail',91],
 joint:['structure.joints',84],
 arm:['material.finish',81],
 dial:['usability.controls',82],
 base:['utility.workflow',83]
};
const parts=entries.map(([id,name,x,y])=>({id,name,region:{x:x-.065,y:y-.06,w:.13,h:.12}}));
const evidence=[{id:'IMG',type:'image',label:'原始产品图'},...parts.map(p=>({id:'R:'+p.id,type:'region',label:p.name,region:p.region}))];
const annotations=entries.map(([partId,title,x,y,dimension,severity,explanation,observation,suggestion])=>{
 const [itemId,score]=mapping[partId];
 return {id:'C:'+partId+':'+itemId,partId,title,dimension,itemId,score,severity,explanation,evidence:observation,
  evidenceIds:['R:'+partId],suggestion,status:'demo',expertLabel:GROUPS.find(g=>g.dimensions.includes(dimension)).label};
});
const durability='material.durability';
const firstRating={id:durability,score:90,basis:'把浅色表面视作耐腐蚀表现。',evidenceIds:['R:arm']};
const finalRating={id:durability,score:null,basis:'缺少耐腐蚀试验结果及相应工况。',evidenceIds:[]};
const auditBefore={id:durability,status:'insufficient',reason:'图中只可观察颜色和光泽。耐腐蚀子项须有相关测试结果。'};
const auditAfter={id:durability,status:'supported',reason:'复评结论准确说明了现有资料的边界。'};
annotations.push({id:'C:arm:'+durability,partId:'arm',dimension:'material',itemId:durability,title:'耐腐蚀性待验证',
 score:null,severity:'unknown',explanation:'支架表面的颜色和光泽无法确认耐腐蚀性能。',evidenceIds:['R:arm'],
 suggestion:'补充测试方法、工况、结果及判定阈值。',status:'demo',expertLabel:'工程材料专家'});
const dimensions=DIMENSIONS.map(d=>{
 const items=d.items.map(item=>{
  const claim=annotations.find(n=>n.itemId===item.id);
  return {...item,score:claim?.score??null,basis:claim?.evidence??(claim?.explanation||'此子项未在示例中评分。'),
   evidenceIds:claim?.evidenceIds??[]};
 });
 const rated=items.filter(i=>i.score!==null);
 return {...d,items,score:rated[0]?.score??null,basis:'示例覆盖 '+rated.length+' / '+items.length+' 个子项。'};
});
export const demo={product:'ARC 01 · 桌面照明',source:'demo',rubricVersion:RUBRIC_VERSION,dimensions,parts,evidence,annotations,
 trace:{scoreRevisions:[{id:durability,before:firstRating,after:finalRating,auditBefore,auditAfter}],claimRevisions:[]}};
