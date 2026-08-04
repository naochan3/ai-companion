// 画面配置・キャラ・人格の設定。localStorageに永続化し、設定パネルから編集する。
export type LayoutConfig = {
  characterName: string
  persona: string
  voice: string
  // 画像は dataURL（背景・立ち絵・口開き差分）
  backgroundImage: string | null
  characterImage: string | null
  characterMouthOpenImage: string | null
  // キャラ配置（画面に対する%指定）
  charX: number // 中心X 0-100
  charBottom: number // 下端からのオフセット% (0=画面下端)
  charHeight: number // 画面高さに対する%
  subtitleY: number // 字幕の下からの位置%
}

const KEY = 'companion-ui-config'

export const DEFAULT_CONFIG: LayoutConfig = {
  characterName: 'モモ',
  persona:
    'あなたは「モモ」という明るく親しみやすい女の子。部屋で一緒に過ごす相棒として、フレンドリーな口語で話す。一人称は「わたし」。AIであることには言及しない。',
  voice: 'persona',
  backgroundImage: null,
  characterImage: null,
  characterMouthOpenImage: null,
  charX: 50,
  charBottom: 0,
  charHeight: 78,
  subtitleY: 12,
}

export function loadConfig(): LayoutConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(c: LayoutConfig) {
  localStorage.setItem(KEY, JSON.stringify(c))
}
