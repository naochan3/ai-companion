// Irodori-TTS-Server (OpenAI互換 /v1/audio/speech) で文を合成する
export async function synthesize(
  text: string,
  voice: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const res = await fetch('/tts/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'irodori-tts',
      input: text,
      voice,
      response_format: 'wav',
    }),
    signal,
  })
  if (!res.ok) {
    throw new Error(`tts error: ${res.status}`)
  }
  return res.arrayBuffer()
}
