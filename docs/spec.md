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
| セッション行の 1 タップ化・切替時にドロワーを閉じる | `COARSE`（行の表示・dblclick）／`PHONE`（閉じる） | §4.4 |
| スワイプジェスチャ | `COARSE`（§2）。動作ごとに `PHONE` も要る | §5 |
| キーボード追従・入力 16px・入力欄の自動フォーカス抑止・Enter で改行 | `COARSE` | §6 |
| viewport meta の書換 | 常時（幅・ポインタで分けない） | §6 |
| セーフエリア padding | 幅 ≤1023px かつ `display-mode` が standalone / fullscreen | §6 |

## 2. 用語と判定条件

| 名前 | 定義 | 根拠 |
|---|---|---|
| `PHONE` | `(max-width:767px)` | [client.js:11-13](../lib/client.js#L11-L13) |
| `COARSE` | `(max-width:1023px) and (pointer:coarse)` | [client.js:15](../lib/client.js#L15) |
| frame | `[data-rightbar-col]` 要素の親（DSH AppFrame の grid 要素） | [client.js:344](../lib/client.js#L344) |
| sidebarCol | frame の先頭の子要素 | [client.js:88](../lib/client.js#L88)、[client.js:409](../lib/client.js#L409) |
| 開／閉 | frame に `data-sidebar-collapsed` が無ければ開、あれば閉。frame が無ければ常に閉として扱う | [client.js:345-348](../lib/client.js#L345-L348) |
| 右パネル展開 | `ctx.sidebarRight.isExpanded()` が true | [client.js:571](../lib/client.js#L571) |
| オーバーレイ | `document.body` の子要素で、computed `position` が `fixed` のもの（DSH のメニュー・モーダル・トースト、本プラグインの FAB） | [client.js:361-394](../lib/client.js#L361-L394) |

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
| `data-composer-input`（チャット入力欄の contenteditable）、`data-composer-card`（入力カード） | conversation `ComposerInput` / `InputBar`（同パッケージの `lib/client.js` 16563–16573 行、17444 行） | 自動フォーカス抑止の対象と「近辺」（§6.1）、Enter を改行にする対象（§6.2） |
| `data-composer-composing`（IME 変換中に入力欄へ付く）、Lexical が `beforeinput` の `insertLineBreak` で改行を挿入すること（`InputEvent` が `getTargetRanges` を持つ環境のみ登録） | conversation（同 `lib/client.js` 16660 行、5332–5339 行、5515–5516 行） | §6.2 |
| 入力補完の候補リストが `[role=listbox]` で、項目の強調中は `aria-activedescendant` を持つこと | ui-input-trigger `MenuView`（`lib/client.js` 1108–1110 行） | §6.2（候補の確定に Enter を譲る） |
| `ctx.layout.toggleSidebar()` | ui-layout `LayoutController`。<1024px では `narrowExpanded` を反転する | 開閉の唯一の操作経路 |
| `ctx.sidebarRight.isExpanded()` / `toggleExpanded()` | ui-sidebar-right。`isExpanded` は画面上のサーフェスが無ければ false | 右パネルを畳む |
| `[data-row-key^="session:"][role=treeitem]`（セッション行）と、その子の順序 slot → title → time? → pin（`role=img`）? → rowActions?（「…」ボタンを含む最後の子） | ui-workspace `SessionNodeItem`（同パッケージの `lib/client.js` 1571–1684 行）。time と rowActions は blank 行に無い | §4.4 の行 CSS と dblclick 抑止。**子の順序は構造依存（○）**で、ハッシュ化クラス名は使わない |
| `ctx.sessions.list`（`ObservableSnapshot<SessionListState>`：`getSnapshot()` / `subscribe()`）と、行の `retainedBy.mainView > 0` が表示中を表すこと | api-session-controller `ISessions`（`lib/types/client/contract/sessions.d.ts`）。ui-workspace も同じ判定をする | 表示中セッションの切替の検知（§4.4）。**任意依存** |
| `ctx.inject(names, callback)` | cordis 4.0.4 の registry（mixin で `ctx` に出る） | 任意依存のサービスを待つ |
| `document.body` へ portal される固定オーバーレイ | ui-primitives `MenuSurface`、model-selection `ModelSelect`（`createPortal(..., document.body)`）、Modal、Toast（0.2.0-rc.2 で確認） | 座標系の補正対象（§6） |

不変条件 `SafeDegrade`（範囲限定）: `data-rightbar-col` が無くなって frame を特定できない場合、frame 用の CSS（ドロワー・バックドロップ・列）は一致しなくなる。JS 側は `body[data-dsh-mobile-sidebar=none]` となり、FAB は表示されない（[client.js:406](../lib/client.js#L406)）。
これは全面的な無介入への復帰ではない。次の介入は残る。
- `#root` の高さ、入力 16px、セーフエリア、viewport meta（frame に依存しない）
- スワイプ: frame が無くても isOpen()=false なので、右スワイプで `toggleSidebar()` を呼びうる。frame 外起点を除外するガード（§5.1 `SwipeOnlyInsideFrame`）は、境界を決められないため掛けない

子の順序だけが変わった場合は CSS が一致し続け、別の先頭要素を fixed／inert にする。この場合は劣化ではなく誤作動になる。

セッション行の子の順序（§4.4）が変わった場合も同様に、別の子の `display` を固定しうる（誤作動）。属性 `data-row-key` / `role=treeitem` が無くなれば一致しなくなり、DSH 既定の hover 表示へ戻る（劣化）。

不変条件 `OptionalSessions`: `sessions` は必須の `inject`（`["layout","sidebarRight"]`）に入れない。cordis は必須依存が揃うまで `apply` を呼ばないため、入れると `ctx.sessions` が無い構成で本プラグイン全体が起動しなくなる。
`ctx.inject(["sessions"], …)` の子 fiber で待ち、提供されたときだけ §4.4 の切替検知を有効にする。`ctx.inject` が無い、または `list` の形が違う場合は切替検知だけを行わない。

## 4. ドロワー（`PHONE` のとき）

### 4.1 レイアウト（CSS、[client.js:80-160](../lib/client.js#L80-L160)）
- frame の `grid-template-columns` を `minmax(0,1fr) 0px 0px !important` にする。DSH がインライン style で指定する値より優先される。
- sidebarCol を `position:fixed`、幅 `min(85vw,300px)`、`z-index:60` のドロワーにする。grid のフローから外れるため、centerCol が第 1 列に入る。
- 閉時は `translateX(-110%)` と `visibility:hidden` で画面外へ出す。transition は .25s。`prefers-reduced-motion:reduce` では開閉どちらの transition も無効にする（閉時のセレクタと同じ詳細度の規則を reduced-motion 側に置く。KI-3）。
- 開時は frame の `::after` を `z-index:59`、`rgba(0,0,0,.35)` の全面バックドロップとして表示する。
- frame 直下の `[data-side]`（列リサイズ用ハンドル）を非表示にする。

### 4.2 状態同期（[client.js:403-431](../lib/client.js#L403-L431)）
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
| FAB の click | FAB は `PHONE ∧ body=closed` のときだけ表示される | トグル（開く） | [client.js:113-121](../lib/client.js#L113-L121)、[client.js:446-452](../lib/client.js#L446-L452) |
| pointerdown（capture 段階） | `PHONE ∧ 開`、かつ target が sidebarCol 外・FAB 外・frame 内 | `preventDefault` と `stopPropagation` の後にトグル（閉じる） | [client.js:456-470](../lib/client.js#L456-L470) |
| keydown `Escape` | `PHONE ∧ 開`、かつ `defaultPrevented` でなく、`[aria-modal=true]` が文書に無い（KI-7） | トグル（閉じる）。閉じが frame に反映され、`body=closed`（FAB 表示）に同期した時点で `fab.focus()` を呼ぶ（KI-1） | [client.js:483-492](../lib/client.js#L483-L492)（`onKeyDown`）、[client.js:403-431](../lib/client.js#L403-L431)（`syncState`） |

不変条件 `EscapeRefocusesFab`: Escape で閉じたとき、FAB へのフォーカスは `body[data-dsh-mobile-sidebar=closed]` に更新した後に行う（`toggleSidebar()` は DSH のストアを更新するだけで、`data-sidebar-collapsed` は再描画で後から変わるため）。予約は Escape から 1 秒以内の最初の閉で消費する。Escape 以外の経路（FAB・バックドロップ・スワイプ）でトグルすると予約を取り消すので、その経路の閉ではフォーカスを動かさない。予約が有効な間（閉の反映待ち）の Escape は無視する（`isOpen()` が古い値を返し、再トグルで開に戻るのを防ぐ）。

不変条件 `EscapeYieldsToForeground`（KI-7）: 前面の UI が処理した Escape（`defaultPrevented`）と、`[aria-modal=true]` の要素が存在する間の Escape では、ドロワーを閉じない。DSH 0.2.0-rc.2 の Modal（ui-primitives `useModalLayer`）は document の bubble 段階で処理し、本プラグインより後に登録されるため、`defaultPrevented` だけでは防げない。

不変条件 `BackdropOnlyInsideFrame`: frame 外の target（`document.body` 直下へ portal される Modal やメニューなど）への pointerdown では、ドロワーを閉じない。

### 4.4 セッション行（T309）
DSH 0.2.0-rc.2 の行 CSS は `:hover` で「…」（rowActions）を表示し、時刻とピンを隠す（`@media (hover:hover)` で囲まれていない）。iOS WebKit は、タップで合成した `:hover` で表示が変わるとその回の click を配送しないとされ、行を開くのに 2 タップ要る原因と推定している（実機未確認。ADR-20261026-1745）。

| 介入 | 条件 | 内容 | 根拠 |
|---|---|---|---|
| 行の表示固定（CSS） | `COARSE` | 行の最後の子でボタンを含むもの（rowActions）を `display:inline-flex !important`、3 番目以降で最後でも `role=img` でもない子（time）を `display:inline !important`、`role=img` の子（ピン）を `display:inline-flex !important` にする | [client.js:145-159](../lib/client.js#L145-L159) |
| dblclick の抑止 | `COARSE`、target がセッション行内 | document の capture 段階で `preventDefault` と `stopPropagation`。DSH のタイトル `onDoubleClick`（改名ダイアログ）に届かない。改名は「…」メニューから行う | [client.js:615-630](../lib/client.js#L615-L630) |
| 切替時にドロワーを閉じる | `ctx.sessions` があり、`PHONE ∧ 開` | `ctx.sessions.list` の通知ごとに、`retainedBy.mainView > 0` の id 集合を前回と比べ、前回に無かった id が現れたら `toggleSidebar()` を 1 回呼ぶ | [client.js:200-239](../lib/client.js#L200-L239)、[client.js:741-748](../lib/client.js#L741-L748) |

不変条件:
- `RowStableUnderHover`: `COARSE` では、セッション行の子の表示（「…」・時刻・ピン）が `:hover` の有無で変わらない。
- `NoRenameOnDoubleTap`: `COARSE` では、セッション行内の dblclick を DSH 本体へ届けない。fine pointer では従来どおり。
- `CloseOnSessionSwitch`: 表示中セッションが別の id に切り替わるたびに、`PHONE ∧ 開` ならドロワーを 1 回だけ閉じる。DSH の `replaceMain` は新参照を retain してから旧参照を release するので、一瞬 2 件が表示中になるが、新しい id が現れた通知でだけ反応する。閉じているとき、`PHONE` でないとき、表示中の集合に新しい id が無い通知（旧の release、一覧の他の更新）では何もしない。
  行のクリック以外の経路（新規作成・検索結果・fork 等）も同じく閉じる。
  `toggleSidebar()` の結果は再描画で後から DOM に反映されるため、閉を要求してから 1 秒間は、DOM が開のままでも再要求しない（反映前の連続切替で開き直さないため）。

## 5. スワイプ（`COARSE` のとき）

document 上の passive な `touchstart` / `touchend` / `touchcancel` で判定する。`preventDefault` は呼ばないため、ネイティブのスクロールを妨げない（ADR-20261023-1750）。

### 5.1 候補の確定（touchstart、[client.js:518-547](../lib/client.js#L518-L547)）
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

### 5.2 判定（touchend、[client.js:548-585](../lib/client.js#L548-L585)）
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

## 6. viewport・キーボード・セーフエリア

- **viewport meta**（ADR-20261026-1450、[client.js:265-296](../lib/client.js#L265-L296)）: `meta[name=viewport]` があれば、content を項目単位でマージする。meta が無い場合は新規作成しない。この書換は幅にもポインタにも依存しない。
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
- **入力 16px**（`COARSE`、[client.js:139](../lib/client.js#L139)）: checkbox / radio 以外の input、textarea、select、`[data-lexical-editor]`、`[contenteditable=true]` に `font-size:16px !important` を指定する。iOS のフォーカス時自動ズームを抑止する。meta でズームを制限しないため（`PinchAllowed`）、この規則が唯一の対策になる（ADR-20261026-1450）。
- **セーフエリア**（[client.js:141-144](../lib/client.js#L141-L144)）: 幅 ≤1023px で standalone / fullscreen 表示のとき、`#root` の上下左右に `env(safe-area-inset-*)` の padding を付ける。ドロワーと FAB は個別に inset を考慮する。

### 6.1 入力欄の自動フォーカス（`COARSE`、T310、ADR-20261026-1745）
DSH 0.2.0-rc.2 の InputBar は、セッションの切替・ロック解除・editor の生成のたびに入力欄へ `focus()` する（conversation `lib/client.js` 17309–17316 行）。
iOS はユーザー操作の処理中の `focus()` でソフトキーボードを出すため、セッション行のタップで開くとキーボードが出る（推定）。

- document の capture 段階で `pointerdown` / `touchstart` / `keydown` を記録する。`pointerdown` / `touchstart` は target が `[data-composer-card]` か `[data-composer-input]` の中なら「近辺の押下中」として時刻を記録し、それ以外なら記録を消す。近辺の押下の終了（`pointerup` / `pointercancel` / `touchend` / `touchcancel`）で時刻を記録し直す。`keydown` は場所を問わず記録する（外付けキーボード）。
- `focusin`（capture）の target が `[data-composer-input]` の中で、`[role=dialog],[role=menu],[role=listbox],[aria-modal=true]` の中になく、近辺の押下中でも記録から 1.5 秒以内でもなければ、次のタスク（`setTimeout 0`）で、まだその入力欄にフォーカスがあり、その間にも記録が無く、撤去されていないときに `blur()` する（[client.js:632-693](../lib/client.js#L632-L693)）。

不変条件:
- `UserTapKeepsFocus`: 入力欄・入力カード（送信などのボタンを含む）で始まった押下の間と、その開始・終了から 1.5 秒以内のフォーカスは外さない（長押しで遅れて来るフォーカスも含む）。記録は focus より前に capture で行われ、本プラグインは focus を遅らせないので、タップした回のキーボードは出る（iOS の挙動は実機未確認）。
- `NoProgrammaticComposerFocus`: それ以外の入力欄へのフォーカス（セッション切替による自動フォーカス）は、次のタスクで外す。同期の `blur` はしない（DSH / Lexical の再フォーカスと再帰しうるため）。fine pointer では何もしない。dispose 後は予約済みの `blur` も実行しない。
- 1.5 秒は推定値。入力欄をタップしてから 1.5 秒以上たって DSH が focus する経路（遅いロック解除など）では外れうる。

### 6.2 Enter で改行（`COARSE`、T344、ADR-20261026-1745）
DSH 0.2.0-rc.2 の composer は修飾なしの Enter で送信し、Shift+Enter を Lexical の改行に任せる（conversation `lib/client.js` 16704–16716 行）。iOS のソフトキーボードでは Shift+Enter を入力できない。

- document の capture 段階の `keydown` で、次をすべて満たすときに `preventDefault` と `stopPropagation` をし、入力欄へ `beforeinput`（`inputType: "insertLineBreak"`、bubbles・cancelable）を送る（[client.js:694-734](../lib/client.js#L694-L734)）。
  - `key === "Enter"`、`defaultPrevented` でない、Shift / Ctrl / Meta / Alt のいずれも押されていない
  - `isComposing` でも `keyCode === 229` でもなく、入力欄に `data-composer-composing` が無く、直前の `compositionend`（document の capture で記録）から 10ms を超えている（IME 変換中と確定直後。Safari は確定 Enter を `isComposing=false`・`keyCode=13` で送ることがあり、DSH 本体も同じ 10ms を変換の確定とみなす）
  - `COARSE`、`localStorage["dsh-mobile-ui:enterNewline"] !== "0"`（読めなければ有効）、`InputEvent` が `getTargetRanges` を持つ
  - target が `[data-composer-input]` の中で、`[role=dialog],[role=menu],[role=listbox],[aria-modal=true]` の中でない
  - 文書に `[role=listbox][aria-activedescendant]`（候補の強調中）が無い
- 送信は送信ボタンで行う。修飾キー付き（Shift+Enter の改行、Cmd/Ctrl+Enter）は DSH のまま。

不変条件:
- `EnterInsertsLineBreak`: 上の条件では、修飾なしの Enter で送信しない。改行の挿入は Lexical 自身が `beforeinput` を処理して行う（本プラグインは DOM を直接編集しない）。
- `EnterNewlineOptOut`: `localStorage["dsh-mobile-ui:enterNewline"] = "0"` で無効になる（次の keydown から反映）。切替 UI は未実装。
- §6 のキーボード追従（KI-9）とは独立する。改行は入力欄の高さを変えるだけで、visual viewport は動かさない（推定。実機未確認）。

## 7. ライフサイクル

- すべての介入は 1 つの `ctx.effect` の中で登録する。dispose 時は登録と逆の順に撤去する（[client.js:736-738](../lib/client.js#L736-L738)）。撤去するのは、style タグ、meta の元値、CSS 変数、FAB、body 属性、inert、全リスナー、observer。
- 例外: §4.4 の切替検知は `ctx.inject` の子 fiber の effect に置く（`OptionalSessions`）。親 fiber の停止、または `sessions` サービスの撤去で購読を外す。
- `style[data-plugin-css="dsh-mobile-ui/override.css"]` が既にあれば、style タグを重ねて挿入しない。この場合、既存のタグは本 effect の撤去対象にならない。
- 撤去手段は、`cordis.patch.yml` の insert を削除することと、ページを再読込すること（README）。

## 8. 検証状況

- 実機: iPhone PWA で、レイアウト、ドロワー、キーボード、ズーム、スワイプ（ADR の検証欄）をユーザーが確認した。固定オーバーレイの座標補正（KI-10）も 2026-10-24 に確認した。iPad と Android は未確認。
  ピンチズームの許可と `PinchFreezesRoot`（ADR-20261026-1450、KI-2・KI-8）は実機未確認。
  §4.4 のセッション行、§6.1 の自動フォーカス抑止、§6.2 の Enter で改行（ADR-20261026-1745）は実機未確認。happy-dom ではキーボードの表示を検査できず、`focus()` / `blur()` と `activeElement` で検査している。§6.2 は keydown の抑止と `beforeinput` の送出までを検査し、Lexical が実際に改行を挿入するかは検査できない（happy-dom の `InputEvent` は `getTargetRanges` を持たないため、テストで補っている）。happy-dom は `(pointer:coarse)` と `:has()` を組み合わせた規則・`:hover`・iOS の click 抑止を再現できないため、CSS は文字列と、media を外した規則の当たり方で検査している。
- モデル検査: §5.2 の判定表を写した純粋関数で、同値類と境界の直積 2160 件を全列挙した。対象は `x ∈ {0,28,29,195,196}`（幅 390）、`dx ∈ {±59,±60}`、`dy ∈ {0,30,31}` と各状態フラグ。不変条件 3 件に反例は無かった（行 5a の追加前のモデル）。これは手で抽象化したモデルに対する結果であり、コードの証明ではない。スクリプトは `tmp/spec-review/swipe-enum.mjs` にあり、コミットしない。
- 自動テスト: `npm test`（node:test + happy-dom、ADR-20261024-0410、44 件）。各テストは名前の `[§n]` で本書の節に対応する。
  CI は `.github/workflows/test.yml`。手順は [development.md](development.md)。

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
