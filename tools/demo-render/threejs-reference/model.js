import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const EA=window.ExerciseAnim;const V=a=>new THREE.Vector3(a[0],a[1],a[2]);
const r=new THREE.WebGLRenderer({canvas:c,antialias:true,preserveDrawingBuffer:true});r.setSize(960,960,false);r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;
r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.05;
const s=new THREE.Scene();s.background=new THREE.Color(0xeceef1);
s.add(new THREE.HemisphereLight(0xffffff,0x9aa0aa,1.0));
const key=new THREE.DirectionalLight(0xffffff,2.0);key.position.set(2.5,5,3.5);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.radius=6;key.shadow.bias=-0.0005;
Object.assign(key.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.5,far:15});s.add(key);
const fill=new THREE.DirectionalLight(0xdfe8ff,0.7);fill.position.set(-3,2,-2);s.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(14,14),new THREE.ShadowMaterial({opacity:.22}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;s.add(floor);
const cam=new THREE.PerspectiveCamera(30,1,.1,60);
const TUN={base:[.40,.42,.46],red:[.86,.18,.14]};
const GROUPS={thighs:['thigh_l','thigh_r'],calves:['calf_l','calf_r'],arms:['upperarm_l','upperarm_r'],forearms:['lowerarm_l','lowerarm_r'],delts:['clavicle_l','clavicle_r'],torso:['spine_02','spine_03'],abs:['spine_01'],pelvis:['pelvis']};
const gl={};async function load(){const g=await new GLTFLoader().loadAsync('human-addon-animations.glb');gl.g=g;gl.root=g.scene;s.add(g.scene);
 gl.bones={};g.scene.traverse(o=>{if(o.isBone)gl.bones[o.name]=o;if(o.isSkinnedMesh)gl.mesh=o;});
 gl.mesh.castShadow=true;gl.mesh.frustumCulled=false;g.scene.updateMatrixWorld(true);
 gl.rest={};for(const n in gl.bones){const b=gl.bones[n];gl.rest[n]={pos:b.getWorldPosition(new THREE.Vector3()),quat:b.getWorldQuaternion(new THREE.Quaternion())}}
 gl.restLocal={};for(const n in gl.bones){const b=gl.bones[n];gl.restLocal[n]={p:b.position.clone(),q:b.quaternion.clone()}}
 gl.mesh.material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62,metalness:0});
 gl.child={pelvis:'spine_01',clavicle_l:'upperarm_l',clavicle_r:'upperarm_r',upperarm_l:'lowerarm_l',upperarm_r:'lowerarm_r',lowerarm_l:'hand_l',lowerarm_r:'hand_r',hand_l:'middle_01_l',hand_r:'middle_01_r',thigh_l:'calf_l',thigh_r:'calf_r',calf_l:'foot_l',calf_r:'foot_r',foot_l:'ball_l',foot_r:'ball_r'};
 buildMuscles();window.ready=true}
function color(hi,sec){const g=gl.mesh.geometry,si=g.attributes.skinIndex,sw=g.attributes.skinWeight,bn=gl.mesh.skeleton.bones.map(b=>b.name);
 const inH=new Set((hi||[]).flatMap(k=>GROUPS[k]||[])),inS=new Set((sec||[]).flatMap(k=>GROUPS[k]||[]));
 const col=new Float32Array(si.count*3);
 for(let i=0;i<si.count;i++){let h=0,sc=0;for(let k=0;k<4;k++){const w=sw.getComponent(i,k);if(!w)continue;const n=bn[si.getComponent(i,k)];if(inH.has(n))h+=w;else if(inS.has(n))sc+=w*.45}
  const t=Math.min(1,h+sc),sm=t*t*(3-2*t);for(let k=0;k<3;k++)col[i*3+k]=TUN.base[k]*(1-sm)+TUN.red[k]*sm}
 g.setAttribute('color',new THREE.BufferAttribute(col,3))}

// ---------- sculpted muscle overlay (ellipsoids parented to bones, built in rest pose) ----------

