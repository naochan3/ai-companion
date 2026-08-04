// see-throughのレイヤーPNG群 + layers.json から Anime2.5DRig 用PSDを合成する。
// リグは 'eyewhite' 等の未分割名を期待して自前で左右分割するため、
// -l / -r レイヤーは基底名に統合してフルキャンバスで書き出す。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import agpsd from 'ag-psd'

const OUT_DIR = 'C:/AI/ComfyUI_Data/output'
const META = 'nemu_20260804_231921_2d0a14f6_layers.json'
const DEST = 'C:/Users/nekop/Desktop/Development/repos/_active/ai-companion/assets/character/nemu.psd'
const W = 1024
const H = 1024

const meta = JSON.parse(readFileSync(join(OUT_DIR, META), 'utf8'))

// 基底名ごとにフルキャンバスへ合成（JSONの並び順 = 奥→手前 を維持）
const order = []
const canvases = new Map()

function canvasFor(name) {
  if (!canvases.has(name)) {
    canvases.set(name, new Uint8ClampedArray(W * H * 4))
    order.push(name)
  }
  return canvases.get(name)
}

for (const layer of meta.layers) {
  let png
  try {
    png = PNG.sync.read(readFileSync(join(OUT_DIR, layer.filename)))
  } catch {
    continue
  }
  const base = layer.name.replace(/-[lr]$/, '')
  const dst = canvasFor(base)
  const ox = layer.left
  const oy = layer.top
  for (let y = 0; y < png.height; y++) {
    const ty = y + oy
    if (ty < 0 || ty >= H) continue
    for (let x = 0; x < png.width; x++) {
      const tx = x + ox
      if (tx < 0 || tx >= W) continue
      const si = (y * png.width + x) * 4
      const a = png.data[si + 3]
      if (a === 0) continue
      const di = (ty * W + tx) * 4
      // 単純上書き（同名レイヤーの左右は重ならない前提）
      dst[di] = png.data[si]
      dst[di + 1] = png.data[si + 1]
      dst[di + 2] = png.data[si + 2]
      dst[di + 3] = a
    }
  }
}

const children = []
const skipped = []
for (const name of order) {
  const data = canvases.get(name)
  let hasAlpha = false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 8) {
      hasAlpha = true
      break
    }
  }
  if (!hasAlpha) {
    skipped.push(name)
    continue
  }
  children.push({
    name,
    left: 0,
    top: 0,
    right: W,
    bottom: H,
    imageData: { width: W, height: H, data },
  })
}

const buffer = agpsd.writePsdBuffer(
  { width: W, height: H, children },
  { generateThumbnail: false, noBackground: true }
)
writeFileSync(DEST, buffer)
console.log(`PSD書き出し完了: ${DEST} (${(buffer.length / 1048576).toFixed(1)}MB)`)
console.log(`採用 ${children.length} レイヤー: ${children.map((c) => c.name).join(', ')}`)
console.log(`空でスキップ: ${skipped.join(', ') || 'なし'}`)
