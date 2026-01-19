import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// -------------------------------------------------
// Helpers
// -------------------------------------------------
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const rand = (min, max) => min + Math.random() * (max - min);
const TWO_PI = Math.PI * 2;

function wrapAngle(a) { return ((a % TWO_PI) + TWO_PI) % TWO_PI; }

function makeSkyTexture(top, mid, bot) {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 1024;
  const g = c.getContext("2d");

  const grad = g.createLinearGradient(0, 0, 0, 1024);
  grad.addColorStop(0.00, top);
  grad.addColorStop(0.45, mid);
  grad.addColorStop(1.00, bot);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 1024);

  g.globalAlpha = 0.10;
  for (let i = 0; i < 2200; i++) {
    const y = rand(0, 620);
    const x = rand(0, 1024);
    const w = rand(120, 16);
    const h = rand(30, 6);
    g.fillStyle = `rgba(255,255,255,${rand(0.18, 0.02)})`;
    g.beginPath();
    g.ellipse(x, y, w, h, rand(0, Math.PI), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function blendHex(h1, h2, t) {
  const c1 = new THREE.Color(h1);
  const c2 = new THREE.Color(h2);
  const c = c1.lerp(c2, t);
  return `#${c.getHexString()}`;
}

function displaceIsland(geo, strength, freq, seed = 0) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const n =
      Math.sin((x + seed) * freq) * 0.6 +
      Math.sin((z - seed) * (freq * 0.92)) * 0.5 +
      Math.sin((x + z) * (freq * 0.55)) * 0.35;
    const r = Math.sqrt(x * x + z * z);
    const falloff = 1 - clamp(r / 18.0, 0, 1);
    const y = (n * strength) * (0.25 + 0.75 * falloff);
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function sectorBlend(thetaWrapped) {
  const a = wrapAngle(thetaWrapped);
  const s = (Math.PI / 2);
  const idx = Math.floor(a / s);
  const frac = (a - idx * s) / s;
  const names = ["Aarde", "Vuur", "Water", "Lucht"];
  return { A: names[idx], B: names[(idx + 1) % 4], t: smooth(frac) };
}

// -------------------------------------------------
// Scene / Camera / Renderer
// -------------------------------------------------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 700);
camera.position.set(0, 9.0, 22);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.body.appendChild(renderer.domElement);

// -------------------------------------------------
// Orbit offset (user) + follow logic (SMOOTH)
// -------------------------------------------------
let isDragging = false;
let lastX = 0, lastY = 0;

let orbitYawTarget = 0.0;
let orbitPitchTarget = 0.18;
let orbitDistanceTarget = 22;

let orbitYaw = 0.0;
let orbitPitch = 0.18;
let orbitDistance = 22;

window.addEventListener("mousedown", (e) => { isDragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener("mouseup", () => { isDragging = false; });
window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  orbitYawTarget -= dx * 0.0045;
  orbitPitchTarget -= dy * 0.004;
});
window.addEventListener("wheel", (e) => { orbitDistanceTarget += e.deltaY * 0.012; }, { passive: true });

const camPos = new THREE.Vector3();
const camTargetSmooth = new THREE.Vector3(0, 2.0, 0);

function updateFollowCamera(aangPos, aangForward, t, dt) {
  orbitPitchTarget = clamp(orbitPitchTarget, -0.05, 0.62);
  orbitDistanceTarget = clamp(orbitDistanceTarget, 14, 36);

  const damp = 1.0 - Math.pow(0.001, dt);
  orbitYaw = lerp(orbitYaw, orbitYawTarget, damp * 0.85);
  orbitPitch = lerp(orbitPitch, orbitPitchTarget, damp * 0.85);
  orbitDistance = lerp(orbitDistance, orbitDistanceTarget, damp * 0.85);

  const behind = aangForward.clone().multiplyScalar(-1);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), behind).normalize();

  const yawRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), orbitYaw);
  const dir = behind.clone().applyQuaternion(yawRot).normalize();

  const upLift = new THREE.Vector3(0, 1, 0).multiplyScalar(0.40 + Math.sin(orbitPitch) * 0.65);
  const sway = 0.12 * Math.sin(t * 1.1);
  const swayVec = right.clone().multiplyScalar(sway);

  const desiredPos = aangPos.clone()
    .add(dir.multiplyScalar(orbitDistance))
    .add(upLift.multiplyScalar(orbitDistance * 0.55))
    .add(swayVec);

  const desiredTarget = new THREE.Vector3(0, 1.6, 0);

  const camDamp = 1.0 - Math.pow(0.0005, dt);
  camPos.lerp(desiredPos, camDamp);
  camTargetSmooth.lerp(desiredTarget, camDamp * 0.9);

  camera.position.copy(camPos);
  camera.lookAt(camTargetSmooth);
}

