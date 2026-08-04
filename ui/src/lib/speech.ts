import { synthesize } from './tts'
import { stripEmotionTags, type Emotion } from './emotions'

export type SpeechEvents = {
  // 文の再生開始時: 字幕表示（spokenText＝実際に読む文字列そのもの）と表情
  onSentenceStart: (spokenText: string, emotion: Emotion) => void
  // 再生中の口の開き（0〜1、requestAnimationFrame頻度）
  onMouthLevel: (level: number) => void
  onIdle: () => void
  onError?: (e: unknown) => void
}

const SENTENCE_END = /(?<=[。！？!?\n])/

// ストリーミングテキストを文単位で TTS→再生する直列キュー。
// 「先の文を合成しながら今の文を再生」して待ち時間を隠す。
export class SpeakQueue {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private pending = ''
  private queue: string[] = []
  private playing = false
  private stopped = false
  private streamDone = false
  private rafId = 0
  private currentSource: AudioBufferSourceNode | null = null

  private events: SpeechEvents
  private voice: string

  constructor(events: SpeechEvents, voice: string) {
    this.events = events
    this.voice = voice
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.connect(this.ctx.destination)
    }
    void this.ctx.resume()
    return this.ctx
  }

  // ストリーミング断片を受け取り、文が完成したらキューに積む
  push(delta: string) {
    if (this.stopped) return
    this.pending += delta
    const parts = this.pending.split(SENTENCE_END)
    this.pending = parts.pop() ?? ''
    for (const p of parts) {
      const t = p.trim()
      if (t) this.queue.push(t)
    }
    void this.drain()
  }

  // ストリーム終了: 残りをフラッシュ
  finish() {
    this.streamDone = true
    const t = this.pending.trim()
    this.pending = ''
    if (t) this.queue.push(t)
    void this.drain()
  }

  stop() {
    this.stopped = true
    this.queue = []
    this.pending = ''
    try {
      this.currentSource?.stop()
    } catch {
      /* 再生前のstopは無視 */
    }
    cancelAnimationFrame(this.rafId)
    this.events.onMouthLevel(0)
  }

  private async drain() {
    if (this.playing || this.stopped) return
    this.playing = true
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const raw = this.queue.shift()!
        const { emotion, text } = stripEmotionTags(raw)
        if (!text) continue
        let wav: ArrayBuffer
        try {
          wav = await synthesize(text, this.voice)
        } catch (e) {
          this.events.onError?.(e)
          continue
        }
        if (this.stopped) break
        await this.playBuffer(wav, text, emotion)
      }
    } finally {
      this.playing = false
      if (this.queue.length === 0 && this.streamDone && !this.stopped) {
        this.events.onIdle()
      }
    }
  }

  private playBuffer(
    wav: ArrayBuffer,
    text: string,
    emotion: Emotion
  ): Promise<void> {
    const ctx = this.ensureCtx()
    return new Promise((resolve) => {
      void ctx.decodeAudioData(wav.slice(0), (buffer) => {
        if (this.stopped) return resolve()
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.connect(this.analyser!)
        this.currentSource = source
        this.events.onSentenceStart(text, emotion)
        const data = new Uint8Array(this.analyser!.frequencyBinCount)
        const tick = () => {
          this.analyser!.getByteTimeDomainData(data)
          let sum = 0
          for (const v of data) {
            const c = (v - 128) / 128
            sum += c * c
          }
          const rms = Math.sqrt(sum / data.length)
          this.events.onMouthLevel(Math.min(1, rms * 6))
          this.rafId = requestAnimationFrame(tick)
        }
        tick()
        source.onended = () => {
          cancelAnimationFrame(this.rafId)
          this.events.onMouthLevel(0)
          resolve()
        }
        source.start()
      })
    })
  }
}
