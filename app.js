// Anima Vena AR — 8th Wall (self-hosted engine) + three.js, image-target tracking.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { fullWindowCanvas } from './full-window-canvas.js'

// 8th Wall's three.js module expects a global THREE.
window.THREE = THREE

// Engine license notice (required by the 8th Wall distributed-engine license).
console.log('8th Wall engine — Copyright © 2026 Niantic Spatial, Inc. https://github.com/8thwall/engine/blob/main/LICENSE')

// ---------- placement (image-target space) ----------
// Target space: the tracked crop of the painting is a plane in XY, centred at the origin,
// height = 1 unit (width = 0.75 for this 3:4 crop). +Z points out of the painting.
// Values below put the eye over the painted eye; tweak live with URL params, e.g.
//   ?x=0&y=-0.17&z=0.02&s=0.38&debug=1
const q = new URLSearchParams(location.search)
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d)
const PLACE = {
  x: num('x', 0.03),   // model centre sits at x≈-0.1 in model units -> shift right
  y: num('y', -0.165),
  z: num('z', 0.02),
  s: num('s', 0.38),   // eye model is ~1.7 units wide -> ~0.65 units (≈86% of painting width)
}
const DEBUG = q.get('debug') === '1'
const V = '8' // bump on every deploy so phones don't use cached models

// ---------- look (neon / radiance) ----------
// Tweak live with URL params, e.g. ?env=1.2&glow=2.5&eyeglow=1.6&halo=0.9&light=1
const LOOK = {
  env: num('env', 0.7),          // reflections from a studio environment (glossy highlights)
  glow: num('glow', 1.2),        // sparks' emission multiplier
  eyeGlow: num('eyeglow', 0.7),  // eye's emission multiplier
  halo: num('halo', 0),        // additive glow halo behind each spark (0 = off)
  light: num('light', 0.6),      // overall scene light multiplier
  spark: num('spark', 1.3),        // size of each small sparkle (scaled around its own centre)
  star: num('star', 1.3),          // size of the big central star with the long rays
  starX: num('starx', -0.04),        // fine-tune the star's centre (model units, + = right/up)
  starY: num('stary', 0),
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id)
const intro = $('intro'), startBtn = $('start'), hint = $('hint'), errorEl = $('error')
const showError = (msg) => { errorEl.textContent = msg; startBtn.disabled = true; startBtn.textContent = 'UNAVAILABLE' }

// ---------- content ----------
const content = new THREE.Group()          // follows the painting
content.visible = false
const rig = new THREE.Group()              // eye + sparks, placed within target space
rig.position.set(PLACE.x, PLACE.y, PLACE.z)
rig.scale.setScalar(PLACE.s)
content.add(rig)

const mixers = []
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
// Soft radial texture for halos (white; tinted per spark via sprite color).
const haloTexture = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  r.addColorStop(0.6, 'rgba(255,255,255,0.12)'); r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r; g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t
})()

// Colour of an ombre texture near its centre (u≈0.2) -> halo tint.
const sampleColor = (tex) => {
  try {
    const img = tex.image, c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(Math.floor(img.width * 0.2), Math.floor(img.height / 2), 1, 1).data
    return new THREE.Color().setRGB(d[0] / 255, d[1] / 255, d[2] / 255, THREE.SRGBColorSpace)
  } catch (e) { return new THREE.Color(0xffffff) }
}

const addHalo = (mesh) => {
  if (LOOK.halo <= 0) return
  mesh.geometry.computeBoundingSphere()
  const { center, radius } = mesh.geometry.boundingSphere
  const color = mesh.material.map ? sampleColor(mesh.material.map) : mesh.material.color.clone()
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture, color, transparent: true, opacity: LOOK.halo,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }))
  sprite.position.copy(center)
  sprite.scale.setScalar(Math.min(radius * 1.3, 0.46))
  sprite.renderOrder = -1
  mesh.add(sprite)                          // follows the spark's animation (incl. pulsing)
}

// Measured in model space: where the big star's rays cross, and the eye's pupil.
const STAR_CROSS = new THREE.Vector2(0.0126, -0.0796)
const PUPIL = new THREE.Vector2(-0.020, 0.008)

const loadModel = (url, { glow = 1, halos = false, grow = 1 } = {}) => new Promise((resolve, reject) => {
  loader.load(url, (gltf) => {
    const root = gltf.scene
    const meshes = []
    root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; meshes.push(o) } })
    // the big central star = the mesh with the largest on-screen size
    const size = (m) => { m.geometry.computeBoundingSphere(); return m.geometry.boundingSphere.radius * m.scale.x * (m.parent?.scale.x || 1) }
    const biggest = (grow !== 1 || halos) ? meshes.reduce((a, b) => (size(b) > size(a) ? b : a)) : null
    root.updateMatrixWorld(true)
    meshes.forEach((m) => {
      const mat = m.material
      mat.envMapIntensity = LOOK.env
      mat.emissiveIntensity = (mat.emissiveIntensity ?? 1) * glow
      mat.needsUpdate = true
      if (m === biggest) {
        // scale the star around its ray crossing and put that crossing on the pupil
        const g = LOOK.star
        const inv = m.parent.matrixWorld.clone().invert()
        const z = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).z
        const cross = new THREE.Vector3(STAR_CROSS.x, STAR_CROSS.y, z).applyMatrix4(inv)
        const target = new THREE.Vector3(PUPIL.x + LOOK.starX, PUPIL.y + LOOK.starY, z).applyMatrix4(inv)
        m.position.multiplyScalar(g).sub(cross.clone().multiplyScalar(g - 1)).add(target.sub(cross))
        m.scale.multiplyScalar(g)
      } else if (grow !== 1) {
        const g = grow
        // enlarge the spark around its own centre (not the scene origin), leaving its animation intact
        m.geometry.computeBoundingBox()
        const c = m.geometry.boundingBox.getCenter(new THREE.Vector3()).multiply(m.scale).add(m.position)
        m.position.multiplyScalar(g).sub(c.multiplyScalar(g - 1))
        m.scale.multiplyScalar(g)
      }
      if (halos) addHalo(m)
    })
    if (gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(root)
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play())
      mixers.push(mixer)
    }
    resolve(root)
  }, undefined, reject)
})

