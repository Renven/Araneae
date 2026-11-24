import assert from 'node:assert/strict';
import {Vector3} from '../dist/assets/three.module.js';
import {MechanicalMotion} from '../dist/motion.js';

function run(speed,{size=1.5,hz=120,limit=Infinity,interrupt=false,sprint=false,distance=480}={}){
 const scale=size/1.5,position=new Vector3(-300*scale,0,0),velocity=new Vector3();
 const motion=new MechanicalMotion(position,velocity,-Math.PI/2),goal=new Vector3((-300+distance)*scale,0,0);
 let peak=0,overshoot=0,brakeSpeed=0,slides=0,releases=0,interrupted=false,grip=null,maxRewind=0;
 for(let i=0;i<hz*4;i++){
  if(interrupt&&motion.skid&&!interrupted){goal.set(-600*scale,0,0);interrupted=true;}
  motion.tick(1/hz,{goal,moving:true,size,speed,skidLimit:limit,sprint});
  assert.ok([...position,...velocity,motion.heading,motion.pose.pitch].every(Number.isFinite));
  peak=Math.max(peak,velocity.length());
  if(motion.skid){brakeSpeed=Math.max(brakeSpeed,motion.skid.speed);slides=motion.skidSequence;assert.ok(Math.abs(motion.heading+Math.PI/2)<1e-7||interrupted,'arrival made an unwanted U-turn');}
  if(!interrupt&&motion.skid?.stage==='catch'&&grip===null)grip=position.clone();
  if(grip)maxRewind=Math.max(maxRewind,position.distanceTo(grip));
  if(!interrupted)overshoot=Math.max(overshoot,position.x-goal.x);
  if(interrupted&&!motion.skid)releases++;
 }
 if(!interrupt){
  if(slides){assert.ok(grip&&maxRewind<1e-7,'body root rewound after the feet gripped');assert.ok(motion.isAtGoal(goal,size),'did not latch the actual stop');}
  else assert.ok(position.distanceTo(goal)<26*scale,'slow arrival failed to stop near destination');
  assert.ok(velocity.length()<1,'never stopped');
  assert.ok(Math.abs(motion.pose.pitch)+Math.abs(motion.pose.roll)+motion.pose.lag.length()+Math.abs(motion.crouch)<1e-7,'stopped body did not return upright');
 }
 else assert.ok(interrupted&&releases>0,'new destination did not interrupt the skid');
 return {speed,size,hz,peak,overshoot,brakeSpeed,slides,maxRewind};
}
const slow=run(.4),normal=run(1.25),brisk=run(1.5),quick=run(2),fast=run(3),shortDash=run(3,{sprint:true,distance:60});
assert.equal(slow.slides,0,'slow approach should stop normally');
assert.equal(normal.slides,0,'normal walking should stop without a skid');
assert.equal(brisk.slides,0,'brisk walking should stop without a skid');
assert.equal(quick.slides,1);assert.equal(fast.slides,1);
assert.equal(shortDash.slides,1,'a short explicit dash should still have inertia');
assert.ok(shortDash.overshoot>=18,'short dash lacks visible overrun');
assert.ok(fast.overshoot>quick.overshoot,'higher incoming momentum should travel farther');
const bounded=run(3,{limit:18});assert.ok(bounded.overshoot<18.01,'ignored screen-edge skid allowance');
const small=run(3,{size:.35});assert.ok(Math.abs(small.overshoot/(.35/1.5)-fast.overshoot)<.1,'inertia failed to scale with the body');
const lowFps=run(3,{hz:30});assert.ok(Math.abs(lowFps.overshoot-fast.overshoot)<15,'frame rate materially changed inertia');
run(3,{interrupt:true});
console.log(JSON.stringify({normal,brisk,quick,fast,shortDash,slow,bounded,small,lowFps}));
