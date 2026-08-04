import { useCallback, useEffect, useRef, useState } from 'react'
import { askBrain, type ChatMessage } from './lib/brain'
import { SpeakQueue } from './lib/speech'
import { stripEmotionTags, type Emotion } from './lib/emotions'
import { loadConfig, saveConfig, type LayoutConfig } from './lib/config'
import { Character } from './components/Character'
import { SettingsPanel } from './components/SettingsPanel'

type LogEntry = { role: 'user' | 'assistant'; text: string }

export default function App() {
  const [config, setConfig] = useState<LayoutConfig>(loadConfig)
  const [subtitle, setSubtitle] = useState('')
  const [mouthLevel, setMouthLevel] = useState(0)
  const [emotion, setEmotion] = useState<Emotion>('neutral')
  const [speaking, setSpeaking] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const historyRef = useRef<LogEntry[]>([])
  const queueRef = useRef<SpeakQueue | null>(null)

  useEffect(() => saveConfig(config), [config])

  const updateConfig = useCallback((c: LayoutConfig) => setConfig(c), [])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    // 進行中の発話は打ち切る（常に最新の会話を優先）
    queueRef.current?.stop()
    historyRef.current.push({ role: 'user', text })
    setThinking(true)
    setSpeaking(true)

    const queue = new SpeakQueue(
      {
        onSentenceStart: (spoken, emo) => {
          setSubtitle(spoken)
          setEmotion(emo)
        },
        onMouthLevel: setMouthLevel,
        onIdle: () => {
          setSpeaking(false)
          setMouthLevel(0)
        },
        onError: (e) => console.error('[tts]', e),
      },
      config.voice
    )
    queueRef.current = queue

    const messages: ChatMessage[] = [
      { role: 'system', content: config.persona },
      ...historyRef.current.slice(-20).map((h) => ({
        role: h.role,
        content: h.text,
      })),
    ]

    try {
      const full = await askBrain(messages, (delta) => queue.push(delta))
      queue.finish()
      const clean = stripEmotionTags(full).text
      historyRef.current.push({ role: 'assistant', text: clean })
    } catch (e) {
      console.error('[brain]', e)
      setSubtitle('……ごめん、うまく聞こえなかった。もう一回言って？')
      setSpeaking(false)
    } finally {
      setThinking(false)
    }
  }, [input, thinking, config.persona, config.voice])

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950 text-white">
      {/* 部屋背景 */}
      {config.backgroundImage ? (
        <img
          src={config.backgroundImage}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950 via-slate-900 to-slate-950" />
      )}
      <div className="absolute inset-0 bg-black/10" />

      {/* キャラ */}
      <Character
        config={config}
        mouthLevel={mouthLevel}
        emotion={emotion}
        speaking={speaking}
      />

      {/* 右上メニュー */}
      <div className="absolute right-4 top-4 z-30 flex gap-2">
        <button
          className="rounded-full bg-black/40 px-4 py-2 text-sm backdrop-blur hover:bg-black/60"
          onClick={() => setShowLog((v) => !v)}
        >
          ログ
        </button>
        <button
          className="rounded-full bg-black/40 px-4 py-2 text-sm backdrop-blur hover:bg-black/60"
          onClick={() => setShowSettings(true)}
        >
          ⚙ 設定
        </button>
      </div>

      {/* 会話ログ */}
      {showLog && (
        <div className="absolute left-4 top-4 z-20 max-h-[60%] w-80 overflow-y-auto rounded-xl bg-black/50 p-3 text-sm backdrop-blur">
          {historyRef.current.length === 0 && (
            <p className="text-white/50">まだ会話がないよ</p>
          )}
          {historyRef.current.map((h, i) => (
            <p key={i} className="mb-2 leading-relaxed">
              <span
                className={h.role === 'user' ? 'text-sky-300' : 'text-pink-300'}
              >
                {h.role === 'user' ? 'あなた' : config.characterName}
              </span>
              ：{h.text}
            </p>
          ))}
        </div>
      )}

      {/* 字幕（読み上げている文字列と完全一致） */}
      {subtitle && (
        <div
          className="absolute left-1/2 z-20 w-[min(90%,52rem)] -translate-x-1/2"
          style={{ bottom: `${config.subtitleY}%` }}
        >
          <div className="rounded-2xl bg-black/60 px-6 py-4 text-center backdrop-blur">
            <span className="mr-3 text-sm font-bold text-pink-300">
              {config.characterName}
            </span>
            <span className="text-lg leading-relaxed">{subtitle}</span>
          </div>
        </div>
      )}

      {/* 入力欄 */}
      <div className="absolute bottom-4 left-1/2 z-30 w-[min(92%,44rem)] -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-full bg-black/50 p-2 backdrop-blur">
          <input
            className="flex-1 bg-transparent px-4 py-2 outline-none placeholder:text-white/40"
            placeholder={
              thinking ? `${config.characterName}が考え中…` : '話しかけてみよう'
            }
            value={input}
            disabled={thinking}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
            }}
          />
          <button
            className="rounded-full bg-indigo-500 px-6 py-2 font-semibold hover:bg-indigo-400 disabled:opacity-40"
            disabled={thinking || !input.trim()}
            onClick={() => void send()}
          >
            送信
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsPanel
          config={config}
          onChange={updateConfig}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
