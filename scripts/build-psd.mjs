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

// 差分画像から「元画像と異なるピクセルだけ」を透明付きで抜き出す。
// 矩形ベタ貼りだと頭の視差移動でパッチの縁がズレて見えるため、真の差分のみ移植する。
const DIFF_DIR = 'C:/Users/nekop/Desktop/Development/repos/_active/ai-companion/assets/character/diffs'
const BASE_IMG = PNG.sync.read(
  readFileSync('C:/Users/nekop/Desktop/Development/repos/_active/ai-companion/assets/character/nemu-base.png')
)
function stampRect(diffFile, rect) {
  const img = PNG.sync.read(readFileSync(join(DIFF_DIR, diffFile)))
  const scale = img.width / W
  const baseScale = BASE_IMG.width / W
  const x0 = Math.max(0, rect.x0)
  const x1 = Math.min(W, rect.x1)
  const y0 = Math.max(0, rect.y0)
  const y1 = Math.min(H, rect.y1)
  const rw = x1 - x0
  const rh = y1 - y0
  // 1) 差分マスク作成（色距離しきい値）
  const mask = new Uint8Array(rw * rh)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const sx = Math.min(img.width - 1, Math.round(x * scale))
      const sy = Math.min(img.height - 1, Math.round(y * scale))
      const si = (sy * img.width + sx) * 4
      const bx = Math.min(BASE_IMG.width - 1, Math.round(x * baseScale))
      const by = Math.min(BASE_IMG.height - 1, Math.round(y * baseScale))
      const bi = (by * BASE_IMG.width + bx) * 4
      const d =
        Math.abs(img.data[si] - BASE_IMG.data[bi]) +
        Math.abs(img.data[si + 1] - BASE_IMG.data[bi + 1]) +
        Math.abs(img.data[si + 2] - BASE_IMG.data[bi + 2])
      if (d > 60) mask[(y - y0) * rw + (x - x0)] = 1
    }
  }
  // 2) 孤立ノイズ除去（周囲8近傍に2つ未満なら消す）→ 3) 1px膨張（縁のギザ防止）
  const clean = new Uint8Array(mask)
  for (let y = 1; y < rh - 1; y++) {
    for (let x = 1; x < rw - 1; x++) {
      if (!mask[y * rw + x]) continue
      let n = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if ((dx || dy) && mask[(y + dy) * rw + (x + dx)]) n++
      if (n < 2) clean[y * rw + x] = 0
    }
  }
  // 2.5) 連結成分解析: 最大成分の15%未満の破片（描画ブレ由来の迷い線）を捨てる
  const labels = new Int32Array(rw * rh).fill(-1)
  const sizes = []
  const stack = []
  for (let i = 0; i < rw * rh; i++) {
    if (!clean[i] || labels[i] >= 0) continue
    const id = sizes.length
    let size = 0
    stack.push(i)
    labels[i] = id
    while (stack.length) {
      const p = stack.pop()
      size++
      const px = p % rw
      const py = (p / rw) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx
          const ny = py + dy
          if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue
          const np = ny * rw + nx
          if (clean[np] && labels[np] < 0) {
            labels[np] = id
            stack.push(np)
          }
        }
      }
    }
    sizes.push(size)
  }
  const maxSize = Math.max(1, ...sizes)
  for (let i = 0; i < rw * rh; i++) {
    if (clean[i] && sizes[labels[i]] < maxSize * 0.15) clean[i] = 0
  }

  const dilated = new Uint8Array(clean)
  for (let y = 1; y < rh - 1; y++) {
    for (let x = 1; x < rw - 1; x++) {
      if (clean[y * rw + x]) continue
      for (let dy = -1; dy <= 1 && !dilated[y * rw + x]; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (clean[(y + dy) * rw + (x + dx)]) { dilated[y * rw + x] = 1; break }
    }
  }
  // 4) マスク部分だけ差分画像から転写
  const out = new Uint8ClampedArray(W * H * 4)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!dilated[(y - y0) * rw + (x - x0)]) continue
      const sx = Math.min(img.width - 1, Math.round(x * scale))
      const sy = Math.min(img.height - 1, Math.round(y * scale))
      const si = (sy * img.width + sx) * 4
      const di = (y * W + x) * 4
      out[di] = img.data[si]
      out[di + 1] = img.data[si + 1]
      out[di + 2] = img.data[si + 2]
      out[di + 3] = 255
    }
  }
  return out
}

// 口のパクパク改善: 分解された口（閉じ口のドット）は mouth_close に割り当て、
// 開き口 mouth_open はアニメ調の楕円口を描画して生成する（おちょぼ口対策）。
if (canvases.has('mouth')) {
  const src = canvases.get('mouth')
  // 閉じ口の重心と大きさを計測
  let sx = 0, sy = 0, n = 0, minX = W, maxX = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = src[(y * W + x) * 4 + 3]
      if (a > 32) {
        sx += x; sy += y; n++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
      }
    }
  }
  if (n > 0) {
    const cx = sx / n
    const cy = sy / n
    const closedW = Math.max(10, maxX - minX)
    // mouth_close = 元の口
    canvases.set('mouth_close', src)
    order[order.indexOf('mouth')] = 'mouth_close'
    // mouth_open = ユーザー納品の差分画像（自然な半開き）から矩形移植
    const openLayer = stampRect('mouth-e.png', {
      x0: Math.round(cx - 48), x1: Math.round(cx + 48),
      y0: Math.round(cy - 28), y1: Math.round(cy + 38),
    })
    canvases.set('mouth_open', openLayer)
    order.splice(order.indexOf('mouth_close') + 1, 0, 'mouth_open')
    console.log(`口を2枚構成に: mouth_close(元絵) + mouth_open(差分mouth-e移植 @${Math.round(cx)},${Math.round(cy)})`)
  }
}

