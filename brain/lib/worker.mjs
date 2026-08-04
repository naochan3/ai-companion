import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const RUNTIME_HOME =
  process.env.BRAIN_WORKDIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "runtime-home");

function defaultClaudeCmd() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(
      process.env.APPDATA,
      "npm",
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe"
    );
  }
  return "claude";
}

// claude を常駐プロセスとして1本保持し、ターンごとの再起動コスト（数秒）を消す。
// 入出力は stream-json。会話文脈はプロセス内セッションが保持する。
export class ClaudeWorker {
  constructor({ model = process.env.BRAIN_MODEL ?? "haiku" } = {}) {
    this.model = model;
    this.system = null;
    this.child = null;
    this.queue = Promise.resolve();
  }

  _spawn(system) {
    mkdirSync(RUNTIME_HOME, { recursive: true });
    const cmd = process.env.BRAIN_CLAUDE_CMD ?? defaultClaudeCmd();
    let args;
    if (process.env.BRAIN_CLAUDE_ARGS_OVERRIDE) {
      args = JSON.parse(process.env.BRAIN_CLAUDE_ARGS_OVERRIDE);
    } else {
      args = [
        "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--model", this.model,
        "--strict-mcp-config",
      ];
      if (system) args.push("--system-prompt", system);
    }
    const child = spawn(cmd, args, { cwd: RUNTIME_HOME, windowsHide: true });
    child.on("exit", () => {
      if (this.child === child) this.child = null;
    });
    child.stderr.on("data", () => {});
    this.rl = createInterface({ input: child.stdout });
    this.system = system;
    this.child = child;
    return child;
  }

  // 次の ask で新しいプロセスが立つか（=会話文脈が空か）
  willBeFresh(system) {
    return !this.child || this.system !== system;
  }

  ensure(system) {
    // 人格が変わったら作り直す（システムプロンプトは起動時固定のため）
    if (this.child && this.system === system) return this.child;
    if (this.child) {
      try { this.child.kill(); } catch { /* ignore */ }
      this.child = null;
    }
    return this._spawn(system);
  }

  // 1ターン実行。onDelta(text) が逐次呼ばれ、完了時に全文を resolve する。
  ask({ system, prompt, onDelta, timeoutMs = 120000 }) {
    const run = () =>
      new Promise((resolve, reject) => {
        const child = this.ensure(system);
        let full = "";
        let settled = false;
        const finish = (fn, val) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.rl.removeListener("line", onLine);
          fn(val);
        };
        const timer = setTimeout(() => {
          try { child.kill(); } catch { /* ignore */ }
          this.child = null;
          finish(reject, new Error("claude worker timeout"));
        }, timeoutMs);

        const onLine = (line) => {
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            return;
          }
          if (ev.type === "stream_event") {
            const delta = ev.event?.delta;
            if (delta?.type === "text_delta" && delta.text) {
              full += delta.text;
              onDelta?.(delta.text);
            }
            return;
          }
          if (ev.type === "result") {
            if (ev.is_error) {
              finish(reject, new Error(String(ev.result ?? "claude error")));
            } else {
              // partialを取り逃した場合の保険として result 側の本文を優先採用
              const text = typeof ev.result === "string" && ev.result.trim() !== ""
                ? ev.result
                : full;
              finish(resolve, text.trim());
            }
          }
        };
        this.rl.on("line", onLine);
        child.once("exit", () => finish(reject, new Error("claude worker exited")));

        const userMsg = {
          type: "user",
          message: { role: "user", content: [{ type: "text", text: prompt }] },
        };
        child.stdin.write(JSON.stringify(userMsg) + "\n");
      });
    // 直列化: 同時リクエストは順番に処理
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

export const sharedWorker = new ClaudeWorker();
