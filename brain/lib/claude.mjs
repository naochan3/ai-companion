import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// 会話専用の空ディレクトリ。開発リポジトリのCLAUDE.md等を拾って人格が汚染されるのを防ぐ
const RUNTIME_HOME = process.env.BRAIN_WORKDIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "runtime-home");

// claude -p を1リクエスト1プロセスで実行して応答テキストを返す。
// BRAIN_CLAUDE_CMD / BRAIN_CLAUDE_ARGS_OVERRIDE はテスト用の差し替えフック。
// Windowsではシェル経由だと日本語引数が化けるため、claude.exe の実体を直接spawnする
function defaultClaudeCmd() {
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = join(
      process.env.APPDATA,
      "npm",
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe"
    );
    return exe;
  }
  return "claude";
}

export function runClaude({ system, prompt, model = "haiku", timeoutMs = 90000 }) {
  return new Promise((resolve, reject) => {
    const cmd = process.env.BRAIN_CLAUDE_CMD ?? defaultClaudeCmd();
    let args;
    if (process.env.BRAIN_CLAUDE_ARGS_OVERRIDE) {
      args = JSON.parse(process.env.BRAIN_CLAUDE_ARGS_OVERRIDE);
    } else {
      args = [
        "-p", prompt,
        "--model", model,
        "--output-format", "text",
        "--max-turns", "1",
        "--strict-mcp-config",
      ];
      // 完全置換: Claude Code としての素性を消し、キャラ人格だけにする
      if (system) args.push("--system-prompt", system);
    }
    mkdirSync(RUNTIME_HOME, { recursive: true });
    const child = spawn(cmd, args, {
      cwd: RUNTIME_HOME,
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
