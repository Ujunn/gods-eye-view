import * as Cesium from 'cesium';
import { holdContinuousRender, releaseContinuousRender } from '../renderGovernor.js';

const CAMERA_OWNER = 'resilience-attack-follow';
const SPIN_OWNER = 'resilience-attack-follow';
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * One-target-at-a-time replay. The supplied order is already computed from
 * FAOSTAT by prepare.py; this camera controller NEVER reranks attacks.
 * All timers, flights, and render holds are cancellable on user input.
 */
export function createResilienceAttackFollow({
  viewer, getNode, getEdge, onAttack, onPhase, onEnd,
}) {
  if (!viewer?.camera || !viewer?.scene) throw new TypeError('A Cesium viewer is required');
  let running = false;
  let epoch = 0;
  let waitTimer = null;
  let resolveWait = null;
  let resolveFlight = null;
  let ourFlight = false;

  function releaseCamera() {
    releaseContinuousRender(CAMERA_OWNER);
    window.dispatchEvent(new CustomEvent('gev:earth-spin-resume', {
      detail: { owner: SPIN_OWNER },
    }));
  }

  function stop(reason = 'paused') {
    const wasRunning = running;
    running = false;
    epoch++;
    if (waitTimer !== null) clearTimeout(waitTimer);
    waitTimer = null;
    const settleWait = resolveWait;
    resolveWait = null;
    settleWait?.();
    if (ourFlight && !viewer.isDestroyed?.()) {
      ourFlight = false;
      viewer.camera.cancelFlight();
    }
    const settleFlight = resolveFlight;
    resolveFlight = null;
    settleFlight?.();
    if (wasRunning) {
      releaseCamera();
      onEnd?.(reason);
    }
  }

  function wait(ms) {
    return new Promise(resolve => {
      resolveWait = () => { resolveWait = null; resolve(); };
      waitTimer = setTimeout(() => {
        waitTimer = null;
        resolveWait?.();
      }, ms);
    });
  }

  function focusTarget(mode, id, durationSeconds) {
    const isNode = mode.startsWith('node-');
    let sphere;
    let range;
    let pitch;
    let name;
    try {
      if (isNode) {
        const n = getNode(id);
        if (!n || !Number.isFinite(n.lon) || !Number.isFinite(n.lat)) return Promise.resolve(null);
        sphere = new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(n.lon, n.lat), 400_000);
        range = 5_900_000;
        pitch = -Cesium.Math.PI_OVER_TWO + .13;
        name = n.name || id;
      } else {
        const edge = getEdge(id);
        if (!edge) return Promise.resolve(null);
        const a = getNode(edge.source), b = getNode(edge.target);
        if (!a || !b) return Promise.resolve(null);
        const start = Cesium.Cartographic.fromDegrees(a.lon, a.lat);
        const end = Cesium.Cartographic.fromDegrees(b.lon, b.lat);
        const geodesic = new Cesium.EllipsoidGeodesic(start, end);
        const points = [];
        const elevation = Math.min(1_100_000, Math.max(140_000, geodesic.surfaceDistance * .1));
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const p = geodesic.interpolateUsingFraction(t);
          points.push(Cesium.Cartesian3.fromRadians(
            p.longitude, p.latitude, 16_000 + Math.sin(t * Math.PI) * elevation,
          ));
        }
        sphere = Cesium.BoundingSphere.fromPoints(points);
        range = clamp(sphere.radius * 3.3, 6_600_000, 26_000_000);
        pitch = -Cesium.Math.PI_OVER_TWO + .18;
        name = `${a.name || a.id} → ${b.name || b.id}`;
      }
    } catch (error) {
      console.warn('[Resilience Follow] Focus calculation failed:', error);
      return Promise.resolve(null);
    }
    if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return Promise.resolve(name);
    viewer.trackedEntity = undefined;
    // Preserve Cesium's usual drag/zoom semantics. We never disable the camera controller.
    return new Promise(resolve => {
      let finished = false;
      const settle = () => {
        if (finished) return;
        finished = true;
        resolveFlight = null;
        ourFlight = false;
        resolve(name);
      };
      resolveFlight = settle;
      ourFlight = true;
      try {
        viewer.camera.flyToBoundingSphere(sphere, {
          duration: durationSeconds,
          offset: new Cesium.HeadingPitchRange(0, pitch, range),
          complete: settle,
          cancel: settle,
        });
      } catch (error) {
        console.warn('[Resilience Follow] Camera flight failed:', error);
        settle();
      }
    });
  }

  async function play({ mode, order, fromCount = 0, secondsPerTarget = 4 }) {
    stop('superseded');
    if (!Array.isArray(order) || !order.length) return false;
    if (fromCount >= order.length) return false;
    const generation = ++epoch;
    running = true;
    const duration = clamp(secondsPerTarget, 2, 10);
    holdContinuousRender(CAMERA_OWNER);
    window.dispatchEvent(new CustomEvent('gev:earth-spin-suspend', {
      detail: { owner: SPIN_OWNER },
    }));
    try {
      for (let i = fromCount; i < order.length; i++) {
        if (!running || generation !== epoch) return true;
        const id = order[i];
        const secondsToFly = Math.min(1.45, duration * .38);
        const targetLabel = mode.startsWith('node-')
          ? (getNode(id)?.name || id)
          : (() => { const e=getEdge(id), a=e&&getNode(e.source), b=e&&getNode(e.target);
              return e ? `${a?.name||e.source} → ${b?.name||e.target}` : id; })();
        onPhase?.({ phase: 'locating', id, name: targetLabel, index: i + 1, total: order.length });
        const targetName = await focusTarget(mode, id, secondsToFly);
        if (!running || generation !== epoch) return true;
        onAttack?.({ id, index: i + 1, total: order.length, name: targetName });
        onPhase?.({ phase: 'attacked', id, index: i + 1, total: order.length, name: targetName });
        await wait(Math.max(400, duration * 1000 - secondsToFly * 1000));
      }
      if (running && generation === epoch) stop('finished');
    } catch (error) {
      console.error('[Resilience Follow] Replay interrupted:', error);
      if (running && generation === epoch) stop('error');
    }
    return true;
  }

  return { play, stop, isRunning: () => running };
}

