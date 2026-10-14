import * as Cesium from 'cesium';
import { holdContinuousRender, releaseContinuousRender, governorRequestRender } from '../renderGovernor.js';

// Paper-inspired structural attack replay, built from complete 2022 FAOSTAT data.
// This is NOT a tonne-resupply model, and the underlying data are not UN Comtrade.
const SOURCE = '/data/resilience/soybeans_2022_lab.json';
const OWNER = 'resilience-lab';
const CROP_LAYER = 'agri-soybeans-2022';
const PURPLE = Cesium.Color.fromCssColorString('#B57CFF');
const RED = Cesium.Color.fromCssColorString('#ff4d62');
const ACTIVE_MATERIAL = new Cesium.ColorMaterialProperty(PURPLE.withAlpha(.91));
const FAILED_MATERIAL = new Cesium.ColorMaterialProperty(RED);
const LABELS = Object.freeze({
  'node-targeted':'节点 · 蓄意攻击',
  'node-random':'节点 · 随机攻击',
  'edge-targeted':'边 · 蓄意攻击',
  'edge-random':'边 · 随机攻击',
});
const STYLES = `
#gev-resilience-root{position:fixed;top:103px;right:20px;width:314px;max-width:calc(100vw - 34px);z-index:2550;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#d3e1ee;letter-spacing:0;background:rgba(4,10,22,.96);border:1px solid rgba(88,177,218,.36);border-radius:12px;box-shadow:0 12px 35px #0009;overflow:hidden}
#gev-resilience-root button,#gev-resilience-root select{font:inherit;cursor:pointer}
#gev-resilience-root button{background:#11263b;border:1px solid #31536a;border-radius:7px;color:#cfedfa;padding:7px 10px}
#gev-resilience-root button:hover{border-color:#35d0ff}
#gev-resilience-root button:disabled{opacity:.45;cursor:default}
#gev-resilience-root .gev-lab-header{display:flex;align-items:center;gap:8px;padding:10px 12px}
#gev-resilience-root .gev-lab-header>button:first-child{text-align:left;flex:1;background:transparent;border:0;color:#65d9ff;font-weight:700;letter-spacing:.075em;padding:4px 0}
#gev-resilience-root .gev-lab-body{border-top:1px solid #273c52;padding:13px;max-height:calc(100vh - 200px);overflow:auto}
#gev-resilience-root label{display:block;color:#8bacc1;font-size:11px;letter-spacing:.07em;margin:0 0 6px}
#gev-resilience-root select{width:100%;background:#0b1929;color:#e5faff;border:1px solid #30516b;border-radius:7px;padding:7px}
#gev-resilience-root input[type=range]{width:100%;accent-color:#fa5c70;margin:7px 0 13px}
#gev-resilience-root .gev-lab-pct{font-size:19px;font-weight:700;color:#ff6476}
#gev-resilience-root input.gev-attack-step[type=range]{min-width:0;width:100%;margin:0;accent-color:#57d5f9;flex:1}
#gev-resilience-root .gev-step-value{min-width:54px;text-align:right;font-weight:700;font-size:12px;color:#65d9ff;font-variant-numeric:tabular-nums}
#gev-resilience-root .gev-step-line{display:flex;gap:9px;align-items:center;color:#91afc4;font-size:11px;margin-bottom:7px}
#gev-resilience-root .gev-step-help{font-size:10px;color:#7f98ab;margin:0 0 8px}
#gev-resilience-root .gev-lab-actions{flex-wrap:wrap}
#gev-resilience-root .gev-lab-hero{margin:11px 0;padding:13px;border:1px solid rgba(58,219,250,.48);background:linear-gradient(125deg,#102c3f,#06121f);border-radius:10px}
#gev-resilience-root .gev-lab-hero strong{display:block;font-size:39px;line-height:1.15;letter-spacing:-1.5px;color:#64f2ff;font-variant-numeric:tabular-nums;text-shadow:0 0 18px #38d9ff8c}
#gev-resilience-root .gev-lab-hero small{color:#9cc5d6}
#gev-resilience-root .gev-lab-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#gev-resilience-root .gev-lab-metric{background:#091827;padding:8px;border:1px solid #253d50;border-radius:7px}
#gev-resilience-root .gev-lab-metric span{display:block;color:#829daf;font-size:10px}
#gev-resilience-root .gev-lab-metric b{font-size:15px;line-height:1.6;font-variant-numeric:tabular-nums}
#gev-resilience-root .gev-lab-actions{display:flex;gap:7px;margin-top:13px}
#gev-resilience-root .gev-lab-status{font-size:10px;color:#98aabb;line-height:1.6;min-height:27px;margin:9px 0 0;white-space:pre-wrap}
#gev-resilience-root .gev-lab-foot{color:#8a99a7;font-size:10px;margin-top:10px}
`;

