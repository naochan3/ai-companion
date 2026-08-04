import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.mjs";

let server;
let port;

before(async () => {
  // claude を node ワンライナーに差し替え: 固定文字列を出力するだけの偽バックエンド
  process.env.BRAIN_CLAUDE_CMD = process.execPath;
  process.env.BRAIN_CLAUDE_ARGS_OVERRIDE = JSON.stringify([
    "-e",
    "console.log('テスト応答です')",
  ]);
  server = await startServer(0);
  port = server.address().port;
});

after(() => server.close());

test("GET /v1/models がモデル一覧を返す", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/v1/models`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data[0].id, "companion");
});

test("POST /v1/chat/completions (非stream)", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "companion",
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.choices[0].message.content, "テスト応答です");
  assert.equal(body.choices[0].finish_reason, "stop");
});

test("POST /v1/chat/completions (stream=SSE)", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "companion",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /"delta":\{"content":"テスト応答です"\}/);
  assert.match(text, /data: \[DONE\]/);
});

test("不正JSONは400を返す", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid",
  });
  assert.equal(res.status, 400);
});
