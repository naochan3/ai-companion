import { spawn } from "node:child_process";

// claude -p を1リクエスト1プロセスで実行して応答テキストを返す。
// BRAIN_CLAUDE_CMD / BRAIN_CLAUDE_ARGS_OVERRIDE はテスト用の差し替えフック。
export function runClaude({ system, prompt, model = "haiku", timeoutMs = 90000 }) {
  return new Promise((resolve, reject) => {
    const cmd = process.env.BRAIN_CLAUDE_CMD ?? "claude";
    let args;
    if (process.env.BRAIN_CLAUDE_ARGS_OVERRIDE) {
      args = JSON.parse(process.env.BRAIN_CLAUDE_ARGS_OVERRIDE);
    } else {
      args = ["-p", prompt, "--model", model, "--output-format", "text"];
      if (system) args.push("--append-system-prompt", system);
    }
    const child = spawn(cmd, args, {
      shell: process.platform === "win32" && !process.env.BRAIN_CLAUDE_CMD,
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("claude timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