function makeFiberTex(seed){const W=1024,H=256,cv=document.createElement('canvas');cv.width=W;cv.height=H;const g=cv.getContext('2d');let r=seed||7;const rnd=()=>{r=(r*16807)%2147483647;return r/2147483647};
 g.fillStyle='#d9d9d9';g.fillRect(0,0,W,H);
 for(let i=0;i<420;i++){let x=rnd()*W;const w=.6+rnd()*2.2,a=.10+rnd()*.38,dark=rnd()<.72;g.strokeStyle=dark?'rgba(40,40,45,'+a+')':'rgba(255,255,255,'+a*.8+')';g.lineWidth=w;g.beginPath();g.moveTo(x,0);const ph=rnd()*6,amp=.4+rnd()*1.4;for(let y=0;y<=H;y+=16){g.lineTo(x+Math.sin(y*.04+ph)*amp,y)}g.stroke()}
 // coarse bundles
 for(let i=0;i<46;i++){const x=rnd()*W,w=6+rnd()*14;g.fillStyle='rgba(30,30,35,'+(.05+rnd()*.1)+')';g.fillRect(x,0,w,H)}
 const t=new THREE.CanvasTexture(cv);t.wrapS=THREE.RepeatWrapping;t.wrapT=THREE.ClampToEdgeWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t}
const FIB=makeFiberTex(11),FIB2=makeFiberTex(29);
const MUSCLES=[];let SURF=null;
function surfaceVerts(){if(SURF)return SURF;const g=gl.mesh.geometry,p=g.attributes.position,out=[];const m=gl.mesh.matrixWorld;for(let i=0;i<p.count;i+=2)out.push(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(m));SURF=out;return out}
function surf(C,d){let best=0;for(const v of surfaceVerts()){const w=v.clone().sub(C);const a=w.dot(d);if(a<0)continue;const perp=w.clone().addScaledVector(d,-a).length();if(perp<.045&&a>best)best=a}return best}
function addMuscle(boneName,C,dir,axis,ra,rl,rd,group,bulge){ // C: centre on body axis (rest world), dir: outward, axis: long direction
 const d=dir.clone().normalize(),ax=axis.clone().normalize();const sf=surf(C,d)||rd;const centre=C.clone().addScaledVector(d,sf-rd*(1-(bulge||.55)));
 const ez=d.clone(),ey=ax.clone().addScaledVector(d,-ax.dot(d)).normalize(),ex=new THREE.Vector3().crossVectors(ey,ez).normalize();
 const q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex,ey,ez));
 const g=new THREE.SphereGeometry(1,64,40);{const p=g.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i),k=Math.pow(Math.max(.0001,Math.sqrt(1-y*y)),.0)*(1-.18*y*y);p.setX(i,p.getX(i)*k);p.setZ(i,p.getZ(i)*k)}g.computeVertexNormals()}
 const tx=(MUSCLES.length%2)?FIB:FIB2;const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0xb4b9c1,map:tx,bumpMap:tx,bumpScale:3,roughness:.52}));m.castShadow=true;
 const W=new THREE.Matrix4().compose(centre,q,new THREE.Vector3(ra*1.3,rl*1.15,rd*1.2));const b=gl.bones[boneName];
 const inv=new THREE.Matrix4().copy(b.matrixWorld).invert();const L=inv.multiply(W);L.decompose(m.position,m.quaternion,m.scale);b.add(m);MUSCLES.push({m,group});}
