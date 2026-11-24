import {Vector3, MathUtils} from './assets/three.module.js';
const clamp=MathUtils.clamp;
export const LEG_SECTORS=[[-1.48,-.76],[-.74,-.018],[.018,.74],[.76,1.48]];

// Closest distance between finite limb centerlines; radii are checked separately.
export function segmentDistance(a,b,c,d){
 const ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=d.x-c.x,vy=d.y-c.y,vz=d.z-c.z;
 let wx=a.x-c.x,wy=a.y-c.y,wz=a.z-c.z;
 const aa=ux*ux+uy*uy+uz*uz,bb=ux*vx+uy*vy+uz*vz,cc=vx*vx+vy*vy+vz*vz;
 const dd=ux*wx+uy*wy+uz*wz,ee=vx*wx+vy*wy+vz*wz,eps=1e-10;
 let s=0,t=0;
 if(aa<eps&&cc<eps)return Math.sqrt(wx*wx+wy*wy+wz*wz);
 if(aa<eps)t=clamp(ee/cc,0,1);
 else if(cc<eps)s=clamp(-dd/aa,0,1);
 else{
  const det=aa*cc-bb*bb;
  s=det>eps?clamp((bb*ee-cc*dd)/det,0,1):0;
  t=(bb*s+ee)/cc;
  if(t<0){t=0;s=clamp(-dd/aa,0,1);}
  else if(t>1){t=1;s=clamp((bb-dd)/aa,0,1);}
 }
 // Preserve the original arithmetic order without allocating three vectors.
 wx+=ux*s;wy+=uy*s;wz+=uz*s;
 wx+=vx*-t;wy+=vy*-t;wz+=vz*-t;
 return Math.sqrt(wx*wx+wy*wy+wz*wz);
}

export function contactInSector(point,root,heading,leg,size,margin=0){
 const local=point.clone().sub(root).applyAxisAngle(new Vector3(0,1,0),-heading);
 const angle=Math.atan2(local.z,local.x*leg.side),[lo,hi]=LEG_SECTORS[leg.row];
 return local.x*leg.side>25*size&&angle>=lo+margin&&angle<=hi-margin;
}

export function clampContact(point,root,heading,leg,size){
 const up=new Vector3(0,1,0),local=point.clone().sub(root).applyAxisAngle(up,-heading);
 const outer=leg.row===0||leg.row===3;
 local.x=leg.side*clamp(local.x*leg.side,(outer?58:85)*size,(outer?82:115)*size);
 const limits=[[-180,-58],[-110,18],[-18,110],[58,180]][leg.row];
 local.z=clamp(local.z,limits[0]*size,limits[1]*size);local.y=0;
 return point.copy(local.applyAxisAngle(up,heading).add(root)).setY(0);
}

export function keepReachable(point,hip,root,heading,leg,size,minimum=68){
 const dy=hip.y-point.y,required=Math.sqrt(Math.max(0,(minimum*size)**2-dy*dy));
 const horizontal=point.clone().sub(hip).setY(0);
 if(horizontal.length()<required){
  const sector=LEG_SECTORS[leg.row],angle=(sector[0]+sector[1])/2;
  const ray=new Vector3(leg.side*Math.cos(angle),0,Math.sin(angle)).applyAxisAngle(new Vector3(0,1,0),heading);
  point.x=hip.x+ray.x*required;point.z=hip.z+ray.z*required;
 }
 return point;
}

export function safeYawDelta(legs,root,heading,requested,size){
 let lo=-Infinity,hi=Infinity;
 const up=new Vector3(0,1,0);
 for(const leg of legs){
  const local=leg.foot.clone().sub(root).applyAxisAngle(up,-heading);
  const angle=Math.atan2(local.z,local.x*leg.side),sector=LEG_SECTORS[leg.row];
  let a=(sector[0]-angle)*leg.side,b=(sector[1]-angle)*leg.side;
  if(a>b)[a,b]=[b,a];
  // If translation already exhausted a sector, do not turn farther through that boundary.
  lo=Math.max(lo,Math.min(0,a));hi=Math.min(hi,Math.max(0,b));
 }
 return clamp(requested,lo,hi);
}

export function limbClearance(a,b,size){
 return Math.min(
  segmentDistance(a.hip,a.knee,b.hip,b.knee)-10.5*size,
  segmentDistance(a.hip,a.knee,b.knee,b.foot)-8*size,
  segmentDistance(a.knee,a.foot,b.hip,b.knee)-8*size,
  segmentDistance(a.knee,a.foot,b.knee,b.foot)-5.5*size
 );
}

