# ADR-20261027-1400: iOS のターミナル入力は textarea の値に触れず、229 の keydown を xterm に見せずに、編集の差分を送る

- Date: 2026-10-27
- Status: proposed
- Level: 3
- Deciders: AI（DSH の Claude 系サブエージェント）。実機確認後にオーナーが accepted にする
- Task: T311 / KI-12
- Supersedes: ADR-20261027-0020（proposed のまま置き換える）

## Context

ADR-20261027-0020 の修正（f8e4bb0）を当てた iPhone PWA（Gboard）で、2026-10-27 13:25 のオーナー報告: 英字は入るようになった。日本語はひらがなが送られる（`echo` で「こんにちは」）が、かな→漢字の変換ができない。
f8e4bb0 は、xterm が捨てる `insertText` を止めて送り直す前に、textarea の値と選択範囲を挿入前へ戻していた。そのため、キーボードが入れたかなは textarea から即座に消える。
（zsh の行編集でマルチバイトが `<0081>` 等と出るのは PTY のロケールの問題で、本 ADR の対象外。）

## Decision Drivers

- かな→漢字の変換（Gboard 型・標準キーボード型の両方）を壊さない。
- 英字・数字・空白・Enter・Backspace を落とさず、二重にもしない（ADR-20261027-0020 の評価基準 1–3 を保つ）。
- 変換で読みを消して漢字を入れる操作を、端末の行にも同じ編集（DEL ＋ 漢字）として届ける。
- spec §3 の契約の範囲（公開 DOM クラスとイベントだけ）。

## 評価基準（実装前に確定）

1. Gboard 型の変換（かなを 1 文字ずつ insertText → 候補の選択で「deleteContentBackward × 読み → insertText 漢字」、または「読みを選択 → insertReplacementText」）で、
   かなが textarea に残り、onData が「かな、DEL × 読み、漢字」の順に 1 回ずつ。
2. 標準キーボード型（composition / marked text）の変換で、onData は確定文字の 1 回だけ。textarea の値に触れない。
3. 既存の `test/terminal-input.test.mjs` の列（英字・keyCode 65・Enter/Backspace・中国語 IME の空白 2 回・送信待ち・作り直し・readOnly・dispose）で 1 回ずつ。
4. 修正前の 2 版（d686e25・f8e4bb0）は 1・2 の少なくとも一方で赤。主要な仕組みを外した変異が赤。

## 原因の分析（f8e4bb0 が変換を壊す経路）

- 事実（コード）: f8e4bb0 の `onTermInput` は、`insertText` を止めた後に `input.value = snap.value`（beforeinput の時点の値）へ戻す。iOS の `insertText` 1 回ごとに、入れた文字は textarea から消える。
- 事実（一次資料）: iOS のサードパーティキーボードは `UITextDocumentProxy`（`documentContextBeforeInput` など、カーソル前の文脈）を通じてだけ文書を見る（Apple Developer Documentation、下記）。
  `setMarkedText` は iOS 13 から使えるが、Gboard・Simeji・ATOK はほぼ使っていない（azooKey 開発者の記事、2021 年公開・2022 年追記。下記）。
  WebKit は `deleteBackward` を `executeEditCommand("deleteBackward")`、`insertText:` を `insertTextAsync` に通す（`WKContentViewInteraction.mm`、tmp/sources の写し）。
- 推定: Gboard は日本語のかなを marked text なしで `insertText` し、変換時にカーソル前の文脈から読みを消して（後方削除の繰り返し、または置換）漢字を入れる。
  傍証: Scrapbox forum の報告（iOS の Gboard・Simeji・ATOK・SwiftKey などで、独自エディタ上の変換が「最後の 1 文字だけ変換され、残りが残る」）は、エディタが値を保たないと
  サードパーティキーボードの変換が壊れることを示す（エディタの実装は不明で、原因の同一性は確かめていない）。
- 推定（結論）: f8e4bb0 では、候補を選んだ時点でキーボードが見る文脈（textarea のカーソル前）にかなが無い。キーボードは消す読みを見つけられず、変換できない（または置換を出さない）。
  もし後方削除を出しても、textarea に文字が無いので UA は削除の input を出さない（or 何も消さない）ため、端末の行にも DEL が届かない。
