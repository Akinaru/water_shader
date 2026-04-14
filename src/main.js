import './style.css'
import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js'
import { Pane } from 'tweakpane'
import { Fn, positionWorld, texture, uniform, vec2, vec3, vec4 } from 'three/tsl'

const app = document.querySelector('#app')
app.innerHTML = `
  <div class="hud">
    <h1>Procedural Rivers</h1>
    <p>Terrain procedural + eau pour bosser les shaders.</p>
  </div>
`

const scene = new THREE.Scene()
scene.background = new THREE.Color(0xbfdcf2)
scene.fog = new THREE.Fog(0xbfdcf2, 60, 260)

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500,
)
camera.position.set(30, 22, 28)

const renderer = new THREE.WebGPURenderer({
  antialias: true,
  powerPreference: 'high-performance',
  forceWebGL: false,
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
app.appendChild(renderer.domElement)
await renderer.init()

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.target.set(0, 0, 0)

scene.add(new THREE.HemisphereLight(0xecfbff, 0x4e5f4a, 0.95))
const sun = new THREE.DirectionalLight(0xffffff, 1.1)
sun.position.set(12, 20, 9)
scene.add(sun)

const noise = new ImprovedNoise()

const terrainParams = {
  mapSize: 96,
  subdivisions: 192,
  baseLevel: 1.15,
  height: 0,
  baseFrequency: 0.026,
  octaves: 2,
  lacunarity: 1.95,
  persistence: 0.61,
  warpStrength: 20,
  warpFrequency: 0.08,
  riverWidth: 0.11,
  riverDepth: 3.45,
  riverMeander: 0.42,
  riverMeanderFrequency: 2.2,
  riverNoiseFrequency: 1.3,
  riverNoiseStrength: 0.9,
  branchOffset: -0.22,
  branchWeight: 0.48,
  lowColor: '#d78b16',
  highColor: '#2c840c',
  riverColor: '#1d359d',
  coastBlend: 0.25,
  underwaterRange: 2.8,
}

const waterParams = {
  slopeFrequency: 11.5,
  noiseFrequency: 0.9,
  threshold: 0.21,
  speed: 0.07,
  y: -0.7,
  opacity: 0.55,
}

const mapHalf = terrainParams.mapSize * 0.5
const exportUi = {
  status: 'ready',
}
let exportStatusBinding = null

function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function setExportStatus(status) {
  exportUi.status = status

  if (exportStatusBinding) {
    exportStatusBinding.refresh()
  }
}

function buildSettingsPayload() {
  return JSON.stringify(
    {
      terrainParams: { ...terrainParams },
      waterParams: { ...waterParams },
    },
    null,
    2,
  )
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return true
  }

  const textArea = document.createElement('textarea')
  textArea.value = text
  textArea.setAttribute('readonly', '')
  textArea.style.position = 'fixed'
  textArea.style.top = '-9999px'
  textArea.style.left = '-9999px'
  document.body.appendChild(textArea)
  textArea.select()

  const copied = document.execCommand('copy')
  document.body.removeChild(textArea)
  return copied
}

function fbm2(x, z) {
  const octaveCount = Math.max(1, Math.floor(terrainParams.octaves))
  let value = 0
  let amplitude = 1
  let frequency = terrainParams.baseFrequency
  let amplitudeSum = 0

  for (let i = 0; i < octaveCount; i += 1) {
    value += noise.noise(x * frequency, z * frequency, i * 37.13) * amplitude
    amplitudeSum += amplitude
    amplitude *= terrainParams.persistence
    frequency *= terrainParams.lacunarity
  }

  return amplitudeSum > 0 ? value / amplitudeSum : 0
}

function computeRiverMask(x, z) {
  const warpA =
    noise.noise(
      x * terrainParams.warpFrequency,
      z * terrainParams.warpFrequency,
      11,
    ) * terrainParams.warpStrength
  const warpB =
    noise.noise(
      (x + 43.2) * terrainParams.warpFrequency * 1.1,
      (z - 29.7) * terrainParams.warpFrequency * 1.1,
      29,
    ) * terrainParams.warpStrength

  const wx = x + warpA * 0.8 + warpB * 0.25
  const wz = z + warpB * 0.8 - warpA * 0.15

  const xn = wx / mapHalf
  const zn = wz / mapHalf

  const jitterA =
    noise.noise(
      xn * terrainParams.riverNoiseFrequency,
      zn * terrainParams.riverNoiseFrequency,
      53,
    ) * terrainParams.riverNoiseStrength
  const jitterB =
    noise.noise(
      (xn + 1.3) * terrainParams.riverNoiseFrequency * 1.2,
      (zn - 0.7) * terrainParams.riverNoiseFrequency * 1.2,
      79,
    ) * terrainParams.riverNoiseStrength

  const centerA =
    Math.sin(xn * terrainParams.riverMeanderFrequency + jitterA * 2.4) *
    terrainParams.riverMeander
  const centerB =
    Math.sin((xn + 0.4) * (terrainParams.riverMeanderFrequency * 1.17) + jitterB * 2.1) *
      (terrainParams.riverMeander * 0.6) +
    terrainParams.branchOffset

  const widthA = Math.max(
    0.01,
    terrainParams.riverWidth *
      (1 +
        noise.noise(xn * 1.7, zn * 1.7, 101) *
          0.35),
  )
  const widthB = Math.max(
    0.01,
    terrainParams.riverWidth *
      0.8 *
      (1 +
        noise.noise(xn * 2.1, zn * 2.1, 131) *
          0.45),
  )

  const distA = Math.abs(zn - centerA)
  const distB = Math.abs(zn - centerB)

  const riverA = Math.exp(-((distA * distA) / (widthA * widthA)))
  const riverB = Math.exp(-((distB * distB) / (widthB * widthB)))

  return clamp01(Math.max(riverA, riverB * terrainParams.branchWeight))
}

const terrainGeometry = new THREE.PlaneGeometry(
  terrainParams.mapSize,
  terrainParams.mapSize,
  terrainParams.subdivisions,
  terrainParams.subdivisions,
)
terrainGeometry.rotateX(-Math.PI * 0.5)
const terrainPositions = terrainGeometry.attributes.position
const terrainColors = new Float32Array(terrainPositions.count * 3)
const terrainColorAttribute = new THREE.BufferAttribute(terrainColors, 3)
terrainGeometry.setAttribute('color', terrainColorAttribute)

const lowColor = new THREE.Color(terrainParams.lowColor)
const highColor = new THREE.Color(terrainParams.highColor)
const riverColor = new THREE.Color(terrainParams.riverColor)
const mixedColor = new THREE.Color()

const riverMaskSize = 512
const riverMaskData = new Uint8Array(riverMaskSize * riverMaskSize)
const riverMaskTexture = new THREE.DataTexture(
  riverMaskData,
  riverMaskSize,
  riverMaskSize,
  THREE.RedFormat,
  THREE.UnsignedByteType,
)
riverMaskTexture.colorSpace = THREE.NoColorSpace
riverMaskTexture.wrapS = THREE.ClampToEdgeWrapping
riverMaskTexture.wrapT = THREE.ClampToEdgeWrapping
riverMaskTexture.minFilter = THREE.LinearFilter
riverMaskTexture.magFilter = THREE.LinearFilter
riverMaskTexture.generateMipmaps = false

function rebuildRiverMaskTexture() {
  for (let y = 0; y < riverMaskSize; y += 1) {
    const v = y / (riverMaskSize - 1)
    const z = (1 - v) * terrainParams.mapSize - mapHalf

    for (let x = 0; x < riverMaskSize; x += 1) {
      const u = x / (riverMaskSize - 1)
      const wx = u * terrainParams.mapSize - mapHalf
      const mask = computeRiverMask(wx, z)
      riverMaskData[y * riverMaskSize + x] = Math.round(mask * 255)
    }
  }

  riverMaskTexture.needsUpdate = true
}

function rebuildTerrain() {
  lowColor.set(terrainParams.lowColor)
  highColor.set(terrainParams.highColor)
  riverColor.set(terrainParams.riverColor)

  for (let i = 0; i < terrainPositions.count; i += 1) {
    const x = terrainPositions.getX(i)
    const z = terrainPositions.getZ(i)

    const n = fbm2(x, z)
    const riverMask = computeRiverMask(x, z)

    const height =
      terrainParams.baseLevel +
      n * terrainParams.height -
      riverMask * terrainParams.riverDepth
    terrainPositions.setY(i, height)

    const levelDelta = height - waterParams.y

    if (levelDelta <= 0) {
      const depth = -levelDelta
      const depthMix = clamp01(depth / Math.max(0.001, terrainParams.underwaterRange))
      mixedColor.copy(lowColor).lerp(riverColor, depthMix)
    } else {
      const coastMix = clamp01(levelDelta / Math.max(0.001, terrainParams.coastBlend))
      mixedColor.copy(lowColor).lerp(highColor, coastMix)
    }

    terrainColors[i * 3 + 0] = mixedColor.r
    terrainColors[i * 3 + 1] = mixedColor.g
    terrainColors[i * 3 + 2] = mixedColor.b
  }

  terrainPositions.needsUpdate = true
  terrainColorAttribute.needsUpdate = true
  terrainGeometry.computeVertexNormals()

  rebuildRiverMaskTexture()
}

rebuildTerrain()

const terrainMesh = new THREE.Mesh(
  terrainGeometry,
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0.01,
  }),
)
scene.add(terrainMesh)

