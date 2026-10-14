import * as Cesium from 'cesium';
import { holdContinuousRender, releaseContinuousRender, governorRequestRender } from '../renderGovernor.js';
import { createResilienceAttackFollow } from './resilienceFollowCamera.js';

// Every crop is independently scored against its full FAOSTAT bilateral network.
// Checking multiple crops overlays their results; the current focus crop owns
// the main metric cards and the cinematic camera target queue.
const SPECS = Object.freeze({
  rice:     { name:'水稻', en:'Rice, milled', icon:'🍚', color:'#35D0FF' },
  wheat:    { name:'小麦', en:'Wheat', icon:'🌾', color:'#F6C445' },
  maize:    { name:'玉米', en:'Maize', icon:'🌽', color:'#7ED957' },
  soybeans: { name:'大豆', en:'Soybeans', icon:'🫘', color:'#B57CFF' },
});
const MODES = {
  'node-targeted':'节点 · 蓄意攻击',
  'node-random':'节点 · 随机攻击',
  'edge-targeted':'边 · 蓄意攻击',
  'edge-random':'边 · 随机攻击',
};
const OWNER='resilience-multicrop-v7';
const RED=Cesium.Color.fromCssColorString('#ff445a');
const CSS=`
#gev-resilience-root {position:fixed;right:20px;top:103px;width:314px;max-width:calc(100vw - 32px);z-index:2550;background:rgba(4,10,22,.96);border:1px solid #31536a;border-radius:11px;overflow:hidden;color:#cee0ee;font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 10px 30px #0008}
#gev-resilience-root button,#gev-resilience-root select {cursor:pointer;font:inherit;background:#102538;border:1px solid #31536a;border-radius:6px;color:#d9f5ff;padding:6px 8px}
#gev-resilience-root button:hover{border-color:#39cfff}
#gev-resilience-root button:disabled{opacity:.45;cursor:default}
#gev-resilience-root .gev-lab-header {display:flex;align-items:center;gap:6px;padding:10px 12px}
#gev-resilience-root .gev-lab-header button:first-child{flex:1;text-align:left;color:#6ad9fa;background:transparent;border:none;letter-spacing:1px;font-weight:bold}
#gev-resilience-root .gev-lab-body{padding:12px;border-top:1px solid #273e53;max-height:calc(100vh - 200px);overflow-y:auto}
#gev-resilience-root label{font-size:11px;display:block;color:#97b6ca;margin-bottom:6px}
#gev-resilience-root select{width:100%;background:#091929}
#gev-resilience-root .gev-crops{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:9px}
#gev-resilience-root .gev-crop{display:flex;align-items:center;gap:4px;min-width:0;margin:0;padding:6px;background:#0c2130;border:1px solid #2e4b60;border-radius:6px;cursor:pointer;letter-spacing:0}
#gev-resilience-root .gev-crop input{margin:0;flex:none;accent-color:#35d0ff}
#gev-resilience-root .gev-crop-name{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#b9d4e3}
#gev-resilience-root .gev-crop-rate{flex:none;white-space:nowrap;color:#72daea;font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
#gev-resilience-root .gev-crop:has(input:checked){border-color:#65b3cf;background:#122d3e}
#gev-resilience-root .gev-crop:not(:has(input:checked)) .gev-crop-rate{color:#678393}
#gev-resilience-root .gev-select-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0 0 8px}
#gev-resilience-root .gev-select-field{min-width:0}
#gev-resilience-root .gev-select-field label{margin:0 0 4px;white-space:nowrap}
#gev-resilience-root .gev-select-wrap{position:relative;min-width:0}
#gev-resilience-root .gev-select-wrap select{box-sizing:border-box;display:block;min-width:0;width:100%;height:31px;margin:0;padding:5px 24px 5px 8px;appearance:none;-webkit-appearance:none;border-radius:6px;line-height:19px;color:#d9f5ff}
#gev-resilience-root .gev-select-wrap::after{content:'';position:absolute;right:11px;top:calc(50% - 3px);width:6px;height:6px;border-right:1.5px solid #a3c7d7;border-bottom:1.5px solid #a3c7d7;transform:rotate(45deg);pointer-events:none}
#gev-resilience-root .gev-select-wrap:focus-within::after{border-color:#65e9fa}
#gev-resilience-root input[type=range]{accent-color:#ff5a70;width:100%;margin:7px 0 12px}
#gev-resilience-root .gev-line{display:flex;align-items:center;justify-content:space-between;gap:8px}
#gev-resilience-root .gev-line output{font-variant-numeric:tabular-nums;color:#ff6b7b;font-size:18px;font-weight:bold}
#gev-resilience-root .gev-small-slider{accent-color:#56d9f4!important;margin:3px 0!important}
#gev-resilience-root .gev-follow{border:1px solid #31536a;background:#0b2233;border-radius:8px;padding:9px;margin:6px 0 11px}
#gev-resilience-root .gev-follow label{display:flex;gap:7px;align-items:center;cursor:pointer;color:#b0e9f6}
#gev-resilience-root .gev-follow input[type=checkbox]{accent-color:#52d7fa}
#gev-resilience-root .gev-follow-extra[hidden]{display:none}
#gev-resilience-root .gev-hero{background:linear-gradient(135deg,#0f2f43,#06121e);border:1px solid #2887a8;border-radius:10px;padding:12px;margin:9px 0}
#gev-resilience-root .gev-hero strong{display:block;font-size:35px;color:#65e9fa;line-height:1.2;font-variant-numeric:tabular-nums}
#gev-resilience-root .gev-hero small{color:#a5c6d6}
#gev-resilience-root .gev-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
#gev-resilience-root .gev-metric{padding:7px;border:1px solid #2a4053;border-radius:6px;background:#0a1a29}
#gev-resilience-root .gev-metric span{display:block;color:#859fb0;font-size:10px}
#gev-resilience-root .gev-metric b{font-size:14px}
#gev-resilience-root .gev-actions{display:flex;gap:7px;flex-wrap:wrap;margin:11px 0}
#gev-resilience-root .gev-status{white-space:pre-wrap;color:#91adbd;font-size:10px;line-height:1.5;margin:8px 0 3px;min-height:28px}
#gev-resilience-root .gev-hint{font-size:10px;color:#809aaa;margin:7px 0}
@media(max-width:650px){#gev-resilience-root{right:10px;top:165px;width:290px}}
`;
const el=(tag,cls='',str='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(str)e.textContent=str;return e;};
const countFor=(data,mode,p)=>Math.min(data.experiments[mode].order.length,
  Math.floor(data.experiments[mode].order.length*p/100+1e-9));
const intPct=(p)=>Math.min(100,Math.round(p));

function arc(a,b){
  const s=Cesium.Cartographic.fromDegrees(a.lon,a.lat),t=Cesium.Cartographic.fromDegrees(b.lon,b.lat);
  const great=new Cesium.EllipsoidGeodesic(s,t);
  const rise=Math.min(1100000,Math.max(140000,great.surfaceDistance*.1)),out=[];
  for(let i=0;i<=40;i++){
    const u=i/40,q=great.interpolateUsingFraction(u);
    out.push(Cesium.Cartesian3.fromRadians(q.longitude,q.latitude,16000+Math.sin(u*Math.PI)*rise));
  }
  return out;
}
function makeArrow(hex){
  const c=document.createElement('canvas');c.width=c.height=38;
  const x=c.getContext('2d');x.strokeStyle=hex;x.lineWidth=3.6;x.lineJoin='round';
  x.beginPath();x.moveTo(7,25);x.lineTo(19,11);x.lineTo(31,25);x.stroke();return c;
}

function cropRenderer({viewer,crop,data}){
  const spec=SPECS[crop],nodes=new Map(data.nodes.map(x=>[x.id,x]));
  const ds=new Cesium.CustomDataSource(`resilience-v7-${crop}`);
  const extras=new Cesium.CustomDataSource(`resilience-v7-${crop}-extras`);
  const billboards=viewer.scene.primitives.add(new Cesium.BillboardCollection());
  const healthy=Cesium.Color.fromCssColorString(spec.color).withAlpha(.91);
  const visual=[],markers=[],movers=[],extraSlots=[];
  const topIds=new Set();
  let lastState='',visible=true;
  const maxVolume=Math.max(1,...data.edges.slice(0,120).map(e=>e.volumeTonnes));
  for(const e of data.edges.slice(0,120)){
    const a=nodes.get(e.source),b=nodes.get(e.target);if(!a||!b)continue;
    let positions;try{positions=arc(a,b);}catch{continue;}
    const width=1+3.1*Math.sqrt(e.volumeTonnes/maxVolume);
    const entity=ds.entities.add({id:`v7-${crop}-${e.id}`,name:`${a.name} → ${b.name}`,
      polyline:{positions,arcType:Cesium.ArcType.NONE,width,material:new Cesium.ColorMaterialProperty(healthy)}});
    visual.push({edge:e,entity,positions,attacked:false,healthy});topIds.add(e.id);
  }
  for(const n of data.nodes){
    if(!Number.isFinite(n.lon)||!Number.isFinite(n.lat))continue;
    markers.push({id:n.id,entity:ds.entities.add({id:`v7-${crop}-node-${n.id}`,
      show:false,position:Cesium.Cartesian3.fromDegrees(n.lon,n.lat,45000),
      point:{pixelSize:7,color:RED,outlineColor:Cesium.Color.WHITE.withAlpha(.5),outlineWidth:1}})});
  }
  const arrow=makeArrow(spec.color);
  for(let i=0;i<Math.min(30,visual.length);i++){
    const item=visual[i];
    const bb=billboards.add({position:item.positions[0],image:arrow,width:17,height:17,show:true,disableDepthTestDistance:0});
    movers.push({bb,item,phase:(i*.193)%1});
  }
  async function mount(){
    await viewer.dataSources.add(ds);
    await viewer.dataSources.add(extras);
  }
  function setVisible(v){visible=v;ds.show=v;extras.show=v;billboards.show=v;}
  function apply(mode,p,forceCount=null){
    const order=data.experiments[mode].order;
    const k=forceCount===null?countFor(data,mode,p):Math.min(order.length,forceCount);
    const signature=`${mode}-${k}`;
    if(signature===lastState)return;
    lastState=signature;
    const damaged=new Set(order.slice(0,k)),nodeAttack=mode.startsWith('node-');
    const affected=e=>nodeAttack?damaged.has(e.source)||damaged.has(e.target):damaged.has(e.id);
    for(const v of visual){
      const isDamaged=affected(v.edge);
      if(isDamaged===v.attacked)continue;
      v.attacked=isDamaged;
      // One entity, one material: no stacked polylines or delete/recreate flashes.
      v.entity.polyline.material=new Cesium.ColorMaterialProperty(isDamaged?RED:v.healthy);
    }
    for(const x of markers)x.entity.show=nodeAttack&&damaged.has(x.id);
    for(const x of movers)x.bb.show=!x.item.attacked;
    let used=0;
    for(const edge of data.edges){
      if(used===18)break;
      if(topIds.has(edge.id)||!affected(edge))continue;
      const a=nodes.get(edge.source),b=nodes.get(edge.target);if(!a||!b)continue;
      const slot=extraSlots[used];
      if(slot?.edgeId===edge.id){slot.entity.show=true;used++;continue;}
      let positions;try{positions=arc(a,b);}catch{continue;}
      if(slot){slot.edgeId=edge.id;slot.entity.polyline.positions=positions;slot.entity.show=true;}
      else{
        const entity=extras.entities.add({id:`v7-${crop}-extra-${used}`,show:true,
          polyline:{positions,arcType:Cesium.ArcType.NONE,width:2.5,material:new Cesium.ColorMaterialProperty(RED)}});
        extraSlots.push({edgeId:edge.id,entity});
      }
      used++;
    }
    for(let i=used;i<extraSlots.length;i++)extraSlots[i].entity.show=false;
    governorRequestRender(OWNER);
  }
  function animate(t){
    if(!visible)return;
    for(const {bb,item,phase} of movers){
      if(!bb.show)continue;
      const u=.02+.96*((t/8500+phase)%1),index=u*(item.positions.length-1),j=Math.floor(index);
      bb.position=Cesium.Cartesian3.lerp(item.positions[j],item.positions[j+1],index-j,new Cesium.Cartesian3());
    }
  }
  function dispose(){
    viewer.scene.primitives.remove(billboards);
    viewer.dataSources.remove(ds,true);viewer.dataSources.remove(extras,true);
  }
  return {nodes,edges:new Map(data.edges.map(e=>[e.id,e])),data,mount,setVisible,apply,animate,dispose};
}

/** Install the whole v7 lab in place of v5+v6; old files remain intact for rollback. */
export function installMultiCropResilience({viewer,dataManager}){
  if(document.getElementById('gev-resilience-root'))throw new Error('Resilience lab already present');
  const style=el('style');style.textContent=CSS;document.head.append(style);
  const root=el('section');root.id='gev-resilience-root';
  const header=el('div','gev-lab-header');
  const toggle=el('button','','◉ NETWORK RESILIENCE LAB');
  const collapse=el('button','','▾');header.append(toggle,collapse);
  const body=el('div','gev-lab-body');body.hidden=true;
  const cropTitle=el('label','','研究作物（可多选）');
  const cropGrid=el('div','gev-crops');
  const checkboxes=new Map(),retentionOutputs=new Map();
  for(const [key,spec] of Object.entries(SPECS)){
    const row=el('label','gev-crop'),box=el('input');box.type='checkbox';box.checked=key==='soybeans';box.value=key;
    const name=el('span','gev-crop-name',`${spec.icon} ${spec.name}`);
    const rate=el('output','gev-crop-rate','—');rate.setAttribute('aria-label',`${spec.name}网络效率保留率`);
    row.append(box,name,rate);
    row.style.borderLeft=`3px solid ${spec.color}`;cropGrid.append(row);checkboxes.set(key,box);retentionOutputs.set(key,rate);
  }
  // Compact, accessible two-column selectors; the caret is drawn by CSS.
  const selectGrid=el('div','gev-select-grid');
  const focusField=el('div','gev-select-field'),focusLine=el('label','','主作物'),focusWrap=el('div','gev-select-wrap');
  const focus=el('select');focus.id='gev-resilience-focus';focusLine.htmlFor=focus.id;
  focus.setAttribute('aria-label','主作物：主指标及镜头跟随作物');
  focusWrap.append(focus);focusField.append(focusLine,focusWrap);
  const modeField=el('div','gev-select-field'),modeLine=el('label','','攻击方式'),modeWrap=el('div','gev-select-wrap');
  const mode=el('select');mode.id='gev-resilience-mode';modeLine.htmlFor=mode.id;
  modeWrap.append(mode);modeField.append(modeLine,modeWrap);
  selectGrid.append(focusField,modeField);
  const shortModes={'node-targeted':'节点·蓄意','node-random':'节点·随机','edge-targeted':'边·蓄意','edge-random':'边·随机'};
  for(const [key,title] of Object.entries(shortModes)){const o=el('option','',title);o.value=key;mode.append(o);}
  const stepLine=el('div','gev-line');stepLine.append(el('label','','推进步长（0%～1%）'));
  const stepValue=el('span','','0.20%');stepLine.append(stepValue);
  const step=el('input','gev-small-slider');step.type='range';step.min=0;step.max=1;step.step=.01;step.value=.2;step.setAttribute('aria-label','自动攻击推进步长（百分比）');
  const percentage=el('div','gev-line');percentage.append(el('label','','攻击程度'));const pct=el('output','','0.00%');percentage.append(pct);
  const slider=el('input');slider.type='range';slider.min=0;slider.max=100;slider.step=.01;slider.value=0;slider.setAttribute('aria-label','攻击程度百分比');
  const followBox=el('div','gev-follow');const followLabel=el('label');const follow=el('input');follow.type='checkbox';followLabel.append(follow,document.createTextNode('🎥 攻击镜头跟拍（逐个目标）'));
  const followExtra=el('div','gev-follow-extra');followExtra.hidden=true;
  const secondsLine=el('div','gev-line');secondsLine.append(el('span','','每目标演示周期'));
  const secondsValue=el('span','','4.0 秒');secondsLine.append(secondsValue);
  const seconds=el('input','gev-small-slider');seconds.type='range';seconds.min=2;seconds.max=10;seconds.step=.5;seconds.value=4;
  followExtra.append(secondsLine,seconds,el('div','gev-hint','多作物同时攻击，镜头只跟随所选主作物。'));followBox.append(followLabel,followExtra);
  const hero=el('div','gev-hero');hero.append(el('small','','网络效率保留率 · STRUCTURAL RESILIENCE'));
  const score=el('strong','','—'),baseline=el('small','','等待完整网络...');hero.append(score,baseline);
  const metrics=el('div','gev-grid');
  const fields=[['平均聚类系数','clustering'],['平均度','meanDegree'],['平均路径长度','pathLength'],['最大连通子图','giantFraction'],['孤立节点比例','isolatedFraction'],['网络效率','efficiency']];
  const slots=new Map();
  for(const [name,key] of fields){const card=el('div','gev-metric');card.append(el('span','',name));const b=el('b','','—');card.append(b);metrics.append(card);slots.set(key,b);}
  const actions=el('div','gev-actions'),play=el('button','','▶ 播放'),reset=el('button','','↺ 重置'),bestView=el('button','','◎ 最佳视角');actions.append(play,reset,bestView);
  const status=el('div','gev-status','点击标题开始加载数据。');
  const foot=el('div','gev-hint','各作物独立攻击，指标来自完整 FAOSTAT 网络；红线表示失效贸易关系，并非真实运输路线。');
  body.append(cropTitle,cropGrid,selectGrid,stepLine,step,percentage,slider,followBox,hero,metrics,actions,status,foot);
  root.append(header,body);document.body.append(root);

  const selected=new Set(['soybeans']),models=new Map(),muted=new Map();
  let focusCrop='soybeans',modeKey='node-targeted',percent=0,stepSize=.2;
  let busy=false,opened=false,disposed=false,timer=null,loadingToken=0,following=false;
  const emit=()=>governorRequestRender(OWNER);
  function renderFocusOptions(){
    focus.replaceChildren();for(const key of selected){const opt=el('option','',`${SPECS[key].icon} ${SPECS[key].name}`);opt.value=key;focus.append(opt);}
    if(!selected.has(focusCrop))focusCrop=[...selected][0];
    focus.value=focusCrop;
  }
  renderFocusOptions();
  const stopTimer=()=>{if(timer!==null){clearInterval(timer);timer=null;}};
  const stopFollow=(reason='paused')=>{following=false;camera.stop(reason);};
  function stop(reason='paused'){stopTimer();stopFollow(reason);play.textContent='▶ 播放';}
  function formatMetric(key,v){
    if(!Number.isFinite(v))return '—';
    if(key.endsWith('Fraction'))return `${(v*100).toFixed(1)}%`;
    return v.toFixed(key==='efficiency'?4:key==='pathLength'?2:3);
  }
  function updateStats(){
    pct.textContent=`${percent.toFixed(2)}%`;
    const focusModel=models.get(focusCrop);
    for(const [key,output] of retentionOutputs){
      if(!selected.has(key)){output.textContent='—';continue;}
      const val=models.get(key)?.data?.experiments?.[modeKey]?.steps?.[intPct(percent)]?.metrics?.efficiencyRetentionPct;
      output.textContent=Number.isFinite(val)?`${val.toFixed(1)}%`:'…';
    }
    const exp=focusModel?.data.experiments[modeKey];const point=exp?.steps?.[intPct(percent)];
    if(!point){score.textContent='—';baseline.textContent='读取中...';for(const b of slots.values())b.textContent='—';return;}
    score.textContent=`${point.metrics.efficiencyRetentionPct.toFixed(1)}%`;
    score.style.color=point.metrics.efficiencyRetentionPct<40?'#ff6b7a':'#65e9fa';
    baseline.textContent=`${SPECS[focusCrop].name} · 网络效率 ${point.metrics.efficiency.toFixed(4)} · 初始 ${exp.steps[0].metrics.efficiency.toFixed(4)}`;
    for(const [key,b] of slots)b.textContent=formatMetric(key,point.metrics[key]);
    const count=countFor(focusModel.data,modeKey,percent);
    if(!following)status.textContent=`${SPECS[focusCrop].name} · ${MODES[modeKey]} · 已攻击 ${count} / ${exp.order.length}\n六项指标：${intPct(percent)}% 预计算快照；地图按实际攻击数量更新。`;
  }
  function applyState(forceCount=null){
    for(const crop of selected){models.get(crop)?.apply(modeKey,percent,crop===focusCrop?forceCount:null);}
    updateStats();emit();
  }
  function move(v,exactCount=null){percent=Math.round(Math.max(0,Math.min(100,Number(v)||0))*100)/100;slider.value=String(percent);applyState(exactCount);}
  async function muteLayer(crop){
    const id=`agri-${crop}-2022`;
    if(!dataManager?.layers?.has(id))return;
    if(muted.has(crop))return;
    const was=dataManager.isEnabled(id);muted.set(crop,was);
    if(was)await dataManager.setEnabled(id,false,{origin:'user'});
  }
  async function restoreLayer(crop){
    if(!muted.has(crop))return;
    const was=muted.get(crop);muted.delete(crop);
    if(was)try{await dataManager.setEnabled(`agri-${crop}-2022`,true,{origin:'user'});}catch(e){console.warn('Restore crop layer failed',crop,e);}
  }
  async function load(crop){
    if(models.has(crop)){await muteLayer(crop);return models.get(crop);}
    const response=await fetch(`/data/resilience/${crop}_2022_lab.json`);
    if(!response.ok)throw new Error(`${SPECS[crop].name} 缺少完整网络文件（HTTP ${response.status}）。请运行 v7 数据生成脚本。`);
    const data=await response.json();
    if(data.meta?.crop!==crop||data.meta?.fullNetwork!==true||!Array.isArray(data.nodes)||!Array.isArray(data.edges)
      ||!Object.keys(MODES).every(k=>data.experiments?.[k]?.steps?.length===101&&Array.isArray(data.experiments?.[k]?.order)))
      throw new Error(`${SPECS[crop].name} 不是完整的四种攻击网络数据`);
    await muteLayer(crop);
    const model=cropRenderer({viewer,crop,data});
    try{await model.mount();models.set(crop,model);return model;}
    catch(error){model.dispose();await restoreLayer(crop);throw error;}
  }
  async function syncSelection(){
    const token=++loadingToken;busy=true;stop();
    try{
      for(const crop of [...models.keys()]){
        if(selected.has(crop))continue;
        models.get(crop).setVisible(false);await restoreLayer(crop);
        if(token!==loadingToken)return;
      }
      for(const crop of selected){
        status.textContent=`正在加载 ${SPECS[crop].name} 的完整网络...`;
        const model=await load(crop);
        if(token!==loadingToken){
          if(!selected.has(crop)){model.setVisible(false);await restoreLayer(crop);}
          return;
        }
        model.setVisible(true);
      }
      for(const [crop,model] of models){if(!selected.has(crop))model.setVisible(false);}
      applyState();
    }catch(error){status.textContent=`加载失败：${error.message}`;console.error('[Resilience v7]',error);}
    finally{if(token===loadingToken)busy=false;}
  }
  const camera=createResilienceAttackFollow({
    viewer,
    getNode:id=>models.get(focusCrop)?.nodes.get(id),
    getEdge:id=>models.get(focusCrop)?.edges.get(id),
    onPhase:({phase,index,total,name})=>{
      if(phase==='locating')status.textContent=`◎ 正在追踪 ${SPECS[focusCrop].name} · ${index}/${total}: ${name||''}`;
      else status.textContent=`🔴 已攻击 ${SPECS[focusCrop].name} · ${index}/${total}: ${name||''}`;
    },
    onAttack:({index,total})=>{
      if(disposed||!opened)return;
      const next=Math.ceil(index*10000/total-1e-8)/100;
      move(next,index);
      play.textContent='Ⅱ 暂停跟拍';
    },
    onEnd:why=>{
      following=false;play.textContent='▶ 播放';
      if(why==='finished')status.textContent='所选作物的所有目标已完成。';
      if(why==='user')status.textContent='已暂停跟拍；点击播放继续。';
    },
  });
  function onPlay(){
    if(busy||!opened)return;
    if(follow.checked){
      if(camera.isRunning()){stop();return;}
      const model=models.get(focusCrop);if(!model)return;
      let from=countFor(model.data,modeKey,percent);
      if(from>=model.data.experiments[modeKey].order.length){move(0);from=0;}
      following=true;play.textContent='Ⅱ 暂停跟拍';
      camera.play({mode:modeKey,order:model.data.experiments[modeKey].order,fromCount:from,secondsPerTarget:Number(seconds.value)});
    }else{
      if(timer!==null){stop();return;}
      if(!stepSize)return;
      if(percent>=100)move(0);
      play.textContent='Ⅱ 暂停';
      timer=setInterval(()=>{if(percent>=100){stop();return;}move(percent+stepSize);},260);
    }
  }
  async function expand(){
    if(busy||disposed)return;
    if(opened){
      stop();opened=false;body.hidden=true;collapse.textContent='▾';
      for(const [crop,model] of models){model.setVisible(false);await restoreLayer(crop);}
      releaseContinuousRender(OWNER);emit();return;
    }
    opened=true;body.hidden=false;collapse.textContent='▴';holdContinuousRender(OWNER);
    await syncSelection();
  }
  function selectCrop(event){
    const crop=event.target.value;if(!SPECS[crop])return;
    if(event.target.checked)selected.add(crop);else{
      if(selected.size===1){event.target.checked=true;status.textContent='请至少保留一种作物。';return;}
      selected.delete(crop);
    }
    renderFocusOptions();if(opened){updateStats();void syncSelection();}
  }
  function changeFocus(){stop();focusCrop=focus.value;applyState();}
  function onManualMove(){stop();move(slider.value);}
  function onFollowChange(){stop();followExtra.hidden=!follow.checked;play.disabled=!follow.checked&&stepSize===0;}
  function onPointer(){if(camera.isRunning())stop('user');}
  function onBest(){
    stop();window.dispatchEvent(new CustomEvent('gev:earth-spin-pause',{detail:{durationMs:2800}}));
    viewer.trackedEntity=undefined;viewer.camera.cancelFlight();
    viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(20,19,25_000_000),
      orientation:{heading:0,pitch:-Cesium.Math.PI_OVER_TWO,roll:0},duration:1.6});
  }
  const unsubs=[];const listen=(x,event,fn,options)=>{x.addEventListener(event,fn,options);unsubs.push(()=>x.removeEventListener(event,fn,options));};
  listen(toggle,'click',()=>void expand());listen(collapse,'click',()=>void expand());
  for(const box of checkboxes.values())listen(box,'change',selectCrop);
  listen(focus,'change',changeFocus);listen(mode,'change',()=>{stop();modeKey=mode.value;move(0);});
  listen(step,'input',()=>{stop();stepSize=Number(step.value);stepValue.textContent=`${stepSize.toFixed(2)}%`;play.disabled=!follow.checked&&stepSize===0;});
  listen(slider,'input',onManualMove);listen(play,'click',onPlay);listen(reset,'click',()=>{stop();move(0);});
  listen(follow,'change',onFollowChange);listen(seconds,'input',()=>{secondsValue.textContent=`${Number(seconds.value).toFixed(1)} 秒`;});
  listen(bestView,'click',onBest);
  listen(viewer.canvas,'pointerdown',onPointer,true);
  listen(viewer.canvas,'wheel',onPointer,{capture:true,passive:true});
  listen(viewer.canvas,'touchstart',onPointer,{capture:true,passive:true});
  const frame=viewer.scene.preRender.addEventListener(()=>{
    if(!opened||disposed)return;
    for(const key of selected)models.get(key)?.animate(performance.now());
  });
  return ()=>{
    if(disposed)return;disposed=true;loadingToken++;stop();frame();unsubs.forEach(fn=>fn());
    releaseContinuousRender(OWNER);
    for(const [crop,model] of models){model.dispose();void restoreLayer(crop);}
    root.remove();style.remove();
  };
}