let eyeRoot = null, sparksRoot = null
const modelsReady = Promise.all([
  loadModel(`models/eye.glb?v=${V}`, { glow: LOOK.eyeGlow }),
  loadModel(`models/sparks.glb?v=${V}`, { glow: LOOK.glow, halos: true, grow: LOOK.spark }),
])
  .then(([eye, sparks]) => { eyeRoot = eye; sparksRoot = sparks; rig.add(eye); rig.add(sparks) })

if (DEBUG) {
  // outline of the tracked area (0.75 x 1) + full painting (0.75 x 1.124)
  const frame = (w, h, color) => new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)),
    new THREE.LineBasicMaterial({ color }))
  content.add(frame(0.75, 1, 0x00ff88), frame(0.75, 1.124, 0xffcc00))
}

// ---------- tracking ----------
const target = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, has: false }
const SMOOTH = 0.35 // 0 = frozen, 1 = raw tracking (more jitter)
let lostTimer = null

const onFound = ({ detail }) => {
  target.pos.copy(detail.position); target.quat.copy(detail.rotation); target.scale = detail.scale
  if (!target.has) {                        // snap on first sighting
    content.position.copy(target.pos); content.quaternion.copy(target.quat); content.scale.setScalar(target.scale)
  }
  target.has = true
  clearTimeout(lostTimer)
  content.visible = true
  hint.classList.add('hidden')
}
const onLost = () => {
  // brief grace period so a blink in tracking doesn't make it flicker
  lostTimer = setTimeout(() => { content.visible = false; target.has = false; hint.classList.remove('hidden') }, 600)
}

const clock = new THREE.Clock()
const arModule = () => ({
  name: 'animavena',
  onStart: ({ canvas }) => {
    const { scene, camera, renderer } = XR8.Threejs.xrScene()
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    // studio environment -> glossy, bright reflections (what Kivicube's default lighting gives)
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture
    pmrem.dispose()
    scene.add(new THREE.HemisphereLight(0xeef0ff, 0x3a2a80, 1.8 * LOOK.light))
    const key = new THREE.DirectionalLight(0xffffff, 2.0 * LOOK.light); key.position.set(0.5, 1, 2); scene.add(key)
    const rim = new THREE.DirectionalLight(0xff9ad5, 0.35 * LOOK.light); rim.position.set(-1, -0.5, 1); scene.add(rim)
    scene.add(content)
    if (DEBUG) window.__ar = { THREE, scene, camera, rig, content, get eye() { return eyeRoot }, get sparks() { return sparksRoot } }
    camera.position.set(0, 0, 0)
    XR8.XrController.updateCameraProjectionMatrix({ origin: camera.position, facing: camera.quaternion })
    hint.classList.remove('hidden')
  },
  onUpdate: () => {
    const dt = Math.min(clock.getDelta(), 0.1)
    mixers.forEach((m) => m.update(dt))
    if (target.has) {
      content.position.lerp(target.pos, SMOOTH)
      content.quaternion.slerp(target.quat, SMOOTH)
      const s = THREE.MathUtils.lerp(content.scale.x, target.scale, SMOOTH)
      content.scale.setScalar(s)
    }
  },
  listeners: [
    { event: 'reality.imagefound', process: onFound },
    { event: 'reality.imageupdated', process: onFound },
    { event: 'reality.imagelost', process: onLost },
  ],
})

// ---------- boot ----------
const onxrloaded = async () => {
  try {
    const targetData = await fetch('targets/painting.json').then((r) => r.json())
    XR8.XrController.configure({ disableWorldTracking: true, imageTargetData: [targetData] })
    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),
      fullWindowCanvas.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      arModule(),
      {
        name: 'errors',
        onCameraStatusChange: ({ status }) => { if (status === 'failed') showError('Camera access was denied. Allow camera access and reload.') },
        onException: (e) => { console.error(e); showError('Something went wrong starting AR. Try reloading.') },
      },
    ])
    await modelsReady
    startBtn.disabled = false
    startBtn.textContent = 'START'
    startBtn.onclick = () => {
      intro.classList.add('hidden')
      XR8.run({ canvas: $('camerafeed'), allowedDevices: XR8.XrConfig.device().ANY })
    }
  } catch (e) {
    console.error(e)
    showError('Could not load the experience. Check your connection and reload.')
  }
}
window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