// まばたき品質向上: 納品された閉じ目差分から eye_close レイヤーを作る
{
  // 目パーツ（白目+瞳+まつ毛）の合成bboxを計測
  let minX = W, maxX = 0, minY = H, maxY = 0, found = false
  for (const nm of ['eyewhite', 'irides', 'eyelash']) {
    const c = canvases.get(nm)
    if (!c) continue
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (c[(y * W + x) * 4 + 3] > 32) {
          found = true
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
  }
  if (found) {
    const eyeClose = stampRect('eyes-close.png', {
      x0: minX - 14, x1: maxX + 14, y0: minY - 16, y1: maxY + 10,
    })
    canvases.set('eye_close', eyeClose)
    order.splice(order.indexOf('eyebrow') + 1, 0, 'eye_close')
    console.log(`eye_close を閉じ目差分から移植 (${minX - 14},${minY - 16})-(${maxX + 14},${maxY + 10})`)
  }
}

// にんじんヘアピン修復: 分解時にピン本体の一部が髪レイヤーへ吸われて欠けるため、
// 元画像からピン領域を切り出して headwear レイヤーを差し替える。
// マスク: ほぼ黒(髪)とほぼ白(背景)を除外した色付きピクセルだけ移植する。
{
  const ORIG = 'C:/Users/nekop/Desktop/Development/repos/_active/ai-companion/assets/character/nemu-base.png'
  const orig = PNG.sync.read(readFileSync(ORIG))
  const scale = orig.width / W // 1254/1024
  // ピンのbbox（1024キャンバス座標）
  const box = { x0: 468, y0: 60, x1: 552, y1: 148 }
  const head = canvasFor('headwear')
  head.fill(0)
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      // 最近傍で元画像からサンプリング
      const sx = Math.min(orig.width - 1, Math.round(x * scale))
      const sy = Math.min(orig.height - 1, Math.round(y * scale))
      const si = (sy * orig.width + sx) * 4
      const r = orig.data[si]
      const g = orig.data[si + 1]
      const b = orig.data[si + 2]
      const isHair = r < 70 && g < 70 && b < 70
      const isBg = r > 232 && g > 232 && b > 232
      const saturation = Math.max(r, g, b) - Math.min(r, g, b)
      if (isHair || isBg || saturation < 40) continue // 彩度が低い=髪の照り等は除外
      const di = (y * W + x) * 4
      head[di] = r
      head[di + 1] = g
      head[di + 2] = b
      head[di + 3] = 255
    }
  }
  console.log('headwear をオリジナル画像のピン領域から再構築しました')
}

// 既知の破綻対策（Anime2.5DRig README公認）: neck は topwear と z-fighting するため
// 「首を下に敷いた topwear 一体型レイヤー」に統合する
if (canvases.has('neck') && canvases.has('topwear')) {
  const neck = canvases.get('neck')
  const top = canvases.get('topwear')
  // 服を先に敷き、その上に首の可視部分を重ねる。
  // （topwear の補完画素が首を覆い隠すため、首が最後）
  const merged = new Uint8ClampedArray(top)
  for (let i = 0; i < neck.length; i += 4) {
    if (neck[i + 3] > 0) {
      merged[i] = neck[i]
      merged[i + 1] = neck[i + 1]
      merged[i + 2] = neck[i + 2]
      merged[i + 3] = neck[i + 3]
    }
  }
  canvases.set('topwear', merged)
  canvases.delete('neck')
  order.splice(order.indexOf('neck'), 1)
  console.log('topwear の上に neck を統合しました（襟の補完画素による首隠れ対策）')
}

// 描画順テンプレート（奥→手前）。PSDのレイヤー順=描画順なので明示的に制御する。
// 未知レイヤーは分解JSONの元の並びで objects の位置に挟む。
const Z_ORDER = [
  'wings', 'tail', 'back hair',
  'legwear', 'footwear', 'bottomwear',
  'topwear', 'neckwear', 'handwear', 'objects',
  'ears', 'earwear', 'face', 'mouth_close', 'mouth_open', 'mouth', 'nose',
  'eyewhite', 'irides', 'eyelash', 'eyebrow', 'eye_close', 'eyewear',
  'front hair', 'headwear',
]
order.sort((a, b) => {
  const ia = Z_ORDER.indexOf(a)
  const ib = Z_ORDER.indexOf(b)
  return (ia < 0 ? Z_ORDER.indexOf('objects') : ia) - (ib < 0 ? Z_ORDER.indexOf('objects') : ib)
})

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