// -------------------------------------------------
// Atmos presets
// -------------------------------------------------
const atmos = {
  Aarde: {
    fog: 0.020, fogCol: new THREE.Color(0x86c49b),
    hemiTop: new THREE.Color(0xcff7dd), hemiBot: new THREE.Color(0x0f2a1d),
    sunCol: new THREE.Color(0xffffff), exposure: 1.12,
    sky: ["#d8fff0", "#aee8c9", "#1a2f3a"]
  },
  Vuur: {
    fog: 0.034, fogCol: new THREE.Color(0x6b2a1f),
    hemiTop: new THREE.Color(0xffe0c2), hemiBot: new THREE.Color(0x240d0a),
    sunCol: new THREE.Color(0xffe2c8), exposure: 1.06,
    sky: ["#ffd2b0", "#ff8b6b", "#1b0c14"]
  },
  Water: {
    fog: 0.022, fogCol: new THREE.Color(0x6fc6ff),
    hemiTop: new THREE.Color(0xdaf6ff), hemiBot: new THREE.Color(0x0a2040),
    sunCol: new THREE.Color(0xeaf6ff), exposure: 1.18,
    sky: ["#e5fbff", "#a8ddff", "#102a55"]
  },
  Lucht: {
    fog: 0.016, fogCol: new THREE.Color(0xaad9ff),
    hemiTop: new THREE.Color(0xeef7ff), hemiBot: new THREE.Color(0x1a2a40),
    sunCol: new THREE.Color(0xffffff), exposure: 1.22,
    sky: ["#f3fbff", "#b8e6ff", "#1c2a5a"]
  }
};

scene.fog = new THREE.FogExp2(atmos.Lucht.fogCol.getHex(), atmos.Lucht.fog);

const hemi = new THREE.HemisphereLight(atmos.Lucht.hemiTop, atmos.Lucht.hemiBot, 0.95);
scene.add(hemi);

const sun = new THREE.DirectionalLight(atmos.Lucht.sunCol, 1.35);
sun.position.set(18, 26, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 220;
sun.shadow.camera.left = -90;
sun.shadow.camera.right = 90;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
scene.add(sun);

const fill = new THREE.PointLight(0xffc07a, 0.45, 70);
fill.position.set(0, 4, 0);
scene.add(fill);

const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
const sky = new THREE.Mesh(new THREE.SphereGeometry(280, 48, 48), skyMat);
scene.add(sky);

function setSkyFor(nameA, nameB, t) {
  const A = atmos[nameA].sky;
  const B = atmos[nameB].sky;
  const tex = makeSkyTexture(
    blendHex(A[0], B[0], t),
    blendHex(A[1], B[1], t),
    blendHex(A[2], B[2], t)
  );
  if (skyMat.map) skyMat.map.dispose();
  skyMat.map = tex;
  skyMat.needsUpdate = true;
}
setSkyFor("Lucht", "Lucht", 0);

let skyTimer = 0;
let lastSkyKey = "";

// -------------------------------------------------
// One floating island + 4 nation quarters
// -------------------------------------------------
const island = new THREE.Group();
scene.add(island);

const topGeo = new THREE.PlaneGeometry(40, 40, 180, 180);
displaceIsland(topGeo, 1.85, 0.22, 11);

const topMat = new THREE.MeshStandardMaterial({ color: 0x2f6b45, roughness: 0.98 });
const top = new THREE.Mesh(topGeo, topMat);
top.rotation.x = -Math.PI / 2;
top.receiveShadow = true;
island.add(top);

const underside = new THREE.Mesh(
  new THREE.CylinderGeometry(16.5, 20.5, 7.8, 110, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.99 })
);
underside.position.y = -3.6;
underside.castShadow = true;
island.add(underside);

