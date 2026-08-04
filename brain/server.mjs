// brain — 依存ゼロのOpenAI互換プロキシ。
// AITuberKit(lmstudioサービス) から /v1/chat/completions を受け、claude -p に中継する。
import { createServer } from "node:http";
import { buildPrompt } from "./lib/prompt.mjs";
import { runClaude } from "./lib/claude.mjs";

const MODEL_ID = "companion";

function chatCompletionBody(text) {
  return {
    id: "chatcmpl-brain",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: MODEL_ID,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
  };
}

async function handleChat(req, res, body) {
  const { messages = [], stream = false } = body;
  const { system, prompt } = buildPrompt(messages);
  let text;
  try {
    text = await runClaude({
      system,
      prompt,
      model: process.env.BRAIN_MODEL ?? "haiku",
    });
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: { message: String(e.message ?? e), type: "brain_backend_error" },
      })
    );
    return;
  }
  if (!stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(chatCompletionBody(text)));
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const base = {
    id: "chatcmpl-brain",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL_ID,
  };
  const chunk = {
    ...base,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  const done = {
    ...base,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  res.write(`data: ${JSON.stringify(done)}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

export function startServer(port = Number(process.env.BRAIN_PORT ?? 8100)) {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data: [{ id: MODEL_ID, object: "model" }],
        })
      );
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        let body;
        try {
          body = JSON.parse(raw || "{}");
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "invalid json" } }));
          return;
        }
        void handleChat(req, res, body);
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
  });
  return new Promise((resolve) =>
    server.listen(port, "0.0.0.0", () => resolve(server))
  );
}

import { pathToFileURL } from "node:url";
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  startServer().then((s) =>
    console.log(`[brain] listening on port ${s.address().port} (model=${process.env.BRAIN_MODEL ?? "haiku"})`)
  );
}