function arc(a,b) {
  const start=Cesium.Cartographic.fromDegrees(a.lon,a.lat);
  const end=Cesium.Cartographic.fromDegrees(b.lon,b.lat);
  const geodesic=new Cesium.EllipsoidGeodesic(start,end);
  const altitude=Math.min(1100000,Math.max(140000,geodesic.surfaceDistance*.1));
  const points=[];
  for(let i=0;i<=36;i++){
    const t=i/36,p=geodesic.interpolateUsingFraction(t);
    points.push(Cesium.Cartesian3.fromRadians(p.longitude,p.latitude,16000+altitude*Math.sin(t*Math.PI)));
  }
  return points;
}

function element(tag, cls='', txt='') {
  const el=document.createElement(tag);
  if(cls)el.className=cls;
  if(txt)el.textContent=txt;
  return el;
}

function arrowIcon() {
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=38;
  const ctx=canvas.getContext('2d');
  ctx.lineWidth=4;ctx.strokeStyle='#d6a6ff';ctx.shadowColor='#a957ff';ctx.shadowBlur=9;
  ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(6,24);ctx.lineTo(19,11);ctx.lineTo(32,24);ctx.stroke();
  return canvas;
}
function pointOnArc(points,t,out) {
  const index=t*(points.length-1);
  const i=Math.min(points.length-2,Math.floor(index));
  return Cesium.Cartesian3.lerp(points[i],points[i+1],index-i,out);
}

