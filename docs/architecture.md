# 詳細設計書 — AIコンパニオン「ネム」

最終更新: 2026-08-06 / 対象: naochan3/ai-companion + naochan3/aituber-kit（フォーク）

初期の要件・技術選定の経緯は開発ルートの `docs/superpowers/specs/2026-08-04-ai-companion-design.md`（設計スペック）を参照。本書は**実装済みシステムの現状仕様**を記録する。

---

## 1. 全体像

```
┌─ ブラウザ (localhost:3000) ────────────────────────────────┐
│  AITuberKit フォーク (Next.js 15 + React 18 + Zustand)      │
│   ├─ rig25dViewer ── iframe ── public/rig25d/index.html     │
│   │                   （Anime2.5DRig ランタイム＋nemu.psd）  │
│   ├─ セッション管理 (sessions.ts + companionDashboard)      │
│   └─ LINE風会話ログ (chatLog.tsx) ＋ 再生ボタン             │
└──────┬──────────────────────────┬──────────────────────────┘
       │ /v1/chat/completions     │ /v1/audio/speech (OpenAI TTS互換)
       ▼                          ▼
┌─ brain (8100) ──────────┐  ┌─ Irodori-TTS-Server (8088) ─┐
│ OpenAI互換プロキシ       │  │ Irodori-TTS v4-Small        │
│ Node.js・依存ゼロ        │  │ uv venv / PCM 48kHz         │
│ └─ 常駐 claude.exe -p    │  │ ボイス: シード#912029(暫定) │
│    (haiku, stream-json)  │  └─────────────────────────────┘
│    人格 = persona.md     │
└──────────────────────────┘
```

**1発話のデータフロー**（ユーザーが送信してからネムが話すまで）:

1. フロントの送信 → AIサービス `ollama`（ベースURL `http://127.0.0.1:8100`、モデル名 `companion`）として brain へ OpenAI互換リクエスト
2. brain が履歴指紋を照合（§3.3）→ 常駐claudeワーカーへ stream-json で中継
3. 応答はサニタイズ（`sanitize.mjs`）を通し、文単位でSSEストリーミング返却
4. フロントが文単位に分割 → 各文の感情タグ `[happy]` 等を解析
5. `speakCharacter()` → 音声キャッシュ照合（§2.4）→ ミスなら `/api/openAITTS` → Irodori-TTS。**感情連動キャプション**をここで注入し演技を制御
6. 再生PCM(48kHz)の音量を `lipSync` が解析 → `rig25dBridge` が iframe へ postMessage
7. リグが口パク（音量で う/え/あ 切替）＋感情タグに応じた表情を描画

---

## 2. フロントエンド（aituber-kit フォーク）

