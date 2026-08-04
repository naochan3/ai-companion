export type Emotion =
  | 'neutral'
  | 'happy'
  | 'angry'
  | 'sad'
  | 'relaxed'
  | 'surprised'

const TAG_RE = /\[(neutral|happy|angry|sad|relaxed|surprised)\]/g

// 「[happy]おはよう」→ { emotion: 'happy', text: 'おはよう' }
// 読み上げ・字幕にはタグを一切残さない（読み上げ＝字幕の完全一致保証）
export function stripEmotionTags(raw: string): {
  emotion: Emotion
  text: string
} {
  let emotion: Emotion = 'neutral'
  const m = raw.match(TAG_RE)
  if (m && m.length > 0) {
    emotion = m[0].slice(1, -1) as Emotion
  }
  const text = raw.replace(TAG_RE, '').trim()
  return { emotion, text }
}
