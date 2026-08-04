import { useRef } from 'react'
import type { LayoutConfig } from '../lib/config'

type Props = {
  config: LayoutConfig
  onChange: (c: LayoutConfig) => void
  onClose: () => void
}

function ImagePicker({
  label,
  value,
  onPick,
}: {
  label: string
  value: string | null
  onPick: (dataUrl: string | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        {value && (
          <button
            className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
            onClick={() => onPick(null)}
          >
            削除
          </button>
        )}
        <button
          className="rounded bg-indigo-500/80 px-3 py-1 text-xs hover:bg-indigo-400"
          onClick={() => ref.current?.click()}
        >
          {value ? '変更' : '選択'}
        </button>
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          const reader = new FileReader()
          reader.onload = () => onPick(String(reader.result))
          reader.readAsDataURL(f)
        }}
      />
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="text-white/50">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        className="w-full accent-indigo-400"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function SettingsPanel({ config, onChange, onClose }: Props) {
  const set = <K extends keyof LayoutConfig>(k: K, v: LayoutConfig[K]) =>
    onChange({ ...config, [k]: v })

  return (
    <div className="absolute right-0 top-0 z-40 flex h-full w-96 flex-col gap-4 overflow-y-auto bg-slate-900/95 p-5 text-white shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">設定</h2>
        <button
          className="rounded bg-white/10 px-3 py-1 text-sm hover:bg-white/20"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>

      <section className="space-y-3">
        <h3 className="border-b border-white/20 pb-1 text-sm font-semibold text-indigo-300">
          キャラクター
        </h3>
        <label className="block text-sm">
          名前
          <input
            className="mt-1 w-full rounded bg-white/10 px-2 py-1"
            value={config.characterName}
            onChange={(e) => set('characterName', e.target.value)}
          />
        </label>
        <label className="block text-sm">
          人格（システムプロンプト）
          <textarea
            className="mt-1 h-28 w-full rounded bg-white/10 px-2 py-1 text-xs leading-relaxed"
            value={config.persona}
            onChange={(e) => set('persona', e.target.value)}
          />
        </label>
        <label className="block text-sm">
          声（Irodoriのvoice名）
          <input
            className="mt-1 w-full rounded bg-white/10 px-2 py-1"
            value={config.voice}
            onChange={(e) => set('voice', e.target.value)}
          />
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="border-b border-white/20 pb-1 text-sm font-semibold text-indigo-300">
          画像
        </h3>
        <ImagePicker
          label="部屋の背景"
          value={config.backgroundImage}
          onPick={(v) => set('backgroundImage', v)}
        />
        <ImagePicker
          label="キャラ立ち絵"
          value={config.characterImage}
          onPick={(v) => set('characterImage', v)}
        />
        <ImagePicker
          label="口開き差分（任意）"
          value={config.characterMouthOpenImage}
          onPick={(v) => set('characterMouthOpenImage', v)}
        />
      </section>

      <section className="space-y-3">
        <h3 className="border-b border-white/20 pb-1 text-sm font-semibold text-indigo-300">
          画面配置
        </h3>
        <Slider
          label="キャラ左右位置(%)"
          value={config.charX}
          min={0}
          max={100}
          onChange={(v) => set('charX', v)}
        />
        <Slider
          label="キャラの高さ(%)"
          value={config.charHeight}
          min={20}
          max={100}
          onChange={(v) => set('charHeight', v)}
        />
        <Slider
          label="キャラ下端の浮き(%)"
          value={config.charBottom}
          min={0}
          max={40}
          onChange={(v) => set('charBottom', v)}
        />
        <Slider
          label="字幕の高さ(%)"
          value={config.subtitleY}
          min={0}
          max={50}
          onChange={(v) => set('subtitleY', v)}
        />
      </section>
    </div>
  )
}