土台は [tegnike/aituber-kit](https://github.com/tegnike/aituber-kit)。upstream は `upstream` リモートとして保持し追従可能。独自実装は以下（`git diff upstream/main..HEAD` が正）。

### 2.1 rig25d 表示方式（VRM/Live2D/PNGTuber に次ぐ第4のモデルタイプ）

| ファイル | 役割 |
|---|---|
| `src/components/rig25dViewer.tsx` | `public/rig25d/index.html` を iframe 埋め込み。ドラッグ配置（キャラ本体ヒット時のみgrab）・拡大率反映 |
| `src/features/rig25d/rig25dBridge.ts` | postMessage送信の一元化（mouth / expr / param / scale / offset / hittest） |
| `src/features/rig25d/rig25dHandler.ts` | 発話再生とリップシンク値→ブリッジの接続 |
| `src/features/messages/characterRenderer.ts` | モデルタイプ分岐に rig25d を追加 |
| `src/components/settings/character/CharacterModelSection.tsx` | 設定UI（モデルタイプ選択・拡大率スライダー 30〜250%） |

- 拡大率・配置位置は localStorage に永続化。
- rig25d には PCMストリーミング再生（`speakPcm16Stream`）が**ない**ため、音声は必ずバッファ再生 = 音声キャッシュ（§2.4）が効く。VRMはストリーミング経路がありキャッシュを素通りする（既知の差異）。

### 2.2 Irodori-TTS 接続と感情演技

| ファイル | 役割 |
|---|---|
| `src/pages/api/openAITTS.ts` | OpenAI TTS互換の中継。`OPENAI_TTS_BASE_URL` でIrodoriへ向け、**感情タグ→演技キャプション**を常時注入（省エネ⇔エンジンONの2段階演技）。PCMサンプルレートも環境変数化（Irodoriは48kHz。24kHz想定で再生すると1オクターブ低くなる） |
| `src/features/messages/synthesizeVoiceOpenAI.ts` | 上記API呼び出し側の対応 |
| `src/pages/api/voice-gacha.ts` + `src/components/voiceGachaPanel.tsx` | 声ガチャ（シード違いのサンプルを一括生成→試聴→採用）。パネルはPortal化（transform祖先によるfixedズレ対策）。採用時に音声キャッシュをクリア |

### 2.3 セッション管理（ChatGPT風）

| ファイル | 役割 |
|---|---|
| `src/features/stores/sessions.ts` | zustand persist (`companion-sessions`)。`syncActiveSession` が chatLog の変化を自動保存 |
| `src/components/companionDashboard.tsx` | 全画面ダッシュボード: セッション一覧・再開・2段階削除・「話したいこと」メモ（その話題で新規会話開始） |
| `src/components/menu.tsx` | ドックに「セッション」ボタン追加。左上⚙復帰フェイルセーフ（`showControlPanel` off / キオスクで設定に戻れなくなる問題の保険） |

**実装上の不変条件**（破ると過去に実際に壊れた）:

- 再開・新規開始では `activeSessionId` を**先に**更新してから `homeStore.setState({ chatLog })` を呼ぶ。逆順だと subscribe が同期発火して旧セッションを新内容で上書きする。
- `syncActiveSession` は `sessionsStore.persist.hasHydrated()` ガード必須。復元前に同期すると重複セッションが生まれる。内容一致（id ?? text のキー比較）なら既存セッションを採用する。

### 2.4 会話ログ・再生・音声キャッシュ

| ファイル | 役割 |
|---|---|
| `src/components/chatLog.tsx` | LINE風化（Glass/Classic両スタイル）。キャラ発言は左＋`nemu-icon.png`、ユーザーは右＋`user-icon.png`。キャラ発言に「▶ もう一回きく」 |
| `src/features/messages/replaySpeech.ts` | 保存済みテキストを感情タグで再分割→Talk列を再構築→`speakCharacter`。タグ付き再合成なので演技も再現される |
| `src/features/messages/speakCharacter.ts` | 合成音声LRUキャッシュ（最大30件）。キー = `voiceType|emotion|paramsKey|message`。`voiceParamsKey` は voicevox / openai のみ実装（他エンジンは null = キャッシュ無効）。**`decodeAudioData` はArrayBufferをデタッチするため、格納も取り出しも必ず `.slice(0)` のコピー**。`clearSpeechCache()` を輸出し声ガチャ採用時に呼ぶ |

`.env` の表示スタイルは `NEXT_PUBLIC_CHAT_LOG_STYLE="classic"`（ユーザーが見るのはClassic側。両スタイルに実装しないと「直ってない」事故になる）。

---

## 3. brain（頭脳プロキシ、`brain/`）

**依存ゼロのNode.js**（`node:http` のみ）。OpenAI互換 `/v1/chat/completions`（stream対応）を受け、常駐claudeワーカーへ中継する。

### 3.1 常駐claudeワーカー（`lib/worker.mjs`）

```
claude.exe -p
  --input-format stream-json --output-format stream-json
  --include-partial-messages --verbose
  --model haiku --strict-mcp-config
  --system-prompt <persona全文>
```

- **シェル経由で spawn すると日本語引数が化ける**（Windows）→ `claude.exe` 実体を直接 spawn。cwd は `runtime-home/`（作業ディレクトリ汚染防止）。
- 常駐化により初動3〜4秒（都度起動だと数十秒）。プロセス内セッションが会話文脈を保持。
- `restart()` でワーカーを作り直せる（セッション切替時に使用）。
- 引数は `BRAIN_CLAUDE_ARGS_OVERRIDE`（JSON配列）で差し替え可能（テスト用）。

**法的制約（最重要・恒久）**: Agent SDK + OAuth(Maxプラン認証) の組み合わせは規約違反。`claude -p`（CLI）はMaxプラン枠内で合法（2026-02規約、anthropics/claude-agent-sdk-python#559 で確認）。この構成を崩さないこと。

### 3.2 人格と出力契約（`server.mjs` + `persona.md`）

- `brain/persona.md` が**人格の正本**。存在すればフロントのシステムプロンプト設定より優先。
- `OUTPUT_CONTRACT` をサーバー側で常時追記: 絵文字・記号装飾禁止 / 2〜3文の話し言葉 / 各文頭に感情タグ `[neutral|happy|angry|sad|relaxed|surprised]`（AITuberKitのEMOTIONSと一致させる）。
- 応答は `lib/sanitize.mjs` で発話用にサニタイズしてから返す。

### 3.3 セッション切替 — 履歴指紋の照合（`lib/context.mjs`）

常駐ワーカーは文脈を持つため、フロントでセッションを切り替えると文脈がズレる。brainはステートレスなAPIのまま、次の方式で自動追従する:

- モジュール変数 `seenHistory` = ワーカーが見たことのある非systemメッセージ本文の配列（`null` = 不明）。
- リクエスト受信時、履歴部分（最後の発言を除く）を `sameHistory(seen, incoming)`（空白正規化して比較。`null`は常に不一致）で照合。
  - **一致** → 最新発言のみワーカーへ（速い・通常経路）
  - **不一致** → `sharedWorker.restart()` → `buildPrompt(messages)` で全履歴を再生してから応答（セッション切替・リロード時）
- 応答成功後 `seenHistory = [...履歴, 最新発言, 応答]` に更新。エラー時は `null` に戻す（次回強制再生）。
- 実機検証済み: セッションA継続→即答、B切替→文脈分離、A復帰→記憶復元。

テスト: `brain/test/`（`node --test`、11件）。

---

## 4. 2.5Dリグ（`rig/` = 正本、`aituber-kit/public/rig25d/` = デプロイ先）

土台は [852wa/Anime2.5DRig](https://github.com/852wa/Anime2.5DRig)（MIT）。PSDをドロップすると自動リギングされるWebGL1ランタイム。ここに埋め込みモードと品質修正を加えた。**編集は必ず `rig/` → kitへコピー**の順（逆流禁止）。

### 4.1 埋め込みAPI（postMessage）

親フレーム→リグ: `{type:'mouth',value}` 口開度 / `{type:'expr',...}` 表情 / `{type:'param',key,value}` 任意パラメータ / `{type:'preset'}` / `{type:'scale'}` / `{type:'offset'}` / `{type:'hittest',x,y}`（ピクセル精密の当たり判定。ドラッグ判定に使用）/ `{type:'auto',patch:{idle,blink,phys,rand,mouse}}` 自動運動の個別ON/OFF。

### 4.2 描画の設計判断（アーティファクト根治の記録）

三度の「直ってない」を経て確立した方式。**理由ごと維持すること。**

| 機構 | 方式 | 理由 |
|---|---|---|
| 口の切替 | **勝者総取りスナップ**: 1フレームに口レイヤーは必ず1枚だけ完全不透明（開き口バリアント or mouth_close）。ヒステリシス `base=0.05+mouthEase*0.35`、開き判定 base+0.08 / 閉じ判定 base | クロスフェードだと閉じ口の唇線が開き口に透けて「ピクセル漏れ」に見える |
| まばたき | 同上（目セット: eyewhite/irides/eyelash ⇔ eye_close）。閾値 `0.10+eyeEase*0.45`、+0.08ヒステリシス | クロスフェード混合が違和感の正体だった |
| 表情オーバーレイ (expr_*) | eyesShown と連動のバイナリ切替 | 中間透明度は二重写しになる |
| 顎追従変形 | **無効化**（コメントアウトで理由記載） | 顔下半分をスライドさせ、顎線が首の上を動いて「首の線」に見えた。開き口差分に開きが描いてあるので変形は不要 |
| 呼吸 | 自動フラグと無関係に常時動作（頭と体で位相差） | 静止しても生きて見せる |

### 4.3 検証手法（教訓）

- **静止フレーム監査は「動きで露出する」問題を検出できない**（顎追従・クロスフェードは静止画では無傷に見える）。
- 動的検証の正攻法: `{type:'auto',patch:{全部false}}` で自動運動を全停止 → パラメータを固定 → 状態別（静止/開口/閉眼）にスクリーンショット → 拡大クロップで元絵と比較。ナイーブな連写diffは呼吸で常に差分が出て使えない。

---

## 5. PSDビルドパイプライン（`scripts/build-psd.mjs`）

立ち絵1枚 + [see-through](https://github.com/shitagaki-lab/see-through)（Apache-2.0, SIGGRAPH 2026。[HF Spaceデモ](https://huggingface.co/spaces/24yearsold/see-through-demo)）のレイヤー分解 + ユーザー納品差分12枚 → Anime2.5DRig命名規約のPSDを合成する。

処理順:

1. **差分抽出**: 納品差分から真の差分ピクセルのみ移植。連結成分フィルタ（最大成分の15%未満=迷い線を破棄）、外周フラッドフィルで穴埋め（二重写し対策）
2. **パッチ品質**: `stampRect` は貼り込み時に**トーン自動補正**（非マスク領域の平均色差を差し引く）＋**縁の羽根ぼかし**（納品AI絵の肌トーン差による長方形ムラ対策）。mouth_close は分解由来でなく**元絵ピクセルの円形羽根パッチ**（静止時=元絵を構造的に保証）
3. **静止フレーム監査** `auditRestFrame`: 静止時に見えるレイヤーを合成し、平坦領域のみ元絵と比較。色ズレ塊（dist>48、30px以上のクラスタ）をレイヤー内訳つきで報告
4. **自動修復**: 静的下地（topwear等）→ 元絵を焼き直し / 動くレイヤー（handwear等）→ 孤立成分は削除、本体連結のにじみは1px縁削り＋下地へ元絵焼き込み。**最終監査クリーンまでがビルド成功**
5. `BRAIN_DUMP_FLAT=path` で合成静止フレームPNGを出力可能（目視検証用）

実行はscratchpadに `ag-psd` + `pngjs` を入れた作業ディレクトリで行う（リポジトリ本体は依存ゼロを維持）。成果物 `assets/character/nemu.psd` → `aituber-kit/public/rig25d/nemu.psd` へコピーでデプロイ。

---

## 6. 音声（Irodori-TTS）

- サーバー: [Aratako/Irodori-TTS-Server](https://github.com/Aratako/Irodori-TTS-Server)（`%LOCALAPPDATA%\Programs\irodori-tts-server`、uv venv、port 8088、OpenAI TTS互換）。エンジン: [Aratako/Irodori-TTS](https://github.com/Aratako/Irodori-TTS) v4-Small。RTX 4070で1文2〜3秒、モデルロード約40秒。
- 声の正本: `docs/nemu-voice-design.md`（ユーザー執筆）。現行ボイス = シード**#912029**（暫定）、**#336694**をキープ。
- 参照音声だけだと抑揚が死ぬ → **感情タグ→キャプション常時注入**が演技の要（§2.2）。
- 既知: 日本語をcurlのインラインJSONで送ると400 → `--data-binary @file` で送る。

---

## 7. 運用

- **起動**: README記載の3プロセス。開発セッションの子プロセスとして起動すると親と一緒に死ぬため、`Start-Process -WindowStyle Hidden`（ログは `_logs/*.log`）で**デタッチ起動**する。
- **ポート**: 3000（画面）/ 8100（brain）/ 8088（TTS）。
- **git**: ai-companion（親）と aituber-kit（内側の独立リポ）は別管理。親の `.gitignore` が `aituber-kit/` を除外。`.env` は両リポでgitignore（`.env.example` のみ追跡）。
- **AITuberKit設定の要点**: UI言語 ja 固定（非日本語だと日本語専用TTSがgoogleへ強制排他）、アクセスポリシー unprotected（ローカル専用）、`NEXT_PUBLIC_CHAT_LOG_STYLE=classic`。

---

## 8. 今後の拡張（優先順）

1. **記憶システム**: brain に SQLite 会話ログ＋定期要約（要約も `claude -p`）。セッション横断でネムが覚えている状態へ
2. **外出先アクセス**: Tailscale ＋ セッションのサーバー側保存
3. **エンジンON検出**: 猫・ゲーム・おかき話題 → sparkle/awake表情＋早口キャプション（表情の配管は済み）
4. 検品(Qwen3-ASR) / 配信レイアウト / TTS高速化プレイブック適用
5. 小物: セッション手動リネーム、胸の猫ワッペンの滲み

---

## 9. 参照リンク一覧

| 分類 | リンク |
|---|---|
| 土台 | https://github.com/tegnike/aituber-kit （docs: https://docs.aituberkit.com/） |
| 音声 | https://github.com/Aratako/Irodori-TTS / https://github.com/Aratako/Irodori-TTS-Server |
| リグ | https://github.com/852wa/Anime2.5DRig （デモ: https://852wa.github.io/Anime2.5DRig/） |
| レイヤー分解 | https://github.com/shitagaki-lab/see-through / https://huggingface.co/spaces/24yearsold/see-through-demo |
| 頭脳 | https://code.claude.com/docs/ （`claude -p` ヘッドレスモード） |
| 規約根拠 | https://github.com/anthropics/claude-agent-sdk-python/issues/559 |
| 検品(予定) | https://huggingface.co/Qwen/Qwen3-ASR-1.7B （arXiv 2601.21337） |
| PSD処理 | https://github.com/Agamnentzar/ag-psd / https://github.com/pngjs/pngjs |