function buildMuscles(){const R=gl.rest,B=gl.bones;gl.root.updateMatrixWorld(true);const P=n=>R[n].pos.clone();
 const X=new THREE.Vector3(1,0,0),Yv=new THREE.Vector3(0,1,0),F=new THREE.Vector3(0,0,1),Nf=F.clone().negate();
 const along=(a,b,t)=>P(a).lerp(P(b),t);
 const heads=(bone,C,dir,axis,ra,rl,rd,grp,n,gap,bulge)=>{const perp=new THREE.Vector3().crossVectors(dir,axis).normalize();
  for(let k=0;k<n;k++){const o=(k-(n-1)/2);const lr=rl*(1-.08*Math.abs(o)),ctr=C.clone().addScaledVector(perp,o*gap).addScaledVector(axis.clone().normalize(),o*rl*.04*(k%2?1:-1));
   addMuscle(bone,ctr,dir,axis,ra/n*1.25+.004,lr,rd,grp,bulge||.7)}};
 for(const [sd,sx] of [['l',1],['r',-1]]){
  const out=X.clone().multiplyScalar(sx),inn=out.clone().negate();
  const ua=P('lowerarm_'+sd).sub(P('upperarm_'+sd)),fa=P('hand_'+sd).sub(P('lowerarm_'+sd));
  const U=t=>along('upperarm_'+sd,'lowerarm_'+sd,t),FA=t=>along('lowerarm_'+sd,'hand_'+sd,t);
  // deltoid: anterior, lateral, posterior heads
  heads('upperarm_'+sd,U(.14),F.clone().add(out.clone().multiplyScalar(.5)),ua,.05,.075,.04,'delts',1,0);
  heads('upperarm_'+sd,U(.12),out.clone().add(Yv.clone().multiplyScalar(.4)),ua,.065,.085,.045,'delts',3,.022);
  heads('upperarm_'+sd,U(.16),Nf.clone().add(out.clone().multiplyScalar(.4)),ua,.05,.07,.04,'delts',1,0);
  // biceps (2 heads), triceps (3 heads), brachialis
  heads('upperarm_'+sd,U(.5),F,ua,.05,.11,.034,'arms',2,.016);
  heads('upperarm_'+sd,U(.48),Nf,ua,.07,.115,.036,'arms',3,.017);
  // forearm flexors and extensors
  heads('lowerarm_'+sd,FA(.3),F,fa,.05,.1,.03,'forearms',3,.012);
  heads('lowerarm_'+sd,FA(.3),Nf,fa,.05,.1,.028,'forearms',3,.012);
  // thighs: rectus, vastus lat/med, hamstrings, adductors
  const th=P('calf_'+sd).sub(P('thigh_'+sd)),T=t=>along('thigh_'+sd,'calf_'+sd,t);
  heads('thigh_'+sd,T(.45),F,th,.05,.17,.05,'thighs',1,0);
  heads('thigh_'+sd,T(.42),out,th,.06,.165,.04,'thighs',2,.018);
  heads('thigh_'+sd,T(.42),inn,th,.05,.15,.04,'thighs',2,.016);
  heads('thigh_'+sd,T(.4),Nf,th,.075,.17,.045,'thighs',3,.02);
  // calves: gastrocnemius medial/lateral, soleus, tibialis
  const ca=P('foot_'+sd).sub(P('calf_'+sd)),Cc=t=>along('calf_'+sd,'foot_'+sd,t);
  heads('calf_'+sd,Cc(.3),Nf,ca,.07,.13,.045,'calves',2,.02);
  heads('calf_'+sd,Cc(.55),Nf,ca,.05,.12,.03,'calves',1,0);
  heads('calf_'+sd,Cc(.4),F,ca,.04,.13,.028,'calves',2,.012);
  // glutes: max, med
  heads('pelvis',P('thigh_'+sd).add(new THREE.Vector3(-sx*.005,.07,0)),Nf,Yv,.09,.095,.06,'pelvis',2,.03);
  // chest: clavicular, sternal, abdominal fibres fanning to the arm
  const sp3=P('spine_03'),sp2=P('spine_02'),sp1=P('spine_01');
  for(const [dy,ax] of [[.055,new THREE.Vector3(sx*1,-.45,0)],[.015,new THREE.Vector3(sx*1,-.12,0)],[-.03,new THREE.Vector3(sx*1,.25,0)]])
   addMuscle('spine_03',sp3.clone().add(new THREE.Vector3(sx*.085,dy+.02,0)),F,ax,.03,.115,.05,'chest',.75);
  // lats and traps, rhomboids/infra
  heads('spine_02',sp2.clone().add(new THREE.Vector3(sx*.1,.02,0)),Nf,Yv.clone().add(out.clone().multiplyScalar(.3)),.1,.15,.045,'back',3,.03);
  heads('spine_03',sp3.clone().add(new THREE.Vector3(sx*.07,.1,0)),Nf.clone().add(Yv.clone().multiplyScalar(.3)),X.clone().multiplyScalar(sx),.07,.11,.035,'back',2,.03);
  // obliques / serratus
  heads('spine_01',sp1.clone().add(new THREE.Vector3(sx*.11,.07,0)),out,Yv,.07,.1,.035,'abs',3,.025);
  // abs: 4 rows, with tendinous inscriptions between
  for(let i=0;i<4;i++)addMuscle(i>1?'spine_01':'spine_02',(i>1?P('spine_01'):P('spine_02')).add(new THREE.Vector3(sx*.032,[.1,.04,.12,.06][i]-(i>1?.02:.0)+(i<2?-.0:0),0)),F,Yv,.04,.03,.03,'abs',.75);
 }
 gl.muscleMat=MUSCLES}
