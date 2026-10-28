# FAB とヘッダの重なり・セーフエリアの実測・右パネルのターミナル操作

- Status: proposed
- Date: 2026-10-26
- Task: issue #12 / T320（FAB がヘッダを隠す）、T347（セーフエリアの実測）、T311 / T343（ターミナルに入力・スクロールできない）

## Context

1. スマホ幅（`PHONE`）の閉時、左上の FAB（右端 = `safe-left + 46px`）が会話ヘッダのセッション名と、右パネル（<768px で全画面）のタブ列・ファイル名の先頭を隠す（issue #12）。
2. iOS 26 系のホーム画面アプリでは、WebView が画面より短く、その差の帯をシステムが描くと報告されている（WebKit Bug 301994、後述）。帯にホームインジケータがあると、`#root` の `padding-bottom: env(safe-area-inset-bottom)` は余白を二重にしうる。JS からは `env()` を直接読めない。
3. 右パネルのターミナル（`dsh-client-ui-sidebar-terminal`、xterm.js 6.0.0 同梱）は、スマホから入力もスクロールもできない（T311 / T343）。DSH の `focus()` は effect から呼ばれ、ユーザー操作の処理中ではない。xterm 6.0 にはタッチでスクロールする経路が無い。

DSH の挙動は `@deepseek-ai/*` 0.2.0-rc.2 の配布物で確認した（行番号は事前調査 `tmp/wave2-investigation.md` と本 ADR の「出典」）。

## 決定点

1. 会話ヘッダの重なりの避け方。
2. 右パネル全画面時の FAB。
3. セーフエリア下端の native gap の扱い。
4. ターミナルのタップでキーボードを出す方法。
5. ターミナルのスクロール。
6. キーボード表示時のターミナルの高さ合わせ。

## 選択肢

1. 会話ヘッダ
   - 1a. DSH 自身の変数 `--dsh-frame-leading-clearance` を `PHONE` かつ閉の frame に与える（`56px + env(safe-area-inset-left)`。PWA では `#root` が inset の padding を持つので `56px`）。
   - 1b. `header[data-window-drag]` に `padding-left` を足す（上流 dsh-mobile-maxxing の方式）。
   - 1c. FAB を小さくする・下へ動かす。
2. 右パネル全画面時の FAB
   - 2a. 右パネル展開中は FAB を隠す。判定は公開サービス `ctx.sidebarRight.isExpanded()` で、DOM の変化（`data-sidebar-right-open` / `hidden` / 要素の出入り）を契機に body 属性へ同期する。
   - 2b. 右パネルのタブ列（dockkit の `[data-dockkit-strip]`）に padding を足す。
   - 2c. 何もしない。
3. native gap
   - 3a. probe 要素で inset を実測し、条件を満たしたら `#root` の `padding-bottom` を 0 にする（上流と同じ。既定で有効）。
   - 3b. 実測と判定までは行い、padding を消すのはフラグ（localStorage `dsh-mobile-ui:native-gap=on`）で有効にしたときだけにする。既定では観測用の属性 `data-dsh-mobile-native-gap=detected` だけを付ける。
   - 3c. 何もしない。
4. タップでキーボード
   - 4a. `[data-sidebar-terminal] .xterm` 内のタップ（単指・移動 6px 以内・500ms 以内）の `touchend` で、`textarea.xterm-helper-textarea` を同期的に `focus()` する。readOnly / disabled なら何もしない。
   - 4b. `click` の capture で focus する（上流の方式）。
5. スクロール
   - 5a. 縦優位の単指ドラッグを素の `Event("wheel")`（`deltaY = −Δy × 0.8`、Δy は 1 イベント ±32px でクランプ）に変え、`.xterm-scrollable-element` へ送る。`touchmove` は `.xterm` 要素だけに non-passive で付け、スクロール中だけ `preventDefault` する。
   - 5b. CSS（`touch-action` / `overflow`）で解く。
6. 高さ合わせ
   - 6a. 追加しない（`#root` の visual viewport 追従で足りるとみなす）。
   - 6b. 上流と同じく、ターミナルのマウント要素の高さを visual viewport に合わせる。

## 評価基準

- spec §3 の方針（ハッシュ化クラス名と内部ストアに依存しない）を守る。壊れたときは介入前の表示へ劣化する（安全側）。
- 効果の根拠が推測に強く依存する介入は、既定で表示を変えない。
- 既存のスワイプ判定（§5）、ピンチズームのガード（KI-2）、ネイティブのスクロールと干渉しない。
- happy-dom の自動テストで分岐を検査でき、検査できない部分は実機の確認手順を示せる。