const waterNoiseTextureSize = 256
const waterNoiseTextureData = new Uint8Array(waterNoiseTextureSize * waterNoiseTextureSize)
const waterNoiseTexture = new THREE.DataTexture(
  waterNoiseTextureData,
  waterNoiseTextureSize,
  waterNoiseTextureSize,
  THREE.RedFormat,
  THREE.UnsignedByteType,
)
waterNoiseTexture.colorSpace = THREE.NoColorSpace
waterNoiseTexture.wrapS = THREE.RepeatWrapping
waterNoiseTexture.wrapT = THREE.RepeatWrapping
waterNoiseTexture.minFilter = THREE.LinearFilter
waterNoiseTexture.magFilter = THREE.LinearFilter
waterNoiseTexture.generateMipmaps = false

for (let y = 0; y < waterNoiseTextureSize; y += 1) {
  const ny = (y / (waterNoiseTextureSize - 1)) * 2 - 1

  for (let x = 0; x < waterNoiseTextureSize; x += 1) {
    const nx = (x / (waterNoiseTextureSize - 1)) * 2 - 1
    const i = y * waterNoiseTextureSize + x

    const nA = noise.noise(nx * 3.4, ny * 3.4, 211)
    const nB = noise.noise((nx + 1.7) * 7.8, (ny - 0.9) * 7.8, 257)
    const nC = noise.noise((nx - 2.1) * 15.3, (ny + 1.4) * 15.3, 293)
    const mixNoise = nA * 0.6 + nB * 0.3 + nC * 0.1
    waterNoiseTextureData[i] = Math.round((mixNoise * 0.5 + 0.5) * 255)
  }
}
waterNoiseTexture.needsUpdate = true

