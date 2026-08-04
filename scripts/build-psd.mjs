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

  // 2.7) 穴埋め: 外周からフラッドフィルで到達できない「内部の穴」をマスクに含める。
  // （元絵と色が近い部分が差分から漏れ、下のレイヤーが透けて二重写しになる対策。
  //   埋めた画素は差分画像由来なので、元絵と同じ見た目なら視覚的に無害）
  {
    const reach = new Uint8Array(rw * rh)
    const q = []
    for (let x = 0; x < rw; x++) {
      for (const y of [0, rh - 1]) {
        const i = y * rw + x
        if (!clean[i] && !reach[i]) { reach[i] = 1; q.push(i) }
      }
    }
    for (let y = 0; y < rh; y++) {
      for (const x of [0, rw - 1]) {
        const i = y * rw + x
        if (!clean[i] && !reach[i]) { reach[i] = 1; q.push(i) }
      }
    }
    while (q.length) {
      const p = q.pop()
      const px = p % rw
      const py = (p / rw) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx
        const ny = py + dy
        if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue
        const np = ny * rw + nx
        if (!clean[np] && !reach[np]) { reach[np] = 1; q.push(np) }
      }
    }
    for (let i = 0; i < rw * rh; i++) {
      if (!clean[i] && !reach[i]) clean[i] = 1 // 内部の穴を埋める
    }
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
    // mouth_close = 元絵そのままの羽根ぼかし円形パッチ。
    // 分解由来の口パッチは周辺スキンに薄い色ムラがあり、口の開閉のたびに
    // ムラが点滅して「ピクセル漏れ」に見える。元絵のピクセルを使えば
    // 静止時の見た目＝元絵が構造的に保証される（今後の再ビルドでも同じ）。
    const closePatch = new Uint8ClampedArray(W * H * 4)
    {
      const sB = BASE_IMG.width / W
      const R = 52, FE = 14 // コア半径 / 羽根ぼかし幅(px)
      const y0p = Math.max(0, Math.floor(cy - R - FE))
      const y1p = Math.min(H - 1, Math.ceil(cy + R + FE))
      const x0p = Math.max(0, Math.floor(cx - R - FE))
      const x1p = Math.min(W - 1, Math.ceil(cx + R + FE))
      for (let y = y0p; y <= y1p; y++) {
        for (let x = x0p; x <= x1p; x++) {
          const d = Math.hypot(x - cx, y - cy)
          if (d > R + FE) continue
          const a = d <= R ? 1 : 1 - (d - R) / FE
          const sxB = Math.min(BASE_IMG.width - 1, Math.round(x * sB))
          const syB = Math.min(BASE_IMG.height - 1, Math.round(y * sB))
          const si = (syB * BASE_IMG.width + sxB) * 4
          const di = (y * W + x) * 4
          closePatch[di] = BASE_IMG.data[si]
          closePatch[di + 1] = BASE_IMG.data[si + 1]
          closePatch[di + 2] = BASE_IMG.data[si + 2]
          closePatch[di + 3] = Math.round(a * BASE_IMG.data[si + 3])
        }
      }
    }
    canvases.set('mouth_close', closePatch)
    order[order.indexOf('mouth')] = 'mouth_close'
    // mouth_open = ユーザー納品の差分画像（自然な半開き）から矩形移植
    const openLayer = stampRect('mouth-e.png', {
      x0: Math.round(cx - 48), x1: Math.round(cx + 48),
      y0: Math.round(cy - 28), y1: Math.round(cy + 38),
    })
    canvases.set('mouth_open', openLayer)
    order.splice(order.indexOf('mouth_close') + 1, 0, 'mouth_open')
    // 多段階口パク用: う/あ/い も同じ矩形から抽出して追加
    // （命名 mouth_open_N でリグのmouth_openスロットに乗り、埋め込み側が音量で切替）
    const variants = [
      ['mouth_open_2', 'mouth-u.png'],
      ['mouth_open_3', 'mouth-a.png'],
      ['mouth_open_4', 'mouth-i.png'],
    ]
    const mouthRect = {
      x0: Math.round(cx - 48), x1: Math.round(cx + 48),
      y0: Math.round(cy - 28), y1: Math.round(cy + 38),
    }
    let insertAt = order.indexOf('mouth_open') + 1
    for (const [name, file] of variants) {
      canvases.set(name, stampRect(file, mouthRect))
      order.splice(insertAt++, 0, name)
    }
    console.log(`口を5枚構成に: mouth_close + mouth_open(え) + う/あ/い @${Math.round(cx)},${Math.round(cy)}`)
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
    const eyeRect = { x0: minX - 14, x1: maxX + 14, y0: minY - 16, y1: maxY + 10 }
    const eyeClose = stampRect('eyes-close.png', eyeRect)
    canvases.set('eye_close', eyeClose)
    order.splice(order.indexOf('eyebrow') + 1, 0, 'eye_close')
    console.log(`eye_close を閉じ目差分から移植 (${eyeRect.x0},${eyeRect.y0})-(${eyeRect.x1},${eyeRect.y1})`)

    // 表情用の目オーバーレイ（埋め込み側が activeExpr で1枚だけ表示する）
    const exprs = [
      ['expr_normal', 'eyes-normal.png'],   // デフォルト（ジト目解消の普通目）
      ['expr_wide', 'eyes-wide.png'],       // 驚き
      ['expr_sparkle', 'eyes-sparkle.png'], // きらきら（エンジンON）
      ['expr_smile', 'eyes-smile.png'],     // 笑い目
      ['expr_jito', 'eyes-jito.png'],       // 強ジト目（静かに圧）
    ]
    // 見開き等は元の半目より大きいため、表情用は広めの矩形で抽出する
    const exprRect = {
      x0: minX - 24, x1: maxX + 24, y0: minY - 24, y1: maxY + 38,
    }
    let at = order.indexOf('eyebrow') + 1 // eye_close より奥・眉より手前
    for (const [name, file] of exprs) {
      canvases.set(name, stampRect(file, exprRect))
      order.splice(at++, 0, name)
    }
    // 照れ頬（頬の領域。将来の感情拡張用ストック、既定非表示）
    const cheekRect = { x0: minX - 20, x1: maxX + 20, y0: maxY - 6, y1: maxY + 46 }
    canvases.set('expr_blush', stampRect('cheeks-blush.png', cheekRect))
    order.splice(at++, 0, 'expr_blush')
    console.log('表情オーバーレイ6種（normal/wide/sparkle/smile/jito/blush）を追加')
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
  'eyewhite', 'irides', 'eyelash', 'eyebrow',
  'expr_blush', 'expr_normal', 'expr_wide', 'expr_sparkle', 'expr_smile', 'expr_jito',
  'eye_close', 'eyewear',
  'front hair', 'headwear',
]
const zIndexOf = (name) => {
  const base = name.replace(/_\d+$/, '') // mouth_open_2 → mouth_open
  const i = Z_ORDER.indexOf(base)
  return i < 0 ? Z_ORDER.indexOf('objects') : i
}
order.sort((a, b) => zIndexOf(a) - zIndexOf(b))

