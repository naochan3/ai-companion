import { test } from "node:test";
import assert from "node:assert/strict";
import { sameHistory, normalizeText } from "../lib/context.mjs";

test("normalizeText: 空白の揺れを吸収する", () => {
  assert.equal(normalizeText(" こんにちは 世界\n"), "こんにちは世界");
  assert.equal(normalizeText(null), "");
});

test("sameHistory: 同一履歴は一致と判定する", () => {
  assert.ok(sameHistory(["やあ", "[happy]おかえり！"], ["やあ ", "[happy]おかえり！\n"]));
  assert.ok(sameHistory([], []));
});

test("sameHistory: 内容や長さが違えば不一致", () => {
  assert.ok(!sameHistory(["やあ"], ["こんばんは"]));
  assert.ok(!sameHistory(["やあ"], ["やあ", "続き"]));
});

test("sameHistory: 不明状態(null)は必ず不一致=履歴再生に倒す", () => {
  assert.ok(!sameHistory(null, []));
});