let BACKY=false;function colorMuscles(hi,sec){const ex=g=>(g||[]).flatMap(k=>k==='torso'?[BACKY?'back':'chest']:[k]);const H=new Set(ex(hi)),S=new Set(ex(sec));for(const {m,group} of MUSCLES){const h=H.has(group),sc=S.has(group);m.material.color.setHex(h?0xe0392c:sc?0xcf9a92:0xb6bbc3);m.material.emissive.setHex(h?0x2c0603:0x000000);m.material.roughness=h?.42:.55}}
const q0=new THREE.Quaternion();
function setWorldQ(b,q){const pq=b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();b.quaternion.copy(pq.multiply(q));b.updateMatrixWorld(true)}
function basisQ(side,up,f){const m=new THREE.Matrix4().makeBasis(side,up,f);return new THREE.Quaternion().setFromRotationMatrix(m)}
let FIST=0;const FING=['index','middle','ring','pinky'];
function curlFingers(a){for(const l of ['l','r']){for(const f of FING){[['_01_',1.0],['_02_',1.1],['_03_',0.8]].forEach(([sfx,m])=>{const n=f+sfx+l,b=gl.bones[n];if(!b)return;b.quaternion.copy(gl.restLocal[n].q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),a*m*1.2))});}
 const t=['thumb_01_'+l,'thumb_02_'+l,'thumb_03_'+l];t.forEach((n,i)=>{const b=gl.bones[n];if(b)b.quaternion.copy(gl.restLocal[n].q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),a*.5*(i?1:0)))})}gl.root.updateMatrixWorld(true)}
function retarget(sk){const B=gl.bones,R=gl.rest;
 for(const n in B){B[n].position.copy(gl.restLocal[n].p);B[n].quaternion.copy(gl.restLocal[n].q)}gl.root.updateMatrixWorld(true);
 const sideR=R.thigh_l.pos.clone().sub(R.thigh_r.pos).normalize(),upR=R.neck_01.pos.clone().sub(R.pelvis.pos).normalize();
 const fR=new THREE.Vector3().crossVectors(sideR,upR).normalize();sideR.crossVectors(upR,fR).normalize();
 const qR=basisQ(sideR,upR,fR);const qT=basisQ(V(sk.side).normalize(),V(sk.up).normalize(),V(sk.f).normalize());
 const Q=qT.clone().multiply(qR.clone().invert());
 const midR=R.thigh_l.pos.clone().add(R.thigh_r.pos).multiplyScalar(.5),midT=V(sk.hip.L).add(V(sk.hip.R)).multiplyScalar(.5);
 const pw=midT.clone().add(R.pelvis.pos.clone().sub(midR).applyQuaternion(Q));
 const pb=B.pelvis;pb.position.copy(pb.parent.worldToLocal(pw.clone()));setWorldQ(pb,Q.clone().multiply(R.pelvis.quat));
 const aim=(n,target)=>{const b=B[n],c=B[gl.child[n]];const dR=R[gl.child[n]].pos.clone().sub(R[n].pos).normalize();
  const dT=target.clone().sub(b.getWorldPosition(new THREE.Vector3())).normalize();const q=new THREE.Quaternion().setFromUnitVectors(dR,dT).multiply(R[n].quat);setWorldQ(b,q)};
 for(const k of ['L','R']){const l=k.toLowerCase();
  aim('clavicle_'+l,V(sk.sh[k]));aim('upperarm_'+l,V(sk.el[k]));aim('lowerarm_'+l,V(sk.wr[k]));aim('hand_'+l,V(sk.hand[k]));
  aim('thigh_'+l,V(sk.kn[k]));aim('calf_'+l,V(sk.an[k]));aim('foot_'+l,V(sk.toe[k]))}
 curlFingers(FIST)}
const MAT={metal:0xa9afb8,plate:0x8f959e,pad:0x7f8690,frame:0xb7bdc5,cable:0x70767f,body:0xb9bec6,sec:0xb9bec6,hi:0xd02f24};
const props=new THREE.Group();s.add(props);const mats={};const mat=c=>mats[c]||(mats[c]=new THREE.MeshStandardMaterial({color:MAT[c]||MAT.body,roughness:.5,metalness:c==='metal'?.5:.1}));
function clearProps(){while(props.children.length){const o=props.children.pop();o.geometry&&o.geometry.dispose()}}
const Y=new THREE.Vector3(0,1,0);
function addCyl(a,b,ra,rb,col,caps){const A=V(a),Bv=V(b),d=Bv.clone().sub(A),len=d.length();if(len<1e-4)return;
 const m=new THREE.Mesh(new THREE.CylinderGeometry(rb,ra,len,18),mat(col));m.position.copy(A.clone().add(Bv).multiplyScalar(.5));m.quaternion.setFromUnitVectors(Y,d.normalize());m.castShadow=true;m.receiveShadow=true;props.add(m);
 if(caps)[[a,ra],[b,rb]].forEach(([p,rr])=>{const sp=new THREE.Mesh(new THREE.SphereGeometry(rr,14,10),mat(col));sp.position.copy(V(p));sp.castShadow=true;props.add(sp)})}
