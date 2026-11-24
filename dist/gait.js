import {Vector3,MathUtils} from './assets/three.module.js';
import {segmentDistance} from './leg-safety.js';
const clamp=MathUtils.clamp,up=new Vector3(0,1,0);
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const v=(x=0,y=0,z=0)=>new Vector3(x,y,z);
const poseJoints=['hip','knee','ankle','foot'],poseRadii=[4.3,2.5,1.5];

// Wide angular lanes and ordered three-link legs keep the silhouette open.
export function contactTarget(leg,root,heading,size,ahead=0){
 const local=leg.localIdeal.clone().multiplyScalar(size);local.z-=ahead;
 const center=Math.atan2(leg.localIdeal.z,Math.abs(leg.localIdeal.x));
 const a=clamp(Math.atan2(local.z,local.x*leg.side),center-.25,center+.25);
 const r=clamp(Math.hypot(local.x,local.z),92*size,190*size);
 return v(leg.side*Math.cos(a)*r,0,Math.sin(a)*r).applyAxisAngle(up,heading).add(root).setY(0);
}
export function supportTurn(legs,root,heading,requested){
 let lo=-Infinity,hi=Infinity;
 for(const l of legs)if(l.initialized&&!l.stepping){
  const p=l.foot.clone().sub(root).applyAxisAngle(up,-heading),angle=Math.atan2(p.z,p.x*l.side);
  const center=Math.atan2(l.localIdeal.z,Math.abs(l.localIdeal.x));
  let a=(center-.28-angle)*l.side,b=(center+.28-angle)*l.side;if(a>b)[a,b]=[b,a];
  lo=Math.max(lo,Math.min(0,a));hi=Math.min(hi,Math.max(0,b));
 }
 return clamp(requested,lo,hi);
}
export function createLegPose(){return {hip:v(),foot:v(),knee:v(),ankle:v(),ray:v(),normal:v()};}
export function legPose(leg,root,heading,size,pose=createLegPose()){
 const {hip,foot,knee,ankle,ray,normal}=pose;
 hip.copy(leg.hip.position);foot.copy(leg.foot);
 ray.copy(foot).sub(hip).setY(0);const length=ray.length()||1;
 normal.set(-ray.z,0,ray.x).multiplyScalar(1/length);
 // Longitudinally ordered joints: no IK pole can flip a knee through its neighbor.
 const bend=leg.side*[-7,-4,4,7][leg.row]*size;
 const flex=leg.stepping?Math.sin(Math.PI*leg.swing):0;
 knee.copy(hip).lerp(foot,.38).addScaledVector(normal,bend);
 ankle.copy(hip).lerp(foot,.76).addScaledVector(normal,bend*.32);
 knee.y=Math.max(hip.y,foot.y)+17*size+flex*7*size;
 ankle.y=Math.max(7*size,foot.y+8*size)+flex*4*size;
 return pose;
}
export class BurstGait {
 constructor(legs){
  this.legs=legs;this.nextBeat=0;this.group=0;this.beat=0;this.landedBeat=-1;this.size=0;
  this.poses=legs.map(()=>createLegPose());this.candidatePose=createLegPose();
  this.original=v();this.ray=v();this.normal=v();this.offset=v();
  this.directions=Array.from({length:4},()=>v());
 }
 tick(dt,root,heading,motion,size,speed,moving){
  const legs=this.legs,clock=motion.clock;
  const skid=motion.skid,sliding=skid?.stage==='slide',braking=sliding;
  if(this.size&&this.size!==size){const ratio=size/this.size;for(const l of legs){for(const p of [l.foot,l.from,l.to])p.sub(root).multiplyScalar(ratio).add(root);if(l.detour)l.detour.multiplyScalar(ratio);if(l.lift)l.lift*=ratio;}}
  this.size=size;
  for(const l of legs){
   // During the cartoon skid the toes intentionally lose friction. Most of
   // their motion follows the slide, with a little body travel left to stretch
   // the braced legs. Ordinary planted feet remain fixed in world space.
   if(sliding&&l.initialized)for(const p of [l.foot,l.from,l.to])p.addScaledVector(motion.displacement,.86);
   l.contactAge=(l.contactAge??1)+dt;
   if(!l.initialized){l.foot.copy(contactTarget(l,root,heading,size));l.from.copy(l.foot);l.to.copy(l.foot);l.initialized=true;l.stepping=false;l.contactCount=0;l.swing=1;}
   l.ideal.copy(contactTarget(l,root,heading,size));
  }
  // Finish the throw first. The landing event is the shared propulsion beat.
  for(const l of legs)if(l.stepping){
   l.swing=Math.min(1,l.swing+dt/l.duration);const p=l.swing,t=1-Math.pow(1-p,2.5);
   l.foot.lerpVectors(l.from,l.to,t);
   const ray=l.to.clone().sub(root).setY(0).normalize();
   l.foot.addScaledVector(ray,-7*size*Math.sin(Math.PI*p));
   l.foot.y=Math.pow(Math.sin(Math.PI*p),.8)*l.lift;
   if(l.detour)l.foot.add(l.detour);
   if(p===1){if(l.detour)l.to.add(l.detour);l.foot.copy(l.to);l.foot.y=0;l.stepping=false;l.contactAge=0;l.contactCount++;
    if(l.beat>this.landedBeat){motion.land(l.gaitGroup===0?-1:1);this.landedBeat=l.beat;}
   }
  }
  if(skid&&(skid.stage==='catch'||skid.stage==='recover')){
   const front=legs.filter(l=>l.row===0);
   if(!skid.frontAnchors&&front.every(l=>!l.stepping))motion.anchorFrontFeet(front);
   for(const anchor of skid.frontAnchors??[]){
    const l=legs[anchor.i];l.foot.copy(anchor.point);l.from.copy(anchor.point);l.to.copy(anchor.point);l.stepping=false;
   }
   this.clearThrows(root,heading,size);return;
  }
  if(!moving&&motion.velocity.length()<3){this.clearThrows(root,heading,size);return;}
  const pace=motion.velocity.length(),effort=clamp(pace/(660*size/1.5*speed),0,1),turning=Math.abs(motion.angularVelocity)>1||Math.abs(motion.turnError??0)>.65;
  // Above the old speed limit, shorten throws with travel speed so planted
  // feet do not fall behind the body and crowd neighboring leg lanes.
  const cadence=speed>2?speed/Math.sqrt(2):Math.sqrt(speed);
  const interval=(braking?.055:turning?.03: .175-.045*effort)/cadence;
  const duration=clamp((braking?.035:turning?.028:.09-.023*effort)/cadence,.022,.15);
  const candidates=[];
  const beatDue=clock>=this.nextBeat;
  for(const l of legs)if(!l.stepping){
   const local=l.foot.clone().sub(root).applyAxisAngle(up,-heading),a=Math.atan2(local.z,local.x*l.side);
   const home=Math.atan2(l.localIdeal.z,Math.abs(l.localIdeal.x));
   const future=a+clamp(motion.angularVelocity*.065,-.45,.45)*l.side;
   const error=Math.max(Math.abs(wrap(a-home)),Math.abs(wrap(future-home)));
   const reach=local.length()/size;
   const driftLimit=turning?.16:speed>2?.22:.43;
   const plantedTime=turning?.018:.035/Math.max(1,speed/2);
   const urgent=(l.contactAge>plantedTime&&error>driftLimit)||local.x*l.side<32*size||reach>205||reach<65;
   const needsBrace=braking&&l.brakeId!==skid.id;
   if(urgent||(beatDue&&l.gaitGroup===this.group&&(!braking||needsBrace)))candidates.push({l,score:(urgent?10+error*8+Math.min(l.contactAge,1)*4+Math.abs(reach-140)*.01:0)});
  }
  candidates.sort((a,b)=>b.score-a.score);
  let capacity=4-legs.filter(l=>l.stepping).length,started=0;
  for(const {l} of candidates){
   if(capacity--<=0)break;
   l.from.copy(l.foot);l.detour=v();l.duration=duration;l.swing=0;l.stepping=true;l.lift=(braking?8:20)*size;l.beat=this.beat;
   l.brakeId=braking?skid.id:null;
   // Aim the next support set into the requested turn even while the old set
   // limits body rotation. Using the blocked body's actual rate here stalls it.
   const lead=turning?motion.angularVelocity*(duration+.025):(motion.appliedAngularVelocity??motion.angularVelocity)*duration*.4;
   const landingHeading=heading+clamp(lead,turning?-.28:-.06,turning?.28:.06);
   const ahead=braking?48*size:turning?0:clamp(pace*.115,22*size,65*size);
   const predicted=root.clone().addScaledVector(motion.velocity,duration*.7);
   l.to.copy(contactTarget(l,predicted,landingHeading,size,ahead));started++;
  }
  if(beatDue&&started){this.group=1-this.group;this.beat++;this.nextBeat=clock+interval;}
  // A pending group never catches up by firing several beats in one display frame.
  if(beatDue&&!started)this.nextBeat=clock+.012;
  this.clearThrows(root,heading,size);
 }
 clearThrows(root,heading,size){
  const poses=this.poses;
  for(let i=0;i<this.legs.length;i++)legPose(this.legs[i],root,heading,size,poses[i]);
  for(let i=0;i<this.legs.length;i++){
   const leg=this.legs[i];if(!leg.stepping)continue;
   if(clearanceToOthers(poses[i],poses,i,size)>=.6*size)continue;
   const {original,ray,normal,offset,directions,candidatePose}=this;
   original.copy(leg.foot);ray.copy(original).sub(root).setY(0).normalize();normal.set(-ray.z,0,ray.x);
   directions[0].copy(normal);directions[1].copy(normal).negate();
   directions[2].copy(ray);directions[3].copy(ray).negate();
   let found=false;
   for(const distance of [3,6,10,16,24]){
    for(const direction of directions){
     offset.copy(direction).multiplyScalar(distance*size);leg.foot.copy(original).add(offset);
     legPose(leg,root,heading,size,candidatePose);
     if(clearanceToOthers(candidatePose,poses,i,size)>=.6*size){found=true;break;}
    }
    if(found)break;
   }
   leg.foot.copy(original);
   if(found){
    leg.foot.add(offset);leg.detour.add(offset);
    for(const joint of poseJoints)poses[i][joint].copy(candidatePose[joint]);
   }
  }
 }

}

function poseClearance(a,b,size){
 let gap=Infinity;
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)gap=Math.min(gap,
  segmentDistance(a[poseJoints[i]],a[poseJoints[i+1]],b[poseJoints[j]],b[poseJoints[j+1]])-(poseRadii[i]+poseRadii[j])*size);
 return gap;
}

function clearanceToOthers(pose,poses,skip,size){
 let gap=Infinity;
 for(let i=0;i<poses.length;i++)if(i!==skip)gap=Math.min(gap,poseClearance(pose,poses[i],size));
 return gap;
}
