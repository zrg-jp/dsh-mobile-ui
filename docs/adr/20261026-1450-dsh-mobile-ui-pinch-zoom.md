# ピンチズームを許可し、ズーム中は visual viewport 追従を止める

- Status: proposed
- Date: 2026-10-26
- Task: T346（viewport meta のマージ）、issue #8 / KI-8、issue #2 / KI-2

## Context

iPhone PWA の実機で「ピンチによる拡大縮小が効かない」と報告された（KI-8、2026-10-24）。本プラグインは viewport meta の
content を全文置き換え、`maximum-scale=1` を付けていた。DSH 本体の viewport は `width=device-width, initial-scale=1` だけで
ズームを禁じていない（`@deepseek-ai/dsh-web-frontend` 0.2.0-rc.2 の `dist/index.html`）。
MDN は maximum-scale / user-scalable を「iOS10+ は既定で無視する」と書くが（後述）、standalone で同じかは一次資料で確認できていない。
一方、ピンチを有効にすると KI-2 が顕在化する。`#root` は ADR-20261024-0450 で `visualViewport.height` / `offsetTop` に
追従しており、倍率 2 では高さが半分になる。KI-10 の `resize` 再送（ADR-20261024-1646）もズーム中に余計な再配置を起こしうる。

## 決定点

1. ズーム制限の扱い（KI-8）。
2. viewport meta の書き方（T346）。
3. ズーム中の追従（KI-2）。
4. ズーム中のスワイプ判定（ピンチ許可で生じる衝突）。

## 選択肢

1. ズーム制限
   - 1a. `maximum-scale` / `user-scalable` を付けない。フォーカス時の自動ズームは入力 16px 化（既存の CSS）だけで防ぐ。
   - 1b. `maximum-scale=1` を残し、ピンチは諦める。
   - 1c. `maximum-scale` を 5 などに緩める。
2. meta の書き方
   - 2a. 項目単位でマージする。管理項目（`width` / `initial-scale` / `viewport-fit` / `interactive-widget`）だけを上書き・追加し、他は順序ごと保つ。
     dispose では、他者が触っていなければ元の文字列をそのまま戻し、触っていれば本プラグインの値のまま残る管理項目だけを元へ戻す。
   - 2b. 従来どおり全文を置き換え、dispose で元の全文へ戻す。
3. ズーム中の追従
   - 3a. `|visualViewport.scale − 1| > 0.01` の間は CSS 変数も `resize` 再送も更新しない（据え置き）。等倍へ戻った最初のイベントでその時点の値に追従し直す。
   - 3b. 倍率で正規化する（`height × scale` を使う）。
   - 3c. キーボードによる縮みだけを検出して反映する（`innerHeight − vv.height` の閾値など）。
4. ズーム中のスワイプ
   - 4a. 開始時か終了時にズーム中なら、スワイプ候補にしない／破棄する。
   - 4b. 従来どおり判定する（拡大画面の単指パンがサイドバーの開閉や右パネルの畳み込みとして誤発火しうる）。

## 評価基準

- iPhone PWA で 2 本指のピンチ拡大・縮小ができること（KI-8 の解消）。
- 入力欄（チャット入力・検索欄など）へのフォーカスで自動ズームしないこと。
- ピンチ中・ピンチ後に `#root` が縮まず、等倍へ戻るとキーボード追従（ADR-20261024-0450）と KI-10 の補正が従来どおり働くこと。
- ページ側（DSH 本体・他プラグイン）の viewport 項目を壊さず、dispose で元へ戻ること（自動テストで確認）。
- 拡大画面の単指パンで、サイドバーの開閉や右パネルの畳み込みが起きないこと。
- 低視力の利用者がズームできること（アクセシビリティ。WCAG 1.4.4 は 200% の拡大を求める）。

## 決定

1a、2a、3a、4a。

## 理由（考察。比較実験は iPhone 実機が要り、本 ADR の作成時点では未実施）

- 1a: 自動ズームの原因は「フォーカスした編集領域の font-size が 16px 未満」であり、既存の規則（COARSE で入力系に
  `font-size:16px !important`）が直接その条件を外す。`maximum-scale=1` は保険にすぎず、KI-8 の最有力の原因でもある。
  1b はアクセシビリティを損なう。1c は自動ズームの抑止に寄与しない（自動ズームを止めていたのは「上限 1」であり、1 を超える上限では拡大を許す）うえ、
  standalone で尊重される場合は拡大の上限だけが残る。`user-scalable` は付けず、ブラウザの既定に任せる。
