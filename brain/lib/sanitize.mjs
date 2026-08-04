// TTSが誤読する要素（絵文字・マークダウン記号・コード片）を発話前に除去する。
// AITuberKitの感情タグ [happy] 等は表情制御に使われるため残す。
export function sanitizeSpeech(text) {
  let t = text;
  t = t.replace(/```[\s\S]*?```/g, "");
  // 絵文字・装飾記号（変体セレクタ含む）
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu,
    ""
  );
  // マークダウン記号
  t = t.replace(/[*_#`>~|]/g, "");
  return t;
}
