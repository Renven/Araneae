import * as THREE from './assets/three.module.js';
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),up=V(0,1,0),TAU=Math.PI*2;
const linkDirection=V();
const mix=THREE.MathUtils.lerp;
// This generator is private to the skin. It never consumes the locomotion RNG.
function randomSource(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
let sphere,boneGeometry,chitin,jointMaterial,cuffMaterial,eyeMaterial,eyeSocketMaterial,irisMaterial,reflectionMaterial,hairMaterial,hairFrontMaterial,surfaceMaps;
function makeSurfaceMaps(){
 const n=512,albedo=new Uint8Array(n*n*4),normal=new Uint8Array(n*n*4),roughness=new Uint8Array(n*n*4),heights=new Float32Array(n*n);
 const hash=(x,y)=>{let h=Math.imul(x,374761393)+Math.imul(y,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;};
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const grain=hash(x,y),pores=Math.pow(hash(x>>1,y>>1),8),flow=Math.sin(x*.38+Math.sin(y*.025)*2)*.12;
  heights[y*n+x]=grain*.28-pores*.34+flow;
 }
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const j=y*n+x,i=j*4,h=heights[j],noise=hash(x+83,y-91),tone=.83+h*.35;
  albedo[i]=Math.round(21*tone);albedo[i+1]=Math.round(30*tone);albedo[i+2]=Math.round(44*tone);albedo[i+3]=255;
  const dx=(heights[y*n+(x+1)%n]-heights[y*n+(x+n-1)%n])*.65,dy=(heights[((y+1)%n)*n+x]-heights[((y+n-1)%n)*n+x])*.65;
  const z=1/Math.hypot(dx,dy,1);normal[i]=Math.round((-.5*dx*z+.5)*255);normal[i+1]=Math.round((-.5*dy*z+.5)*255);normal[i+2]=Math.round((.5*z+.5)*255);normal[i+3]=255;
  const r=Math.round(116+noise*57+h*15);roughness[i]=roughness[i+1]=roughness[i+2]=r;roughness[i+3]=255;
 }
 const texture=(data,color=false)=>{const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;if(color)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;};
 return {map:texture(albedo,true),normalMap:texture(normal),roughnessMap:texture(roughness)};
}
function makeResources(){
 sphere=new THREE.SphereGeometry(1,64,48);
 boneGeometry=new THREE.LatheGeometry([[.38,-.5],[.64,-.45],[.89,-.31],[1,-.1],[.96,.1],[.8,.3],[.57,.44],[.42,.5]].map(([x,y])=>new THREE.Vector2(x,y)),24);
 const bonePositions=boneGeometry.attributes.position;
 for(let i=0;i<bonePositions.count;i++){const y=bonePositions.getY(i);bonePositions.setX(i,bonePositions.getX(i)*.8+.2*Math.sin((y+.5)*Math.PI));bonePositions.setZ(i,bonePositions.getZ(i)*.704);}bonePositions.needsUpdate=true;boneGeometry.computeVertexNormals();
 surfaceMaps=makeSurfaceMaps();
 chitin=new THREE.MeshPhysicalMaterial({color:'#c3d2e1',...surfaceMaps,roughness:.84,normalScale:new THREE.Vector2(.27,.2),metalness:.015,clearcoat:.17,clearcoatRoughness:.35,sheen:.18,sheenColor:new THREE.Color('#2b536b'),sheenRoughness:.55,iridescence:.16,iridescenceIOR:1.25,iridescenceThicknessRange:[90,160]});
 jointMaterial=new THREE.MeshPhysicalMaterial({color:'#121820',roughness:.43,metalness:0,clearcoat:.22,clearcoatRoughness:.34,normalMap:surfaceMaps.normalMap,normalScale:new THREE.Vector2(.25,.25)});
 cuffMaterial=new THREE.MeshStandardMaterial({color:'#202329',roughness:.72});
 eyeMaterial=new THREE.MeshPhysicalMaterial({color:'#06121e',roughness:.035,metalness:.06,ior:1.52,clearcoat:1,clearcoatRoughness:.02,specularIntensity:1.2});
 eyeSocketMaterial=new THREE.MeshPhysicalMaterial({color:'#172b3b',roughness:.3,metalness:.18,clearcoat:.45});
 irisMaterial=new THREE.MeshStandardMaterial({color:'#368fac',metalness:.55,roughness:.23,emissive:'#133f54',emissiveIntensity:.22});
 reflectionMaterial=new THREE.MeshBasicMaterial({color:'#d5f1ff'});
 // Keep the original back-then-front transparent draws, with stable material
 // variants instead of invalidating the shared shader configuration per draw.
 hairMaterial=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.4,depthWrite:false,side:THREE.BackSide});
 hairFrontMaterial=hairMaterial.clone();hairFrontMaterial.side=THREE.FrontSide;
}
const palette=['#111720','#293646','#526173','#1c2532','#0d121b'];
function addMesh(parent,geo,mat){const m=new THREE.Mesh(geo,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function ellipsoid(parent,center,radii,material){const m=addMesh(parent,sphere,material);m.position.copy(center);m.scale.copy(radii);return m;}
function bone(parent,mat=chitin){return addMesh(parent,boneGeometry,mat);}
function link(mesh,a,b,radius){mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(up,linkDirection.copy(b).sub(a).normalize());mesh.scale.set(radius,a.distanceTo(b),radius*.88);updateFur(mesh);}
// Shared by both the carapace and its hair roots: no floating coat of bristles.
function bodySurface(x,y,z,kind){
 const top=Math.max(0,y),angle=Math.atan2(z,x);
 if(kind==='thorax'){
  const dent=Math.exp(-(x*x*5+(z-.12)**2*6)/.12)*.035;
  const furrow=Math.pow(Math.max(0,Math.cos(angle*7+.45)),14)*.007*Math.min(1,Math.abs(x)*3);
  y-=top*(dent+furrow);x*=1-.08*Math.abs(z);
 }else{
  x*=.91+.08*z;z+=.035*(1-z*z);if(y<0)y*=.82;
  y+=top*.006*Math.sin(x*37+z*14)*Math.sin(z*29-x*23);
 }
 return V(x,y,z);
}
const boneProfile=[[.38,-.5],[.64,-.45],[.89,-.31],[1,-.1],[.96,.1],[.8,.3],[.57,.44],[.42,.5]];
function boneRadius(t){
 for(let i=1;i<boneProfile.length;i++){const [a,y0]=boneProfile[i-1],[b,y1]=boneProfile[i];if(t<=y1)return mix(a,b,(t-y0)/(y1-y0));}return .42;
}
function updateFur(parent){
 const fur=parent.userData.surfaceFur;if(!fur)return;
 const r=parent.scale.x,length=parent.scale.y;if(fur.r===r&&fur.length===length)return;
 const positions=fur.mesh.geometry.attributes.position,{inv,direction,tip,side,a,b}=fur.work;
 inv.set(1/r,1/length,1/(r*.88));
 for(let i=0;i<fur.strands.length;i++){
  const h=fur.strands[i];direction.copy(h.direction).multiplyScalar(h.length*r).multiply(inv);
  tip.copy(h.root).add(direction);side.copy(h.side).multiplyScalar(h.width*r).multiply(inv);
  a.copy(h.root).add(side);b.copy(h.root).sub(side);
  positions.setXYZ(i*3,a.x,a.y,a.z);positions.setXYZ(i*3+1,b.x,b.y,b.z);positions.setXYZ(i*3+2,tip.x,tip.y,tip.z);
 }
 positions.needsUpdate=true;fur.r=r;fur.length=length;
}
function hairs(parent,count,seed,bodySpec=null){
 const rng=randomSource(seed),vertices=[],colors=[],samples=[],strands=[];
 const color=new THREE.Color();
 for(let i=0;i<count;i++){
  const long=i%19===0;let root,normal,direction,length,width,side;
  if(bodySpec){
   const z=rng()*2-1,az=rng()*TAU,r=Math.sqrt(1-z*z),unit=V(Math.cos(az)*r,Math.abs(Math.sin(az))*r,z).normalize();
   root=bodySurface(unit.x,unit.y,unit.z,bodySpec.kind).multiply(bodySpec.radii).add(bodySpec.center);
   normal=V(unit.x/bodySpec.radii.x,unit.y/bodySpec.radii.y,unit.z/bodySpec.radii.z).normalize();
   const tangent=V(0,0,1).addScaledVector(normal,-normal.z).normalize();
   direction=tangent.multiplyScalar(long?.65:.96).addScaledVector(normal,long?.65:.14).normalize();
   length=long?1+rng()*.8:.25+rng()*.4;width=long?.045:.023;
   side=new THREE.Vector3().crossVectors(direction,normal);if(side.lengthSq()<.01)side=V(1,0,0);side.normalize().multiplyScalar(width);
   const tip=root.clone().addScaledVector(direction,length);samples.push([root,tip]);vertices.push(...root.clone().add(side),...root.clone().sub(side),...tip);
  }else{
   const t=-.41+rng()*.8,az=rng()*TAU,r=boneRadius(t),c=Math.cos(az),z=Math.sin(az);
   root=V(c*r*.8+.2*Math.sin((t+.5)*Math.PI),t,z*r*.704);
   normal=V(c/.8,0,z/.704).normalize();
   direction=V(normal.x*(long?.62:.18),long?.78:.985,normal.z*(long?.62:.18)).normalize();
   side=new THREE.Vector3().crossVectors(direction,normal).normalize();
   length=long?.4+rng()*.25:.095+rng()*.105;width=long?.018:.008;
   strands.push({root,direction,side,length,width});vertices.push(0,0,0,0,0,0,0,0,0);
  }
  color.set(long?'#344356':'#263342');for(let j=0;j<3;j++){const f=j===2?.65:1;colors.push(color.r*f,color.g*f,color.b*f);}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
 const mesh=new THREE.Mesh(g,hairMaterial);mesh.name='groomed-setae';mesh.castShadow=false;parent.add(mesh);
 // Both passes share geometry and the same world transform. Consecutive IDs
 // keep each back/front pair together when transparent depth keys are equal.
 const front=new THREE.Mesh(g,hairFrontMaterial);front.name='groomed-setae-front';front.castShadow=false;mesh.add(front);
 if(!bodySpec){
  parent.userData.surfaceFur={mesh,strands,work:{inv:V(),direction:V(),tip:V(),side:V(),a:V(),b:V()}};
  updateFur(parent);
 }g.computeBoundingSphere();
 return samples;
}
function bodyMaterial(kind){
 const g=sphere.clone(),a=g.attributes.position,c=[];
 for(let i=0;i<a.count;i++){
  let x=a.getX(i),y=a.getY(i),z=a.getZ(i);const top=Math.max(0,y),angle=Math.atan2(z,x);
  const p=bodySurface(x,y,z,kind);x=p.x;y=p.y;z=p.z;
  a.setXYZ(i,x,y,z);
  const tone=.79+top*.19-.04*Math.cos(angle*7)*top;
  c.push(tone*.91,tone*.96,tone);
 }
 a.needsUpdate=true;g.computeVertexNormals();g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));
 const material=chitin.clone();material.vertexColors=true;material.roughness=kind==='abdomen'?1:.84;material.clearcoat=kind==='abdomen'?.1:.18;
 return {geometry:g,material};
}

export class OrganicAppearance {
 constructor(scene,body,legs){
  this.body=body;this.legs=legs;this.size=1;this.heading=0;
  // Keep the legacy joint data, but detach its unused render meshes so they
  // do not participate in scene matrix updates or display interpolation.
  for(const child of [...body.children]){child.visible=false;body.remove(child);}
  this.headOrigin=V(0,4,-25);this.head=new THREE.Group();this.head.position.copy(this.headOrigin);body.add(this.head);
  const headPoint=p=>p.clone().sub(this.headOrigin);
  this.parts=[
   {kind:'thorax',center:V(0,0,-7),radii:V(22,14,28)},
   {kind:'abdomen',center:V(0,1,49),radii:V(25,18,31)}
  ];
  this.bodyFur=[];
  for(let i=0;i<this.parts.length;i++){
   const spec=this.parts[i],skin=bodyMaterial(spec.kind),m=addMesh(body,skin.geometry,skin.material);m.position.copy(spec.center);m.scale.copy(spec.radii);
   this.bodyFur.push(...hairs(body,i?240:120,891+i,spec));
  }
  ellipsoid(body,V(0,-3,29),V(6.5,6,10),jointMaterial);
  ellipsoid(this.head,headPoint(V(0,4,-31)),V(11,7,8),chitin);
  this.eyes=[];
  for(const [x,y,z,r,primary] of [[-3.7,9,-37,3.05,true],[3.7,9,-37,3.05,true],[-8.1,10.3,-32,1.6],[8.1,10.3,-32,1.6],[-7.2,5.5,-37.7,1.1],[7.2,5.5,-37.7,1.1],[-5.8,11,-28,1.05],[5.8,11,-28,1.05]]){
   const rig=new THREE.Group();rig.position.copy(headPoint(V(x,y,z)));
   rig.quaternion.setFromUnitVectors(V(0,0,1),V(x*.018,.56,-.83).normalize());this.head.add(rig);
   ellipsoid(rig,V(0,0,-r*.18),V(r*1.12,r*(primary?.8:.98),r*.66),eyeSocketMaterial);
   ellipsoid(rig,V(),V(r,r*(primary?.67:.88),r*.77),eyeMaterial);
   if(primary){
    // A restrained broken blue crescent sits inside the dark corneal rim.
    const iris=addMesh(rig,new THREE.TorusGeometry(r*.54,r*.045,8,48,Math.PI*1.54),irisMaterial);
    iris.position.z=r*.67;iris.rotation.z=-Math.PI*.3;iris.scale.y=.72;
    ellipsoid(rig,V(0,0,r*.75),V(r*.36,r*.27,r*.045),eyeMaterial);
    const brow=ellipsoid(rig,V(0,r*.57,r*.22),V(r*1.12,r*.15,r*.55),chitin);brow.rotation.z=x<0?-.14:.14;
   }
   const reflection=ellipsoid(rig,V(-r*.28,r*.29,r*.72),V(r*.105,r*.22,r*.035),reflectionMaterial);reflection.rotation.z=-.4;
   ellipsoid(rig,V(r*.3,-r*.18,r*.71),V(r*.045,r*.065,r*.025),reflectionMaterial);
   this.eyes.push({p:V(x,y,z),r,primary:!!primary,rig});
  }
  this.palps=[];
  for(const side of [-1,1]){
   const points=[V(side*8,-3,-33),V(side*15,-1,-41),V(side*13,-7,-51)];this.palps.push(points);
   for(let i=0;i<2;i++){const m=bone(this.head);link(m,headPoint(points[i]),headPoint(points[i+1]),i?1.9:2.5);hairs(m,8,140+i+side*4);}
   ellipsoid(this.head,headPoint(V(side*4,-6,-37)),V(3.6,4.5,5.5),jointMaterial);
   const fang=bone(this.head,jointMaterial);link(fang,headPoint(V(side*4,-9,-39)),headPoint(V(side*2,-10,-47)),1.2);
   ellipsoid(body,V(side*4,-3,77),V(2.2,2,4),chitin);
  }
  this.skins=legs.map((leg,index)=>{
   for(const child of [...leg.group.children]){child.visible=false;leg.group.remove(child);}
   const radii=[4.6,4.65,4.15,2.65,1.12],bones=radii.map(()=>bone(leg.group));
   bones.forEach((m,i)=>hairs(m,[6,25,3,22,12][i],258+index*19+i));
   const nodes=Array.from({length:6},()=>addMesh(leg.group,sphere,jointMaterial));
   for(const i of [1,3,5])nodes[i].visible=false;
   const cuffs=[];
   return {leg,bones,nodes,cuffs,radii,points:Array.from({length:6},()=>V()),outward:V(),cuffPoint:V()};
  });
 }
 update(size,heading,gesture={}){
  this.size=size;this.heading=heading;
  this.head.position.copy(this.headOrigin);this.head.position.y+=gesture.headLift||0;
  this.head.rotation.set(gesture.headPitch||0,gesture.headYaw||0,0,'YXZ');this.head.updateMatrixWorld(true);
  for(const skin of this.skins){
   const l=skin.leg,[a,coxa,knee,patella,ankle,foot]=skin.points;
   foot.copy(l.foot);
   // All eight visible coxae attach to the cephalothorax; the motion rig is untouched.
   a.set(l.side*[13,18,18,16][l.row],-1,[-26,-15,-3,9][l.row]).applyMatrix4(this.body.matrixWorld);
   const outward=skin.outward.set(l.side*12,9,[-8,5,-5,8][l.row]).multiplyScalar(size).applyAxisAngle(up,heading);
   knee.copy(l.knee.position).add(outward);ankle.copy(l.ankle.position);
   coxa.copy(a).lerp(knee,.18);patella.copy(knee).lerp(ankle,.19);patella.y+=1.8*size;
   const points=skin.points;
   for(let i=0;i<5;i++)link(skin.bones[i],points[i],points[i+1],skin.radii[i]*size);
   for(let i=0;i<6;i++){skin.nodes[i].position.copy(points[i]);skin.nodes[i].quaternion.copy(skin.bones[Math.min(i,4)].quaternion);const r=[4.6,3.9,4.35,3.35,2.05,.85][i]*size;skin.nodes[i].scale.set(r,r*.67,r*.88);}
   for(let i=0;i<skin.cuffs.length;i++){
    const j=i?3:1,c=skin.cuffs[i];c.position.copy(skin.cuffPoint.copy(points[j]).lerp(points[j+1],i?.13:.85));
    c.quaternion.copy(skin.bones[j].quaternion);c.scale.set((i?2.9:4)*size,1.35*size,(i?2.9:4)*size);
   }
  }
 }
 draw(ctx,dpr,width,height,camera,state,root){
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const size=state.size,heading=this.heading;
  const project=v=>{const p=v.clone().project(camera);return {x:(p.x+1)*width/2,y:(1-p.y)*height/2,z:p.z};};
  const local=v=>project(v.clone().applyMatrix4(this.body.matrixWorld));
  const headWorld=v=>v.clone().sub(this.headOrigin).applyMatrix4(this.head.matrixWorld),headLocal=v=>project(headWorld(v));
  const shadow=(v,rx,ry,opacity)=>{
   const p=project(v);ctx.save();ctx.translate(p.x+5,p.y+6);ctx.scale(1,ry/rx);
   const g=ctx.createRadialGradient(0,0,0,0,0,rx);g.addColorStop(0,`rgba(9,15,23,${opacity})`);g.addColorStop(1,'rgba(9,15,23,0)');
   ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,rx,0,TAU);ctx.fill();ctx.restore();
  };
  for(const l of this.legs)shadow(V(l.foot.x,0,l.foot.z),9*size,4*size,.18);
  shadow(root,39*size,52*size,.24);shadow(V(0,0,52).applyMatrix4(this.body.matrixWorld).setY(0),34*size,36*size,.19);
  const rod=(a,b,radius,index,seed)=>{
   const p=project(a),q=project(b),dx=q.x-p.x,dy=q.y-p.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,r=radius*size;
   const profile=[[0,.5],[.12,.86],[.32,1],[.65,.85],[.88,.64],[1,.43]];
   ctx.beginPath();for(let side=0;side<2;side++){const values=side?[...profile].reverse():profile;for(const [t,w] of values){const x=mix(p.x,q.x,t)+nx*r*w*(side?-1:1),y=mix(p.y,q.y,t)+ny*r*w*(side?-1:1);if(!side&&t===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}}ctx.closePath();
   const g=ctx.createLinearGradient(p.x-nx*r,p.y-ny*r,p.x+nx*r,p.y+ny*r);g.addColorStop(0,'#080c13');g.addColorStop(.23,'#182434');g.addColorStop(.36,index===4?'#496376':'#52758c');g.addColorStop(.46,'#283d54');g.addColorStop(.64,'#111a29');g.addColorStop(1,'#070b12');
   ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='#080b11bf';ctx.lineWidth=.45;ctx.stroke();
   if(index===1||index===3){const t=.84,w=r*.59;ctx.beginPath();ctx.moveTo(mix(p.x,q.x,t)-nx*w,mix(p.y,q.y,t)-ny*w);ctx.lineTo(mix(p.x,q.x,t)+nx*w,mix(p.y,q.y,t)+ny*w);ctx.strokeStyle='#090e17b0';ctx.lineWidth=Math.max(.7,1.15*size);ctx.stroke();}
   const rng=randomSource(seed);ctx.beginPath();
   for(let i=0;i<(index===4?3:5);i++){const t=.07+rng()*.87,side=rng()>.5?1:-1,w=r*(.82-.25*Math.abs(t-.4)),x=mix(p.x,q.x,t)+nx*w*side,y=mix(p.y,q.y,t)+ny*w*side,h=(.55+rng()*.9)*size;
    ctx.moveTo(x,y);ctx.lineTo(x+dx/len*h+nx*h*side*.15,y+dy/len*h+ny*h*side*.15);
   }
   ctx.strokeStyle=state.dark?'#64758c52':'#26314066';ctx.lineWidth=.22;ctx.stroke();
  };
  const joint=(point,r)=>{
   const p=project(point),radius=r*size,g=ctx.createRadialGradient(p.x-radius*.32,p.y-radius*.35,.2,p.x,p.y,radius);
   g.addColorStop(0,'#61798c');g.addColorStop(.24,'#2c3d51');g.addColorStop(.55,'#101925');g.addColorStop(.85,'#070b11');g.addColorStop(1,'#030609');
   ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(p.x,p.y,radius*.95,radius*.76,-heading,0,TAU);ctx.fill();ctx.strokeStyle='#060910b0';ctx.lineWidth=.65;ctx.stroke();
   ctx.beginPath();ctx.arc(p.x,p.y,radius*.7,3.7,4.7);ctx.strokeStyle='#7997ac42';ctx.lineWidth=.7;ctx.stroke();
  };
  const sorted=[...this.skins].sort((a,b)=>project(b.nodes[2].position).z-project(a.nodes[2].position).z);
  for(const skin of sorted){
   const points=skin.nodes.map(n=>n.position);
   for(let i=0;i<5;i++)rod(points[i],points[i+1],skin.radii[i],i,skin.leg.i*91+i+100);
   for(const i of [0,2,4])joint(points[i],[4.6,3.9,4.35,3.35,2.05,.85][i]);
   if(state.feet){const p=project(skin.leg.foot);ctx.beginPath();ctx.ellipse(p.x,p.y,6*size,4*size,0,0,TAU);ctx.strokeStyle='#9d7d4f99';ctx.lineWidth=.8;ctx.stroke();}
  }
  // Projected local ellipses retain the same body orientation and pose as WebGL.
  const oval=(spec,head=false)=>{
   const transform=head?headLocal:local;
   const center=transform(spec.center.clone().add(V(0,spec.radii.y*.25,0))),x=transform(spec.center.clone().add(V(spec.radii.x,0,0))),z=transform(spec.center.clone().add(V(0,0,spec.radii.z)));
   ctx.save();ctx.transform(x.x-center.x,x.y-center.y,z.x-center.x,z.y-center.y,center.x,center.y);
   ctx.beginPath();ctx.ellipse(0,0,1,1,0,0,TAU);ctx.clip();
   const g=ctx.createRadialGradient(-.34,-.22,.02,.12,.13,1.22);g.addColorStop(0,spec.kind==='abdomen'?'#283d56':'#324961');g.addColorStop(.37,'#172436');g.addColorStop(.72,'#0b121e');g.addColorStop(1,'#04070c');
   ctx.fillStyle=g;ctx.fillRect(-1,-1,2,2);
   // A grazing blue sheen follows the curved shell rather than a painted stripe.
   const sheen=ctx.createLinearGradient(-1,-.6,.6,.8);sheen.addColorStop(0,'#92b5ce00');sheen.addColorStop(.23,'#70a6c326');sheen.addColorStop(.34,'#80b3d338');sheen.addColorStop(.43,'#4a93c315');sheen.addColorStop(.66,'#273c6100');ctx.fillStyle=sheen;ctx.fillRect(-1,-1,2,2);
   if(spec.kind==='thorax'){
    ctx.strokeStyle='#01040a50';ctx.lineWidth=.018;for(const side of [-1,1])for(let i=0;i<4;i++){const y=-.5+i*.3;ctx.beginPath();ctx.moveTo(side*.13,y+.08);ctx.quadraticCurveTo(side*.4,y+.17,side*.86,y-.01);ctx.stroke();}
    const dent=ctx.createRadialGradient(0,.12,.01,0,.12,.18);dent.addColorStop(0,'#00040a66');dent.addColorStop(1,'#00000000');ctx.fillStyle=dent;ctx.fillRect(-.22,-.1,.44,.44);
   }
   const rng=randomSource(spec.kind==='abdomen'?872:454);
   ctx.beginPath();for(let i=0;i<1900;i++){const a=rng()*TAU,r=Math.sqrt(rng()),x=Math.cos(a)*r,y=Math.sin(a)*r;ctx.moveTo(x,y);ctx.lineTo(x+(rng()-.5)*.008,y+.003+rng()*.008);}ctx.strokeStyle='#a5c2df23';ctx.lineWidth=.004;ctx.stroke();
   ctx.beginPath();for(let i=0;i<950;i++){const a=rng()*TAU,r=Math.sqrt(rng()),x=Math.cos(a)*r,y=Math.sin(a)*r;ctx.moveTo(x,y);ctx.lineTo(x+.004,y+.004);}ctx.strokeStyle='#01030a60';ctx.lineWidth=.005;ctx.stroke();ctx.restore();
  };
  oval(this.parts[1]);oval(this.parts[0]);
  oval({kind:'head',center:V(0,4,-31),radii:V(11,7,8)},true);
  for(const side of [-1,1])oval({kind:'head',center:V(side*4,-6,-37),radii:V(3.6,4.5,5.5)},true);
  for(const points of this.palps){for(let i=0;i<2;i++)rod(headWorld(points[i]),headWorld(points[i+1]),(i?1.9:2.5),4,450+i);}
  ctx.beginPath();for(let i=0;i<this.bodyFur.length;i+=2){const [a,b]=this.bodyFur[i],p=local(a),q=local(b);ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);}ctx.strokeStyle=state.dark?'#73839545':'#27344445';ctx.lineWidth=.2;ctx.stroke();
  for(const eye of this.eyes){
   const map=(x,y,z=.22)=>project(V(x*eye.r,y*eye.r,z*eye.r).applyMatrix4(eye.rig.matrixWorld));
   const p=map(0,0),x=map(1,0),y=map(0,eye.primary?.67:.88);
   ctx.save();ctx.transform(x.x-p.x,x.y-p.y,y.x-p.x,y.y-p.y,p.x,p.y);
   ctx.beginPath();ctx.ellipse(0,0,1.12,1.12,0,0,TAU);ctx.fillStyle='#102333';ctx.fill();ctx.strokeStyle='#6a91a566';ctx.lineWidth=.055;ctx.stroke();
   const g=ctx.createRadialGradient(-.3,.35,.025,.08,-.08,1.12);g.addColorStop(0,'#47758d');g.addColorStop(.23,'#142e43');g.addColorStop(.6,'#06131f');g.addColorStop(1,'#010409');
   ctx.beginPath();ctx.ellipse(0,0,1,1,0,0,TAU);ctx.fillStyle=g;ctx.fill();
   if(eye.primary){
    ctx.beginPath();ctx.arc(0,0,.56,-Math.PI*.3,Math.PI*1.24);ctx.strokeStyle='#4e9ab5';ctx.lineWidth=.085;ctx.stroke();
    ctx.beginPath();ctx.ellipse(0,0,.36,.43,0,0,TAU);ctx.fillStyle='#02080f';ctx.fill();
   }
   ctx.beginPath();ctx.ellipse(-.28,.29,.105,.22,-.4,0,TAU);ctx.fillStyle='#d5f1ff';ctx.fill();
   ctx.beginPath();ctx.ellipse(.3,-.18,.045,.065,0,0,TAU);ctx.fillStyle='#a3c7dbe6';ctx.fill();ctx.restore();
   if(eye.primary){
    ctx.save();ctx.transform(x.x-p.x,x.y-p.y,y.x-p.x,y.y-p.y,p.x,p.y);ctx.rotate(eye.p.x<0?-.14:.14);
    ctx.beginPath();ctx.ellipse(0,.85,1.12,.22,0,0,TAU);ctx.fillStyle='#112331';ctx.fill();ctx.strokeStyle='#45647677';ctx.lineWidth=.04;ctx.stroke();ctx.restore();
   }
  }
 }
}

// Three.js creates UUIDs with Math.random, so construct the skin in an isolated,
// synchronous RNG scope as well. This preserves every autonomous motion sample.
export function createOrganicAppearance(scene,body,legs){
 const previousRandom=Math.random;Math.random=randomSource(317209);
 try{makeResources();return new OrganicAppearance(scene,body,legs);}finally{Math.random=previousRandom;}
}
