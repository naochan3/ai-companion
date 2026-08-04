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

// OpenAI形式 messages を claude -p 用の system + 単一プロンプトへ変換する
export function buildPrompt(messages) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => contentToText(m.content))
    .join("\n");
  const turns = messages.filter((m) => m.role !== "system");
  const last = turns.at(-1);
  const history = turns
    .slice(0, -1)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${contentToText(m.content)}`)
    .join("\n");
  const prompt = history
    ? `これまでの会話:\n${history}\n\n次のUser発言に応答してください。\n${contentToText(last?.content ?? "")}`
    : contentToText(last?.content ?? "");
  return { system, prompt };
}