// The knee lies on the exact two-link IK circle. Choose a hinge plane inside its own fan.
export function safeKnee(hip,foot,upper,lower,preferred,root,heading,leg,size,previous,neighbors=[]){
 const axis=foot.clone().sub(hip),actual=axis.length();axis.normalize();
 const distance=clamp(actual,Math.abs(upper-lower)+.01,upper+lower-.01);
 const along=(upper*upper-lower*lower+distance*distance)/(2*distance);
 const radius=Math.sqrt(Math.max(0,upper*upper-along*along));
 const center=hip.clone().addScaledVector(axis,along);
 const pole=preferred.clone().addScaledVector(axis,-preferred.dot(axis)).normalize();
 const tangent=new Vector3().crossVectors(axis,pole).normalize();
 const [lo,hi]=LEG_SECTORS[leg.row],mid=(lo+hi)/2;
 const c=Math.cos(heading),s=Math.sin(heading);
 function candidate(phi,margin){
  const p=center.clone().addScaledVector(pole,radius*Math.cos(phi)).addScaledVector(tangent,radius*Math.sin(phi));
  const dx=p.x-root.x,dz=p.z-root.z;
  const x=(dx*c-dz*s)*leg.side,z=dx*s+dz*c,angle=Math.atan2(z,x);
  const hipX=((hip.x-root.x)*c-(hip.z-root.z)*s)*leg.side;
  if(x<hipX+23*size||angle<lo+margin||angle>hi-margin||p.y<hip.y-5*size)return null;
  const height=(p.y-hip.y)/size;
  const continuity=previous?p.distanceToSquared(previous)/(size*size):0;
  return {p,phi,cost:(angle-mid)**2*12+phi*phi*.08+height*height*.0015+continuity*.008};
 }
 let best=null,step=Math.PI/32;
 for(const margin of [.15,.035]){
  for(let i=-32;i<=32;i++){
   const choice=candidate(i*step,margin);if(choice&&(!best||choice.cost<best.cost))best=choice;
  }
  if(best){
   for(let pass=0;pass<5;pass++){
    step*=.5;const origin=best.phi;
    for(const phi of [origin-step,origin+step]){const choice=candidate(phi,margin);if(choice&&choice.cost<best.cost)best=choice;}
   }
   break;
  }
 }
 function clearance(choice){
  const pose={hip,knee:choice.p,foot};
  return Math.min(Infinity,...neighbors.map(other=>limbClearance(pose,other,size)));
 }
 if(best&&clearance(best)<.7*size){
  let safe=null,least=best,leastGap=clearance(best);
  for(const margin of [.025,-.12]){
   const searchStep=Math.PI/48;
   for(let i=-48;i<=48;i++){
    const choice=candidate(i*searchStep,margin);if(!choice)continue;
    const gap=clearance(choice);
    if(gap>leastGap){least=choice;leastGap=gap;}
    if(gap>=.7*size&&(!safe||choice.cost<safe.cost))safe=choice;
   }
   if(safe){
    let refine=searchStep;
    for(let pass=0;pass<5;pass++){
     refine*=.5;const origin=safe.phi;
     for(const phi of [origin-refine,origin+refine]){const choice=candidate(phi,margin);if(choice&&clearance(choice)>=.7*size&&choice.cost<safe.cost)safe=choice;}
    }
    break;
   }
  }
  best=safe||least;
 }
 leg.kneeFallback=!best;
 return best?best.p:center.addScaledVector(pole,radius);
}

export function clearSwingFoot(hip,foot,upper,lower,pole,root,heading,leg,size,previous,neighbors,landing){
 const up=new Vector3(0,1,0);
 const lateral=new Vector3(leg.side,0,0).applyAxisAngle(up,heading);
 const forward=new Vector3(0,0,-1).applyAxisAngle(up,heading);
 const directions=[lateral,lateral.clone().negate(),forward,forward.clone().negate(),lateral.clone().add(forward).normalize(),lateral.clone().sub(forward).normalize()];
 if(!landing)directions.push(up);
 for(const amount of [2,4,8,12,18])for(const direction of directions){
  const point=foot.clone().addScaledVector(direction,amount*size);
  const local=point.clone().sub(root).applyAxisAngle(up,-heading);
  if(local.x*leg.side<30*size||point.y<0||point.distanceTo(hip)>(leg.reachLimit-1)*size||point.distanceTo(hip)<60*size)continue;
  const candidateLeg={row:leg.row,side:leg.side};
  const knee=safeKnee(hip,point,upper,lower,pole,root,heading,candidateLeg,size,previous,neighbors);
  const pose={hip,knee,foot:point};
  if(neighbors.every(other=>limbClearance(pose,other,size)>=.55*size))return point;
 }
 return null;
}