const edge = new THREE.Mesh(
  new THREE.TorusGeometry(18.6, 0.42, 16, 200),
  new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.98 })
);
edge.rotation.x = Math.PI / 2;
edge.position.y = 0.12;
edge.castShadow = true;
island.add(edge);

// -------------------------------------------------
// Nation ground sectors (based on landmark centers)
// -------------------------------------------------
const sectorGroup = new THREE.Group();
island.add(sectorGroup);

function addSectorByCenter(colorHex, centerX, centerZ, halfWidthRad = Math.PI / 4) {
  const centerAng = Math.atan2(centerZ, centerX);
  const start = centerAng - halfWidthRad;
  const len = halfWidthRad * 2;

  const segGeo = new THREE.CircleGeometry(18.0, 180, start, len);
  const segMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.98,
    metalness: 0.0
  });

  const seg = new THREE.Mesh(segGeo, segMat);
  seg.rotation.x = -Math.PI / 2;
  seg.position.y = 0.14;
  seg.receiveShadow = true;
  sectorGroup.add(seg);
  return seg;
}

// Centers
const earthCenter = new THREE.Vector2(6.8, 6.8);
const fireCenter = new THREE.Vector2(-6.8, 6.8);
const waterCenter = new THREE.Vector2(-6.8, -6.8);
const airCenter = new THREE.Vector2(6.8, -6.8);

// Create sectors
const earthSector = addSectorByCenter(0x2f6b45, earthCenter.x, earthCenter.y);
const fireSector = addSectorByCenter(0x3b1410, fireCenter.x, fireCenter.y);
const waterSector = addSectorByCenter(0x1e5aa8, waterCenter.x, waterCenter.y);
const airSector = addSectorByCenter(0xe8d9b8, airCenter.x, airCenter.y);

// Reverse Fire <-> Water ground colors/materials (zoals in jouw code)
{
  const fireMat = fireSector.material;
  const waterMat = waterSector.material;
  fireSector.material = waterMat;
  waterSector.material = fireMat;
  fireSector.material.needsUpdate = true;
  waterSector.material.needsUpdate = true;
}

// Re-apply feel
fireSector.material.emissive = new THREE.Color(0x2a0703);
fireSector.material.emissiveIntensity = 0.25;

waterSector.material.roughness = 0.55;
waterSector.material.metalness = 0.03;

// -------------------------------------------------
// Road
// -------------------------------------------------
const roadGroup = new THREE.Group();
island.add(roadGroup);

const road = new THREE.Mesh(
  new THREE.RingGeometry(13.2, 14.4, 260, 2),
  new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.96 })
);
road.rotation.x = -Math.PI / 2;
road.position.y = 0.16;
road.receiveShadow = true;
roadGroup.add(road);

const tileGeo = new THREE.BoxGeometry(0.52, 0.06, 0.28);
const tileMat = new THREE.MeshStandardMaterial({ color: 0x9099a6, roughness: 0.98 });
const tileCount = 260;
const tiles = new THREE.InstancedMesh(tileGeo, tileMat, tileCount);
tiles.castShadow = true;
tiles.receiveShadow = true;

for (let i = 0; i < tileCount; i++) {
  const a = (i / tileCount) * TWO_PI;
  const r = 13.8 + Math.sin(i * 0.9) * 0.10;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
  const m = new THREE.Matrix4();
  const jitter = (i % 2 === 0) ? 0.14 : -0.14;
  m.compose(
    new THREE.Vector3(x + Math.cos(a + Math.PI / 2) * jitter, 0.18, z + Math.sin(a + Math.PI / 2) * jitter),
    q,
    new THREE.Vector3(1, 1, 1)
  );
  tiles.setMatrixAt(i, m);
}
tiles.instanceMatrix.needsUpdate = true;
roadGroup.add(tiles);

// -------------------------------------------------
// Landmarks
// -------------------------------------------------
const landmarks = new THREE.Group();
island.add(landmarks);

