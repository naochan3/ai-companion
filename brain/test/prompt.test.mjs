import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../lib/prompt.mjs";

test("system と履歴と最新発言を分離する", () => {
  const { system, prompt } = buildPrompt([
    { role: "system", content: "あなたはネコ耳メイド" },
    { role: "user", content: "こんにちは" },
    { role: "assistant", content: "いらっしゃいませ" },
    { role: "user", content: "今日の予定は?" },
  ]);
  assert.equal(system, "あなたはネコ耳メイド");
  assert.match(prompt, /User: こんにちは/);
  assert.match(prompt, /Assistant: いらっしゃいませ/);
  assert.match(prompt, /今日の予定は\?$/);
});

test("マルチモーダル content 配列は text のみ連結する", () => {
  const { prompt } = buildPrompt([
    {
      role: "user",
      content: [
        { type: "text", text: "画像見て" },
        { type: "image_url", image_url: { url: "data:image/png;base64,xxxx" } },
      ],
    },
  ]);
  assert.match(prompt, /画像見て/);
  assert.doesNotMatch(prompt, /data:/);
});

test("履歴なし単発発言はそのまま prompt になる", () => {
  const { system, prompt } = buildPrompt([{ role: "user", content: "やあ" }]);
  assert.equal(system, "");
  assert.equal(prompt, "やあ");
});
