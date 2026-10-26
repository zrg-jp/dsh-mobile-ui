# dsh-mobile-ui 仕様

対象: `lib/client.js`（2026-10-26 時点）、`@deepseek-ai/dsh-web-app` 0.2.0-rc.2（web プロファイル）。
本書は現在の仕様の正本である。決定の経緯は [ADR](adr/README.md) にあり、本書には書き写さない。
実装と ADR から確認した内容だけを載せる。未確定の挙動は「未確定」と明記し、[§9](#9-未確定事項確認質問) に確認質問として挙げる。

## 1. スコープ

DSH Web GUI をスマホ・タブレットで使うためのローカル client プラグイン。DSH 本体のコードは変更しない。
次の系統の介入を行う。

| 系統 | 有効条件 | 節 |
|---|---|---|
| ドロワー化レイアウト・FAB・バックドロップ・Escape | `PHONE`（§2） | §4 |
| スワイプジェスチャ | `COARSE`（§2）。動作ごとに `PHONE` も要る | §5 |
| 右パネルのターミナルのタップ・縦ドラッグ | `COARSE` | §5.3 |
| キーボード追従・入力 16px | `COARSE` | §6 |
| viewport meta の書換 | 常時（幅・ポインタで分けない） | §6 |
| セーフエリア padding・実測 | 幅 ≤1023px かつ `display-mode` が standalone / fullscreen（`SAFE_AREA`） | §6 |

## 2. 用語と判定条件

| 名前 | 定義 | 根拠 |
|---|---|---|
| `PHONE` | `(max-width:767px)` | [client.js:11-13](../lib/client.js#L11-L13) |
| `COARSE` | `(max-width:1023px) and (pointer:coarse)` | [client.js:15](../lib/client.js#L15) |
| `SAFE_AREA` | `(max-width:1023px) and (display-mode:standalone)` または `(max-width:1023px) and (display-mode:fullscreen)` | [client.js:17](../lib/client.js#L17) |
| frame | `[data-rightbar-col]` 要素の親（DSH AppFrame の grid 要素） | [client.js:269](../lib/client.js#L269) |
| sidebarCol | frame の先頭の子要素 | [client.js:90](../lib/client.js#L90)、[client.js:335](../lib/client.js#L335) |
| 開／閉 | frame に `data-sidebar-collapsed` が無ければ開、あれば閉。frame が無ければ常に閉として扱う | [client.js:270-273](../lib/client.js#L270-L273) |
| 右パネル展開 | `ctx.sidebarRight.isExpanded()` が true | [client.js:715](../lib/client.js#L715) |
| オーバーレイ | `document.body` の子要素で、computed `position` が `fixed` のもの（DSH のメニュー・モーダル・トースト、本プラグインの FAB） | [client.js:286-320](../lib/client.js#L286-L320) |

768–1023px は DSH 本体の狭幅挙動（<1024px でレール化し、トグルでオーバーレイ展開）に任せ、本プラグインはレイアウトを変えない。

## 3. 依存する外部契約

本プラグインは、DSH の次の契約だけに依存する。ハッシュ化クラス名や内部ストアには依存しない（ADR-20261023-1720）。

| 契約 | 提供元（0.2.0-rc.2 で確認） | 用途 |
|---|---|---|
| `data-rightbar-col` 属性。親が frame であること | ui-layout `RightbarColumn` | frame の特定 |
| frame の子の順序が sidebarCol → centerCol → rightbarCol であること | ui-layout `AppFrame`（DocumentTitle は DOM を出さない） | sidebarCol の特定・grid 自動配置 |
| `data-sidebar-collapsed`（閉時のみ付く） | ui-layout `AppFrame` | 開閉状態の観測 |
| `data-side`（frame 直下の DragHandle） | ui-layout `DragHandle` | 非表示にする対象 |
| `data-lexical-editor` | チャット入力欄 | 16px 化の対象 |
| `ctx.layout.toggleSidebar()` | ui-layout `LayoutController`。<1024px では `narrowExpanded` を反転する | 開閉の唯一の操作経路 |
| `ctx.sidebarRight.isExpanded()` / `toggleExpanded()` | ui-sidebar-right。`isExpanded` は画面上のサーフェスが無ければ false | 右パネルを畳む |
| `--dsh-frame-leading-clearance`（frame から継承される CSS 変数） | ui-layout が darwin の閉時の frame に定め（160px / 84px）、ui-conversation の会話ヘッダ titleRow が `padding-inline-start: max(0px, calc(var(--dsh-frame-leading-clearance,0px) - 20px))` で参照する（conversation `lib/client.js` 15797） | 会話タイトルを FAB から離す（§4.4） |
| `data-sidebar-right-open`（展開時だけ付く）と、セッション切替で変わる `hidden` | ui-sidebar-right `SidebarPanel` / `SessionView` | 右パネル展開の再判定の契機（判定自体は `isExpanded()`。§4.4） |
| `section[data-sidebar-terminal]` | ui-sidebar-terminal（`client.terminal.js` 13288, 13334） | ターミナルの特定（§5.3） |
| xterm.js 6.0.0 の公開 DOM クラス `.xterm` / `.xterm-helper-textarea` / `.xterm-scrollable-element`、helper textarea の `readOnly`（`disableStdin`）、ピクセル単位の `wheel` でスクロールすること | ui-sidebar-terminal が同梱する xterm（ハッシュ化されないサードパーティのクラス。版の更新で変わりうる） | タップで focus、合成 wheel（§5.3） |
| `document.body` へ portal される固定オーバーレイ | ui-primitives `MenuSurface`、model-selection `ModelSelect`（`createPortal(..., document.body)`）、Modal、Toast（0.2.0-rc.2 で確認） | 座標系の補正対象（§6） |

不変条件 `SafeDegrade`（範囲限定）: `data-rightbar-col` が無くなって frame を特定できない場合、frame 用の CSS（ドロワー・バックドロップ・列）は一致しなくなる。JS 側は `body[data-dsh-mobile-sidebar=none]` となり、FAB は表示されない（[client.js:332](../lib/client.js#L332)）。
これは全面的な無介入への復帰ではない。次の介入は残る。
- `#root` の高さ、入力 16px、セーフエリア（実測を含む）、viewport meta（frame に依存しない）
- 右パネルの body 属性（`isExpanded()` から同期）とターミナルのタッチ（`[data-sidebar-terminal] .xterm` が無ければ何もしない）
- スワイプ: frame が無くても isOpen()=false なので、右スワイプで `toggleSidebar()` を呼びうる。frame 外起点を除外するガード（§5.1 `SwipeOnlyInsideFrame`）は、境界を決められないため掛けない

子の順序だけが変わった場合は CSS が一致し続け、別の先頭要素を fixed／inert にする。この場合は劣化ではなく誤作動になる。

DSH が `--dsh-frame-leading-clearance` の参照をやめた場合は、FAB がタイトルに重なる元の表示へ戻る。xterm がクラス名やスクロールの実装を変えた場合は、タップ・縦ドラッグが効かなくなる（xterm 6.1 以降で touch のスクロールが入ると二重にスクロールしうる）。

## 4. ドロワー（`PHONE` のとき）

### 4.1 レイアウト（CSS、[client.js:82-164](../lib/client.js#L82-L164)）
- frame の `grid-template-columns` を `minmax(0,1fr) 0px 0px !important` にする。DSH がインライン style で指定する値より優先される。
- sidebarCol を `position:fixed`、幅 `min(85vw,300px)`、`z-index:60` のドロワーにする。grid のフローから外れるため、centerCol が第 1 列に入る。
- 閉時は `translateX(-110%)` と `visibility:hidden` で画面外へ出す。transition は .25s。`prefers-reduced-motion:reduce` では開閉どちらの transition も無効にする（閉時のセレクタと同じ詳細度の規則を reduced-motion 側に置く。KI-3）。
- 開時は frame の `::after` を `z-index:59`、`rgba(0,0,0,.35)` の全面バックドロップとして表示する。
- frame 直下の `[data-side]`（列リサイズ用ハンドル）を非表示にする。

### 4.2 状態同期（[client.js:329-357](../lib/client.js#L329-L357)）
MutationObserver が文書全体の childList と `data-sidebar-collapsed` の変化を監視し、そのたびに次を同期する。`PHONE` の変化時にも同期する。

| 出力 | 値 |
|---|---|
| `body[data-dsh-mobile-sidebar]` | frame 無し → `none`、開 → `open`、閉 → `closed` |
| FAB の `aria-expanded` | 開なら `"true"` |
| sidebarCol の `inert` | `PHONE ∧ 閉` のときだけ true |

### 4.3 操作
すべての開閉は `ctx.layout.toggleSidebar()` を呼んで行う。プラグインは開閉状態を自分で持たない。

| 入力 | 条件 | 結果 | 根拠 |
|---|---|---|---|
| FAB の click | FAB は `PHONE ∧ body=closed` のときだけ表示される（右パネル展開中は除く。§4.4） | トグル（開く） | [client.js:114-137](../lib/client.js#L114-L137)、[client.js:372-378](../lib/client.js#L372-L378) |
| pointerdown（capture 段階） | `PHONE ∧ 開`、かつ target が sidebarCol 外・FAB 外・frame 内 | `preventDefault` と `stopPropagation` の後にトグル（閉じる） | [client.js:382-396](../lib/client.js#L382-L396) |
| keydown `Escape` | `PHONE ∧ 開`、かつ `defaultPrevented` でなく、`[aria-modal=true]` が文書に無い（KI-7） | トグル（閉じる）。閉じが frame に反映され、`body=closed`（FAB 表示）に同期した時点で `fab.focus()` を呼ぶ（KI-1） | [client.js:409-418](../lib/client.js#L409-L418)（`onKeyDown`）、[client.js:329-357](../lib/client.js#L329-L357)（`syncState`） |

不変条件 `EscapeRefocusesFab`: Escape で閉じたとき、FAB へのフォーカスは `body[data-dsh-mobile-sidebar=closed]` に更新した後に行う（`toggleSidebar()` は DSH のストアを更新するだけで、`data-sidebar-collapsed` は再描画で後から変わるため）。予約は Escape から 1 秒以内の最初の閉で消費する。Escape 以外の経路（FAB・バックドロップ・スワイプ）でトグルすると予約を取り消すので、その経路の閉ではフォーカスを動かさない。予約が有効な間（閉の反映待ち）の Escape は無視する（`isOpen()` が古い値を返し、再トグルで開に戻るのを防ぐ）。

不変条件 `EscapeYieldsToForeground`（KI-7）: 前面の UI が処理した Escape（`defaultPrevented`）と、`[aria-modal=true]` の要素が存在する間の Escape では、ドロワーを閉じない。DSH 0.2.0-rc.2 の Modal（ui-primitives `useModalLayer`）は document の bubble 段階で処理し、本プラグインより後に登録されるため、`defaultPrevented` だけでは防げない。

不変条件 `BackdropOnlyInsideFrame`: frame 外の target（`document.body` 直下へ portal される Modal やメニューなど）への pointerdown では、ドロワーを閉じない。

### 4.4 FAB とヘッダ・右パネル（issue #12、ADR-20261026-1800）
FAB は左上（`left = safe-left + 10px`、幅 36px。右端は `safe-left + 46px`）に固定され、閉時は中央カラムの先頭に重なる。

- 不変条件 `FabClearsHeader`: `PHONE ∧ 閉` の frame に `--dsh-frame-leading-clearance` を `calc(56px + env(safe-area-inset-left))` として与える（`SAFE_AREA` のときは `#root` が inset の padding を持つので `56px`）。
  会話ヘッダのタイトル行は header の左端からこの値の位置で始まる（§3 の契約）。開（ドロワー表示中）と `PHONE` 外では与えず、DSH の既定に任せる。
  darwin（デスクトップ）の DSH の規則とは幅で重ならない。
- `body[data-dsh-mobile-right]`: `ctx.sidebarRight.isExpanded()` が true なら `open`、それ以外（例外を含む）は `closed`。
  起動時と、文書内の childList・`data-sidebar-right-open`・`hidden` の変化のたびに同期し、dispose で消す（[client.js:424-452](../lib/client.js#L424-L452)）。
  DOM 属性は契機にだけ使い、背景セッションに残るパネルの属性では判定しない。
- 不変条件 `FabHiddenWhileRightPanel`: `PHONE ∧ body=closed ∧ body[data-dsh-mobile-right=open]` では FAB を表示しない（<768px の右パネルは 100vw の全画面で、タブ列・ファイル名の先頭を覆うため）。
  右パネルからサイドバーへは、DSH の閉じるボタンか左端からの右スワイプ（§5.2 行 5）で右パネルを畳んでから FAB を使う。
- 未確定: 全画面ルート（Plugins / Schedules など、`activePanelId !== null`）の見出しと FAB の重なりは扱っていない。

## 5. スワイプ（`COARSE` のとき）

document 上の passive な `touchstart` / `touchend` / `touchcancel` で判定する。`preventDefault` は呼ばないため、ネイティブのスクロールを妨げない（ADR-20261023-1750）。

### 5.1 候補の確定（touchstart、[client.js:662-691](../lib/client.js#L662-L691)）
- 候補になるのは、`COARSE` かつ単指で、ピンチズーム中（`|visualViewport.scale − 1| > 0.01`、§6）でなく、`textarea,input,[contenteditable=true]` の外から始まり、`SwipeOnlyInsideFrame` を満たすタッチだけ。
- 不変条件 `SwipeOnlyInsideFrame`（KI-5）: frame があるとき、起点が frame 外（`document.body` へ portal されたモーダル・メニュー・トーストなど）のタッチは候補にしない。
  pointerdown の `BackdropOnlyInsideFrame` と同じ境界にそろえる。例外は FAB（frame 外だが、本プラグインの開く操作の起点なので候補にする）。
  frame が無いとき（§3 SafeDegrade）はこのガードを掛けない。
- 開始時に、起点座標、`edge = x ≤ 28`、横スクロール祖先の有無、全祖先が左端にあるか（`scrollLeft ≤ 0`）を記録する。
  横スクロール祖先とは、`scrollWidth > clientWidth+1` かつ `overflow-x` が `auto` / `scroll` の祖先要素を指す（body は含まない）。
- `touchcancel` が来たら候補を破棄する。
- 不変条件 `DropSwipeOnViewportChange`（T345）: 候補の確定後、`PHONE` / `COARSE` の change、または幅が変わる `window` の `resize`（回転など）が来たら候補を破棄する。
  開始時の座標・`edge`・横スクロール祖先は変化前のレイアウトで測ったものだから。幅の変わらない `resize`（§6 で本プラグインがキーボードの出入りごとに再送するもの）では破棄しない。
  （Idea from kuraneko1/dsh-mobile-maxxing 24e2e49, MIT。実装は独自）

### 5.2 判定（touchend、[client.js:692-729](../lib/client.js#L692-L729)）
`dx`、`dy` は終了点と開始点の差で、途中の軌跡は見ない。上から順に評価し、最初に該当した行で決まる。

| # | 条件 | 結果 |
|---|---|---|
| 1 | 候補なし、または `changedTouches` が 1 本でない | 何もしない |
| 1a | 終了時にピンチズーム中 | 何もしない（ADR-20261026-1450） |
| 2 | 空でないテキスト選択がある | 何もしない |
| 3 | `|dx| < 60` または `|dx| < 2|dy|` | 何もしない |
| 4 | `dx > 0`、横スクロール祖先あり、かつ一部が左端にない | 何もしない |
| 5a | `dx > 0`、`PHONE ∧ 開` | 何もしない（ドロワーの背後は見えないため。ADR-20261024-0420） |
| 5 | `dx > 0`、右パネル展開中 | `edge` なら `toggleExpanded()`（チャットへ戻る）。`edge` でなければ何もしない |
| 6 | （欠番。旧「`x > innerWidth/2` なら何もしない」は ADR-20261026-1416 で廃止） | — |
| 7 | `dx > 0` | `PHONE ∧ 閉` ならトグル（開く）。それ以外は何もしない |
| 8 | `dx < 0`、横スクロール祖先あり | 何もしない |
| 9 | `dx < 0` | `PHONE ∧ 開` ならトグル（閉じる）。それ以外は何もしない |

名前付き不変条件（§8 のテストで検査する）:
- `OpenOnlyWhenClosedPhone`: サイドバーを開くのは `PHONE ∧ 閉` のときだけ。起点の x は問わない（ADR-20261026-1416）。
- `CollapseOnlyFromEdge`: 右パネルを畳むのは起点 `x ≤ 28` のときだけ。
- `RightPanelFirst`: 右パネル展開中の右スワイプは、サイドバーを開かない（表の行 5 で終わる。ADR-20261023-1750 の優先順位）。
- `DrawerShadowsRightPanel`: `PHONE` でドロワーが開いている間、右スワイプは右パネルを畳まない（行 5a。ADR-20261024-0420）。
- `NoSwipeWhileZoomed`: 開始時か終了時のどちらかでピンチズーム中なら、スワイプとして扱わない（拡大画面の単指パンは閲覧操作であり、visual viewport のパンは横スクロール祖先ガードで検出できないため。§5.1・行 1a。ADR-20261026-1450）。

帰結として、768–1023px の coarse 端末（iPad 縦など）で有効なスワイプは、右パネルを畳む操作（行 5）だけになる。1024px 以上から始めたタッチはスワイプにならない（[KI-4](known-issues.md)）。`COARSE` と `PHONE` を検査する時点は異なる。`COARSE` は touchstart 時に、`PHONE` は touchend 時に検査する。その間に `PHONE` / `COARSE` が変化したら候補を破棄する（§5.1 `DropSwipeOnViewportChange`）。

起点の要素は frame 内と FAB に限る（§5.1 `SwipeOnlyInsideFrame`。KI-5 で変更）。

### 5.3 右パネルのターミナル（T311 / T343、ADR-20261026-1800、[client.js:526-640](../lib/client.js#L526-L640)）
対象は `[data-sidebar-terminal] .xterm` 内から始まるタッチ。document の capture 段階の passive な `touchstart` / `touchend` / `touchcancel` で追跡する。
`touchmove` だけは、初めて触れた `.xterm` 要素に non-passive で付ける（文書全体のスクロールは妨げない。DOM から外れた要素からは次の touchstart（文書のどこでも）で外し、dispose で全部外す）。

- 追跡の開始: `COARSE` かつ単指で、ピンチズーム中でないこと。状態は `pending`（タップ候補）から始まる。
- `pending` で、移動が縦横とも 6px 以内なら何もしない。超えた最初の `touchmove` で、`|dy| ≤ |dx|`（横優位）なら追跡をやめ（§5 のスワイプ判定に任せる）、縦優位なら `scroll` へ移る。
  `scroll` へ移ったとき、§5 のスワイプ候補を捨てる（スクロールに使った操作は、終了時に曲がって横優位でもスワイプにしない）。
- 不変条件 `TerminalDragScrolls`: `scroll` の間の `touchmove` ごとに `preventDefault` し、前回からの縦の移動 Δy（±32px でクランプ）について、
  `deltaY = −Δy × 0.8`、`deltaMode = 0` の素の `Event("wheel")`（bubbles・cancelable）を `.xterm-scrollable-element`（無ければ `.xterm`）へ送る。
  0.8 は、xterm の `SmoothScrollableElement` がピクセル単位の deltaY を 40 で割って 50 倍する（1 wheel px = 1.25px）ため、指と表示の移動をそろえる値。
  2 本目の指が触れたとき、または途中でピンチズーム中になったときは追跡をやめる。
- 不変条件 `TerminalTapFocuses`: `pending` のまま終わり、単指で、開始から 500ms 以内、終了点が開始点から縦横 6px 以内、ズーム中でないタッチを「タップ」とし、
  その `touchend` の中で `textarea.xterm-helper-textarea` に `focus({preventScroll:true})` を同期的に呼ぶ。
  textarea が無い、`readOnly`（DSH が書込権限の無いときに付ける `disableStdin`）または `disabled` なら何もしない。
  すでにフォーカス済み（DSH の表示時 effect による focus で、キーボードが出ていない状態がありうる）なら、キーボード表示中（`visualViewport.height < innerHeight − 100`）は何もせず、それ以外は `blur()` してから focus し直す。
- 高さ合わせ（キーボード表示時）は追加しない。`#root` の追従（§6）で右パネルとターミナルのマウント要素が縮み、DSH の `ResizeObserver` → fit が走る前提（実機未確認。ADR-20261026-1800）。
- mouse tracking を使うアプリでは、xterm がこの wheel をアプリへの入力に変える（デスクトップのホイールと同じ扱い）。

## 6. viewport・キーボード・セーフエリア

- **viewport meta**（ADR-20261026-1450、[client.js:190-221](../lib/client.js#L190-L221)）: `meta[name=viewport]` があれば、content を項目単位でマージする。meta が無い場合は新規作成しない。この書換は幅にもポインタにも依存しない。
  - 管理項目は `width=device-width`、`initial-scale=1`、`viewport-fit=cover`、`interactive-widget=resizes-content` の 4 つ。
    content を `,` または `;`（混在可）で項目に分け（前後の空白と空の項目は捨てる）、key（`=` の前、大文字小文字を区別しない）で照合する。
    管理項目は最初の出現位置で置き換え、同じ key の 2 つ目以降は消す。無ければ末尾へ足す。それ以外の項目は表記と順序を保つ。区切りは `, ` で書き出す。
  - DSH 0.2.0-rc.2 の既定（`width=device-width, initial-scale=1`、`dsh-web-frontend` の `dist/index.html`）からは
    `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content` になる。
  - 不変条件 `PinchAllowed`: ズームを制限する項目（`maximum-scale` / `minimum-scale` / `user-scalable`）を足さない（KI-8）。ページ側に元からある場合は触らない。
  - dispose: content が本プラグインの書いた値のままなら、元の文字列をそのまま戻す（元に content 属性が無ければ属性を消す）。
    他者が書き換えていた場合は、その変更を保ち、本プラグインが書いた値のまま 1 つだけ残っている管理項目だけを元の値（元で重複していたら最後の値。元に無ければ削除）へ戻す。
    他者が値を変えた管理項目には触らない。
- **visualViewport 追従**（ADR-20261024-0450）: effect 登録直後に 1 回、その後は `visualViewport` の `resize`（キーボードの出入り）と `scroll`（パン）のたびに、`COARSE` なら次を設定する。
  - `--dsh-mobile-vvh` = `round(visualViewport.height)px`
  - `--dsh-mobile-vvtop` = `round(max(0, visualViewport.offsetTop))px`

  `COARSE` 下では `#root` を `position:fixed; left:0; right:0; top:var(--dsh-mobile-vvtop,0px); height:var(--dsh-mobile-vvh,100%)` とし、`html,body` を `overflow:hidden; overscroll-behavior:none` にする。
  変数が未設定の場合は、上端 0・高さ 100% にフォールバックする。ページ（window）はスクロールさせない。
  不変条件 `PinchFreezesRoot`（ADR-20261026-1450、KI-2）: `|visualViewport.scale − 1| > 0.01`（ピンチズーム中）の間は、変数の設定も下記の `resize` 再送も行わない（直前の値で据え置く。起動時に拡大中なら未設定のまま）。
  等倍へ戻った後の最初の `resize` / `scroll` で、その時点の値へ追従し直す（丸め値が変わっていれば再送する）。`scale` が数値でない実装は等倍として扱う。
  ズーム中にキーボードが出入りしても反映しない。等倍へ戻るまで `#root` は直前の高さ・上端のままになる。
  不変条件 `RootTracksVisualViewport`: `COARSE` かつ等倍の間に更新処理（起動時・resize・scroll）が走った直後は、`#root` が visual viewport の見えている範囲と（丸め誤差を除いて）重なる。遷移中、ピンチズーム中、KI-6 の経路では保証しない。
- **可視範囲の変化の通知**（ADR-20261024-1646）: `visualViewport` の `resize` / `scroll` で `--dsh-mobile-vvh` / `--dsh-mobile-vvtop` の**丸め値が変わったときだけ**、`window` へ `resize` を再送する（`COARSE` のみ。起動時の初期化では送らない）。
  body 直下のメニューは `window` の `scroll` / `resize` を再配置の契機にしているため（DSH 0.2.0-rc.2 の `ModelSelect.place()`）、キーボード表示後にトリガーが動いた分を置き直させる。
- **固定オーバーレイの座標補正**（ADR-20261024-1646）: `COARSE` のときに限り、`document.body` の子要素のうち computed `position` が `fixed` で、layout viewport 全体を覆わないものへ `data-dsh-mobile-overlay` を付ける（起動時・body の childList 変化時・`COARSE` の change 時。`COARSE` を外れたら外し、dispose でも外す）。`COARSE` のとき `[data-dsh-mobile-overlay]{translate:0 var(--dsh-mobile-vvtop,0px)}` を適用し、`#root` と同じ座標系へ寄せる。全画面レイヤ（`inset:0` の Modal 等）は対象外（キーボード時のずれは高さの問題で、平行移動では直らないため触らない）。
  位置プロパティ（`top` / `left`）は書き換えないため、DSH の配置計算（トリガーの rect と `offsetHeight`）には影響しない。対象は `#root` 以外。
  不変条件 `OverlaysShareRootFrame`: `COARSE` の間、オーバーレイは `#root` と同じ `offsetTop` の補正を受ける。offsetLeft（横方向）は補正しない。
  `COARSE` の change は監視しないため、条件を外れた間も変数は前の値のまま残る（[KI-6](known-issues.md)）。
- **入力 16px**（`COARSE`、[client.js:155](../lib/client.js#L155)）: checkbox / radio 以外の input、textarea、select、`[data-lexical-editor]`、`[contenteditable=true]` に `font-size:16px !important` を指定する。iOS のフォーカス時自動ズームを抑止する。meta でズームを制限しないため（`PinchAllowed`）、この規則が唯一の対策になる（ADR-20261026-1450）。
- **セーフエリア**（[client.js:157-163](../lib/client.js#L157-L163)）: `SAFE_AREA` のとき、`#root` の上下左右に `env(safe-area-inset-*)` の padding を付ける。ドロワーと FAB は個別に inset を考慮する。
- **セーフエリアの実測**（T347、ADR-20261026-1800、[client.js:454-524](../lib/client.js#L454-L524)）: `env(safe-area-inset-*)` を padding に持つ不可視の probe 要素（`[data-dsh-mobile-safe-probe]`、0 サイズの fixed、`aria-hidden`）を body 直下に 1 つ置き、
  `SAFE_AREA` のとき computed の padding を `html` の `--dsh-mobile-safe-{top,right,bottom,left}`（px）に出す。`SAFE_AREA` 外では変数と下記の属性を外す。
  起動時と、`window` の `resize` / `orientationchange`、`visualViewport` の `resize`、`SAFE_AREA` の change で測り直す。probe はオーバーレイ補正（KI-10）の対象外。dispose で probe・変数・属性を外す。
  - native gap の判定: 次をすべて満たすとき `html[data-dsh-mobile-native-gap]` を付ける。`navigator.standalone === true`、縦向き（`innerHeight ≥ innerWidth`）、
    キーボードが閉じている（`visualViewport.height ≥ innerHeight − 100`）、`max(screen.width, screen.height) − innerHeight > 8`、実測の下端 inset > 0。
  - 不変条件 `NativeGapOptIn`: 属性の値は、localStorage の `dsh-mobile-ui:native-gap` が `on` のときだけ `on`、それ以外は `detected`。
    `#root` の `padding-bottom` を 0 にする（`!important`）のは `html[data-dsh-mobile-native-gap=on]` のときだけで、既定では表示を変えない。
    帯の位置（上か下か）が資料間で食い違い、実機で未確認のため（ADR-20261026-1800）。localStorage が使えない環境では常に `detected`。

## 7. ライフサイクル

- すべての介入は 1 つの `ctx.effect` の中で登録する。dispose 時は登録と逆の順に撤去する（[client.js:759-761](../lib/client.js#L759-L761)）。撤去するのは、style タグ、meta の元値、CSS 変数、FAB、body 属性、inert、全リスナー、observer。
- `style[data-plugin-css="dsh-mobile-ui/override.css"]` が既にあれば、style タグを重ねて挿入しない。この場合、既存のタグは本 effect の撤去対象にならない。
- 撤去手段は、`cordis.patch.yml` の insert を削除することと、ページを再読込すること（README）。

## 8. 検証状況

- 実機: iPhone PWA で、レイアウト、ドロワー、キーボード、ズーム、スワイプ（ADR の検証欄）をユーザーが確認した。固定オーバーレイの座標補正（KI-10）も 2026-10-24 に確認した。iPad と Android は未確認。
  ピンチズームの許可と `PinchFreezesRoot`（ADR-20261026-1450、KI-2・KI-8）は実機未確認。
- モデル検査: §5.2 の判定表を写した純粋関数で、同値類と境界の直積 2160 件を全列挙した。対象は `x ∈ {0,28,29,195,196}`（幅 390）、`dx ∈ {±59,±60}`、`dy ∈ {0,30,31}` と各状態フラグ。不変条件 3 件に反例は無かった（行 5a の追加前のモデル）。これは手で抽象化したモデルに対する結果であり、コードの証明ではない。スクリプトは `tmp/spec-review/swipe-enum.mjs` にあり、コミットしない。
- 自動テスト: `npm test`（node:test + happy-dom、ADR-20261024-0410、50 件。`test/client.test.mjs` 34 件、`test/chrome.test.mjs` 16 件）。各テストは名前の `[§n]` で本書の節に対応する。
  happy-dom で検査できないもの: カスタムプロパティの継承と実際の重なり、`env()` の値（probe の computed をスタブにする）、`display-mode`（規則の文字列で検査）、ソフトキーボードの表示、xterm 本体のスクロール。
  CI は `.github/workflows/test.yml`。手順は [development.md](development.md)。
- 実機未確認（ADR-20261026-1800）: §4.4・§5.3・§6 のセーフエリア実測。iPhone PWA での確認項目:
  1. 閉時に会話タイトルが FAB の右から始まるか（縦・横向き）。右パネルを開くと FAB が消え、閉じるボタン・左端からの右スワイプで戻ると FAB が出るか。
  2. ターミナル（書込可能）をタップしてキーボードが出るか。読み取り専用ではキーボードが出ないか。縦ドラッグでスクロールバックが指に追従するか。横の右スワイプ（左端起点）で右パネルが畳まれるか。キーボード表示中に最下行が見えるか（見えなければ高さ合わせを追加する）。
  3. Safari の Web インスペクタで `html` の `--dsh-mobile-safe-*` と `data-dsh-mobile-native-gap` の値、`screen.height` / `innerHeight` を記録する。`detected` のとき、下端の余白が二重に見えるか。
     二重なら `localStorage.setItem("dsh-mobile-ui:native-gap","on")` で再読込し、余白が消えてホームインジケータに入力欄が重ならないかを見る。

## 9. 既知の問題・未確定事項

2026-10-24 のレビューで挙げた確認質問 Q1–Q9 は、オーナーの回答に従って次のように扱う。未解決のものは
[known-issues.md](known-issues.md) が正本で、本書の記述は修正されるまで現行の挙動を表す。

| 旧 ID | 扱い |
|---|---|
| Q1, Q3, Q6, Q8 | 既知の問題として記録した（KI-1〜KI-3, KI-7） |
| Q2 | 意図しない挙動だったため修正した（§5.2 行 5a、ADR-20261024-0420） |
| Q4 | 検討中（KI-4。iPad 実機で未確認） |
| Q5 | 実機では「ピンチによる拡大縮小がそもそも効かない」と報告された（KI-8）。対応済み・実機確認待ち（ADR-20261026-1450） |
| Q7 | 既知の問題（KI-5） |
| Q9 | 影響の評価を記録した（KI-6） |
