// Anima Vena AR — 8th Wall (self-hosted engine) + three.js, image-target tracking.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
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
const loadModel = (url) => new Promise((resolve, reject) => {
  loader.load(url, (gltf) => {
    const root = gltf.scene
    root.traverse((o) => { if (o.isMesh) o.frustumCulled = false })
    if (gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(root)
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play())
      mixers.push(mixer)
    }
    resolve(root)
  }, undefined, reject)
})

const modelsReady = Promise.all([loadModel('models/eye.glb'), loadModel('models/sparks.glb')])
  .then(([eye, sparks]) => { rig.add(eye); rig.add(sparks) })

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
    scene.add(new THREE.HemisphereLight(0xdfe4ff, 0x2a2060, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.5, 1, 2); scene.add(key)
    scene.add(content)
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
