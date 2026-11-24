import {Vector3,MathUtils} from './assets/three.module.js';
const clamp=MathUtils.clamp,up=new Vector3(0,1,0);
const angleDelta=(to,from)=>Math.atan2(Math.sin(to-from),Math.cos(to-from));
const recoveryTime=.26;

// Contact beats drive both propulsion and the short, critically damped body response.
export class MechanicalMotion {
 constructor(position,velocity,heading){
  Object.assign(this,{position,velocity,heading,angularVelocity:0,phase:'idle',age:0,clock:0,runAge:0,gaitPhase:0,gaitRate:0,strideLength:220,contactAge:1,contactSign:1,contactEnergy:0,crouch:0,effort:0,wakePending:false});
  this.direction=new Vector3(-Math.sin(heading),0,-Math.cos(heading));
  this.acceleration=new Vector3();this.previousVelocity=new Vector3();
  this.previousPosition=position.clone();this.displacement=new Vector3();
  this.skid=null;this.skidSequence=0;this.skidArmed=true;this.arrivedGoal=null;
  this.pose={height:0,pitch:0,roll:0,brace:0,lag:new Vector3()};
 }
 get arriving(){return this.skid!==null;}
 get label(){return this.skid?.stage==='recover'?'起身回正':{idle:'驻停',load:'收腿蓄力',charge:'爆发推进',turn:'收腿转向',brake:'抓地制动',skid:'刹不住了！',recover:'前足抓地稳住'}[this.phase];}
 isAtGoal(goal,size){return this.arrivedGoal!==null&&goal.distanceTo(this.arrivedGoal)<15*size/1.5;}
 wake(){this.wakePending=true;this.arrivedGoal=null;this.skidArmed=true;}
 anchorFrontFeet(legs){
  const s=this.skid;if(s?.stage!=='catch'||s.frontAnchors)return;
  s.frontAnchors=legs.map(l=>({i:l.i,point:l.foot.clone()}));
  const center=legs.reduce((p,l)=>p.add(l.foot),new Vector3()).multiplyScalar(1/legs.length);
  const neutralReach=legs.reduce((n,l)=>n-l.localIdeal.z*s.size,0)/legs.length;
  // Desktop dashes reserve a short forward rise before reaching the click.
  // Keep the planted toes fixed and finish that rise at the requested goal.
  if(s.precise){s.uprightStop=s.goal.clone();return;}
  // Stand back under the planted forefeet. Only a short forward correction is
  // allowed: it cannot rewind the whole spider toward the original cursor.
  const correction=clamp(center.sub(s.stop).dot(s.direction)-neutralReach,0,28*s.size);
  s.uprightStop=s.stop.clone().addScaledVector(s.direction,correction);
 }
 land(sign=1){this.contactAge=0;this.contactSign=sign;this.contactEnergy=1;}
 setPhase(phase){if(this.phase!==phase){this.phase=phase;this.age=0;}}
 tick(dt,{goal,moving,size,speed,mode='roam',skidLimit=Infinity,sprint=false,preciseArrival=false}){
  if(dt<=0)return;
  this.clock+=dt;this.age+=dt;this.contactAge+=dt;
  const scale=size/1.5,delta=goal.clone().sub(this.position).setY(0),distance=delta.length();
  const precise=preciseArrival&&sprint,stopRadius=(precise?2:25)*scale;
  if(this.arrivedGoal&&!this.isAtGoal(goal,size))this.arrivedGoal=null;
  this.previousPosition.copy(this.position);this.previousVelocity.copy(this.velocity);
  if(this.skid&&(!moving||goal.distanceTo(this.skid.goal)>30*scale||size!==this.skid.size)){
   this.skid=null;this.skidArmed=true;this.setPhase('charge');
  }
  if(!this.skid&&distance>140*scale)this.skidArmed=true;
  const needsMove=moving&&distance>stopRadius&&!this.isAtGoal(goal,size);
  const incoming=this.velocity.length();
  const aligned=incoming>0&&distance>0?this.velocity.dot(delta)/(incoming*distance):0;
  // Ordinary walking stops normally. Explicit dashes also permit a small skid
  // on short routes; long dashes retain their full speed-based momentum.
  const kineticArrival=incoming>900*scale||(sprint&&incoming>120*scale);
  const recoveryDistance=precise?Math.min(20*size,distance*.25):0;
  // Start the slide using the incoming momentum, leaving its entire braking
  // distance and forward recovery before the destination instead of after it.
  const skidStart=precise?incoming*incoming/(12500*scale)+recoveryDistance+incoming*.035
    :25*scale+incoming*.085;
  if(!this.skid&&this.skidArmed&&needsMove&&kineticArrival&&aligned>.97&&
    (this.phase==='charge'||this.phase==='brake')&&distance<skidStart){
   const overrun=precise?0:Math.min(Math.max((incoming/scale)**2/12500*scale,sprint?18*scale:0),Math.max(0,skidLimit));
   if(precise||overrun>3*scale){
    const direction=(precise?delta:this.velocity).clone().normalize();
    const travel=precise?distance-recoveryDistance:delta.dot(direction)+overrun;
    this.skid={id:++this.skidSequence,stage:'slide',elapsed:0,size,precise,goal:goal.clone(),from:this.position.clone(),
     direction,speed:incoming,overrun,duration:2*travel/incoming,stop:this.position.clone().addScaledVector(direction,travel),
     strength:clamp((incoming/scale-250)/900,.12,1.4)};
    this.skidArmed=false;
   }
  }
  if(this.skid){
   this.advanceSkid(dt,scale);this.updateBody(dt,size,speed,false);return;
  }
  if(needsMove)this.direction.copy(delta).normalize();
  const wanted=Math.atan2(-this.direction.x,-this.direction.z),error=angleDelta(wanted,this.heading);
  this.turnError=needsMove?error:0;
  if(needsMove&&(this.phase==='idle'||(this.phase==='brake'&&distance>100*scale))){this.setPhase('load');this.runAge=0;}
  if(needsMove){
   this.runAge+=dt;
   if(this.phase==='load'&&this.age>(Math.abs(error)>.8?.045:.075)/Math.sqrt(speed))this.setPhase(Math.abs(error)>.8?'turn':'charge');
   else if(this.phase!=='load'&&Math.abs(error)>1){if(this.phase!=='turn')this.runAge=0;this.setPhase('turn');}
   else if(this.phase==='turn'&&Math.abs(error)<.18)this.setPhase('charge');
  }else this.setPhase(this.velocity.length()>3?'brake':'idle');
  const turnCap=9.5*Math.sqrt(speed),turnTarget=needsMove&&this.phase!=='load'?clamp(error*20,-turnCap,turnCap):0;
  this.angularVelocity+=(turnTarget-this.angularVelocity)*(1-Math.exp(-dt*50));
  const turn=this.angularVelocity*dt;
  if(Math.abs(turn)>Math.abs(error)){this.heading+=error;this.angularVelocity=0;}else this.heading+=turn;
  const forward=new Vector3(-Math.sin(this.heading),0,-Math.cos(this.heading));
  const turnFactor=Math.min(clamp(1-Math.abs(error)*.8,.08,1),clamp(1-Math.abs(this.angularVelocity)*.075,.2,1));
  const burstSpeed=this.runAge<.33?710:540;
  const shove=.88+.21*Math.exp(-this.contactAge/.045);
  const top=(mode==='follow'?burstSpeed*1.06:burstSpeed)*scale*speed;
  const arrival=Math.sqrt(Math.max(0,2*6200*scale*speed*(distance-stopRadius)));
  if(needsMove&&this.phase==='charge'&&arrival<top*shove)this.setPhase('brake');
  let target=needsMove?Math.min(top*shove,arrival)*turnFactor:0;
  if(this.phase==='load')target=0;
  const current=this.velocity.length(),gain=target<current?42:28;
  let pace=current+(target-current)*(1-Math.exp(-dt*gain));
  if(!needsMove&&pace<.6)pace=0;
  // Very short dashes may not enter a slide; keep their last integration step
  // inside the destination rather than stepping past it and turning back.
  if(precise&&aligned>.97)pace=Math.min(pace,Math.max(0,distance-stopRadius)/dt);
  // Translation follows the nose; a reversal gathers feet instead of skating sideways.
  this.velocity.copy(forward).multiplyScalar(pace);
  this.position.addScaledVector(this.velocity,dt);
  this.topSpeed=top;
  this.updateBody(dt,size,speed,needsMove);
 }
 advanceSkid(dt,scale){
  const s=this.skid;s.elapsed+=dt;this.turnError=0;this.angularVelocity=0;
  this.topSpeed=Math.max(s.speed,1);
  if(s.stage==='slide'){
   this.setPhase('skid');
   const t=Math.min(s.elapsed,s.duration),u=t/s.duration;
   this.position.copy(s.from).addScaledVector(s.direction,s.speed*(t-t*t/(2*s.duration)));
   this.velocity.copy(s.direction).multiplyScalar(s.speed*(1-u));
   if(u===1){this.position.copy(s.stop);this.velocity.set(0,0,0);s.stage='catch';s.elapsed=0;}
  }else if(s.stage==='catch'){
   this.setPhase('recover');this.velocity.set(0,0,0);
   if(s.frontAnchors||s.elapsed>.045){
    s.recoveryPose={pitch:this.pose.pitch,roll:this.pose.roll,crouch:this.crouch,height:this.pose.height,brace:this.pose.brace,lag:this.pose.lag.clone()};
    s.stage='recover';s.elapsed=0;
   }
  }else{
   this.setPhase('recover');
   const u=clamp(s.elapsed/recoveryTime,0,1),ease=u*u*(3-2*u),rate=6*u*(1-u)/recoveryTime;
   const target=s.uprightStop??(s.precise?s.goal:s.stop);
   this.position.lerpVectors(s.stop,target,ease);this.velocity.copy(target).sub(s.stop).multiplyScalar(rate);
   if(s.elapsed>=recoveryTime){this.arrivedGoal=s.goal.clone();this.skid=null;this.setPhase('idle');}
  }
 }
 updateBody(dt,size,speed,needsMove){
  const scale=size/1.5,pace=this.velocity.length(),top=this.topSpeed||540*scale*speed;
  const forward=new Vector3(-Math.sin(this.heading),0,-Math.cos(this.heading));
  this.displacement.copy(this.position).sub(this.previousPosition);
  this.acceleration.copy(this.velocity).sub(this.previousVelocity).multiplyScalar(1/dt);
  this.effort=clamp(pace/Math.max(1,top),0,1);
  this.strideLength=size*145;this.gaitRate=pace/this.strideLength;this.gaitPhase+=this.gaitRate*dt;
  const settling=this.skid?.stage==='recover'?this.skid:null;
  if(settling?.recoveryPose){
   const u=clamp(settling.elapsed/recoveryTime,0,1),remaining=1-u*u*(3-2*u),p=settling.recoveryPose;
   this.pose.pitch=p.pitch*remaining;this.pose.roll=p.roll*remaining;this.crouch=p.crouch*remaining;
   this.pose.height=p.height*remaining;this.pose.brace=p.brace*remaining;this.pose.lag.copy(p.lag).multiplyScalar(remaining);
   this.contactEnergy=0;this.wakePending=false;return;
  }
  const impact=Math.exp(-this.contactAge/.032)*this.effort;
  const longForce=clamp(this.acceleration.dot(forward)/(9000*scale*speed),-1,1);
  const skid=this.skid,sliding=skid?.stage==='slide',strength=skid?.strength||0;
  const braceTarget=sliding?strength*Math.sin(Math.PI*clamp(skid.elapsed/skid.duration,0,1)):0;
  this.pose.brace+=(braceTarget-this.pose.brace)*(1-Math.exp(-dt*35));
  const crouchTarget=this.phase==='load'?5:this.phase==='charge'?1.5:this.phase==='turn'?3:this.phase==='skid'?4*strength:skid?.stage==='catch'?2.5*strength:0;
  this.crouch+=(crouchTarget-this.crouch)*(1-Math.exp(-dt*32));
  this.pose.height=-1.15*impact;
  const recoil=skid?.stage==='catch'?-.09*strength:0;
  const pitchTarget=(needsMove?-.035:0)-longForce*.07+impact*.018-.24*this.pose.brace+recoil;
  const rollTarget=clamp(-this.angularVelocity*.009+this.contactSign*impact*.012,-.065,.065);
  this.pose.pitch+=(pitchTarget-this.pose.pitch)*(1-Math.exp(-dt*35));
  this.pose.roll+=(rollTarget-this.pose.roll)*(1-Math.exp(-dt*35));
  this.pose.lag.copy(forward).multiplyScalar((-impact*.9+4*this.pose.brace)*size);
  if(!this.skid&&!needsMove&&pace<.01){
   this.pose.pitch=this.pose.roll=this.pose.height=this.pose.brace=this.crouch=0;this.pose.lag.set(0,0,0);
  }
  this.contactEnergy=impact;this.wakePending=false;
 }
}