function addBaSingSe() {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcbbf86, roughness: 0.99 });
  const wall = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.55, 18, 180), wallMat);
  wall.rotation.x = Math.PI / 2;
  wall.position.set(earthCenter.x, 0.95, earthCenter.y);
  wall.castShadow = true;
  g.add(wall);

  const bMat = new THREE.MeshStandardMaterial({ color: 0xa89b6a, roughness: 0.98 });
  for (let i = 0; i < 120; i++) {
    const w = rand(1.0, 0.45);
    const d = rand(1.0, 0.45);
    const h = rand(1.2, 0.35);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bMat);
    const a = rand(0, TWO_PI);
    const r = rand(5.0, 1.2);
    b.position.set(earthCenter.x + Math.cos(a) * r, h * 0.5, earthCenter.y + Math.sin(a) * r);
    b.rotation.y = rand(0, Math.PI);
    b.castShadow = true;
    g.add(b);
  }

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1f, roughness: 0.98 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f4a, roughness: 0.98 });
  for (let i = 0; i < 52; i++) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.10, rand(1.25, 0.75), 10), trunkMat);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(rand(0.55, 0.28), 14, 14), leafMat);
    const a = rand(0, TWO_PI);
    const r = rand(7.2, 2.2);
    trunk.position.set(earthCenter.x + Math.cos(a) * r, 0.75, earthCenter.y + Math.sin(a) * r);
    crown.position.set(trunk.position.x, trunk.position.y + 0.85, trunk.position.z);
    trunk.castShadow = crown.castShadow = true;
    g.add(trunk, crown);
  }

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.45, 26, 22),
    new THREE.MeshStandardMaterial({ color: 0x2b7b5a, roughness: 0.85 })
  );
  dome.scale.y = 0.65;
  dome.position.set(earthCenter.x, 1.15, earthCenter.y);
  dome.castShadow = true;
  g.add(dome);

  return g;
}

function addFireNation() {
  const g = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.99 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b0f0b, roughness: 0.98 });

  for (let i = 0; i < 52; i++) {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(rand(2.1, 0.8), rand(0.35, 0.15), rand(2.1, 0.8)),
      rockMat
    );
    const a = rand(0, TWO_PI);
    const r = rand(7.8, 1.2);
    slab.position.set(fireCenter.x + Math.cos(a) * r, 0.16, fireCenter.y + Math.sin(a) * r);
    slab.rotation.y = rand(0, Math.PI);
    slab.castShadow = true;
    g.add(slab);
  }

  for (let i = 0; i < 20; i++) {
    const t = new THREE.Mesh(
      new THREE.CylinderGeometry(rand(0.9, 0.45), rand(1.1, 0.55), rand(2.8, 1.2), 10),
      wallMat
    );
    const a = (i / 20) * TWO_PI;
    const r = 5.8 + Math.sin(i * 0.6) * 0.25;
    t.position.set(fireCenter.x + Math.cos(a) * r, 1.2, fireCenter.y + Math.sin(a) * r);
    t.castShadow = true;
    g.add(t);
  }

  const volcano = new THREE.Mesh(
    new THREE.ConeGeometry(3.8, 5.6, 28),
    new THREE.MeshStandardMaterial({ color: 0x2b0f0b, roughness: 0.99 })
  );
  volcano.position.set(fireCenter.x, 2.4, fireCenter.y);
  volcano.castShadow = true;
  g.add(volcano);

  const lava = new THREE.Mesh(
    new THREE.CircleGeometry(1.45, 80),
    new THREE.MeshStandardMaterial({
      color: 0xff3b1a,
      roughness: 0.35,
      emissive: 0xff2a00,
      emissiveIntensity: 1.35
    })
  );
  lava.rotation.x = -Math.PI / 2;
  lava.position.set(fireCenter.x, 3.9, fireCenter.y);
  g.add(lava);

  g.userData.lava = lava;
  return g;
}