const children = []
const skipped = []
for (const name of order) {
  const data = canvases.get(name)
  // 薄すぎるアルファ（分解由来のゴースト画素）を掃除しつつ、有効画素を数える
  let solidCount = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 24) data[i] = 0
    else if (data[i] > 32) solidCount++
  }
  // 有効画素が少なすぎるレイヤーはゴミ（tail/wings等の幻影）として除外
  if (solidCount < 12) {
    skipped.push(`${name}(${solidCount}px)`)
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

// ── 静止フレーム監査 ──────────────────────────────────────────
// 静止状態（口閉じ・目開き・表情オーバーレイなし）の合成結果を元絵と比較し、
// 色ズレの塊＝「ピクセル漏れ」候補をビルド時に検出して報告する。
// 今後差分レイヤーを追加・再ビルドした時も、この監査が自動で漏れを知らせる。
function auditRestFrame(quiet = false) {
  const hiddenAtRest = (n) => /^(mouth_open|eye_close$|expr_)/.test(n)
  const flat = new Float32Array(W * H * 4)
  const topName = new Array(W * H).fill(null) // 各画素を最終的に描いたレイヤー名
  for (const c of children) {
    if (hiddenAtRest(c.name)) continue
    const d = c.imageData.data
    for (let i = 0; i < flat.length; i += 4) {
      const a = d[i + 3] / 255
      if (a === 0) continue
      flat[i] = d[i] * a + flat[i] * (1 - a)
      flat[i + 1] = d[i + 1] * a + flat[i + 1] * (1 - a)
      flat[i + 2] = d[i + 2] * a + flat[i + 2] * (1 - a)
      flat[i + 3] = Math.min(255, d[i + 3] + flat[i + 3] * (1 - a))
      if (d[i + 3] > 200) topName[i >> 2] = c.name
    }
  }
  const sB = BASE_IMG.width / W
  const baseAt = (x, y) => {
    const sx = Math.min(BASE_IMG.width - 1, Math.round(x * sB))
    const sy = Math.min(BASE_IMG.height - 1, Math.round(y * sB))
    return (sy * BASE_IMG.width + sx) * 4
  }
  // 輪郭線ぎわは縮尺の丸めで必ずズレるので、元絵の3x3近傍が平坦な場所だけ比較する
  const isFlatArea = (x, y) => {
    let mn = [255, 255, 255], mx = [0, 0, 0]
    for (let dy = -2; dy <= 2; dy += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        const si = baseAt(Math.max(0, Math.min(W - 1, x + dx)), Math.max(0, Math.min(H - 1, y + dy)))
        for (let ch = 0; ch < 3; ch++) {
          const v = BASE_IMG.data[si + ch]
          if (v < mn[ch]) mn[ch] = v
          if (v > mx[ch]) mx[ch] = v
        }
      }
    }
    return (mx[0] - mn[0]) + (mx[1] - mn[1]) + (mx[2] - mn[2]) < 60
  }
  const badMask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (flat[i + 3] < 200) continue
      const si = baseAt(x, y)
      if (BASE_IMG.data[si + 3] < 200) continue
      if (!isFlatArea(x, y)) continue
      const dr = flat[i] - BASE_IMG.data[si]
      const dg = flat[i + 1] - BASE_IMG.data[si + 1]
      const db = flat[i + 2] - BASE_IMG.data[si + 2]
      if (dr * dr + dg * dg + db * db > 48 * 48) badMask[y * W + x] = 1
    }
  }
  // 8近傍で塊にまとめ、一定サイズ以上だけ報告
  const seen = new Uint8Array(W * H)
  const clusters = []
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p0 = y * W + x
      if (!badMask[p0] || seen[p0]) continue
      const stack = [p0]
      seen[p0] = 1
      let n = 0, minX = x, maxX = x, minY = y, maxY = y
      while (stack.length) {
        const p = stack.pop()
        n++
        const px = p % W, py = (p / W) | 0
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const q = (py + dy) * W + (px + dx)
            if (px + dx < 0 || px + dx >= W || py + dy < 0 || py + dy >= H) continue
            if (badMask[q] && !seen[q]) { seen[q] = 1; stack.push(q) }
          }
        }
      }
      if (n >= 30) {
        // どのレイヤーが最前面かの内訳（修復方針の判断材料）
        const layers = {}
        for (let yy = minY; yy <= maxY; yy++) {
          for (let xx = minX; xx <= maxX; xx++) {
            const pp = yy * W + xx
            if (!badMask[pp]) continue
            const t = topName[pp] || '(none)'
            layers[t] = (layers[t] || 0) + 1
          }
        }
        clusters.push({ n, box: [minX, minY, maxX, maxY], layers })
      }
    }
  }
  if (!quiet) {
    if (clusters.length) {
      console.warn(`⚠ 静止フレーム監査: 元絵と色がズレた塊 ${clusters.length}件（ピクセル漏れ候補）`)
      for (const c of clusters.sort((a, b) => b.n - a.n).slice(0, 10)) {
        const who = Object.entries(c.layers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')
        console.warn(`  - ${c.n}px @ x${c.box[0]}-${c.box[2]} y${c.box[1]}-${c.box[3]} [${who}]`)
      }
    } else {
      console.log('静止フレーム監査: 元絵との色ズレなし（クリーン）')
    }
  }
  return { badMask, clusters, topName, baseAt }
}

