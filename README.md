# AIコンパニオン「ネム」

自宅PCで動くAIキャラクターコンパニオン（ローカルGrok Ani）。
ブラウザの画面にキャラ「ネム」が立ち、話しかけると人格を持った応答が返り、設計した声で読み上げながら口パク・表情・まばたきで反応する。すべてローカルで完結する。

## 全体構成

```
[ブラウザ localhost:3000]
   AITuberKit フォーク (Next.js) … 画面・字幕・2.5Dキャラ表示・セッション管理
     ├─ LLM → brain (localhost:8100, OpenAI互換プロキシ)
     │          └─ 常駐 claude -p（Claude Code CLI / haiku）＋人格 persona.md
     └─ TTS → Irodori-TTS-Server (localhost:8088, OpenAI TTS互換)
                └─ 感情タグ連動キャプションで演技を制御
```

## リポジトリ

| リポジトリ | 役割 |
|---|---|
| [naochan3/ai-companion](https://github.com/naochan3/ai-companion)（このリポ） | brain・2.5Dリグ・PSDビルド・キャラアセット・設計書 |
| [naochan3/aituber-kit](https://github.com/naochan3/aituber-kit) | プロダクト本体。[tegnike/aituber-kit](https://github.com/tegnike/aituber-kit) のフォーク（upstream リモートで追従可能） |

## ディレクトリ

```
brain/       OpenAI互換プロキシ (port 8100)。常駐claudeワーカー・人格・出力契約・セッション切替
rig/         Anime2.5DRig ランタイム＋埋め込みAPI（正本。public/rig25d/ へコピーでデプロイ）
scripts/     build-psd.mjs — 差分画像→リグ用PSDビルド（静止フレーム監査・自動修復つき）
assets/      立ち絵・差分12枚・ビルド済み nemu.psd・部屋背景
docs/        設計書（下記）
ui/          自作UIプロトタイプ（休眠。本線はAITuberKitフォーク）
aituber-kit/ フォーク本体（独立リポ。このリポからは .gitignore で除外）
_logs/       各サービスのログ出力先
```

## ドキュメント

- [簡易設計書](docs/overview.md) — 仕組みをざっくり理解する用（まずこれ）
- [詳細設計書](docs/architecture.md) — コンポーネント仕様・データフロー・設計判断の全記録
- [ネムの声・演技設計書](docs/nemu-voice-design.md) — キャラ声の正本

## 起動方法

3つのサービスを起動する（順不同。TTSはモデルロードに約40秒かかる）。

```powershell
# 1. brain (port 8100)
Start-Process node.exe "server.mjs" -WorkingDirectory ".\brain" -WindowStyle Hidden

# 2. Irodori-TTS (port 8088)
Start-Process "$env:LOCALAPPDATA\Programs\irodori-tts-server\.venv\Scripts\python.exe" `
  "-m","irodori_openai_tts" -WorkingDirectory "$env:LOCALAPPDATA\Programs\irodori-tts-server" -WindowStyle Hidden

# 3. 画面 (port 3000)
Start-Process npm.cmd "run","dev" -WorkingDirectory ".\aituber-kit" -WindowStyle Hidden
```

ブラウザで `http://localhost:3000` を開く。

## 参照・利用しているプロジェクト

| プロジェクト | 用途 | ライセンス |
|---|---|---|
| [tegnike/aituber-kit](https://github.com/tegnike/aituber-kit) | 土台（フォーク改造） | v2.0.0以降カスタムライセンス（個人非商用無料） |
| [Aratako/Irodori-TTS](https://github.com/Aratako/Irodori-TTS) / [Irodori-TTS-Server](https://github.com/Aratako/Irodori-TTS-Server) | 音声合成（VoiceDesign＋OpenAI互換サーバー） | 各リポ参照 |
| [852wa/Anime2.5DRig](https://github.com/852wa/Anime2.5DRig) | 画像1枚→2.5Dリグのランタイム（`rig/` に同梱・改造） | MIT |
| [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through) | 立ち絵のレイヤー分解（前処理。[HF Space](https://huggingface.co/spaces/24yearsold/see-through-demo)） | Apache-2.0 |
| [Claude Code CLI](https://code.claude.com/docs/) | 頭脳（`claude -p` を常駐化） | Anthropic規約（Maxプラン枠内で合法） |
| ag-psd / pngjs | PSD読み書き・PNG処理（ビルドスクリプト） | MIT |

## ライセンス・運用上の注意

- このリポジトリは**private・個人非商用**で運用する。AITuberKitのカスタムライセンス（商用は別途契約）に従う。
- キャラクター「ネム」の絵・声・人格設定は本リポジトリ所有者の私物。
- 頭脳はAgent SDK + OAuthではなく `claude -p`（CLI）を使う。**SDK+OAuthは規約違反、CLIは合法**という区別を維持すること（詳細は詳細設計書）。
