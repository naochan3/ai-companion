import type { Emotion } from '../lib/emotions'
import type { LayoutConfig } from '../lib/config'

type Props = {
  config: LayoutConfig
  mouthLevel: number
  emotion: Emotion
  speaking: boolean
}

// v1: 立ち絵＋口パク（口開き差分 or 微小バウンス）。
// v2でAnime2.5DRigランタイム（PSDリグ）に差し替えるスロット。
export function Character({ config, mouthLevel, emotion, speaking }: Props) {
  const mouthOpen = mouthLevel > 0.25
  const bob = speaking ? Math.min(mouthLevel * 6, 4) : 0
  const tilt =
    emotion === 'happy' ? -1.2 : emotion === 'sad' ? 1.2 : emotion === 'surprised' ? -2 : 0

  if (!config.characterImage) {
    return (
      <div
        className="absolute flex flex-col items-center justify-end text-white/60"
        style={{
          left: `${config.charX}%`,
          bottom: `${config.charBottom}%`,
          height: `${config.charHeight}%`,
          transform: 'translateX(-50%)',
        }}
      >
        <div className="flex h-full w-56 items-end justify-center rounded-t-full bg-white/10 backdrop-blur-sm">
          <p className="mb-8 px-4 text-center text-sm leading-relaxed">
            設定（右上⚙）から
            <br />
            キャラ画像を追加してね
          </p>
        </div>
      </div>
    )
  }

  const src =
    mouthOpen && config.characterMouthOpenImage
      ? config.characterMouthOpenImage
      : config.characterImage

  return (
    <img
      src={src}
      alt={config.characterName}
      className="absolute select-none object-contain transition-transform duration-75 will-change-transform"
      style={{
        left: `${config.charX}%`,
        bottom: `${config.charBottom}%`,
        height: `${config.charHeight}%`,
        transform: `translateX(-50%) translateY(${-bob}px) rotate(${tilt}deg)`,
        animation: speaking ? undefined : 'breathe 4s ease-in-out infinite',
      }}
      draggable={false}
    />
  )
}
