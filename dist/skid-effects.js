import * as THREE from './assets/three.module.js';

// Faint floor streaks and soft dust only accompany a deliberate loss of grip.
export class SkidEffects {
 constructor(scene){
  const previousRandom=Math.random;let seed=946721;
  Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  try{
  const n=32,data=new Uint8Array(n*n*4);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const i=(y*n+x)*4,r=Math.hypot((x+.5)/n*2-1,(y+.5)/n*2-1);
   data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(Math.max(0,1-r)**2*255);
  }
  const map=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);map.needsUpdate=true;
  const geometry=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
  this.marks=[];this.puffs=[];this.age=1;this.strength=0;this.direction=new THREE.Vector3();
  const mesh=()=>{const m=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:'#80705b',map,transparent:true,opacity:0,depthWrite:false}));m.visible=false;m.renderOrder=2;scene.add(m);return m;};
  for(const i of [0,2,5,7])this.marks.push({i,mesh:mesh(),point:new THREE.Vector3()});
  for(let i=0;i<6;i++)this.puffs.push({i,mesh:mesh(),point:new THREE.Vector3()});
  }finally{Math.random=previousRandom;}
 }
 update(dt,motion,legs,state){
  const s=motion.skid,sliding=s?.stage==='slide';this.age+=dt;
  if(sliding){this.age=0;this.strength=s.strength;this.direction.copy(s.direction);}
  const alpha=Math.exp(-this.age*12),size=state.size;
  for(const mark of this.marks){
   if(sliding)mark.point.copy(legs[mark.i].foot);
   const length=(9+24*this.strength)*size,m=mark.mesh;
   m.position.copy(mark.point).addScaledVector(this.direction,-length*.5);m.position.y=.5;
   m.rotation.y=motion.heading;m.scale.set(1.8*size,1,length);
   m.material.opacity=.25*this.strength*alpha;m.material.color.set(state.dark?'#b8afa0':'#80705b');m.visible=m.material.opacity>.005;
  }
  for(const puff of this.puffs){
   if(sliding)puff.point.copy(legs[(puff.i*3)%8].foot);
   const m=puff.mesh,r=(10+8*this.strength+puff.i)*size*(1+this.age*1.5);
   m.position.copy(puff.point).addScaledVector(this.direction,-(8+puff.i*4+this.age*35)*size);m.position.y=.7;
   m.scale.set(r,1,r*.65);m.material.opacity=.15*this.strength*alpha;
   m.material.color.set(state.dark?'#b8afa0':'#aa9780');m.visible=m.material.opacity>.005;
  }
 }
 draw(ctx,dpr,width,height,camera,state){
  const project=v=>{const p=v.clone().project(camera);return [(p.x+1)*width/2,(1-p.y)*height/2];};
  ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);
  for(const mark of this.marks){
   const m=mark.mesh;if(!m.visible)continue;
   const a=project(mark.point),b=project(mark.point.clone().addScaledVector(this.direction,-m.scale.z));
   ctx.globalAlpha=m.material.opacity;ctx.strokeStyle=state.dark?'#b8afa0':'#80705b';ctx.lineWidth=1.1*state.size;
   ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
  }
  for(const puff of this.puffs){
   const m=puff.mesh;if(!m.visible)continue;const p=project(m.position),r=m.scale.x*.5;
   const gradient=ctx.createRadialGradient(...p,0,...p,r);gradient.addColorStop(0,state.dark?'#b8afa0':'#aa9780');gradient.addColorStop(1,'#aa978000');
   ctx.globalAlpha=m.material.opacity;ctx.fillStyle=gradient;ctx.beginPath();ctx.ellipse(...p,r,r*.65,0,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
 }
}
