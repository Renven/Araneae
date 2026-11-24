const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const poseKeys=['headYaw','headPitch','headLift','bodyYaw','bodyPitch','bodyRoll','height','leanX','leanZ'];
const zero=()=>Object.fromEntries(poseKeys.map(k=>[k,0]));

// Deliberate, finite gestures: turn toward something, hold attention, then move.
// The private RNG never changes the locomotion controller's random sequence.
export class PatrolBehavior {
 constructor(seed=924731){
  this.seed=seed;this.phase='travel';this.age=0;this.clock=0;this.plan=[];this.index=0;this.leg='long';this.legs=0;
  this.pose=zero();this.active=false;this.completedLooks=0;
  // Standing gestures must not change the patrol's route or gesture sequence.
  this.idleSeed=(seed^0x6d2b79f5)>>>0;this.idlePhase='pause';this.idleAge=0;this.idleDuration=.7;this.idleTime=0;this.idleIndex=0;
 }
 random(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
 nextLeg(){this.legs++;return this.legs===1?'long':this.legs===2?'short':this.random()<.55?'short':'long';}
 beginTravel(kind){this.leg=kind;this.phase='travel';this.age=0;this.plan=[];this.index=0;}
 get travelFactor(){return this.leg==='short'?.65:1;}
 get observing(){return this.active&&this.phase!=='travel';}
 get label(){return {pause:'停步倾听',left:'看看左边',right:'看看右边',inspect:'俯身探看',listen:'抬头留意',ready:'准备出发',travel:this.leg==='short'?'小步巡视':'巡逻前进'}[this.phase];}
 startLook(){
  const side=this.random()<.5?'left':'right',other=side==='left'?'right':'left';
  const item=(name,base,spread=.2)=>({name,duration:base+this.random()*spread});
  this.plan=this.random()<.6?
   [item('pause',.07,.04),item(side,.5,.2),item(other,.55,.25),item('inspect',.4,.2),item('ready',.12,.04)]:
   [item('pause',.07,.04),item('listen',.5,.25),item(side,.55,.25),item('ready',.12,.04)];
  this.index=0;this.phase=this.plan[0].name;this.age=0;
 }
 tick(dt,{enabled,settled,idle=false,arriving=false,headingError=0}){
  this.clock+=dt;this.active=enabled;let requestMove=false;const target=zero();
  const resting=idle&&!enabled&&!arriving;
  if(resting){
   this.idleTime+=dt;
   // Let braking and upright recovery finish before adding a standing gesture.
   if(this.idleTime>.65){
    this.idleAge+=dt;
    if(this.idleAge>=this.idleDuration){
     this.idleSeed=(Math.imul(this.idleSeed,1664525)+1013904223)>>>0;
     const choice=this.idleSeed/4294967296;
     if(this.idlePhase==='pause'){
      // Alternate visible side looks with vertical gestures; repeated subtle
      // nods otherwise look frozen from the desktop's overhead camera.
      this.idlePhase=this.idleIndex%2===0?(this.idleIndex%4===0?'left':'right'):(choice<.5?'inspect':'listen');
      this.idleIndex++;this.idleDuration=1.4+choice*.6;
     }else {this.idlePhase='pause';this.idleDuration=1.2+choice;}
     this.idleAge=0;
    }
   }
  }else {this.idleTime=0;this.idleAge=0;this.idlePhase='pause';this.idleDuration=.7;}
  if(!enabled||arriving){this.phase='travel';this.age=0;this.plan=[];}
  else if(this.phase==='travel'){
   if(settled)this.startLook();
   else {target.headYaw=clamp(headingError*.35,-.18,.18);target.headPitch=.025;}
  }else{
   this.age+=dt;
   if(this.age>=this.plan[this.index].duration){
    this.index++;this.age=0;
    if(this.index===this.plan.length){this.completedLooks++;this.phase='travel';requestMove=true;}
    else this.phase=this.plan[this.index].name;
   }
  }
  const phase=enabled&&!arriving?this.phase:resting&&this.idleTime>.65?this.idlePhase:'travel';
  if(phase!=='travel'){
   const side=phase==='left'?-1:phase==='right'?1:0;
   if(side){target.headYaw=side*.32;target.bodyYaw=side*.09;target.bodyRoll=-side*.025;target.height=1.1;target.headLift=.45;}
   if(phase==='inspect'){target.headPitch=-.15;target.bodyPitch=-.045;target.height=-.7;target.leanZ=-3;target.headLift=-.4;}
   if(phase==='listen'){target.headPitch=.14;target.headYaw=.16;target.bodyYaw=.035;target.bodyPitch=.02;target.height=2;target.headLift=.7;}
   if(phase==='pause'){target.headPitch=.06;target.height=.6;}
   if(phase==='ready'){target.bodyPitch=-.02;target.leanZ=-1;}
   if(resting){
    if(side){target.headYaw=side*.48;target.bodyYaw=side*.21;target.bodyRoll=-side*.035;target.leanX=side*4;}
    if(phase==='inspect'){target.headPitch=-.22;target.bodyPitch=-.085;target.height=-1.5;target.leanZ=-7;}
    if(phase==='listen'){target.headPitch=.22;target.bodyPitch=.055;target.height=3;target.leanZ=3;target.headLift=1.5;}
   }
   if(phase!=='ready')target.height+=Math.sin(this.clock*Math.PI*2/3.1)*(resting?1.4:.25);
  }
  for(const key of poseKeys){
   const gain=arriving||(!enabled&&!resting)?20:resting?(key.startsWith('head')?4:3):key.startsWith('head')?15:8;
   this.pose[key]+=(target[key]-this.pose[key])*(1-Math.exp(-dt*gain));
   if(Math.abs(this.pose[key])<1e-6)this.pose[key]=0;
  }
  return {requestMove};
 }
}