const waterSurface = new THREE.Mesh(
  new THREE.PlaneGeometry(terrainParams.mapSize, terrainParams.mapSize),
  new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  }),
)
waterSurface.rotation.x = -Math.PI * 0.5
waterSurface.position.y = waterParams.y

const waterSlopeFrequencyUniform = uniform(waterParams.slopeFrequency)
const waterNoiseFrequencyUniform = uniform(waterParams.noiseFrequency)
const rippleThresholdUniform = uniform(waterParams.threshold)
const waterLocalTimeUniform = uniform(0)
const waterOpacityUniform = uniform(waterParams.opacity)

waterSurface.material.outputNode = Fn(() => {
  const terrainUv = vec2(
    positionWorld.x.div(terrainParams.mapSize).add(0.5),
    positionWorld.z.mul(-1).div(terrainParams.mapSize).add(0.5),
  )
  const terrainData = vec4(0, 0, texture(riverMaskTexture, terrainUv).r, 1)

  const baseRipple = terrainData.b
    .add(waterLocalTimeUniform)
    .mul(waterSlopeFrequencyUniform)
    .toVar()
  const rippleIndex = baseRipple.floor()

  const noiseValue = texture(
    waterNoiseTexture,
    positionWorld.xz.add(rippleIndex.div(0.345)),
  ).mul(waterNoiseFrequencyUniform).r

  const ripple = baseRipple
    .mod(1)
    .sub(terrainData.b.oneMinus())
    .add(noiseValue)

  ripple.greaterThan(rippleThresholdUniform).discard()

  return vec4(vec3(1), waterOpacityUniform)
})()
scene.add(waterSurface)