## 決定

1a、2a、3b、4a、5a、6a。

## 理由（考察。比較実験は iPhone 実機が要り、本 ADR の作成時点では未実施）

- 1a: 変数は DSH 自身が「frame の先頭にある席を避ける」ために使っている（darwin の信号機ボタン）。会話ヘッダの titleRow は
  `padding-inline-start: max(0px, calc(var(--dsh-frame-leading-clearance,0px) - 20px))` で参照し、header の左 padding 20px と合わせて
  タイトルは header の左端から変数の値の位置で始まる。FAB の右端 46px に 10px の間隔を足して 56px にした。
  ハッシュ化クラス名に触れず、DSH が変数をやめれば効かなくなるだけ（重なる元の状態へ戻る）。
  1b は `data-window-drag` が sidebar の logoRow などにも付くため要素型に依存し、DSH の padding と二重になる。1c は 44px 近いタップ領域を削る。
- 2a: <768px の右パネルは 100vw でヘッダごと覆うため（`RightbarSeat` の `autoFullscreen = viewportWidth < 768`）、タブ列・プレビュー内の
  ファイル名など覆われる箇所が多い。2b はタブ列しか直らず、dockkit の内部 CSS 変数（`--dsh-dockkit-strip-inline-start`）は契約外。
  FAB を隠すとサイドバーへ直接は行けなくなるが、右パネルは DSH の閉じるボタン（`[data-sidebar-right-toggle]`）と左端からの右スワイプ（§5.2 行 5）で
  畳めるので、1 操作増えるだけで行き止まりにはならない。判定に DOM 属性ではなく `isExpanded()` を使うのは、背景セッションの
  （`hidden` の中に残る）パネルにも `data-sidebar-right-open` が付きうるため。DOM の変化はきっかけとしてだけ使う。
- 3b: 判定条件は上流 dsh-mobile-maxxing 24e2e49（MIT）の `measureSafeArea` に着想を得た（コードは写していない）。条件はすべて満たすとき:
  `navigator.standalone === true`、縦向き、キーボードが閉じている（`visualViewport.height ≥ innerHeight − 100`）、
  `max(screen.width, screen.height) − innerHeight > 8`、probe で測った下端 inset > 0。
  上流から変えた点: 縦向きを条件に加えた（iOS の `screen` は回転しても縦の寸法を返すため、横向きで差を取ると常に条件を満たす）。下端 inset が 0 なら消す padding が無いので判定しない。
  既定オフにしたのは、効果が推測に強く依存するため。WebKit Bug 301994 の報告は「帯が上（ステータスバー）にある」もの（iOS 26.1、`safe-area-inset-top` が 0）と
  「画面との差 62px をシステムが描く」もの（iOS 26.5.2）で、帯が下にあるという上流の記述（ISSUES.md）とは位置が一致しない。
  帯が上なら下端の padding はホームインジケータを避けるために必要で、消すと入力欄がインジケータに重なる。
  実機で `detected` の状態と見た目（下端の余白が二重か）を確かめてから既定を決める。3c は計測の手がかりも残らない。
- 4a: iOS はユーザー操作の処理中に呼んだ `focus()` でだけソフトキーボードを出す（WebKit の挙動。一次資料は本 ADR で未確認）。
  `click` は、xterm 同梱の VS Code `Gesture` が `touchstart` を `preventDefault` すると合成されない可能性があり（`Gesture.addTarget` の呼出元は未特定）、4b はその場合に効かない。
  `touchend` は合成の有無に依らず届く。移動・時間の閾値は、スクロールや長押し（選択）でキーボードを出さないため。値（6px・500ms）は推定。
  readOnly は DSH が書込権限の無いとき（`disableStdin`）に付けるもので、focus しても入力できない。
  DSH は表示時に effect から focus するため、textarea はフォーカス済みでもキーボードが出ていないことがある。focus 済みの要素へ focus() を呼んでも何も起きないので、
  キーボードが出ていなければ（visualViewport の縮みで推定）blur してから focus し直す（独立レビューの指摘で追加。iOS がこれでキーボードを出すかは実機未確認）。