// ── 監査に基づく自動修復 ─────────────────────────────────────
// 色ズレ画素の最前面レイヤーが「静的な下地」(topwear=首統合済み) のときは、
// その画素を元絵ピクセルで焼き直す。話す時に顎・頭が動いて下地が覗くと
// ズレがちらついて見える「首元ノイズ」を、下地の見た目＝元絵にして解消する。
// 髪など動くレイヤーが最前面の画素には触らない（動きで残像になるため）。
{
  const REPAIRABLE = new Set(['topwear'])
  const first = auditRestFrame(true)
  // 3px膨張: ズレ縁のにじみも一緒に直す
  const dil = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!first.badMask[y * W + x]) continue
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
          dil[ny * W + nx] = 1
        }
      }
    }
  }
  const layerData = new Map(children.map((c) => [c.name, c.imageData.data]))
  let repaired = 0
  const counts = {}
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      if (!dil[p]) continue
      const layerName = first.topName[p]
      if (!layerName || !REPAIRABLE.has(layerName)) continue
      const si = first.baseAt(x, y)
      if (BASE_IMG.data[si + 3] < 200) continue
      const d = layerData.get(layerName)
      const di = p * 4
      d[di] = BASE_IMG.data[si]
      d[di + 1] = BASE_IMG.data[si + 1]
      d[di + 2] = BASE_IMG.data[si + 2]
      d[di + 3] = 255
      repaired++
      counts[layerName] = (counts[layerName] || 0) + 1
    }
  }
  if (repaired) {
    console.log(
      `自動修復: ${repaired}px を元絵で焼き直し (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ')})`
    )
  }

  // ── 動くレイヤーに紛れ込んだ孤立ノイズ成分の除去 ──
  // 分解が handwear 等の「動くレイヤー」へ誤って入れた断片は、腕・頭の
  // アニメと一緒に泳いで首元ノイズに見える。レイヤー本体（最大成分）から
  // 独立した小成分に色ズレ画素が含まれる場合、その成分ごと削除し、
  // 下地(topwear)へ元絵を焼き込んで埋める。
  const movingBad = new Set()
  for (let p = 0; p < W * H; p++) {
    if (!first.badMask[p]) continue
    const t = first.topName[p]
    if (t && !REPAIRABLE.has(t)) movingBad.add(t)
  }
  for (const name of movingBad) {
    const d = layerData.get(name)
    if (!d) continue
    const label = new Int32Array(W * H).fill(-1)
    const sizes = []
    for (let p = 0; p < W * H; p++) {
      if (d[p * 4 + 3] <= 32 || label[p] >= 0) continue
      const id = sizes.length
      let n = 0
      const stack = [p]
      label[p] = id
      while (stack.length) {
        const q = stack.pop()
        n++
        const qx = q % W, qy = (q / W) | 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = qx + dx, ny = qy + dy
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
            const r = ny * W + nx
            if (d[r * 4 + 3] > 32 && label[r] < 0) { label[r] = id; stack.push(r) }
          }
        }
      }
      sizes.push(n)
    }
    const maxSize = Math.max(...sizes, 1)
    const cut = new Set()
    for (let p = 0; p < W * H; p++) {
      if (!first.badMask[p] || first.topName[p] !== name) continue
      const id = label[p]
      if (id >= 0 && sizes[id] < maxSize * 0.5) cut.add(id)
    }
    if (!cut.size) continue
    let removed = 0
    const topD = layerData.get('topwear')
    for (let p = 0; p < W * H; p++) {
      if (label[p] < 0 || !cut.has(label[p])) continue
      d[p * 4 + 3] = 0
      removed++
      const x = p % W, y = (p / W) | 0
      const si = first.baseAt(x, y)
      if (topD && BASE_IMG.data[si + 3] > 200) {
        topD[p * 4] = BASE_IMG.data[si]
        topD[p * 4 + 1] = BASE_IMG.data[si + 1]
        topD[p * 4 + 2] = BASE_IMG.data[si + 2]
        topD[p * 4 + 3] = 255
      }
    }
    console.log(`孤立ノイズ除去: ${name} から ${cut.size}成分 ${removed}px を削除し下地へ元絵を焼き込み`)
  }

  // ── 本体につながった「にじみ縁」の漏れ画素の削り取り ──
  // 分解が袖などの動くレイヤーの縁に染み出させた誤ピクセルは本体成分と
  // 連結しているため、画素単位で削って下地(topwear)に元絵を焼き込む。
  // 元絵側が平坦（＝服や肌）である場所しか監査に載らないので、削っても
  // 本来の絵は失われない。
  {
    let shaved = 0
    const topD = layerData.get('topwear')
    for (let p = 0; p < W * H; p++) {
      if (!first.badMask[p]) continue
      const t = first.topName[p]
      if (!t || REPAIRABLE.has(t)) continue
      const d = layerData.get(t)
      if (!d) continue
      const x = p % W, y = (p / W) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
          const q = ny * W + nx
          if (d[q * 4 + 3] === 0) continue
          d[q * 4 + 3] = 0
          shaved++
          const si = first.baseAt(nx, ny)
          if (topD && BASE_IMG.data[si + 3] > 200) {
            topD[q * 4] = BASE_IMG.data[si]
            topD[q * 4 + 1] = BASE_IMG.data[si + 1]
            topD[q * 4 + 2] = BASE_IMG.data[si + 2]
            topD[q * 4 + 3] = 255
          }
        }
      }
    }
    if (shaved) console.log(`にじみ縁削り: 動くレイヤーから ${shaved}px を削除し下地へ元絵を焼き込み`)
  }

  auditRestFrame() // 修復後の最終結果を報告

  // BRAIN_DUMP_FLAT=パス を指定すると静止フレームの合成PNGを書き出す（目視検証用）
  if (process.env.BRAIN_DUMP_FLAT) {
    const hiddenAtRest = (n) => /^(mouth_open|eye_close$|expr_)/.test(n)
    const png = new PNG({ width: W, height: H })
    for (const c of children) {
      if (hiddenAtRest(c.name)) continue
      const d = c.imageData.data
      for (let i = 0; i < png.data.length; i += 4) {
        const a = d[i + 3] / 255
        if (a === 0) continue
        png.data[i] = d[i] * a + png.data[i] * (1 - a)
        png.data[i + 1] = d[i + 1] * a + png.data[i + 1] * (1 - a)
        png.data[i + 2] = d[i + 2] * a + png.data[i + 2] * (1 - a)
        png.data[i + 3] = Math.min(255, d[i + 3] + png.data[i + 3] * (1 - a))
      }
    }
    writeFileSync(process.env.BRAIN_DUMP_FLAT, PNG.sync.write(png))
    console.log(`静止フレームPNG: ${process.env.BRAIN_DUMP_FLAT}`)
  }
}

const buffer = agpsd.writePsdBuffer(
  { width: W, height: H, children },
  { generateThumbnail: false, noBackground: true }
)
writeFileSync(DEST, buffer)
console.log(`PSD書き出し完了: ${DEST} (${(buffer.length / 1048576).toFixed(1)}MB)`)
console.log(`採用 ${children.length} レイヤー: ${children.map((c) => c.name).join(', ')}`)
console.log(`空でスキップ: ${skipped.join(', ') || 'なし'}`)