function propShapes(shapes){clearProps();
 for(const sh of shapes){
  if(sh.k==='cap')addCyl(sh.a,sh.b,sh.ra,sh.rb,sh.col,true);
  else if(sh.k==='line')addCyl(sh.a,sh.b,.005,.005,sh.col,false);
  else if(sh.k==='sph'){const m=new THREE.Mesh(new THREE.SphereGeometry(sh.r,16,12),mat(sh.col));m.position.copy(V(sh.c));m.castShadow=true;props.add(m)}
  else if(sh.k==='disc'){const n=V(sh.n).normalize();const m=new THREE.Mesh(new THREE.CylinderGeometry(sh.r,sh.r,.03,28),mat(sh.col));m.position.copy(V(sh.c));m.quaternion.setFromUnitVectors(Y,n);m.castShadow=true;m.receiveShadow=true;props.add(m)}
  else if(sh.k==='box'){const a=V(sh.ax[0]),b=V(sh.ax[1]),c2=V(sh.ax[2]);const g=new THREE.BoxGeometry(a.length()*2,b.length()*2,c2.length()*2);
   const m4=new THREE.Matrix4().makeBasis(a.clone().normalize(),b.clone().normalize(),c2.clone().normalize());if(m4.determinant()<0)m4.makeBasis(a.clone().normalize(),b.clone().normalize(),c2.clone().normalize().negate());
   const m=new THREE.Mesh(g,mat(sh.col));m.quaternion.setFromRotationMatrix(m4);m.position.copy(V(sh.c));m.castShadow=true;m.receiveShadow=true;props.add(m)}}}
// per-exercise setup
let cur=null,fit=null;
window.setup=(id)=>{const def=EA.defs[id];BACKY=/Row|Pulldown|Pull Up|Chin|Deadlift|Shrug|Pullover|Hyperext|Back Ext|Rack Pull|Good Morning|Pull-?through/i.test(def.name);colorMuscles(def.hi,def.sec);FIST=/Barbell|Dumbbell|Cable|Kettlebell|Plate|Smith|Machine|Assisted/.test(def.eq)?0.9:0.25;color([],[]);cur=id;
 let pts=[];for(let i=0;i<40;i++){const f=EA.frame(id,i/40);const sk=f.sk;['sh','el','wr','hip','kn','an','toe'].forEach(k=>['L','R'].forEach(l=>pts.push(V(sk[k][l])))); pts.push(V(sk.head));pts.push(V(sk.head).add(new THREE.Vector3(0,.16,0)));
  (def.props?def.props(sk):[]).forEach(sh=>{['a','b','c'].forEach(p=>sh[p]&&pts.push(V(sh[p])))})}
 const box=new THREE.Box3().setFromPoints(pts),ctr=box.getCenter(new THREE.Vector3());let rad=0;pts.forEach(p=>rad=Math.max(rad,p.distanceTo(ctr)));
 fit={c:ctr,r:rad};const yaw=def.cam&&def.cam.yaw!=null?def.cam.yaw:.7,pitch=(def.cam&&def.cam.pitch)||.15,D=5.5;
 cam.fov=2*Math.atan(1.12*rad/D)*180/Math.PI;cam.updateProjectionMatrix();
 cam.position.copy(ctr.clone().add(new THREE.Vector3(D*Math.sin(yaw)*Math.cos(pitch),D*Math.sin(pitch),D*Math.cos(yaw)*Math.cos(pitch))));cam.lookAt(ctr);
 return def.dur};
window.frameAt=(t)=>{const f=EA.frame(cur,t);retarget(f.sk);const def=EA.defs[cur];propShapes(def.props?def.props(f.sk):[]);r.render(s,cam);return c.toDataURL('image/png')};
// CC0 mocap clip, recoloured
window.setupClip=(name,hi,yaw,pitch,ctr,rad)=>{color([],[]);colorMuscles(hi,[]);gl.mixer=new THREE.AnimationMixer(gl.root);const clip=THREE.AnimationClip.findByName(gl.g.animations,name);gl.mixer.clipAction(clip).play();clearProps();
 const D=5.5;cam.fov=2*Math.atan(1.12*rad/D)*180/Math.PI;cam.updateProjectionMatrix();const C=new THREE.Vector3(...ctr);cam.position.copy(C.clone().add(new THREE.Vector3(D*Math.sin(yaw)*Math.cos(pitch),D*Math.sin(pitch),D*Math.cos(yaw)*Math.cos(pitch))));cam.lookAt(C);return clip.duration};
window.clipAt=(t)=>{gl.mixer.setTime(t);r.render(s,cam);return c.toDataURL('image/png')};
load();
