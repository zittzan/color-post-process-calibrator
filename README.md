# Color Post-Process Calibrator

Unity (URP) のポストプロセス (Color Grading) が有効なプロジェクトで、
「レンダリング結果を目標のブランドカラーに一致させるためにテクスチャへ実際に塗るべき色（修正値）」
を逆算するデスクトップツール。

3Dアーティストのワークフロー:

1. URP の Volume Profile (.asset) を読み込む
2. 目標色 (hex) を入力 → 理論逆算による修正値が即座に出る
3. （精度を上げたい場合）実際にテクスチャに塗った色（入力値）と、その時のレンダリング結果の色（出力値）を入力
   → 理論とのズレ（残差）が自動測定され、残差補正込みの修正値に更新される
4. 修正値を Unity で試す → 新しい出力値を測って再入力 → 再計算、を繰り返して収束させる

## 起動方法

```bash
cd tools/color-post-process-calibrator
npm install
npm start
```

配布用 zip: `npm run dist` → 失敗時は `dist/win-unpacked` を `npm run make-zip`。

---

## 計算アーキテクチャ

### 全体データフロー

```
.asset (URP Volume Profile)
   │ パース (asset-parser.js)
   ▼
有効パラメータ {lift, gamma, gain, saturation, tonemapping mode}
   │
   ▼
順方向モデル F: テクスチャ色(sRGB hex) → 予測されるレンダリング出力色(sRGB hex)
   │                                      (colormath.js / URP シェーダーの忠実な移植)
   │
   ├─ 理論補正値: F⁻¹(目標値 T) を数値ソルバーで求める
   │
   ├─ 残差測定:   Δ = F(入力値 I) − 出力値 O   （I, O が両方入力されている場合のみ）
   │              ※ モデル外の要因（ライティング・シェーダー・未対応エフェクト）による
   │                系統誤差を出力空間で捉える
   │
   └─ 最終修正値: F(c) = T + Δ を満たす c を数値ソルバーで求める
                  （O 未入力なら Δ = 0、つまり純理論値になる）
```

行ごとに完全に独立して計算する。複数行にまたがる回帰・共有モデルは持たない。

### 順方向モデル F の詳細

URP の LUT ビルダー (`LutBuilderHdr.shader`) と `ColorUtils.cs` / `Color.hlsl` の
該当処理を JavaScript に移植したもの。Unity 側の Color Space は **Linear 前提**
（`colormath.js` の `COLOR_SPACE` 定数 1 箇所で切替可能にし、Gamma だったと
判明した場合に備える）。

入力: テクスチャに塗る sRGB 色 `c ∈ [0,1]³`

1. **sRGB → リニア** (IEC 61966-2-1 EOTF)
   `x ≤ 0.04045 ? x/12.92 : ((x+0.055)/1.055)^2.4`
2. **作業色空間への変換**（Tonemapping=ACES 時のみ）
   linear sRGB → AP0 (`sRGB_2_AP0` 行列) → ACEScc → コントラスト
   `(x − ACEScc_MIDGRAY) × (contrast/100 + 1) + ACEScc_MIDGRAY` → AP0 → **ACEScg (AP1)**。
   本プロファイルでは contrast の override が無効（乗数 1）なので実質恒等変換だが、
   シェーダーと同じ経路を常に通す（他プロファイルの contrast 対応のため）。
   非 ACES プロファイルでは LogC 経由 (`LinearToLogC`/`LogCToLinear`) で同じ式。