function addWaterTribe() {
  const g = new THREE.Group();
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xbfeeff, roughness: 0.35, metalness: 0.02 });

  const lagoon = new THREE.Mesh(
    new THREE.CircleGeometry(6.0, 100),
    new THREE.MeshStandardMaterial({
      color: 0x3ad0ff,
      roughness: 0.10,
      metalness: 0.05,
      transparent: true,
      opacity: 0.80
    })
  );
  lagoon.rotation.x = -Math.PI / 2;
  lagoon.position.set(waterCenter.x, 0.34, waterCenter.y);
  g.add(lagoon);
  g.userData.water = lagoon;

  for (let i = 0; i < 26; i++) {
    const ig = new THREE.Mesh(new THREE.SphereGeometry(rand(1.05, 0.55), 22, 22), iceMat);
    ig.scale.y = rand(0.78, 0.62);
    const a = rand(0, TWO_PI);
    const r = rand(7.0, 2.0);
    ig.position.set(waterCenter.x + Math.cos(a) * r, 0.75, waterCenter.y + Math.sin(a) * r);
    ig.castShadow = true;
    g.add(ig);
  }

  for (let i = 0; i < 34; i++) {
    const sh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(rand(0.65, 0.18), 0),
      new THREE.MeshStandardMaterial({ color: 0xd8f6ff, roughness: 0.35, metalness: 0.02 })
    );
    const a = rand(0, TWO_PI);
    const r = rand(8.6, 3.0);
    sh.position.set(waterCenter.x + Math.cos(a) * r, 0.6, waterCenter.y + Math.sin(a) * r);
    sh.castShadow = true;
    g.add(sh);
  }

  return g;
}

function addAirNomads() {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xf2ead7, roughness: 0.98 });

  for (let i = 0; i < 5; i++) {
    const terr = new THREE.Mesh(
      new THREE.CylinderGeometry(6.6 - i * 1.1, 6.9 - i * 1.1, 0.55, 44),
      stoneMat
    );
    terr.position.set(airCenter.x, 0.25 + i * 0.55, airCenter.y);
    terr.castShadow = true;
    terr.receiveShadow = true;
    g.add(terr);
  }

  const temple = new THREE.Mesh(
    new THREE.CylinderGeometry(1.25, 1.65, 3.2, 20),
    stoneMat
  );
  temple.position.set(airCenter.x, 3.5, airCenter.y);
  temple.castShadow = true;
  g.add(temple);

  const floatMat = new THREE.MeshStandardMaterial({ color: 0xd8c9a4, roughness: 0.99 });
  for (let i = 0; i < 22; i++) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(rand(0.75, 0.22), 0),
      floatMat
    );
    const a = rand(0, TWO_PI);
    const r = rand(8.8, 3.0);
    rock.position.set(airCenter.x + Math.cos(a) * r, 4.0 + rand(3.2, 0.4), airCenter.y + Math.sin(a) * r);
    rock.castShadow = true;
    rock.userData.floatPhase = rand(0, TWO_PI);
    g.add(rock);
  }

  return g;
}

const earthLand = addBaSingSe();
const fireLand = addFireNation();
const waterLand = addWaterTribe();
const airLand = addAirNomads();
landmarks.add(earthLand, fireLand, waterLand, airLand);