- 修正前（d686e25）: 値は xterm の差分検出が送った後も残る（xterm は 229 の差分検出で値を空にしない）ので、文脈は保たれ、変換の操作自体はできたはず（推定）。
  ただし英字と同じく、かなの `insertText` は差分検出の timer より遅れると落ちる。変換の削除（値が短くなる）は差分検出が DEL を 1 つだけ送る（`t.length < e.length` で常に 1 個）ので、読みが 2 文字以上なら端末の行に読みの一部が残る。
  合成列（テスト）では d686e25 は評価基準 1・2 とも赤（かなも確定前の文字も落ちる）。

## Considered Options

1. (A) textarea の値に触れない。keyCode 229 の keydown を capture で止めて xterm の差分検出を起こさせず、編集の `input`（挿入・置換・後方削除）を止めて、
   beforeinput の時点の値との差を「DEL × 消えた数 ＋ 入った文字」として composed でない insertText で送る。変換中・送信待ちは CompositionHelper に任せる。
2. (B) f8e4bb0 のまま、巻き戻しだけやめる（値を残す）。
3. (C) f8e4bb0 の介入を「日本語らしい入力（非 ASCII）」のときだけ外す。
4. (D) 巻き戻しをやめ、xterm の差分検出と協調する（229 の keydown は xterm に見せ、差分検出が送る分を差し引く）。

## 比較実験

- 方法: `test/terminal-input.test.mjs`（happy-dom 20.14.6 ＋ npm の `@xterm/xterm@6.0.0`）。新しい合成列 10 件を足した:
  Gboard 型の「後方削除 × 3 → insertText」と「選択 → insertReplacementText」、標準キーボード型の marked text、値が空での後方削除、改行と絵文字の置換、keyCode 8 の Backspace の写し 4 件（キーリピート、確定の送信待ちを解く Backspace を含む）、読み取り専用。
- 結果: 案 A で 38 件すべて緑（全体 99 件）。修正前の d686e25 では 37 件中 26 件、f8e4bb0 では 13 件が赤（38 件目の追加前に計数）（変換の 3 件はどちらも赤）。
  案 A の変異 17 種（送信待ちの解除を Backspace の記録の後にする、229 の伝播停止の削除、読み取り専用でも 229 を止める、空の値での DEL の削除、変換中の insertText の停止の削除、keydown 送り済み判定の削除、カーソル後ろの除外の削除、CR 変換の削除、
  サロゲート補正の削除、対象 inputType の限定の削除、readOnly ガードの削除、Backspace の写しの削除、写しを 1 文字に限る、写しで UA の削除を確かめない、写しの readOnly ガードの削除、送信待ちの判定の削除、beforeinput の値への巻き戻しの追加）はすべて赤。
- 案 B: 実装しての比較はしていない。値を残すと、f8e4bb0 は 229 の keydown を xterm に見せたままなので、差分検出が後から走って同じ文字を送り二重になる（f8e4bb0 の巻き戻しはそれを避けるためにあった）。
  評価基準 3 を満たさない。
- 案 C: Gboard の英字も日本語キーボードのローマ字入力も同じ列（229 → insertText）で、文字種で分けても日本語側は修正前の欠陥（落ちる）に戻る。評価基準 1 を満たさない。
- 案 D: 差分検出は「値が短くなれば DEL を 1 つ」「同じ長さで違えば値全体を送る」なので、読みの数だけの DEL や置換を表せない。timer の前後で送る分を差し引くのも近似が増える。評価基準 1 を満たさない。

## 外部根拠（取得: 2026-10-27、web_fetch。本文を確認）

- Apple Developer Documentation「UITextDocumentProxy」https://developer.apple.com/documentation/uikit/uitextdocumentproxy（JSON 版 https://developer.apple.com/tutorials/data/documentation/uikit/uitextdocumentproxy.json を取得）。
  カスタムキーボードはこの proxy で挿入・削除・挿入位置の調整を行い、`documentContextBeforeInput` / `documentContextAfterInput`（挿入位置の前後の文脈）、`setMarkedText` / `unmarkText` を持つ。
- Miwa「iOSカスタムキーボードのsetMarkedTextの現状」azooKey blogs（Zenn）https://zenn.dev/azookey/articles/896fb7b52bf13b（公開 2021-02-12、更新 2022-11-11）。
  `setMarkedText` は iOS 13 から。「大手のキーボードアプリ(Simeji, Gboard, ATOKなど)はほとんど用いていません」。marked text が無い開発では `documentBeforeContext` 等が鍵。WebKit のテキストフィールドでは挙動が違う、との記述。
  記事の時点（2021–2022）以後に Gboard が marked text を使い始めたかは確かめていない。
