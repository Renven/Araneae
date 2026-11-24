import assert from 'node:assert/strict';
import {segmentDistance} from '../dist/leg-safety.js';
const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{style:{},value:'',textContent:'',classList:{toggle(){}},addEventListener(){},setAttribute(){},append(){}});return elements.get(id);};
const listeners=new Map();
globalThis.innerWidth=1363;globalThis.innerHeight=936;globalThis.devicePixelRatio=1;globalThis.window=globalThis;globalThis.addEventListener=(type,callback)=>listeners.set(type,callback);
globalThis.document={getElementById:el,querySelectorAll:()=>[],createElement:()=>({style:{},events:{},addEventListener(k,fn){this.events[k]=fn;},setAttribute(){},getContext:()=>({}),animate(){return {};},remove(){}}),addEventListener(){},body:el('body')};
Object.defineProperty(globalThis,'performance',{value:{now:()=>0}});let frame;globalThis.requestAnimationFrame=fn=>frame=fn;
let seed=Number(process.env.GAIT_SEED||123456);Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const oldError=console.error;console.error=()=>{};await import('../dist/app.js');console.error=oldError;
const spider=window.__spider;spider.renderer.render=()=>{};



spider.state.speed=Number(process.env.PATROL_SPEED||1.25);spider.state.size=Number(process.env.PATROL_SIZE||1.5);
const phases=new Set(),routes=new Set();let head=0,tilt=0,chest=0,stationaryFrames=0,previous=null,stamp=0;
for(let i=0;i<1800;i++){
 const before=spider.position.clone();stamp+=1000/60;frame(stamp);
 const p=spider.patrol,b=spider.appearance.body;phases.add(p.phase);routes.add(p.leg);
 head=Math.max(head,Math.abs(spider.appearance.head.rotation.y));tilt=Math.max(tilt,Math.abs(spider.appearance.head.rotation.x));
 const yaw=b.rotation.y-spider.motion.heading;chest=Math.max(chest,Math.abs(Math.atan2(Math.sin(yaw),Math.cos(yaw))));
 assert.ok([...Object.values(p.pose),...spider.position].every(Number.isFinite));
 if(p.observing&&spider.velocity.length()<.01&&previous?.observing&&previous.still){assert.ok(spider.position.distanceTo(before)<1e-6,'looking around moved the locomotion root');stationaryFrames++;}
 previous={observing:p.observing,still:spider.velocity.length()<.01};
}
assert.ok(routes.has('short')&&routes.has('long'),'patrol did not mix probe steps and longer walks');
assert.ok(phases.has('left')&&phases.has('right'),'patrol never looked to both sides');
assert.ok(phases.has('inspect')||phases.has('listen'),'patrol lacked a second attention gesture');
assert.ok(stationaryFrames>100&&spider.patrol.completedLooks>1,'patrol never paused to observe');
assert.ok(head>.28&&tilt>.1&&chest>.07,'head and torso did not actually animate');
spider.renderer.domElement.events.pointerdown({clientX:innerWidth*.28,clientY:innerHeight*.3,target:{closest:()=>null}});
const clicked=spider.goal.clone(); // pointer event takes effect on the next simulation tick
stamp+=1000/60;frame(stamp);clicked.copy(spider.goal);
for(let i=0;i<60;i++){stamp+=1000/60;frame(stamp);assert.equal(spider.patrol.active,false);assert.ok(spider.goal.distanceTo(clicked)<1e-6,'patrol overrode a user destination');}
console.log(JSON.stringify({phases:[...phases],routes:[...routes],stationaryFrames,completedLooks:spider.patrol.completedLooks,headYawDegrees:head*180/Math.PI,headTiltDegrees:tilt*180/Math.PI,bodyYawDegrees:chest*180/Math.PI,manualOverride:true}));

