import {segmentDistance} from '../dist/leg-safety.js';
const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{style:{},value:'',textContent:'',classList:{toggle(){}},addEventListener(){},setAttribute(){},append(){}});return elements.get(id);};
globalThis.innerWidth=1363;globalThis.innerHeight=936;globalThis.devicePixelRatio=1;globalThis.window=globalThis;globalThis.addEventListener=()=>{};
globalThis.document={getElementById:el,querySelectorAll:()=>[],createElement:()=>({style:{},events:{},addEventListener(k,fn){this.events[k]=fn;},setAttribute(){},getContext:()=>({}),animate(){return {};},remove(){}}),addEventListener(){},body:el('body')};
Object.defineProperty(globalThis,'performance',{value:{now:()=>0}});let frame;globalThis.requestAnimationFrame=fn=>frame=fn;
let seed=Number(process.env.GAIT_SEED||123456);Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const oldError=console.error;console.error=()=>{};await import('../dist/app.js');console.error=oldError;
const spider=window.__spider;spider.renderer.render=()=>{};


spider.state.size=Number(process.env.GAIT_SIZE||1.5);spider.state.speed=Number(process.env.GAIT_SPEED||1);
const route=process.argv.includes('--route');
const anchor=process.argv.includes('--anchor');
if(route||anchor){spider.position.set(0,0,anchor?150:0);spider.velocity.set(0,0,0);spider.motion.heading=0;spider.motion.direction.set(0,0,-1);spider.state.mode='roam';spider.goal.set(0,0,anchor?-100:-500);if(anchor)spider.state.speed=3;spider.legs.forEach(l=>{l.initialized=false;l.stepping=false;l.contactCount=0;});spider.gait.nextBeat=0;}
if(anchor){const p=spider.goal.clone().project(spider.camera);spider.renderer.domElement.events.pointerdown({clientX:(p.x+1)*innerWidth/2,clientY:(1-p.y)*innerHeight/2,target:{closest:()=>null}});}
let timestamp=0,bad=0,minGap=Infinity,maxJump=0,arrival=0;const speeds=[];let plants=0,chargeContacts=null;
let anchorRoot=null,anchorFeet=null,anchorDirection=null,stableRoot=null,anchorChecks=0,maxCorrection=0,gripTime=0;
for(let i=0;i<(route||anchor?300:1800);i++){
const previousPhase=spider.motion.phase;
const old=spider.legs.map(l=>({air:l.stepping,foot:l.foot.clone(),ready:l.initialized}));timestamp+=1000/60;frame(timestamp);
if(spider.motion.skid&&chargeContacts===null)chargeContacts=spider.legs.map(l=>l.contactCount);
if(anchor&&spider.motion.skid?.frontAnchors&&!anchorRoot){gripTime=timestamp/1000;anchorRoot=spider.position.clone();anchorDirection=spider.motion.skid.direction.clone();anchorFeet=spider.motion.skid.frontAnchors.map(a=>({i:a.i,point:a.point.clone()}));}
if(anchorRoot){
 const correction=spider.position.clone().sub(anchorRoot);maxCorrection=Math.max(maxCorrection,correction.length());
 if(correction.dot(anchorDirection)<-1e-6||correction.length()>28*spider.state.size+1e-6)throw Error('uprighting rewound the body or moved it too far');
 for(const a of anchorFeet){if(spider.legs[a.i].foot.distanceTo(a.point)>1e-6)throw Error('front foot anchor moved');anchorChecks++;}
 if(spider.motion.phase==='idle'){
  const b=spider.appearance.body,m=spider.motion;
  if(Math.abs(b.rotation.x)>1e-7||Math.abs(b.rotation.z)>1e-7||Math.abs(b.position.y-27*spider.state.size)>1e-6||m.pose.lag.length()>1e-6)throw Error('body did not regain a neutral standing pose');
  if(stableRoot&&spider.position.distanceTo(stableRoot)>1e-6)throw Error('settled body kept drifting');
  stableRoot=spider.position.clone();
 }
}
if(!spider.diagnostics.finite)throw Error('nonfinite');
let gap=Infinity;
for(let a=0;a<8;a++){const l=spider.legs[a];maxJump=Math.max(maxJump,l.foot.distanceTo(old[a].foot));if(i>0&&old[a].ready&&!old[a].air&&!l.stepping&&previousPhase!=='skid'&&spider.motion.phase!=='skid'){if(old[a].foot.distanceTo(l.foot)>1e-6)throw Error('planted foot slid outside deliberate skid');plants++;}
for(let b=a+1;b<8;b++){const m=spider.legs[b],A=[l.hip.position,l.knee.position,l.ankle.position,l.foot],B=[m.hip.position,m.knee.position,m.ankle.position,m.foot],R=[4.3,2.5,1.5];for(let x=0;x<3;x++)for(let y=0;y<3;y++)gap=Math.min(gap,segmentDistance(A[x],A[x+1],B[y],B[y+1])-(R[x]+R[y])*spider.state.size);}}
minGap=Math.min(minGap,gap);if(gap<0)throw Error('limb overlap at frame '+i+': '+gap);
if(spider.legs.filter(l=>l.stepping).length>4)throw Error('lost support set');
if(route&&i%6===0)speeds.push([+((i+1)/60).toFixed(2),+spider.velocity.length().toFixed(1)]);
if((route||anchor)&&!spider.motion.arriving&&(spider.motion.isAtGoal(spider.goal,spider.state.size)||spider.position.distanceTo(spider.goal)<30)&&spider.velocity.length()<1){if(!arrival)arrival=timestamp/1000;if(!anchor||timestamp/1000-arrival>.5)break;}}
if(anchor&&(!arrival||!anchorRoot||!stableRoot||anchorChecks<10||maxCorrection<1))throw Error('anchored upright arrival did not complete');
if(anchor&&arrival-gripTime>.34)throw Error('upright recovery hesitated too long');
if(route&&(!arrival||arrival>2.6||(chargeContacts??spider.legs.map(l=>l.contactCount)).some(n=>n>4)))throw Error('lost broad-stride burst or failed to settle after recoil');
if(route){const peak=Math.max(...speeds.map(p=>p[1])),cruise=speeds.filter(p=>p[0]>.4&&p[0]<.85).map(p=>p[1]);if(peak<Math.max(...cruise)*1.2)throw Error('lost sprint-to-cruise contrast');}
console.log(JSON.stringify({route,anchor,arrivalSeconds:arrival||undefined,recoverySeconds:anchor?arrival-gripTime:undefined,minLimbGap:+minGap.toFixed(3),plantedFootChecks:plants,frontAnchorChecks:anchorChecks||undefined,uprightCorrection:anchor?maxCorrection:undefined,contacts:route?spider.legs.map(l=>l.contactCount):undefined}));
