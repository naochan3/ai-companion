// brain — 依存ゼロのOpenAI互換プロキシ。
// フロントから /v1/chat/completions を受け、常駐claudeワーカーにストリーミング中継する。
import { createServer } from "node:http";
import { buildPrompt } from "./lib/prompt.mjs";
import { sharedWorker } from "./lib/worker.mjs";
import { sanitizeSpeech } from "./lib/sanitize.mjs";

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

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

// フロントの設定に依存せずサーバー側で強制する発話規則。
// 感情タグはAITuberKitのEMOTIONS（neutral/happy/angry/sad/relaxed/surprised）に一致させる。
const OUTPUT_CONTRACT = `

【出力規則（厳守）】
- 絵文字・顔文字・記号装飾・マークダウンは一切使わない
- 1回の応答は2〜3文の短い話し言葉。書き言葉にしない
- 各文の先頭に [neutral] [happy] [angry] [sad] [relaxed] [surprised] のいずれかの感情タグを付ける
- 例: [happy]おかえり！ [neutral]今日はどんな一日だった？`;

// persona.md があればフロントの設定より優先する（人格の正本をbrain側で一元管理）
import { readFileSync as readFileSyncFs, existsSync as existsSyncFs } from "node:fs";
import { join as joinPath, dirname as dirnamePath } from "node:path";
import { fileURLToPath as fileURLToPathUrl } from "node:url";
const PERSONA_FILE = joinPath(
  dirnamePath(fileURLToPathUrl(import.meta.url)),
  "persona.md"
);
function loadPersona() {
  try {
    if (existsSyncFs(PERSONA_FILE)) {
      const t = readFileSyncFs(PERSONA_FILE, "utf8").trim();
      if (t) return t;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function handleChat(req, res, body) {
  const { messages = [], stream = false } = body;
  const personaOverride = loadPersona();
  const system =
    (personaOverride ??
      messages
        .filter((m) => m.role === "system")
        .map((m) => contentToText(m.content))
        .join("\n")) + OUTPUT_CONTRACT;

  // 常駐ワーカーが会話文脈を保持するため、通常は最新のユーザー発言だけ渡す。
  // ワーカーが新規起動（初回/人格変更/クラッシュ後）の時だけ履歴を復元する。
  let prompt;
  if (sharedWorker.willBeFresh(system)) {
    prompt = buildPrompt(messages).prompt;
  } else {
    const last = messages.filter((m) => m.role !== "system").at(-1);
    prompt = contentToText(last?.content ?? "");
  }

  const base = {
    id: "chatcmpl-brain",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL_ID,
  };

  if (!stream) {
    try {
      const text = await sharedWorker.ask({ system, prompt });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(chatCompletionBody(sanitizeSpeech(text))));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: String(e.message ?? e), type: "brain_backend_error" },
        })
      );
    }
    return;
  }

  // ストリーミング: 最初の文が出た瞬間からフロントが読み上げを始められる
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const sendDelta = (textPiece) => {
    if (!textPiece) return;
    const chunk = {
      ...base,
      choices: [{ index: 0, delta: { content: textPiece }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };
  try {
    await sharedWorker.ask({
      system,
      prompt,
      onDelta: (d) => sendDelta(sanitizeSpeech(d)),
    });
  } catch (e) {
    sendDelta(`……ごめん、頭が真っ白になっちゃった。もう一回言って？`);
  }
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
