// 会話履歴の指紋照合。
// 常駐ワーカーは自分のプロセス内に会話文脈を持つため、フロントがセッションを
// 切り替えると「ワーカーの記憶」と「送られてきた履歴」が食い違う。
// ここで一致を判定し、食い違ったらワーカーを作り直して履歴を再生する。
// 空白の揺れ程度は同一とみなす（誤って不一致でも履歴再生が走るだけで壊れない）。

export const normalizeText = (t) => String(t ?? "").replace(/\s+/g, "");

export function sameHistory(seen, incoming) {
  if (!Array.isArray(seen)) return false;
  if (seen.length !== incoming.length) return false;
  for (let i = 0; i < seen.length; i++) {
    if (normalizeText(seen[i]) !== normalizeText(incoming[i])) return false;
  }
  return true;
}