- 2a: 全文の置き換えは、ページ側が将来足す項目（`height` 等）を消し、dispose 時に他者の変更も巻き戻す。
  重複した key は最初の位置へ 1 つにまとめる（後の重複が前の値を上書きする解釈では、残すと置換が効かないため）。
  アイデアは kuraneko1/dsh-mobile-maxxing 24e2e49（MIT）の `viewportContent` による。コードは写していない。
- 3a: ピンチ中の `offsetTop` は利用者のパン位置で、キーボードによるパンと区別できない。3b は高さを正規化できても
  `top` に使える値が無く、`position:fixed` の `#root` をズーム中に動かすと拡大した画面の中で内容がずれる。
  3c は閾値が端末・キーボードの種類（予測変換バーの有無）に依存し、ズームと同時に起きた場合に誤判定する。
  3a はズーム中の値を使わないので誤判定の余地が無く、等倍へ戻れば従来の経路に合流する。
  許容幅 0.01 は、等倍でも scale が 1 ちょうどにならない場合の丸め誤差を吸収するための推定値で、実測していない。
- 4a: 拡大中の単指ドラッグは拡大画面のパンで、visual viewport のパンは要素の `scrollLeft` に現れないため、既存の横スクロール祖先ガードでは区別できない。
  開始時だけでなく終了時も見るのは、等倍で始まった操作が途中でピンチに移る場合と、拡大中に始まり等倍で終わる場合の両方を除くため。
  4b は独立レビュー（codex / gpt-6.1-sol）でコードから導ける衝突として指摘された。
- 2a の補足: 区切りは `,` が正式だが、ブラウザは `;` も受け付けるため、両方（混在も）で分ける。`,` だけで分けると `;` 区切りの非管理項目を 1 項目と誤認して消す（独立レビューの指摘）。
- ズーム中の `resize` 再送を止めるのは、DSH の `ModelSelect.place()` が可視基準の rect と layout 基準の `top` を混ぜて
  計算するため（ADR-20261024-1646）、ズーム中に再配置させるとかえってずれうるため。

## 端の挙動（推定。実機で確認する）

- キーボード表示中にピンチ: 拡大前の値（キーボードで縮んだ高さと offsetTop）で据え置く。拡大中にキーボードを閉じても
  据え置き、等倍へ戻った時点で全画面に戻る。等倍へ戻るまで `#root` の下部がキーボード領域分だけ短いままになりうる。
- 拡大したまま入力欄をフォーカス: iOS がパンするが追従しない。入力欄が見えない位置に残る可能性がある。
- 等倍へ戻る最後のイベント: iOS がピンチ終了時に scale≈1 で `resize` / `scroll` を発火する前提。発火しなければ
  次のイベント（キーボードの出入り・スクロール）まで古い値が残る。
- 起動時に拡大中: 変数を設定せず CSS のフォールバック（上端 0・高さ 100%）になる。
- KI-10 のオーバーレイ補正は `--dsh-mobile-vvtop` を使うため、ズーム中は据え置きの値で補正される。

## 出典

- MDN「`<meta name="viewport">`」: maximum-scale / minimum-scale / user-scalable は「Browser settings can ignore this rule,
  and iOS10+ ignores it by default」、user-scalable=no は低視力の利用者を妨げ WCAG が 2 倍の拡大を求める旨。
  https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport （2026-10-26 web_fetch で取得。更新日は未確認）
- MDN「VisualViewport: scale property」: pinch-zoom の倍率を返す。
  https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport/scale （2026-10-26 web_fetch で取得）
- Apple Developer「ignoresViewportScaleLimits」: WKWebView 側で作者の制限を無視するかの設定（既定 false）。
  KI-8 の記録（2026-10-24 取得）による。standalone PWA での既定は未確認。
- 不一致: MDN は iOS が無視すると書くが、実機の PWA ではピンチが効かなかった。standalone は Safari のタブと設定が異なる可能性がある（未確認）。

## 検証

- 自動テスト（`npm test`、29 件）: 管理項目のマージ・重複除去・大文字の key・`;` 区切り・content 属性なし・dispose での復元（他者の変更あり／なし、他者が値を変えた・重複させた管理項目）、
  ズーム制限項目を足さないこと、scale≠1 で変数と再送を据え置くこと、許容幅の境界、起動時に拡大中の場合、ズーム中のスワイプを無視すること。
  変異 9 種（scale ガード削除、許容幅 0.05、maximum-scale の再追加、重複除去の無効化、dispose の全文復元化、全文置換化、`,` だけでの分割、touchstart / touchend それぞれのズームガード削除）でいずれも赤になることを確認した。
- 実機: 未確認。iPhone PWA でのピンチ可否・自動ズームの有無・キーボード表示中の `#root` を確認してから accepted にする。
  ピンチが効かないままなら、KI-8 の仮説 2（DSH 本体の外枠）を切り分ける。