const step=(count=1)=>{for(let i=0;i<count;i++){stamp+=1000/60;frame(stamp);}};
let manualIdleFrames=0;
for(let i=0;i<240;i++){
 step();
 if(spider.patrol.idleTime>.65){
  assert.equal(spider.patrol.active,false,'Idle wait started a patrol route');
  assert.ok(spider.velocity.length()<.01,'Idle wait moved before the manual hold ended');
  manualIdleFrames++;
 }
}
assert.ok(manualIdleFrames>30,'Manual arrival never entered idle while waiting');
const idleGestures=new Set();
for(const size of [.35,.5,2.1])for(const mode of ['observe','follow']){
 spider.cancelManual();spider.state.mode=mode;spider.state.size=size;
 spider.position.set(0,0,0);spider.velocity.set(0,0,0);spider.goal.copy(spider.position);
 spider.legs.forEach(leg=>{leg.initialized=false;leg.stepping=false;});
 const point=spider.position.clone().project(spider.camera);
 listeners.get('pointermove')({clientX:(point.x+1)*innerWidth/2,clientY:(1-point.y)*innerHeight/2,target:{closest:()=>null}});
 step(120);
 const root=spider.position.clone(),feet=spider.legs.map(leg=>leg.foot.clone());
 let minHeight=Infinity,maxHeight=-Infinity,minYaw=Infinity,maxYaw=-Infinity,minPitch=Infinity,maxPitch=-Infinity;
 let minScreenX=Infinity,maxScreenX=-Infinity,minScreenY=Infinity,maxScreenY=-Infinity;
 const idlePhases=new Set();
 for(let i=0;i<1200;i++){
  step();idlePhases.add(spider.patrol.idlePhase);idleGestures.add(spider.patrol.idlePhase);
  assert.ok(spider.position.distanceTo(root)<1e-8,`${mode}: idle root drifted`);
  spider.legs.forEach((leg,index)=>assert.ok(leg.foot.distanceTo(feet[index])<1e-8,`${mode}: idle foot slid`));
  assert.ok(spider.diagnostics.finite&&Object.values(spider.patrol.pose).every(Number.isFinite));
  const height=spider.appearance.body.position.y/size,yaw=spider.appearance.head.rotation.y,pitch=spider.appearance.head.rotation.x;
  minHeight=Math.min(minHeight,height);maxHeight=Math.max(maxHeight,height);
  minYaw=Math.min(minYaw,yaw);maxYaw=Math.max(maxYaw,yaw);
  minPitch=Math.min(minPitch,pitch);maxPitch=Math.max(maxPitch,pitch);
  const silhouette=spider.appearance.body.localToWorld(root.clone().set(0,1,75)).project(spider.camera);
  const screenX=silhouette.x*innerWidth/2,screenY=silhouette.y*innerHeight/2;
  minScreenX=Math.min(minScreenX,screenX);maxScreenX=Math.max(maxScreenX,screenX);
  minScreenY=Math.min(minScreenY,screenY);maxScreenY=Math.max(maxScreenY,screenY);
  if(i%60===0)for(let a=0;a<8;a++)for(let b=a+1;b<8;b++){
   const first=spider.legs[a],second=spider.legs[b];
   const points=leg=>[leg.hip.position,leg.knee.position,leg.ankle.position,leg.foot],A=points(first),B=points(second),radii=[4.3,2.5,1.5];
   for(let x=0;x<3;x++)for(let y=0;y<3;y++)assert.ok(segmentDistance(A[x],A[x+1],B[y],B[y+1])>(radii[x]+radii[y])*size,'Idle gesture overlapped planted legs');
  }
 }
 assert.ok(maxHeight-minHeight>.6,`${mode}: idle body did not breathe`);
 assert.ok(Math.hypot(maxYaw-minYaw,maxPitch-minPitch)>.2,`${mode}: idle head did not look around`);
 if(idlePhases.has('inspect')||idlePhases.has('listen'))assert.ok(maxPitch-minPitch>.08,`${mode}: vertical idle gesture did not tilt the head`);
 assert.ok(idlePhases.has('pause')&&idlePhases.size>2,`${mode}: idle lacked gestures and rests`);
 const silhouettePixels=Math.hypot(maxScreenX-minScreenX,maxScreenY-minScreenY);
 assert.ok(silhouettePixels>16*size,`${mode}: idle silhouette movement was too small to see`);
 const paused={clock:spider.patrol.clock,body:spider.appearance.body.position.clone(),head:spider.appearance.head.quaternion.clone()};
 spider.state.paused=true;step(120);
 assert.equal(spider.patrol.clock,paused.clock,'Pause advanced idle behavior');
 assert.ok(spider.appearance.body.position.equals(paused.body)&&spider.appearance.head.quaternion.equals(paused.head),'Pause changed idle pose');
 spider.state.paused=false;step();
 assert.ok(spider.patrol.clock>paused.clock&&spider.patrol.clock-paused.clock<.02,'Resume replayed paused idle time');
 if(mode==='follow'){
  listeners.get('pointermove')({clientX:innerWidth*.7,clientY:innerHeight*.35,target:{closest:()=>null}});
  step(30);
  assert.ok(spider.position.distanceTo(root)>5,'Follow did not resume after idling');
  assert.equal(spider.patrol.idleTime,0,'Idle gesture continued during movement');
 }
 console.log(JSON.stringify({idleMode:mode,size,heightRange:maxHeight-minHeight,headYawRange:maxYaw-minYaw,silhouettePixels,idlePhases:[...idlePhases],feetFixed:true,pauseResume:true}));
}
assert.ok(['pause','left','right','inspect','listen'].every(phase=>idleGestures.has(phase)),'Idle scenarios did not cover all attention gestures');
