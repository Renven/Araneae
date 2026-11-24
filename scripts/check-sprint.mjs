import assert from 'node:assert/strict';
const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{style:{},value:'',textContent:'',classList:{toggle(){}},addEventListener(){},setAttribute(){},append(){}});return elements.get(id);};
globalThis.innerWidth=1363;globalThis.innerHeight=936;globalThis.devicePixelRatio=1;globalThis.window=globalThis;globalThis.addEventListener=()=>{};
globalThis.document={getElementById:el,querySelectorAll:()=>[],createElement:()=>({style:{},events:{},addEventListener(k,fn){this.events[k]=fn;},setAttribute(){},getContext:()=>({}),animate(){return {};},remove(){}}),addEventListener(){},body:el('body')};
Object.defineProperty(globalThis,'performance',{value:{now:()=>0}});let frame;globalThis.requestAnimationFrame=fn=>frame=fn;
let seed=123456;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const oldError=console.error;console.error=()=>{};await import('../dist/app.js');console.error=oldError;
const s=window.__spider;s.renderer.render=()=>{};
let stamp=0;
function step(){stamp+=1000/60;frame(stamp);assert.ok(s.diagnostics.finite);}
function command(x,y,dash=false){
 const event={clientX:x,clientY:y,button:0,target:{closest:()=>null},preventDefault(){}};
 s.renderer.domElement.events.pointerdown(event);
 if(dash){s.renderer.domElement.events.pointerdown(event);s.renderer.domElement.events.dblclick(event);assert.equal(s.sprinting,true);}
}
function arrival(){
 let peak=0,top=0,stop=false;
 for(let i=0;i<330;i++){
  step();peak=Math.max(peak,s.velocity.length());top=Math.max(top,s.motion.topSpeed);
  if(i>3&&!s.motion.arriving&&s.velocity.length()<.1&&(s.motion.isAtGoal(s.goal,s.state.size)||s.position.distanceTo(s.goal)<26)){stop=true;break;}
 }
 assert.ok(stop,'destination did not settle');
 return {peak,top,slides:s.motion.skidSequence};
}
s.state.speed=.4;command(400,310);const slow=arrival();assert.equal(slow.slides,0);
s.state.speed=1.25;command(900,310);const normal=arrival();assert.equal(normal.slides,0,'single-click walking skidded');
s.state.speed=.4;command(400,310,true);const dash=arrival();
assert.equal(dash.slides,1,'double-click dash did not skid');assert.ok(dash.top>2000&&dash.peak>1000,'dash did not use maximum speed');
assert.equal(s.state.speed,.4,'dash changed the saved walking speed');assert.equal(s.sprinting,false,'dash stayed active after stopping');
const stop=s.position.clone(),goal=stop.clone().addScaledVector(s.motion.direction,-110);
const p=goal.project(s.camera);command((p.x+1)*innerWidth/2,(1-p.y)*innerHeight/2,true);const short=arrival();
assert.equal(short.slides,2,'a second nearby dash did not rearm inertia');
command(850,330);const resumed=arrival();assert.equal(resumed.slides,2);assert.ok(resumed.peak<400,'walk did not restore its saved speed');
command(450,330,true);step();command(800,300);assert.equal(s.sprinting,false,'single click did not cancel a dash');
console.log(JSON.stringify({slow,normal,dash,short,resumed,interruption:true}));