// -------------------------------------------------
// Particles
// -------------------------------------------------
function makeParticleSystem(count, colorHex, size, area, yMin, yMax) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    pos[i * 3 + 0] = rand(-area, area);
    pos[i * 3 + 1] = rand(yMin, yMax);
    pos[i * 3 + 2] = rand(-area, area);

    vel[i * 3 + 0] = rand(-0.10, 0.10);
    vel[i * 3 + 1] = rand(0.02, 0.12);
    vel[i * 3 + 2] = rand(-0.10, 0.10);
  }

  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("velocity", new THREE.BufferAttribute(vel, 3));

  const mat = new THREE.PointsMaterial({
    color: colorHex,
    size,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

function updateParticles(sys, dt, bounds = 22) {
  const p = sys.geometry.attributes.position;
  const v = sys.geometry.attributes.velocity;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) + v.getX(i) * dt * 10;
    let y = p.getY(i) + v.getY(i) * dt * 10;
    let z = p.getZ(i) + v.getZ(i) * dt * 10;

    if (x > bounds) x = -bounds;
    if (x < -bounds) x = bounds;
    if (z > bounds) z = -bounds;
    if (z < -bounds) z = bounds;

    if (y > 24) y = 3;
    if (y < 1.0) y = 16;

    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
}

const windParticles = makeParticleSystem(900, 0xffffff, 0.045, 50, 3.0, 22.0);
scene.add(windParticles);

const fireParticles = makeParticleSystem(520, 0xff7a18, 0.06, 16, 2.0, 18.0);
const waterParticles = makeParticleSystem(620, 0xd8f6ff, 0.05, 16, 4.0, 22.0);
const earthParticles = makeParticleSystem(520, 0xcfe9b8, 0.045, 16, 2.0, 16.0);
const airParticles = makeParticleSystem(620, 0xffffff, 0.05, 16, 6.0, 26.0);

earthParticles.position.set(7, 0, 7);
fireParticles.position.set(-7, 0, 7);
waterParticles.position.set(-7, 0, -7);
airParticles.position.set(7, 0, -7);

scene.add(earthParticles, fireParticles, waterParticles, airParticles);

// -------------------------------------------------
// Aang GLB
// -------------------------------------------------
let aangModel = null;
let mixer = null;

const loader = new GLTFLoader();
loader.load(
  "./models/aang_-_avatar_state.glb",
  (gltf) => {
    aangModel = gltf.scene;
    aangModel.scale.set(0.9, 0.9, 0.9);
    aangModel.traverse((obj) => {
      if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
    });
    scene.add(aangModel);

    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(aangModel);
      const clip = gltf.animations.find(a => /fly|hover|run|walk/i.test(a.name)) || gltf.animations[0];
      mixer.clipAction(clip).play();
    }
  },
  undefined,
  (err) => console.error("GLB failed to load:", err)
);

const aangKey = new THREE.SpotLight(0xffffff, 0.85, 70, Math.PI / 5, 0.45, 1.2);
aangKey.position.set(12, 22, 16);
aangKey.target.position.set(0, 2.0, 0);
aangKey.castShadow = true;
scene.add(aangKey, aangKey.target);

// -------------------------------------------------
// Input: speed control (REVERSE supported)
//   ← = achteruit, → = vooruit, loslaten = normale vooruit
// -------------------------------------------------
const keys = { left: false, right: false };
window.addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft") { keys.left = true; e.preventDefault(); }
  if (e.code === "ArrowRight") { keys.right = true; e.preventDefault(); }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft") { keys.left = false; e.preventDefault(); }
  if (e.code === "ArrowRight") { keys.right = false; e.preventDefault(); }
});

// -------------------------------------------------
// UI (smooth needle)
// -------------------------------------------------
const uiEls = {
  Aarde: document.querySelector(".earth"),
  Vuur: document.querySelector(".fire"),
  Water: document.querySelector(".water"),
  Lucht: document.querySelector(".air")
};
const needle = document.querySelector(".needle");

function nearestNation(thetaWrapped) {
  const idx = Math.round(wrapAngle(thetaWrapped) / (Math.PI / 2)) % 4;
  return ["Aarde", "Vuur", "Water", "Lucht"][idx];
}

let needleAngle = 0;
function updateUI(thetaWrapped, dt) {
  const active = nearestNation(thetaWrapped);
  Object.values(uiEls).forEach(el => el.classList.remove("active"));
  uiEls[active].classList.add("active");

  let diff = thetaWrapped - needleAngle;
  diff = ((diff + Math.PI) % (TWO_PI)) - Math.PI;
  const damp = 1.0 - Math.pow(0.001, dt);
  needleAngle += diff * (damp * 0.9);

  needle.style.transform = `translateX(-50%) rotate(${needleAngle}rad)`;
}

// -------------------------------------------------
// Animate (ULTRA SMOOTH: dt clamp + fixed timestep)
// -------------------------------------------------
const clock = new THREE.Clock();
let t = 0;

// Orbit params
const orbitRadius = 18.8;
const orbitHeight = 5.8;

// Smooth orbit state
let theta = 0;
let thetaVel = 0;

// Speed control (rad/s)
let speed = 0.65;       // current
let speedTarget = 0.65; // target

// Fixed timestep sim
let accumulator = 0;
const fixedStep = 1 / 120; // 120Hz simulation