/**
 * UI adapter for v5 resilienceLab, intentionally not changing its algorithms,
 * attack data, six score definitions or existing speed slider.
 */
export function installResilienceFollowUi({ viewer }) {
  const root = document.getElementById('gev-resilience-root');
  const body = root?.querySelector('.gev-lab-body');
  const slider = body?.querySelector('input[aria-label="攻击程度百分比"]');
  const mode = body?.querySelector('select');
  const actions = body?.querySelector('.gev-lab-actions');
  const playButton = actions?.querySelector('button');
  const resetButton = actions?.querySelectorAll('button')[1];
  const stepInput = body?.querySelector('input.gev-attack-step');
  if (!root || !body || !slider || !mode || !playButton || !resetButton || !stepInput)
    throw new Error('[Resilience Follow] 未检测到 v5 韧性实验室界面');

  const styles = document.createElement('style');
  styles.textContent = `
    #gev-resilience-root .gev-follow-panel{border:1px solid #31536a;background:#091c2b;border-radius:9px;padding:10px;margin:4px 0 13px}
    #gev-resilience-root .gev-follow-panel label{display:flex;align-items:center;gap:7px;cursor:pointer;letter-spacing:0;color:#9cdfff;font-size:12px;margin:0}
    #gev-resilience-root .gev-follow-panel input[type=checkbox]{accent-color:#35d0ff}
    #gev-resilience-root .gev-follow-controls{margin-top:11px}
    #gev-resilience-root .gev-follow-controls[hidden]{display:none}
    #gev-resilience-root .gev-follow-controls .gev-follow-flex{display:flex;justify-content:space-between;align-items:center;color:#a2c9dc}
    #gev-resilience-root .gev-follow-controls input[type=range]{width:100%;accent-color:#35d0ff;margin:4px 0}
    #gev-resilience-root .gev-follow-status{font-size:10px;color:#ff9eab;line-height:1.6;min-height:14px;margin-top:6px;white-space:pre-wrap}
    #gev-resilience-root .gev-follow-hint{color:#819bb0;font-size:10px;margin-top:4px}`;
  document.head.appendChild(styles);
  const panel = document.createElement('div');
  panel.className = 'gev-follow-panel';
  const label = document.createElement('label');
  const checked = document.createElement('input');
  checked.type = 'checkbox';
  checked.setAttribute('aria-label', '开启攻击镜头跟拍');
  label.append(checked, document.createTextNode('🎥 攻击镜头跟拍（逐个目标）'));
  const config = document.createElement('div');config.className='gev-follow-controls';config.hidden=true;
  const speedLine = document.createElement('div');speedLine.className='gev-follow-flex';
  const speedTitle = document.createElement('span');speedTitle.textContent='单个目标演示周期';
  const speedValue = document.createElement('output');speedValue.textContent='4.0 秒';
  speedLine.append(speedTitle,speedValue);
  const seconds = document.createElement('input');seconds.type='range';seconds.min='2';seconds.max='10';seconds.step='0.5';seconds.value='4';
  seconds.setAttribute('aria-label','每次目标跟拍秒数');
  const help = document.createElement('div');help.className='gev-follow-hint';
  help.textContent='摄像机飞向目标 → 标红 → 停留。手动拖拽或缩放会暂停。';
  const status = document.createElement('div');status.className='gev-follow-status';
  config.append(speedLine,seconds,help,status);panel.append(label,config);
  slider.insertAdjacentElement('afterend',panel);

  let disposed=false, loading=null, network=null;
  let nodeLookup=new Map(),edgeLookup=new Map(),runningRequest=0;
  const edgeFocus = viewer.entities.add({
    id:'gev-resilience-follow-edge-focus',show:false,
    polyline:{positions:[Cesium.Cartesian3.ZERO,Cesium.Cartesian3.UNIT_X],arcType:Cesium.ArcType.NONE,
      width:4.2,material:new Cesium.ColorMaterialProperty(Cesium.Color.fromCssColorString('#ff2b45'))},
  });
  const nodeFocus = viewer.entities.add({
    id:'gev-resilience-follow-node-focus',show:false,position:Cesium.Cartesian3.ZERO,
    point:{pixelSize:15,color:Cesium.Color.fromCssColorString('#ff2b45'),
      outlineColor:Cesium.Color.WHITE.withAlpha(.7),outlineWidth:2},
  });
  const presenter = createResilienceAttackFollow({
    viewer,
    getNode:id=>nodeLookup.get(id),
    getEdge:id=>edgeLookup.get(id),
    onPhase:({phase,id,index,total,name})=>{
      if(phase==='locating') {
        edgeFocus.show=false; nodeFocus.show=false;
        status.textContent=`◎ 正在锁定第 ${index} / ${total} 个目标：${name || describeTarget(id)}`;
      } else {
        status.textContent=`🔴 已攻击 ${index} / ${total}：${name || describeTarget(id)} · 停留观察`;
      }
    },
    onAttack:({id,index,total})=>{
      if(disposed)return;
      // V5 accepts a 0.01%-precision slider. For the 2022 soybean graph this
      // exact threshold advances the actual removed object count by one.
      const percent=Math.min(100,Math.ceil(index * 10000 / total - 1e-8)/100);
      slider.value=String(percent);
      slider.dispatchEvent(new Event('input',{bubbles:true}));
      highlightTarget(mode.value,id);
      playButton.textContent='Ⅱ 暂停跟拍';
    },
    onEnd:reason=>{
      playButton.textContent='▶ 播放';
      if(reason==='finished')status.textContent='所有目标已攻击完成。';
      if(reason==='user')status.textContent='你已手动调整视角。点击播放可继续攻击。';
      if(reason==='error')status.textContent='跟拍出错，请查看浏览器控制台。';
    },
  });

  function describeTarget(id) {
    const node=nodeLookup.get(id);
    if(node)return node.name||id;
    const edge=edgeLookup.get(id);
    if(edge){const a=nodeLookup.get(edge.source),b=nodeLookup.get(edge.target);return `${a?.name||edge.source} → ${b?.name||edge.target}`;}
    return id;
  }
  function highlightTarget(attackMode,id) {
    edgeFocus.show=false;nodeFocus.show=false;
    if(attackMode.startsWith('node-')) {
      const node=nodeLookup.get(id);
      if(!node)return;
      nodeFocus.position=Cesium.Cartesian3.fromDegrees(node.lon,node.lat,72_000);
      nodeFocus.show=true;
      return;
    }
    const edge=edgeLookup.get(id);
    if(!edge)return;
    const a=nodeLookup.get(edge.source),b=nodeLookup.get(edge.target);
    if(!a||!b)return;
    try {
      const start=Cesium.Cartographic.fromDegrees(a.lon,a.lat);
      const end=Cesium.Cartographic.fromDegrees(b.lon,b.lat);
      const g=new Cesium.EllipsoidGeodesic(start,end);
      const lift=Math.min(1_100_000,Math.max(140_000,g.surfaceDistance*.1));
      const positions=[];
      for(let i=0;i<=40;i++){
        const t=i/40,p=g.interpolateUsingFraction(t);
        // Offset above the regular arc to avoid depth fighting with an existing line.
        positions.push(Cesium.Cartesian3.fromRadians(p.longitude,p.latitude,
          66_000 + Math.sin(t*Math.PI)*lift));
      }
      edgeFocus.polyline.positions=positions;
      edgeFocus.show=true;
    } catch(error){console.warn('[Resilience Follow] highlight unavailable',error);}
  }
  function stop(reason='paused') {
    runningRequest++;
    presenter.stop(reason);
    playButton.textContent='▶ 播放';
  }
  async function ensureNetwork() {
    if(network)return network;
    if(!loading) loading=fetch('/data/resilience/soybeans_2022_lab.json').then(r=>{
      if(!r.ok)throw new Error(`无法读取大豆网络 JSON (${r.status})`);
      return r.json();
    }).then(data=>{
      if(data?.meta?.crop!=='soybeans'||!data?.meta?.fullNetwork||!data.experiments||!Array.isArray(data.nodes)||!Array.isArray(data.edges))
        throw new Error('完整网络数据格式不正确');
      network=data;
      nodeLookup=new Map(data.nodes.map(n=>[n.id,n]));
      edgeLookup=new Map(data.edges.map(e=>[e.id,e]));
      return data;
    }).finally(()=>{loading=null;});
    return loading;
  }

  function handlePlayClick(event) {
    if(!checked.checked)return;
    // The existing v5 play handler would otherwise launch a second timer.
    event.preventDefault();event.stopImmediatePropagation();
    if(disposed||body.hidden)return;
    if(presenter.isRunning()){stop();return;}
    const request=++runningRequest;
    status.textContent='准备完整网络和攻击顺序...';
    ensureNetwork().then(data=>{
      if(disposed||request!==runningRequest||body.hidden||!checked.checked)return;
      const exp=data.experiments[mode.value];
      if(!exp?.order?.length)throw new Error('缺少当前攻击模式的目标序列');
      let count=Math.floor(exp.order.length*Number(slider.value)/100 + 1e-9);
      if(count>=exp.order.length){slider.value='0';slider.dispatchEvent(new Event('input',{bubbles:true}));count=0;}
      playButton.textContent='Ⅱ 暂停跟拍';
      presenter.play({mode:mode.value,order:exp.order,fromCount:count,secondsPerTarget:Number(seconds.value)});
    }).catch(error=>{playButton.textContent='▶ 播放';status.textContent=`启动失败：${error.message}`;});
  }
  function onModeChange(){stop();edgeFocus.show=false;nodeFocus.show=false;}
  function onManualSlider(event){if(event.isTrusted){stop();edgeFocus.show=false;nodeFocus.show=false;}}
  function onToggle(){stop();config.hidden=!checked.checked;status.textContent=checked.checked?'开启后点击「播放」开始逐个攻击。':'';playButton.disabled=(!checked.checked && Number(stepInput.value)===0);}
  function onSpeed(){speedValue.textContent=`${Number(seconds.value).toFixed(1)} 秒`;}
  function onReset(){stop();edgeFocus.show=false;nodeFocus.show=false;status.textContent='';}
  function onCameraManual(){if(presenter.isRunning())stop('user');}
  function onStepChanged(){if(checked.checked)playButton.disabled=false;}
  const observer=new MutationObserver(()=>{if(body.hidden){stop();edgeFocus.show=false;nodeFocus.show=false;}});
  observer.observe(body,{attributes:true,attributeFilter:['hidden']});
  playButton.addEventListener('click',handlePlayClick,true);
  checked.addEventListener('change',onToggle);
  seconds.addEventListener('input',onSpeed);
  mode.addEventListener('change',onModeChange,true);
  slider.addEventListener('input',onManualSlider,true);
  resetButton.addEventListener('click',onReset,true);
  stepInput.addEventListener('input',onStepChanged);
  viewer.canvas.addEventListener('pointerdown',onCameraManual,true);
  viewer.canvas.addEventListener('wheel',onCameraManual,{capture:true,passive:true});
  viewer.canvas.addEventListener('touchstart',onCameraManual,{capture:true,passive:true});

  return () => {
    if(disposed)return;disposed=true;stop();observer.disconnect();
    playButton.removeEventListener('click',handlePlayClick,true);
    checked.removeEventListener('change',onToggle);
    seconds.removeEventListener('input',onSpeed);
    mode.removeEventListener('change',onModeChange,true);
    slider.removeEventListener('input',onManualSlider,true);
    resetButton.removeEventListener('click',onReset,true);
    stepInput.removeEventListener('input',onStepChanged);
    viewer.canvas.removeEventListener('pointerdown',onCameraManual,true);
    viewer.canvas.removeEventListener('wheel',onCameraManual,true);
    viewer.canvas.removeEventListener('touchstart',onCameraManual,true);
    if(!viewer.isDestroyed?.()){
      viewer.entities.remove(edgeFocus);
      viewer.entities.remove(nodeFocus);
    }
    panel.remove();styles.remove();
  };
}