- Scrapbox forum-jp「iOSのGboard日本語入力から変換するとに入力がおかしくなる（…疑似インラインで入力されている未確定の文字が入力扱いにされる）」
  https://scrapbox.io/forum-jp/ （API https://scrapbox.io/api/pages/forum-jp/… で取得。作成 2018-04、最終更新 2025-02）。Gboard・Fleksy・Simeji・SwiftKey・ATOK で同種の報告、ATOK は「カーソル位置入力」オフで直る、との記述。
- WebKit `Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm`（main、tmp/sources に 2026-10-26 取得の写し）: `deleteBackward` → `executeEditCommand("deleteBackward")`、`insertText:` → `insertTextAsync`、`setMarkedText:` → `setCompositionAsync`、`unmarkText` → `confirmCompositionAsync`。
- ADR-20261027-0020 の出典（xterm.js issue #5835、PR #5614、gadzan/xacpx PR #318）はそのまま有効。

## Decision

案 A を採る。評価基準 1–4 を合成列で満たした。実機（iOS 標準キーボードと Gboard での変換）は未確認のため proposed。

## Pros and Cons of the Options

### A. 値に触れず、229 を xterm に見せず、編集の差分を送る（採用）
- Good: キーボードの変換文脈（textarea のカーソル前）を保つ。差分を DEL ＋ 文字で送るので、変換の削除・置換が端末の行にも同じ数だけ届く。xterm の差分検出が走らないので、timer の前後に依らず二重にならない。
  値の巻き戻し・keydown の時点の値の照合が不要になり、状態が減った。
- Bad: 端末の行のカーソルが textarea のカーソルに対応する、という前提を置く（textarea 内でカーソルを動かすとずれる）。textarea の値は Enter・blur まで伸びる。
  xterm が Backspace を keydown で送る場合、送った数だけ textarea からも消す（値への唯一の書込み。UA が自分で消した場合・読み取り専用では消さない）。
  `beforeinput` が無い UA では置換の削除分が分からない。予測候補・自動修正・音声入力の列は未検証。

### B. 巻き戻しだけやめる
- Good: 差分が最小。
- Bad: 差分検出と二重になる（上記）。

### C. 日本語らしい入力では介入しない
- Good: 日本語の経路を xterm の既定に戻せる。
- Bad: 既定の経路自体が落ちる（KI-12 の原因）ので日本語が直らない。

### D. 差分検出と協調
- Good: xterm の経路を使い続ける。
- Bad: 差分検出の送る形（DEL 1 つ・値全体）が変換の編集を表せない。

## 実装（コードの位置は `ADR-20261027-1400` で grep）

- `lib/client.js` の「iOS の文字入力を xterm へ 1 回だけ届ける」ブロック。仕様は spec.md §5.3 `TerminalInputReachesOnce` / `TerminalInputUntouched`。

## 独立レビュー

- codex / gpt-6.1-sol（workflow、閲覧のみ・編集禁止・再委譲禁止。secret-scan --patch 済みの staged 差分）。指摘 2 件を両方採用した。
  1. (high) Backspace のキーリピート（keydown が続いて keyup 1 回）で、端末は複数の DEL を受けるのに textarea は 1 文字しか消えず、続く置換が消しすぎる
     → Backspace の keydown を全部控え、配送の後に `defaultPrevented` だったものの数だけ消す。回帰テストを足した。
  2. (medium) keydown / keyup の介入に readOnly / disabled のガードが無く、spec と食い違う → 229 の伝播停止と Backspace の写しにもガードを足し、テストを足した。
- 同上の 2 回目（修正後の差分）。指摘 1 件を採用した。
  1. (medium) 確定の送信待ちを解く最初の Backspace が、待ちの判定で記録から漏れ、textarea に読みが残る → 待ちの解除を Backspace の記録より先にした。回帰テストを足した。

## 検証

- 自動テスト: `npm test` 99 件（`test/terminal-input.test.mjs` 38 件）。
- 実機: 未確認。手順は spec.md §8 の 2 と KI-12。直らない場合は `tmp/terminal-input-probe.js` と `tmp/terminal-input-probe.md` の「日本語の変換」でイベント列を記録する。

## 出典の扱い

上流のコードは写していない。