/** Attach an isolated, reversible research overlay to an already-started app. */
export function installResilienceLab({viewer,dataManager}) {
  if(!viewer?.scene||!dataManager) throw new TypeError('Resilience lab needs viewer and data manager');
  if(document.querySelector('#gev-resilience-root')) throw new Error('Resilience lab already installed');
  const sheet=element('style');sheet.textContent=STYLES;document.head.appendChild(sheet);
  const root=element('section');root.id='gev-resilience-root';
  const header=element('div','gev-lab-header');
  const toggle=element('button','','◉ NETWORK RESILIENCE LAB');toggle.type='button';
  const close=element('button','','▾');close.type='button';close.setAttribute('aria-label','展开或收起韧性实验');
  header.append(toggle,close);
  const body=element('div','gev-lab-body');body.hidden=true;
  const cropLabel=element('label','','研究对象：大豆 Soybeans · 2022（完整网络）');
  const modeLabel=element('label','','攻击方式');
  const mode=element('select');
  for(const [key,text] of Object.entries(LABELS)) {const opt=element('option','',text);opt.value=key;mode.appendChild(opt);}
  const bar=element('div');bar.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-top:12px';
  const attackLabel=element('label','','攻击程度');const attackPct=element('span','gev-lab-pct','0.0%');bar.append(attackLabel,attackPct);
  const precision=element('div','gev-step-line');
  const stepLabel=element('label','','步长');stepLabel.style.margin='0';
  const stepSelect=element('input','gev-attack-step');stepSelect.type='range';
  stepSelect.min='0';stepSelect.max='1';stepSelect.step='0.01';stepSelect.value='0.20';
  stepSelect.setAttribute('aria-label','自动攻击推进步长（百分比）');
  const stepReadout=element('output','gev-step-value','0.20%');
  stepReadout.setAttribute('aria-live','off');
  precision.append(stepLabel,stepSelect,stepReadout);
  const slider=element('input');slider.type='range';slider.min='0';slider.max='100';slider.step='0.01';slider.value='0';slider.setAttribute('aria-label','攻击程度百分比');
  const stepHelp=element('div','gev-step-help','可选步长 0.00%—1.00%（间隔 0.01%）。0% = 仅手动；韧性指标沿用最接近的整数百分比计算快照。');
  const hero=element('div','gev-lab-hero');
  hero.append(element('small','','网络效率保留率 · STRUCTURAL RESILIENCE'));
  const score=element('strong','','—');
  const indicator=element('small','','基准网络效率 = —');hero.append(score,indicator);
  const grid=element('div','gev-lab-grid');
  const metrics=[['平均聚类系数','clustering',3],['平均度','meanDegree',2],['平均路径长度','pathLength',2],['最大连通子图','giantFraction',1],['孤立节点比例','isolatedFraction',1],['网络效率','efficiency',4]];
  const displays={};
  for(const [label,key] of metrics) {
    const box=element('div','gev-lab-metric');box.append(element('span','',label));
    displays[key]=element('b','','—');box.append(displays[key]);grid.append(box);
  }
  const actions=element('div','gev-lab-actions');
  const play=element('button','','▶ 播放');
  const reset=element('button','','↺ 重置');
  const bestView=element('button','','◎ 最佳视角');bestView.title='返回全球网络推荐视角';
  actions.append(play,reset,bestView);
  const status=element('div','gev-lab-status','点击标题打开实验室；第一次打开时加载数据。');
  const foot=element('div','gev-lab-foot','红色=已攻击并从计算网络中移除；紫色=存活。攻击状态立即切换，不表示真实运输或贸易改道。');
  body.append(cropLabel,modeLabel,mode,precision,bar,slider,stepHelp,hero,grid,actions,status,foot);
  root.append(header,body);document.body.append(root);

  let loaded=null, nodeById=null;
  let source=null, effectsSource=null, arrowCollection=null;
  let graphicEdges=[],graphicNodes=[],movers=[];
  // Keep exactly 18 reusable red detail polylines, rather than deleting and
  // recreating them on every small attack step (which causes visible flashes).
  const EXTRA_LINE_LIMIT=18;
  const extraGraphics=[];
  let mainEdgeIds=new Set();
  let removeFrame=null, running=false, opened=false, busy=false, destroyed=false;
  let previousSoyEnabled=false, originalLayerChanged=false;
  let timer=null, percent=0, stepSize=0.2, currentMode='node-targeted';
  const setStatus=(t)=>{status.textContent=t;};
  const emit=()=>governorRequestRender('resilience-lab');
  const stop=()=>{if(timer!==null){clearInterval(timer);timer=null;}play.textContent='▶ 播放';};
  const snapshotIndex=()=>Math.round(percent);
  const read=(key)=>{let val=loaded?.experiments?.[currentMode]?.steps?.[snapshotIndex()]?.metrics?.[key];return Number.isFinite(val)?val:null;};

  function showStats() {
    const metric=loaded?.experiments[currentMode].steps[snapshotIndex()];
    attackPct.textContent=`${percent.toFixed(2)}%`;
    if(!metric){score.textContent='—';return;}
    const data=metric.metrics;
    score.textContent=`${data.efficiencyRetentionPct.toFixed(1)}%`;
    score.style.color=data.efficiencyRetentionPct<40?'#ff6877':'#64f2ff';
    indicator.textContent=`网络效率 ${data.efficiency.toFixed(4)} · 初始 ${loaded.experiments[currentMode].steps[0].metrics.efficiency.toFixed(4)}`;
    for(const [,key,digits] of metrics){
      const n=read(key);
      displays[key].textContent=n===null?'—':`${(key.endsWith('Fraction')?n*100:n).toFixed(digits)}${key.endsWith('Fraction')?'%':''}`;
    }
    const kind=currentMode.startsWith('node-')?'节点':'边';
    const actualCount=removedAtCurrentPercent();
    setStatus(`${LABELS[currentMode]} · 当前失效 ${actualCount} 个${kind}\n六项指标使用 ${snapshotIndex()}% 预计算快照 · 剩余 ${data.activeNodes} 国 / ${data.activeEdges} 条双边关系（快照）`);
  }

  function createEdge(edge,{extra=false,slot=0}={}) {
    const a=nodeById.get(edge.source),b=nodeById.get(edge.target);
    if(!a||!b)return null;
    let positions;
    try{positions=arc(a,b);}catch{return null;}
    const width=1.8; // Match the first lab version: quiet, thin network links.
    const line=(extra?effectsSource:source).entities.add({
      id:extra?`lab-extra-slot-${slot}`:`lab-edge-${edge.id}`,
      name:`${a.name} → ${b.name} · ${edge.volumeTonnes.toLocaleString()} 吨`,
      polyline:{positions,arcType:Cesium.ArcType.NONE,width:extra?3.3:width,
        material:extra?FAILED_MATERIAL:ACTIVE_MATERIAL},
    });
    if(extra)return {entity:line,edge,positions,attacked:true};
    return {entity:line,edge,positions,attacked:false};
  }

  async function initCesium() {
    if(source)return;
    source=new Cesium.CustomDataSource('2022-soybean-resilience');
    effectsSource=new Cesium.CustomDataSource('2022-soybean-resilience-affected');
    await viewer.dataSources.add(source);
    await viewer.dataSources.add(effectsSource);
    arrowCollection=viewer.scene.primitives.add(new Cesium.BillboardCollection());
    nodeById=new Map(loaded.nodes.map(n=>[n.id,n]));
    const mainEdges=loaded.edges.slice(0,120);
    graphicEdges=mainEdges.map(e=>createEdge(e)).filter(Boolean);
    mainEdgeIds=new Set(graphicEdges.map(({edge})=>edge.id));
    // Nodes are initially hidden; attacked nodes become red. Keep names for picking.
    graphicNodes=loaded.nodes.map(n=>({
      id:n.id,
      entity:source.entities.add({id:`lab-node-${n.id}`,name:n.name,
        position:Cesium.Cartesian3.fromDegrees(n.lon,n.lat,22000),
        point:{pixelSize:8,color:RED,outlineColor:Cesium.Color.WHITE.withAlpha(.5),outlineWidth:1,
          disableDepthTestDistance:0},show:false})
    }));
    const image=arrowIcon();
    // Keep directional hint lightweight: 1 moving chevron on each of the top 35 bilateral links.
    movers=graphicEdges.slice(0,35).map((g,i)=>({g,billboard:arrowCollection.add({image,width:18,height:18,
      position:g.positions[0],show:true,disableDepthTestDistance:0}),phase:(i*.233)%1}));
    const pos1=new Cesium.Cartesian3(),pos2=new Cesium.Cartesian3();
    removeFrame=viewer.scene.preRender.addEventListener(()=>{
      if(!running||viewer.isDestroyed?.())return;
      const now=performance.now();
      const seconds=now/1000;
      for(const {g,billboard,phase} of movers){
        if(!billboard.show)continue;
        const t=.02+.96*((seconds/8+phase)%1);
        const p=pointOnArc(g.positions,t,pos1);
        const ahead=pointOnArc(g.positions,Math.min(.995,t+.012),pos2);
        billboard.position=p;
        const a=Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene,p);
        const b=Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene,ahead);
        if(a&&b){const dx=b.x-a.x,dy=b.y-a.y;
          if(Math.abs(dx)+Math.abs(dy)>.01)billboard.rotation=Math.atan2(-dx,-dy);}
      }
    });
    running=true;holdContinuousRender(OWNER);
  }

  let lastDrawKey=null;
  function removedAtCurrentPercent(){
    const exp=loaded?.experiments?.[currentMode];
    return exp?Math.min(exp.order.length,Math.floor((exp.order.length*percent)/100+1e-9)):0;
  }
  function syncExtraEdges(damaged,isNode) {
    let used=0;
    for(const edge of loaded.edges) {
      if(used===EXTRA_LINE_LIMIT)break;
      if(mainEdgeIds.has(edge.id))continue;
      const attacked=isNode
        ? damaged.has(edge.source)||damaged.has(edge.target)
        : damaged.has(edge.id);
      if(!attacked)continue;
      const existing=extraGraphics[used];
      // At the same attack state, no geometry or material is touched at all.
      if(existing?.edge.id===edge.id) {
        if(!existing.entity.show)existing.entity.show=true;
        used++;
        continue;
      }
      if(!existing) {
        const created=createEdge(edge,{extra:true,slot:used});
        if(!created)continue;
        extraGraphics.push(created);
        used++;
        continue;
      }
      // A slot only changes geometry when the selected trade relationship
      // actually changes (e.g. changing mode), without destroying its Entity.
      const a=nodeById.get(edge.source),b=nodeById.get(edge.target);
      if(!a||!b)continue;
      let positions;
      try { positions=arc(a,b); } catch { continue; }
      existing.edge=edge;
      existing.positions=positions;
      existing.entity.name=`${a.name} → ${b.name} · ${edge.volumeTonnes.toLocaleString()} 吨`;
      existing.entity.polyline.positions=positions;
      if(!existing.entity.show)existing.entity.show=true;
      used++;
    }
    // Hide unused detail lines, but retain the objects for a future drag-back.
    for(let i=used;i<extraGraphics.length;i++) {
      if(extraGraphics[i].entity.show)extraGraphics[i].entity.show=false;
    }
  }

  function draw() {
    if(!loaded||!source)return;
    const exp=loaded.experiments[currentMode];
    const limit=removedAtCurrentPercent();
    const drawKey=`${currentMode}:${limit}`;
    if(drawKey===lastDrawKey)return; // no Cesium entity churn for sub-item steps
    lastDrawKey=drawKey;
    const damaged=new Set(exp.order.slice(0,limit));
    const isNode=currentMode.startsWith('node-');
    const disappeared=g=>isNode?(damaged.has(g.edge.source)||damaged.has(g.edge.target)):damaged.has(g.edge.id);
    for(const graphic of graphicEdges){
      const attacked=disappeared(graphic);
      if(attacked===graphic.attacked)continue;
      graphic.attacked=attacked;
      // One entity per trade relation. No second red overlay or progressive
      // animation: the attack slider changes color instantly and reversibly.
      graphic.entity.polyline.material=attacked?FAILED_MATERIAL:ACTIVE_MATERIAL;
      graphic.entity.polyline.width=attacked?3.3:1.8;
    }
    for(const marker of graphicNodes) {
      marker.entity.show=isNode&&damaged.has(marker.id);
    }
    for(const mover of movers) mover.billboard.show=!disappeared(mover.g);
    // Stable extras: re-use up to 18 Cesium Entities. Never removeAll()
    // during a replay: rebuilding Entity geometries on every attack step
    // caused the highlighted (non-top-120) links to blink.
    syncExtraEdges(damaged,isNode);
    emit();
  }

  function move(value) {
    // Exact display precision is 0.01%; discrete attacks and 1%-step metrics
    // remain tied to their precomputed snapshots.
    percent=Math.round(Math.min(100,Math.max(0,Number(value)||0))*100)/100;
    slider.value=String(percent);
    showStats();
    draw();
  }
  async function activate() {
    if(busy||destroyed||opened)return;
    busy=true;toggle.disabled=true;
    try {
      if(!loaded){
        setStatus('读取完整网络预计算结果...');
        const response=await fetch(SOURCE);
        if(!response.ok)throw new Error(`未找到数据 (${response.status})：请先运行 prepare.py`);
        const value=await response.json();
        if(value?.meta?.crop!=='soybeans'||value?.meta?.fullNetwork!==true||!Array.isArray(value.nodes)||!Array.isArray(value.edges)
           ||!value.experiments||!Object.keys(LABELS).every(k=>value.experiments[k]?.steps?.length===101))
          throw new Error('韧性结果 JSON 格式不符');
        loaded=value;
      }
      // Stop existing soybean animations to prevent arrows on attacked links.
      previousSoyEnabled=dataManager.isEnabled(CROP_LAYER);
      if(previousSoyEnabled){
        const result=await dataManager.setEnabled(CROP_LAYER,false,{origin:'user'});
        if(result===false)throw new Error('原有大豆图层未能关闭，请先手动关闭');
        originalLayerChanged=true;
      }
      await initCesium();
      opened=true;body.hidden=false;close.textContent='▴';
      move(percent);
      emit();
    } catch(error) {
      body.hidden=false; // Show diagnostics even if the data file is missing.
      if(originalLayerChanged){
        originalLayerChanged=false;
        try{await dataManager.setEnabled(CROP_LAYER,true,{origin:'user'});}catch(e){console.warn('[Resilience Lab] restore failed',e);}
      }
      setStatus(`打开失败：${error?.message||error}`);
      console.error('[Resilience Lab]',error);
    } finally {busy=false;toggle.disabled=false;}
  }
  async function deactivate() {
    if(busy||!opened)return;
    stop();opened=false;body.hidden=true;close.textContent='▾';
    if(source)source.show=false;
    if(effectsSource)effectsSource.show=false;
    if(arrowCollection)arrowCollection.show=false;
    running=false;releaseContinuousRender(OWNER);
    emit();
    if(originalLayerChanged) {
      originalLayerChanged=false;
      try{await dataManager.setEnabled(CROP_LAYER,true,{origin:'user'});}catch(error){console.warn('Restore soybean layer failed',error);}
    }
  }
  function resumeGraphics() {
    if(source)source.show=true;
    if(effectsSource)effectsSource.show=true;
    if(arrowCollection)arrowCollection.show=true;
    running=true;holdContinuousRender(OWNER);
  }
  async function toggleLab(){
    if(opened)await deactivate();
    else {await activate();if(opened)resumeGraphics();}
  }
  async function onToggle(){if(destroyed||busy)return;await toggleLab();}
  toggle.addEventListener('click',onToggle);close.addEventListener('click',onToggle);
  mode.addEventListener('change',()=>{stop();currentMode=mode.value;move(0);});
  slider.addEventListener('input',()=>{stop();move(slider.value);});
  stepSelect.addEventListener('input',()=>{
    const candidate=Number(stepSelect.value);
    if(!Number.isFinite(candidate))return;
    stop();
    stepSize=Math.round(Math.min(1,Math.max(0,candidate))*100)/100;
    stepReadout.textContent=`${stepSize.toFixed(2)}%`;
    play.disabled=stepSize===0;
  });
  // Arrow keys on the attack slider follow the selected fine step.
  slider.addEventListener('keydown',(event)=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();
    stop();
    const direction=event.key==='ArrowRight'?1:-1;
    move(percent+direction*(stepSize||0.01));
  });
  play.addEventListener('click',()=>{
    if(timer!==null){stop();return;}
    if(stepSize<=0)return;
    if(percent>=100)move(0);
    play.textContent='Ⅱ 暂停';
    timer=setInterval(()=>{
      if(percent>=100){stop();return;}
      move(percent+stepSize);
    },260);
  });
  reset.addEventListener('click',()=>{stop();move(0);});
  bestView.addEventListener('click',()=>{
    // Request spin pause so a running orbit never fights the camera flight.
    window.dispatchEvent(new CustomEvent('gev:earth-spin-pause',{detail:{durationMs:2600}}));
    viewer.trackedEntity=undefined;
    viewer.camera.cancelFlight();
    viewer.camera.flyTo({
      destination:Cesium.Cartesian3.fromDegrees(10,19,25_000_000),
      orientation:{heading:0,pitch:-Cesium.Math.PI_OVER_TWO,roll:0},
      duration:1.8,
    });
  });
  return () => {
    if(destroyed)return;
    destroyed=true;stop();running=false;releaseContinuousRender(OWNER);
    removeFrame?.();
    if(arrowCollection&&!viewer.isDestroyed?.())viewer.scene.primitives.remove(arrowCollection);
    if(source&&!viewer.isDestroyed?.())viewer.dataSources.remove(source,true);
    if(effectsSource&&!viewer.isDestroyed?.())viewer.dataSources.remove(effectsSource,true);
    // The manager will restore its own layers during app teardown.
    root.remove();sheet.remove();
  };
}
