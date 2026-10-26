# dsh-mobile-ui 仕様

対象: `lib/client.js`（2026-10-24 時点）、`@deepseek-ai/dsh-web-app` 0.2.0-rc.2（web プロファイル）。
本書は現在の仕様の正本である。決定の経緯は [ADR](adr/README.md) にあり、本書には書き写さない。
実装と ADR から確認した内容だけを載せる。未確定の挙動は「未確定」と明記し、[§9](#9-未確定事項確認質問) に確認質問として挙げる。

## 1. スコープ

DSH Web GUI をスマホ・タブレットで使うためのローカル client プラグイン。DSH 本体のコードは変更しない。
次の 4 系統の介入を行う。

| 系統 | 有効条件 | 節 |
|---|---|---|
| ドロワー化レイアウト・FAB・バックドロップ・Escape | `PHONE`（§2） | §4 |
| スワイプジェスチャ | `COARSE`（§2）。動作ごとに `PHONE` も要る | §5 |
| キーボード追従・入力 16px | `COARSE` | §6 |
| viewport meta の書換 | 常時（幅・ポインタで分けない） | §6 |
| セーフエリア padding | 幅 ≤1023px かつ `display-mode` が standalone / fullscreen | §6 |

## 2. 用語と判定条件

| 名前 | 定義 | 根拠 |
|---|---|---|
| `PHONE` | `(max-width:767px)` | [client.js:11-13](../lib/client.js#L11-L13) |
| `COARSE` | `(max-width:1023px) and (pointer:coarse)` | [client.js:15](../lib/client.js#L15) |
| frame | `[data-rightbar-col]` 要素の親（DSH AppFrame の grid 要素） | [client.js:157](../lib/client.js#L157) |
| sidebarCol | frame の先頭の子要素 | [client.js:25](../lib/client.js#L25)、[client.js:215](../lib/client.js#L215) |
| 開／閉 | frame に `data-sidebar-collapsed` が無ければ開、あれば閉。frame が無ければ常に閉として扱う | [client.js:158-161](../lib/client.js#L158-L161) |
| 右パネル展開 | `ctx.sidebarRight.isExpanded()` が true | [client.js:345](../lib/client.js#L345) |
| オーバーレイ | `document.body` の子要素で、computed `position` が `fixed` のもの（DSH のメニュー・モーダル・トースト、本プラグインの FAB） | [client.js:174-205](../lib/client.js#L174-L205) |

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
| `document.body` へ portal される固定オーバーレイ | ui-primitives `MenuSurface`、model-selection `ModelSelect`（`createPortal(..., document.body)`）、Modal、Toast（0.2.0-rc.2 で確認） | 座標系の補正対象（§6） |

不変条件 `SafeDegrade`（範囲限定）: `data-rightbar-col` が無くなって frame を特定できない場合、frame 用の CSS（ドロワー・バックドロップ・列）は一致しなくなる。JS 側は `body[data-dsh-mobile-sidebar=none]` となり、FAB は表示されない（[client.js:212](../lib/client.js#L212)）。
これは全面的な無介入への復帰ではない。次の介入は残る。
- `#root` の高さ、入力 16px、セーフエリア、viewport meta（frame に依存しない）
- スワイプ: frame が無くても isOpen()=false なので、右スワイプで `toggleSidebar()` を呼びうる。frame 外起点を除外するガード（§5.1 `SwipeOnlyInsideFrame`）は、境界を決められないため掛けない

子の順序だけが変わった場合は CSS が一致し続け、別の先頭要素を fixed／inert にする。この場合は劣化ではなく誤作動になる。

## 4. ドロワー（`PHONE` のとき）

### 4.1 レイアウト（CSS、[client.js:17-79](../lib/client.js#L17-L79)）
- frame の `grid-template-columns` を `minmax(0,1fr) 0px 0px !important` にする。DSH がインライン style で指定する値より優先される。
- sidebarCol を `position:fixed`、幅 `min(85vw,300px)`、`z-index:60` のドロワーにする。grid のフローから外れるため、centerCol が第 1 列に入る。
- 閉時は `translateX(-110%)` と `visibility:hidden` で画面外へ出す。transition は .25s。`prefers-reduced-motion:reduce` では開閉どちらの transition も無効にする（閉時のセレクタと同じ詳細度の規則を reduced-motion 側に置く。KI-3）。
- 開時は frame の `::after` を `z-index:59`、`rgba(0,0,0,.35)` の全面バックドロップとして表示する。
- frame 直下の `[data-side]`（列リサイズ用ハンドル）を非表示にする。

### 4.2 状態同期（[client.js:209-232](../lib/client.js#L209-L232)）
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
| FAB の click | FAB は `PHONE ∧ body=closed` のときだけ表示される | トグル（開く） | [client.js:47-55](../lib/client.js#L47-L55)、[client.js:245-249](../lib/client.js#L245-L249) |
| pointerdown（capture 段階） | `PHONE ∧ 開`、かつ target が sidebarCol 外・FAB 外・frame 内 | `preventDefault` と `stopPropagation` の後にトグル（閉じる） | [client.js:254-268](../lib/client.js#L254-L268) |
| keydown `Escape` | `PHONE ∧ 開`、かつ `defaultPrevented` でなく、`[aria-modal=true]` が文書に無い（KI-7） | トグル（閉じる）。閉じが frame に反映され、`body=closed`（FAB 表示）に同期した時点で `fab.focus()` を呼ぶ（KI-1） | client.js の `onKeyDown` / `syncState` |

不変条件 `EscapeRefocusesFab`: Escape で閉じたとき、FAB へのフォーカスは `body[data-dsh-mobile-sidebar=closed]` に更新した後に行う（`toggleSidebar()` は DSH のストアを更新するだけで、`data-sidebar-collapsed` は再描画で後から変わるため）。予約は Escape から 1 秒以内の最初の閉で消費し、それ以外の経路の閉ではフォーカスを動かさない。

不変条件 `EscapeYieldsToForeground`（KI-7）: 前面の UI が処理した Escape（`defaultPrevented`）と、`[aria-modal=true]` の要素が存在する間の Escape では、ドロワーを閉じない。DSH 0.2.0-rc.2 の Modal（ui-primitives `useModalLayer`）は document の bubble 段階で処理し、本プラグインより後に登録されるため、`defaultPrevented` だけでは防げない。

不変条件 `BackdropOnlyInsideFrame`: frame 外の target（`document.body` 直下へ portal される Modal やメニューなど）への pointerdown では、ドロワーを閉じない。

## 5. スワイプ（`COARSE` のとき）

document 上の passive な `touchstart` / `touchend` / `touchcancel` で判定する。`preventDefault` は呼ばないため、ネイティブのスクロールを妨げない（ADR-20261023-1750）。

### 5.1 候補の確定（touchstart、[client.js:305-323](../lib/client.js#L305-L323)）
- 候補になるのは、`COARSE` かつ単指で、`textarea,input,[contenteditable=true]` の外から始まったタッチだけ。
- 不変条件 `SwipeOnlyInsideFrame`（KI-5）: frame があるとき、起点が frame 外（`document.body` へ portal されたモーダル・メニュー・トーストなど）のタッチは候補にしない。
  pointerdown の `BackdropOnlyInsideFrame` と同じ境界にそろえる。例外は FAB（frame 外だが、本プラグインの開く操作の起点なので候補にする）。
  frame が無いとき（§3 SafeDegrade）はこのガードを掛けない。
- 開始時に、起点座標、`edge = x ≤ 28`、横スクロール祖先の有無、全祖先が左端にあるか（`scrollLeft ≤ 0`）を記録する。
  横スクロール祖先とは、`scrollWidth > clientWidth+1` かつ `overflow-x` が `auto` / `scroll` の祖先要素を指す（body は含まない）。
- `touchcancel` が来たら候補を破棄する。

### 5.2 判定（touchend、[client.js:324-359](../lib/client.js#L324-L359)）
`dx`、`dy` は終了点と開始点の差で、途中の軌跡は見ない。上から順に評価し、最初に該当した行で決まる。

| # | 条件 | 結果 |
|---|---|---|
| 1 | 候補なし、または `changedTouches` が 1 本でない | 何もしない |
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

帰結として、768–1023px の coarse 端末（iPad 縦など）で有効なスワイプは、右パネルを畳む操作（行 5）だけになる。1024px 以上から始めたタッチはスワイプにならない（[KI-4](known-issues.md)）。`COARSE` と `PHONE` を検査する時点は異なる。`COARSE` は touchstart 時だけ、`PHONE` は touchend 時に検査する。

起点の要素は frame 内と FAB に限る（§5.1 `SwipeOnlyInsideFrame`。KI-5 で変更）。

## 6. viewport・キーボード・セーフエリア

- **viewport meta**（[client.js:106-114](../lib/client.js#L106-L114)）: `meta[name=viewport]` があれば、content を `width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content` に置き換える。元の値は dispose 時に戻す。meta が無い場合は新規作成しない。この書換は幅にもポインタにも依存しない。
- **visualViewport 追従**（ADR-20261024-0450）: effect 登録直後に 1 回、その後は `visualViewport` の `resize`（キーボードの出入り）と `scroll`（パン）のたびに、`COARSE` なら次を設定する。
  - `--dsh-mobile-vvh` = `round(visualViewport.height)px`
  - `--dsh-mobile-vvtop` = `round(max(0, visualViewport.offsetTop))px`

  `COARSE` 下では `#root` を `position:fixed; left:0; right:0; top:var(--dsh-mobile-vvtop,0px); height:var(--dsh-mobile-vvh,100%)` とし、`html,body` を `overflow:hidden; overscroll-behavior:none` にする。
  変数が未設定の場合は、上端 0・高さ 100% にフォールバックする。ページ（window）はスクロールさせない。
  不変条件 `RootTracksVisualViewport`: `COARSE` の間に更新処理（起動時・resize・scroll）が走った直後は、`#root` が visual viewport の見えている範囲と（丸め誤差を除いて）重なる。遷移中や、KI-6 の経路では保証しない。
- **可視範囲の変化の通知**（ADR-20261024-1646）: `visualViewport` の `resize` / `scroll` で `--dsh-mobile-vvh` / `--dsh-mobile-vvtop` の**丸め値が変わったときだけ**、`window` へ `resize` を再送する（`COARSE` のみ。起動時の初期化では送らない）。
  body 直下のメニューは `window` の `scroll` / `resize` を再配置の契機にしているため（DSH 0.2.0-rc.2 の `ModelSelect.place()`）、キーボード表示後にトリガーが動いた分を置き直させる。
- **固定オーバーレイの座標補正**（ADR-20261024-1646）: `COARSE` のときに限り、`document.body` の子要素のうち computed `position` が `fixed` で、layout viewport 全体を覆わないものへ `data-dsh-mobile-overlay` を付ける（起動時・body の childList 変化時・`COARSE` の change 時。`COARSE` を外れたら外し、dispose でも外す）。`COARSE` のとき `[data-dsh-mobile-overlay]{translate:0 var(--dsh-mobile-vvtop,0px)}` を適用し、`#root` と同じ座標系へ寄せる。全画面レイヤ（`inset:0` の Modal 等）は対象外（キーボード時のずれは高さの問題で、平行移動では直らないため触らない）。
  位置プロパティ（`top` / `left`）は書き換えないため、DSH の配置計算（トリガーの rect と `offsetHeight`）には影響しない。対象は `#root` 以外。
  不変条件 `OverlaysShareRootFrame`: `COARSE` の間、オーバーレイは `#root` と同じ `offsetTop` の補正を受ける。offsetLeft（横方向）は補正しない。
  `COARSE` の change は監視しないため、条件を外れた間も変数は前の値のまま残る（[KI-6](known-issues.md)）。
- **入力 16px**（`COARSE`、[client.js:73](../lib/client.js#L73)）: checkbox / radio 以外の input、textarea、select、`[data-lexical-editor]`、`[contenteditable=true]` に `font-size:16px !important` を指定する。iOS のフォーカス時自動ズームを抑止するためで、meta の `maximum-scale=1` との二重の対策になる。
- **セーフエリア**（[client.js:75-78](../lib/client.js#L75-L78)）: 幅 ≤1023px で standalone / fullscreen 表示のとき、`#root` の上下左右に `env(safe-area-inset-*)` の padding を付ける。ドロワーと FAB は個別に inset を考慮する。

## 7. ライフサイクル

- すべての介入は 1 つの `ctx.effect` の中で登録する。dispose 時は登録と逆の順に撤去する（[client.js:372-374](../lib/client.js#L372-L374)）。撤去するのは、style タグ、meta の元値、CSS 変数、FAB、body 属性、inert、全リスナー、observer。
- `style[data-plugin-css="dsh-mobile-ui/override.css"]` が既にあれば、style タグを重ねて挿入しない。この場合、既存のタグは本 effect の撤去対象にならない。
- 撤去手段は、`cordis.patch.yml` の insert を削除することと、ページを再読込すること（README）。

## 8. 検証状況

- 実機: iPhone PWA で、レイアウト、ドロワー、キーボード、ズーム、スワイプ（ADR の検証欄）をユーザーが確認した。固定オーバーレイの座標補正（KI-10）も 2026-10-24 に確認した。iPad と Android は未確認。
- モデル検査: §5.2 の判定表を写した純粋関数で、同値類と境界の直積 2160 件を全列挙した。対象は `x ∈ {0,28,29,195,196}`（幅 390）、`dx ∈ {±59,±60}`、`dy ∈ {0,30,31}` と各状態フラグ。不変条件 3 件に反例は無かった（行 5a の追加前のモデル）。これは手で抽象化したモデルに対する結果であり、コードの証明ではない。スクリプトは `tmp/spec-review/swipe-enum.mjs` にあり、コミットしない。
- 自動テスト: `npm test`（node:test + happy-dom、ADR-20261024-0410、24 件）。各テストは名前の `[§n]` で本書の節に対応する。
  CI は `.github/workflows/test.yml`。手順は [development.md](development.md)。

## 9. 既知の問題・未確定事項

2026-10-24 のレビューで挙げた確認質問 Q1–Q9 は、オーナーの回答に従って次のように扱う。未解決のものは
[known-issues.md](known-issues.md) が正本で、本書の記述は修正されるまで現行の挙動を表す。

| 旧 ID | 扱い |
|---|---|
| Q1, Q3, Q6, Q8 | 既知の問題として記録した（KI-1〜KI-3, KI-7） |
| Q2 | 意図しない挙動だったため修正した（§5.2 行 5a、ADR-20261024-0420） |
| Q4 | 検討中（KI-4。iPad 実機で未確認） |
| Q5 | 実機では「ピンチによる拡大縮小がそもそも効かない」と報告された（KI-8） |
| Q7 | 既知の問題（KI-5） |
| Q9 | 影響の評価を記録した（KI-6） |