3. **Lift / Gamma / Gain** (`ColorUtils.PrepareLiftGammaGain` + `LiftGammaGainHDR`)
   - 前処理 (C# 側):
     `lift' = ColorToLift(lift × 0.15)`, `invgamma = ColorToInverseGamma(gamma × 0.8)`,
     `gain' = ColorToGain(gain × 0.8)`
     - `ColorToLift(v)`: `S = v.xyz − Lum(v.xyz)`, 戻り値 `S + v.w`
     - `ColorToInverseGamma(v)`: `M = v.xyz − Lum(v.xyz)`, 戻り値 `1 / max(M + v.w + 1, 1e−3)`
     - `ColorToGain(v)`: `H = v.xyz − Lum(v.xyz)`, 戻り値 `H + v.w + 1`
     - `Lum(rgb) = 0.2126r + 0.7152g + 0.0722b`
   - シェーダー側 (`LiftGammaGainHDR`):
     `c = c × gain' + lift'` → `c = sign(c) × |c|^invgamma`
4. **グローバル Saturation** (`ColorAdjustments.saturation`)
   `sat = saturation/100 + 1`, `luma = dot(c, W)`, `c = luma + sat × (c − luma)`
   - W は ACES 時 `AP1_RGB2Y`、非 ACES 時 Rec.709 係数
5. **Tonemapping (ACES)** — Unity 既定の **fitted 近似** (`Color.hlsl AcesTonemap`,
   `TONEMAPPING_USE_FULL_ACES = 0`) を移植:
   1. ACEScg → AP0 (`AP1_2_AP0_MAT`)
   2. Glow module: `aces ×= 1 + glow_fwd(rgb_2_yc(aces), 0.05 × sigmoid_shaper((rgb_2_saturation(aces)−0.4)/0.2), 0.08)`
   3. Red modifier: `aces.r += hueWeight × sat × (0.03 − aces.r) × (1 − 0.82)`
      （`hueWeight = smoothstep(0,1, 1−|2·centerHue(hue,0)/135|)²`）
   4. `acescg = max(0, AP0_2_AP1 × aces)` → RRT 脱飽和 `lerp(dot(acescg, AP1_RGB2Y), acescg, 0.96)`
   5. トーンカーブ (RRT+ODT の有理関数フィット):
      `y = x(278.5085x + 10.7772) / (x(293.6045x + 88.7122) + 80.6889)`
   6. dim surround 補正: xyY 空間で `Y = Y^0.9811`
   7. ODT 脱飽和 `lerp(dot(c, AP1_RGB2Y), c, 0.93)`
   8. AP1 → XYZ → D60→D65 CAT → XYZ → Rec.709 linear
   （非 ACES プロファイルではこのステップをスキップ）
6. **クランプ [0,1] → リニア → sRGB エンコード**
   `x ≤ 0.0031308 ? 12.92x : 1.055x^(1/2.4) − 0.055`

postExposure / colorFilter / hueShift / contrast は `m_OverrideState = 1` の場合のみ
式に組み込む（postExposure は LUT 適用前の乗数 `2^postExposure`、colorFilter は
リニア乗算、contrast は手順 2）。hueShift の解析実装は対象外（override 有効なら警告）。

行列・定数は付録 A を参照（Unity `ACES.hlsl` / `Color.hlsl` の値をそのまま使用）。

### 逆算（数値ソルバー）

ACES トーンカーブ＋各種行列により F は解析的に逆変換できないため、
**減衰付き Gauss-Newton 法**で `F(c) = goal` を解く:

- 目的関数 `E(c) = ‖F(c) − goal‖²`（sRGB float 空間）
- ヤコビアンは中心差分（h = 1e−3）で数値計算した 3×3 行列
- ステップ後に `c` を [0,1]³ に射影。E が減らない場合はステップ半減（バックトラック）
- 反復上限 64 回、収束判定は max 残差 < 0.5/255
- 初期値は複数スタート（goal 自身・入力値・中間グレー）で最良解を採用
- goal が F の到達可能域外（ACES による色域圧縮で起こりうる）の場合は
  最小二乗の意味での最近傍を返し、UI に残差（255 スケール）を表示する

### 残差補正（ハイブリッド方式）

理論モデルは「テクスチャ色がそのまま画面に 1:1 で乗る」という仮定を置いており、
実際にはライティング・シェーディング・未対応エフェクトの影響でズレる。
このズレを行ごとの実測サンプルから自動測定する:

```
Δ = F(入力値) − 出力値          … モデルが実測より Δ だけ明るく/ずれて予測している
修正値 = solve F(c) = 目標値 + Δ  … そのバイアス分を先回りして打ち消す
```

- モデルが完璧なら `F(I) = O` なので Δ = 0 となり、純理論逆算と一致する
- 理論値と実測値を別々に見せて選ばせるのではなく、常にこの式で 1 つの値に自動ブレンドする
- 出力値が未入力の行は Δ = 0（純理論値）
- 修正値セルには残差補正が効いているかどうかをサブテキストで表示する

### 反復ワークフロー（収束）

出力値列の「反復」ボタンで以下を実行:

1. 現在の (入力値, 出力値, 修正値) を行の履歴に追加
2. **入力値 ← 修正値**（前回の修正値を実際に塗った、という前提に更新）
3. 出力値をクリアし、フォーカスを出力値欄へ

ユーザーが新しく測った出力値を入れると自動で再計算される。
繰り返すたびに Δ がその時点の動作点付近で測り直されるため、目標色に収束していく。
履歴は行ごとに展開表示できる（アプリ終了で消える。永続化はしない）。

---

## .asset パーサーと対応範囲

Unity Volume Profile は `!u!` タグ付きマルチドキュメント YAML のため、
専用の軽量パーサー (`asset-parser.js`) で必要フィールドのみ抽出する
（`--- !u!` でドキュメント分割 → `m_Name` / `active` / 各パラメータの
`m_OverrideState` / `m_Value`（スカラー or `{x,y,z,w}` / `{r,g,b,a}`）を読む）。

### 解析的モデルの対応対象（この 3 つのみ）

| コンポーネント | 使用パラメータ |
|---|---|
| LiftGammaGain | lift / gamma / gain（override 有効なもののみ。無効は既定値 (1,1,1,0)） |
| ColorAdjustments | saturation のみ（＋postExposure / contrast / colorFilter は override 有効なら式に反映） |
| Tonemapping | mode（ACES のみ解析対応） |

### パラメータ採用ルール

- 原則: `m_OverrideState = 1` のパラメータのみ適用（Unity Volume の意味論通り）
- **例外**: Tonemapping の mode は `active = 1` なら `m_Value` を採用する
  （実データで mode の override が無効のまま運用されており、依頼者確認済みの挙動。
  UI にその旨を情報表示する）

### 警告（未対応エフェクト）

.asset 読み込み時、以下の場合に「未対応のため理論値の精度が落ちる可能性があります
（実測残差補正は引き続き有効です）」という警告バナーを表示して処理は続行する:

- 上記 3 つ以外のコンポーネントが `active = 1`（WhiteBalance / ColorCurves /
  ChannelMixer / SplitToning / ShadowsMidtonesHighlights / Bloom / Vignette 等すべて）
- ColorAdjustments の hueShift が override 有効かつ非ゼロ
- Tonemapping の mode が ACES (1) 以外（None はトーンマップなしとして扱い警告なし、
  Neutral (2) は未対応警告＋トーンマップなしとして計算）

---

## UI 仕様

シングルウィンドウ・ダークテーマ。作業データはメモリ上のみ（保存機能なし）。

```
┌──────────────────────────────────────────────────────────┐
│ Color Post-Process Calibrator     [.asset を読み込む]      │
│ プロファイル: xxx.asset                                    │
│  LGG lift −0.03 / gamma +0.063 / gain +0.345 ・ Sat +10.1 │
│  ・ Tonemap ACES                                          │
│ ⚠ 未対応エフェクト警告バナー（該当時のみ）                   │
├──────────────────────────────────────────────────────────┤
│ #│ 目標値      │ 入力値      │ 出力値            │ 修正値   │操作│
│ 1│ ■ #2B4786  │ ■ #......  │ ■ #... [スポイト][反復] │ ■ #... [コピー]│🔒 ＋│
│ 2│ ■ #81C7E8  │ ...        │ ...               │ ...     │✕ ＋│
│  └ 履歴: ▸ 1回目 入力#.. 出力#.. → 修正#.. …              │
└──────────────────────────────────────────────────────────┘
```

- **色セル** = カラースウォッチ + hex テキスト入力（`#RRGGBB` / `RRGGBB` / `#RGB` を受理、
  不正値は赤枠表示）。目標値・入力値・出力値が編集可能、修正値は読み取り専用
- **修正値セル**: hex + コピー（クリップボード）ボタン。残差補正が効いている場合は
  「残差補正あり (Δ r,g,b)」、ソルバーが到達不能だった場合は「近似（残差 n/255）」を
  サブテキスト表示。プロファイル未読み込み時は「.asset を読み込んでください」
- **出力値セル**: hex 入力 + スポイトボタン + 反復（再計算）ボタン
- **スポイト**: モーダルを開き、`desktopCapturer` で取得した画面の静止キャプチャを表示
  （マルチディスプレイはドロップダウンで選択、再キャプチャボタンあり）。
  マウス位置の拡大ルーペ＋hex 表示、クリックで出力値欄に確定。
  キャプチャは静止画なので「Unity の画面を前面にしてからスポイトを開く」旨をモーダル内に明記。
  Windows ではデスクトップキャプチャに OS の権限ダイアログは通常発生しないが、
  キャプチャ失敗時は権限設定（設定 > プライバシー）への案内を表示する
- **行操作**: 各行に「＋（下に行追加）」「✕（行削除）」。**1 行目のみ削除不可**で、
  ✕ の代わりに鍵アイコンを表示（誤操作で 0 行になるのを防ぐガード。それ以外の意味はない）
- **計算タイミング**: 目標値・入力値・出力値のいずれかが変わったら自動再計算（デバウンス）
- **履歴**: 反復ボタンを押すたびに履歴に追記。行下に展開表示（回数 / 入力 / 出力 / 修正値）

---

## 技術スタック・ファイル構成

Electron + Vanilla JS（React 不使用。テーブル UI 主体のため直 DOM で十分であり、
Babel/バンドラ依存を避ける）。フレームワーク外の実行時依存なし。

```
tools/color-post-process-calibrator/
  README.md          このファイル（仕様書）
  package.json       electron / electron-builder（devDependencies のみ）
  main.js            BrowserWindow 生成・IPC（ファイルダイアログ / 画面キャプチャ）
  preload.js         contextBridge で window.api を公開
  index.html         シェル（CSP メタタグ・レイアウト）
  style.css          スタイル
  app.js             UI ロジック（テーブル・スポイトモーダル・履歴）
  colormath.js       順方向モデル F・数値ソルバー（UMD 形式。node から直接テスト可能）
  asset-parser.js    Unity YAML パーサー（UMD 形式）
  selftest.js        node selftest.js で colormath / asset-parser の自己検証
  .gitignore         node_modules / dist
```

### セキュリティ（`references/electron-desktop-tool.md` 準拠）

- `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`
  （ファイル DnD を使わないため sandbox を有効化できる）
- CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:`
  （`data:` はキャプチャ画像表示に必要）
- IPC は「ダイアログで選んだ .asset の読み込み」「画面キャプチャ取得」の 2 つのみ。
  レンダラーから任意パスを受け取る IPC は持たない（ダイアログ選択→main が読んで内容を返す）
- `will-navigate` は自ページ以外を preventDefault

### IPC インターフェース

| チャンネル | 方向 | 内容 |
|---|---|---|
| `asset:open` | renderer → main | ダイアログ表示 → 選択された .asset の `{ path, content }` を返す（キャンセル時 null） |
| `capture:screens` | renderer → main | `desktopCapturer.getSources({types:['screen']})`。各ディスプレイの `{ id, name, dataURL, width, height }` 配列を返す（サムネイルサイズは `screen.getAllDisplays()` の物理解像度） |

---

## 付録 A: 定数（Unity ACES.hlsl / Color.hlsl より）

```
sRGB_2_AP0 = [ 0.4397010, 0.3829780, 0.1773350,
               0.0897923, 0.8134230, 0.0967616,
               0.0175440, 0.1115440, 0.8707040 ]

AP0_2_AP1  = [  1.4514393161, -0.2365107469, -0.2149285693,
               -0.0765537734,  1.1762296998, -0.0996759264,
                0.0083161484, -0.0060324498,  0.9977163014 ]

AP1_2_AP0  = [  0.6954522414,  0.1406786965,  0.1638690622,
                0.0447945634,  0.8596711185,  0.0955343182,
               -0.0055258826,  0.0040252103,  1.0015006723 ]

AP1_2_XYZ  = [  0.6624541811,  0.1340042065,  0.1561876870,
                0.2722287168,  0.6740817658,  0.0536895174,
               -0.0055746495,  0.0040607335,  1.0103391003 ]

XYZ_2_AP1  = [  1.6410233797, -0.3248032942, -0.2364246952,
               -0.6636628587,  1.6153315917,  0.0167563477,
                0.0117218943, -0.0082844420,  0.9883948585 ]

D60_2_D65_CAT = [  0.98722400, -0.00611327,  0.0159533,
                  -0.00759836,  1.00186000,  0.0053302,
                   0.00307257, -0.00509595,  1.0816800 ]

XYZ_2_REC709 = [  3.2409699419, -1.5373831776, -0.4986107603,
                 -0.9692436363,  1.8759675015,  0.0415550574,
                  0.0556300797, -0.2039769589,  1.0569715142 ]

AP1_RGB2Y      = (0.2722287168, 0.6740817658, 0.0536895174)
Rec709_Luma    = (0.2126729, 0.7151522, 0.0721750)
ACEScc_MIDGRAY = 0.4135884

ACES_to_ACEScc(x):  x ≤ 0        → -0.35828683
                    x < 2^-15    → (log2(2^-16 + x·0.5) + 9.72) / 17.52
                    それ以外      → (log2(x) + 9.72) / 17.52
ACEScc_to_ACES(y):  y < (9.72-15)/17.52          → (2^(y·17.52−9.72) − 2^-16) × 2
                    y < (log2(65504)+9.72)/17.52 → 2^(y·17.52−9.72)
                    それ以外                      → 65504

LogC (非ACES時のコントラスト用, Alexa LogC El1000):
  a=5.555556, b=0.047996, c=0.244161, d=0.386036
  LinearToLogC(x) = c·log10(max(a·x + b, 0)) + d
  LogCToLinear(y) = (10^((y−d)/c) − b) / a

RRT 定数: GLOW_GAIN=0.05, GLOW_MID=0.08, RED_SCALE=0.82, RED_PIVOT=0.03,
          RED_HUE=0, RED_WIDTH=135, RRT_SAT_FACTOR=0.96, ODT_SAT_FACTOR=0.93,
          DIM_SURROUND_GAMMA=0.9811

rgb_2_saturation(rgb) = (max(M,1e-4) − max(m,1e-4)) / max(M, 1e-2)   (M=最大, m=最小)
rgb_2_yc(rgb)         = (r+g+b + 1.75·sqrt(b(b−g)+g(g−r)+r(r−b))) / 3
sigmoid_shaper(x)     = (1 + sign(x)·(1 − t²)) / 2,  t = max(1 − |x/2|, 0)
glow_fwd(yc, g, mid)  = yc ≤ (2/3)mid → g,  yc ≥ 2mid → 0,  他 → g·(mid/yc − 1/2)
rgb_2_hue(rgb)        = 全成分同値 → 0, 他 → atan2(√3(g−b), 2r−g−b) を度に変換し [0,360) へ
center_hue(h, c)      = h−c を (−180, 180] に折返し
```

## 既知の制約

- 理論モデルはテクスチャ色が 1:1 で画面に出る前提（アンリット相当）。ライティング・
  シェーディングの影響は理論では扱わず、残差補正と反復ワークフローで吸収する
- スポイトは静止画キャプチャ方式（リアルタイム画面追従ではない）
- URP の LUT 解像度 (32³) による量子化誤差はモデル化していない（残差補正で吸収）
- Tonemapping mode の override 無効時に m_Value を採用する仕様のため、実際の Unity
  シーンで別 Volume が優先される構成では理論値がずれる可能性がある（警告と残差補正で運用）