const pane = new Pane({ title: 'Procedural Terrain / Water' })
pane.element.style.position = 'absolute'
pane.element.style.top = '14px'
pane.element.style.right = '14px'
pane.element.style.zIndex = '30'

const terrainFolder = pane.addFolder({ title: 'Terrain' })
terrainFolder
  .addBinding(terrainParams, 'baseLevel', {
    label: 'base level',
    min: -2,
    max: 3,
    step: 0.05,
  })
  .on('change', rebuildTerrain)
terrainFolder
  .addBinding(terrainParams, 'height', {
    label: 'height',
    min: 0,
    max: 8,
    step: 0.1,
  })
  .on('change', rebuildTerrain)
terrainFolder
  .addBinding(terrainParams, 'baseFrequency', {
    label: 'base freq',
    min: 0.004,
    max: 0.05,
    step: 0.001,
  })
  .on('change', rebuildTerrain)
terrainFolder
  .addBinding(terrainParams, 'octaves', {
    label: 'octaves',
    min: 1,
    max: 6,
    step: 1,
  })
  .on('change', rebuildTerrain)
terrainFolder
  .addBinding(terrainParams, 'lacunarity', {
    label: 'lacunarity',
    min: 1.2,
    max: 3,
    step: 0.05,
  })
  .on('change', rebuildTerrain)
terrainFolder
  .addBinding(terrainParams, 'persistence', {
    label: 'persistence',
    min: 0.2,
    max: 0.8,
    step: 0.01,
  })
  .on('change', rebuildTerrain)
terrainFolder
  .addBinding(terrainParams, 'warpStrength', {
    label: 'warp str',
    min: 0,
    max: 20,
    step: 0.1,
  })
  .on('change', rebuildTerrain)
terrainFolder
  .addBinding(terrainParams, 'warpFrequency', {
    label: 'warp freq',
    min: 0.005,
    max: 0.08,
    step: 0.001,
  })
  .on('change', rebuildTerrain)

const biomeFolder = pane.addFolder({ title: 'Biome Colors' })
biomeFolder
  .addBinding(terrainParams, 'lowColor', { label: 'low / shore', view: 'color' })
  .on('change', rebuildTerrain)
biomeFolder
  .addBinding(terrainParams, 'highColor', { label: 'high / land', view: 'color' })
  .on('change', rebuildTerrain)
biomeFolder
  .addBinding(terrainParams, 'riverColor', { label: 'deep / fond', view: 'color' })
  .on('change', rebuildTerrain)
biomeFolder
  .addBinding(terrainParams, 'coastBlend', {
    label: 'coast blend',
    min: 0.01,
    max: 1.2,
    step: 0.01,
  })
  .on('change', rebuildTerrain)