- 5a: xterm 6.0 の `.xterm-viewport` は空で、スクロール位置は JS の `SmoothScrollableElement` が持ち、入力は `wheel` だけ（配布物で確認）。5b の CSS で動かせる DOM のスクロール要素が無い。
  `SmoothScrollableElement` はピクセル単位の `deltaY` を 40 で割って 50 倍する（1 wheel px = 1.25px）ので、0.8 倍で指と表示の移動が一致する。
  素の `Event` にするのは、実ブラウザの `WheelEvent` は `wheelDeltaY` を持ち、xterm がそれを 120 単位で優先するため（速度がブラウザ依存になる）。
  考え方（係数・クランプ・素の Event）は上流 24e2e49 に着想を得た。コードは写していない。
  スクロールに使った操作は、終了時に横優位になってもスワイプにしない（swipe の候補を捨てる）。横優位で始まった操作は追わず、§5 のスワイプ判定に任せる。
  2 本目の指・ピンチズーム中（KI-2 と同じ scale ガード）は手を出さない。
  mouse tracking を使うアプリ（vim、less 等）や alternate buffer では、xterm がこの wheel をアプリへの入力（矢印キー等）に変える。デスクトップのホイールと同じ扱いで、意図どおりとみなす。
- 6a: 本プラグインは `COARSE` で `#root` を visual viewport の高さに追従させている（ADR-20261024-0450）。右パネルは `#root` の中にあるので、
  キーボードで `#root` が縮めばターミナルのマウント要素も縮み、DSH の `ResizeObserver` → `fitScreen` が走るはず（書込可能なときだけ）。
  上流の 6b は、`#root` を追従させない前提での対処と読める。重ねると DSH の fit と競合しうるので、実機で最下行が隠れると確認できてから足す。

## 出典

- WebKit Bugzilla「Bug 301994 – REGRESSION (iOS 26.1): Status bar remains visible in fullscreen mode in Home Screen Web apps」
  https://bugs.webkit.org/show_bug.cgi?id=301994 （2026-10-26 web_fetch で取得。状態 REOPENED、最終更新 2026-10-21）。
  comment 4（`env(safe-area-inset-top)` が 0 を返す）、comment 12（iOS 26.5.2、`screen.height` 874 と `innerHeight` 812、差 62px をシステムが描く）、comment 14（iOS 27 beta で再現）を参照した。
- 上流 kuraneko1/dsh-mobile-maxxing 24e2e49（MIT）`packages/dsh-mobile-maxxing/client.js` 2222–2282（`measureSafeArea`）、10944–10958（CSS）、7352–7441（合成 wheel）、7920–7927（focus）、
  `docs/ISSUES.md`（2026-10-22、帯が下にある旨）。参照のみでコードは写していない。
- DSH 0.2.0-rc.2 の配布物: ui-layout `lib/client.js` の CSS（`[data-platform=darwin] .frame[data-sidebar-collapsed]{--dsh-frame-leading-clearance:160px}` ほか）、
  ui-conversation `lib/client.js` 15797（titleRow の padding）・16364–16377（`ConversationHeader`）、
  ui-sidebar-right `lib/client.js` 5666–5728（`PanelChrome` / `SidebarPanel` / `RightbarSeat`）・6511（`isExpanded`）、
  ui-sidebar-terminal `lib/client.terminal.js` 274–276（`focus`）、319（readOnly）、8867–8895（wheel の処理）、13400–13475（マウント）。

## 独立レビュー

- codex / gpt-6.1-sol（workflow、閲覧のみ）。指摘 2 件を採用した: (high) フォーカス済みの textarea を除外するとキーボードを出せない → blur → focus に変更。
  (low) 外れたターミナル要素を dispose まで保持する → 毎回の touchstart で解放。

## 検証

- 自動テスト（`npm test`、50 件。うち本 ADR 分は `test/chrome.test.mjs` の 16 件）。
  変異 23 種（clearance の規則の削除・PWA 側の inset 二重化、FAB 非表示規則の削除、`isExpanded()` を DOM 属性の判定に差し替え、
  native gap の常時 on 化・キーボード条件・縦向き条件・境界 `>=`・下端 inset 条件の削除、probe のオーバーレイ除外の削除、
  ターミナルの readOnly ガード・終了点の閾値・クランプ・preventDefault・スワイプ候補の破棄・横優位の打切り・ズームガード・2 本指ガード・COARSE ガード・dispose の削除、focus 済み時の blur の削除・キーボード表示中の除外の削除・外れた要素の解放の削除）で、すべて赤になることを確認した。
- happy-dom で検査できないもの: カスタムプロパティの継承と実際の重なり、`env()` の値（probe の computed をスタブにした）、`display-mode`（CSS は規則の文字列で検査）、
  ソフトキーボードの表示、xterm 本体のスクロール。
- 実機: 未確認。iPhone PWA で確認してから accepted にする（手順は spec §8）。