function animate() {
  requestAnimationFrame(animate);

  let dt = clock.getDelta();
  dt = Math.min(dt, 1 / 30);
  t += dt;

  accumulator += dt;

  if (keys.left && !keys.right) speedTarget = -1.10;
  else if (keys.right && !keys.left) speedTarget = 1.10;
  else speedTarget = 0.65;

  const speedDamp = 1.0 - Math.pow(0.001, dt);
  speed = lerp(speed, speedTarget, speedDamp * 0.85);

  while (accumulator >= fixedStep) {
    const velDamp = 1.0 - Math.pow(0.0001, fixedStep);
    thetaVel = lerp(thetaVel, speed, velDamp);
    theta += thetaVel * fixedStep;
    accumulator -= fixedStep;
  }

  const thetaWrapped = wrapAngle(theta);

  sun.position.x = 18 + Math.sin(t * 0.10) * 4.0;
  sun.position.z = 14 + Math.cos(t * 0.10) * 4.0;

  const x = Math.cos(theta) * orbitRadius;
  const z = Math.sin(theta) * orbitRadius;
  const y = orbitHeight + Math.sin(t * 2.0) * 0.25;

  const travelSign = (thetaVel === 0) ? (speed >= 0 ? 1 : -1) : (thetaVel > 0 ? 1 : -1);
  const lookAheadTheta = theta + travelSign * 0.015;

  const ahead = new THREE.Vector3(
    Math.cos(lookAheadTheta) * orbitRadius,
    y,
    Math.sin(lookAheadTheta) * orbitRadius
  );

  const forward = ahead.clone().sub(new THREE.Vector3(x, y, z)).normalize();

  if (aangModel) {
    aangModel.position.set(x, y, z);

    const look = new THREE.Vector3(x, y, z).add(forward);
    aangModel.lookAt(look.x, look.y, look.z);

    const bank = clamp(Math.abs(speed), 0, 1.2) * 0.22;
    aangModel.rotation.z = -bank * travelSign;

    aangModel.rotation.x = 0;
    aangKey.target.position.set(x, y, z);
  }

  updateFollowCamera(new THREE.Vector3(x, y, z), forward, t, dt);

  const sb = sectorBlend(thetaWrapped);
  const A = atmos[sb.A];
  const B = atmos[sb.B];
  const tt = sb.t;

  scene.fog.color.copy(A.fogCol.clone().lerp(B.fogCol, tt));
  scene.fog.density = lerp(A.fog, B.fog, tt);

  hemi.color.copy(A.hemiTop.clone().lerp(B.hemiTop, tt));
  hemi.groundColor.copy(A.hemiBot.clone().lerp(B.hemiBot, tt));
  sun.color.copy(A.sunCol.clone().lerp(B.sunCol, tt));
  renderer.toneMappingExposure = lerp(A.exposure, B.exposure, tt);

  const skyKey = `${sb.A}-${sb.B}-${Math.round(tt * 10)}`;
  skyTimer += dt;
  if (skyTimer > 0.18 && skyKey !== lastSkyKey) {
    setSkyFor(sb.A, sb.B, tt);
    lastSkyKey = skyKey;
    skyTimer = 0;
  }

  if (fireLand?.userData?.lava) {
    fireLand.userData.lava.material.emissiveIntensity = 1.10 + 0.55 * Math.sin(t * 3.8);
    fireSector.material.emissiveIntensity = 0.18 + 0.10 * Math.sin(t * 2.0);
  }
  if (waterLand?.userData?.water) {
    waterLand.userData.water.material.opacity = 0.74 + 0.07 * Math.sin(t * 2.2);
    waterLand.userData.water.scale.setScalar(1 + 0.015 * Math.sin(t * 2.6));
  }

  airLand.children.forEach((c) => {
    if (c.userData && c.userData.floatPhase !== undefined) {
      c.position.y += Math.sin(t * 1.3 + c.userData.floatPhase) * 0.0016;
      c.rotation.y += dt * 0.15;
      c.rotation.x += dt * 0.08;
    }
  });

  updateParticles(windParticles, dt, 26);
  updateParticles(fireParticles, dt, 16);
  updateParticles(waterParticles, dt, 16);
  updateParticles(earthParticles, dt, 16);
  updateParticles(airParticles, dt, 16);

  if (mixer) mixer.update(dt);

  updateUI(thetaWrapped, dt);

  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