biomeFolder
  .addBinding(terrainParams, 'underwaterRange', {
    label: 'underwater range',
    min: 0.2,
    max: 8,
    step: 0.05,
  })
  .on('change', rebuildTerrain)

const riverFolder = pane.addFolder({ title: 'River Shape' })
riverFolder
  .addBinding(terrainParams, 'riverWidth', {
    label: 'width',
    min: 0.03,
    max: 0.35,
    step: 0.005,
  })
  .on('change', rebuildTerrain)
riverFolder
  .addBinding(terrainParams, 'riverDepth', {
    label: 'depth',
    min: 0,
    max: 6,
    step: 0.1,
  })
  .on('change', rebuildTerrain)
riverFolder
  .addBinding(terrainParams, 'riverMeander', {
    label: 'meander',
    min: 0,
    max: 1,
    step: 0.01,
  })
  .on('change', rebuildTerrain)
riverFolder
  .addBinding(terrainParams, 'riverMeanderFrequency', {
    label: 'meander f',
    min: 0.5,
    max: 6,
    step: 0.05,
  })
  .on('change', rebuildTerrain)
riverFolder
  .addBinding(terrainParams, 'riverNoiseFrequency', {
    label: 'noise f',
    min: 0.1,
    max: 4,
    step: 0.05,
  })
  .on('change', rebuildTerrain)
riverFolder
  .addBinding(terrainParams, 'riverNoiseStrength', {
    label: 'noise str',
    min: 0,
    max: 1.5,
    step: 0.01,
  })
  .on('change', rebuildTerrain)
riverFolder
  .addBinding(terrainParams, 'branchOffset', {
    label: 'branch off',
    min: -1,
    max: 1,
    step: 0.01,
  })
  .on('change', rebuildTerrain)
riverFolder
  .addBinding(terrainParams, 'branchWeight', {
    label: 'branch w',
    min: 0,
    max: 1.5,
    step: 0.01,
  })
  .on('change', rebuildTerrain)

const waterFolder = pane.addFolder({ title: 'Water Shader' })
waterFolder
  .addBinding(waterParams, 'slopeFrequency', {
    label: 'water freq',
    min: 1,
    max: 30,
    step: 0.5,
  })
  .on('change', (event) => {
    waterSlopeFrequencyUniform.value = event.value
  })
waterFolder
  .addBinding(waterParams, 'noiseFrequency', {
    label: 'noise freq',
    min: 0.5,
    max: 20,
    step: 0.1,
  })
  .on('change', (event) => {
    waterNoiseFrequencyUniform.value = event.value
  })
waterFolder
  .addBinding(waterParams, 'threshold', {
    label: 'threshold',
    min: -1,
    max: 2,
    step: 0.01,
  })
  .on('change', (event) => {
    rippleThresholdUniform.value = event.value
  })
waterFolder
  .addBinding(waterParams, 'speed', {
  label: 'time speed',
  min: 0,
  max: 1,
  step: 0.01,
})
waterFolder
  .addBinding(waterParams, 'opacity', {
    label: 'opacity',
    min: 0.05,
    max: 1,
    step: 0.01,
  })
  .on('change', (event) => {
    waterOpacityUniform.value = event.value
  })

const exportFolder = pane.addFolder({ title: 'Export' })
exportStatusBinding = exportFolder.addBinding(exportUi, 'status', {
  label: 'clipboard',
  readonly: true,
})
exportFolder.addButton({ title: 'Copy current settings' }).on('click', async () => {
  setExportStatus('copying...')

  try {
    const payload = buildSettingsPayload()
    const copied = await copyTextToClipboard(payload)
    setExportStatus(copied ? 'copied' : 'copy failed')
  } catch (error) {
    console.error(error)
    setExportStatus('copy failed')
  }
})

const clock = new THREE.Clock()

function tick() {
  const deltaTime = clock.getDelta()
  waterLocalTimeUniform.value += deltaTime * waterParams.speed
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}

tick()

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
}

window.addEventListener('resize', onResize)
onResize()
