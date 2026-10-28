# ADR-20261027-0020: iOS のターミナルで落ちる文字入力を、composed でない input として xterm へ送り直す

- Date: 2026-10-27
- Status: superseded by ADR-20261027-1400
- Level: 3
- Deciders: AI（DSH の Claude 系サブエージェント）。実機確認後にオーナーが accepted にする
- Task: T311 / KI-12

## Context

右パネルのターミナル（DSH ui-sidebar-terminal 0.2.0-rc.2、xterm.js 6.0.0 同梱）に、iPhone PWA から文字が入らない。
2026-10-26 の実機報告（Gboard）: キーボードは出る、読み取り専用ではない、Enter は入る、英字はほぼ入らず、まれに `a` だけ入る。
xterm 6.0.0 の `_inputEvent` は keydown から keyup までに来た `composed` な input を捨てる。iOS は入力メソッドが処理したキーを keyCode 229 の keydown にし、
文字は `insertText` の input で入れる。この列の文字は xterm の差分検出にしか拾われず、input が keydown より遅れると落ちる（詳細は KI-12）。
制約: DSH 本体と同梱の xterm は変えない。spec §3 の契約（xterm の公開 DOM クラス）の範囲で行い、React の内部をたどって Terminal インスタンスを取らない。二重送信を起こさない。

## Decision Drivers

- 実機で観測した列（Enter は通り、英字は落ちる）を説明できる原因に効くこと。
- デスクトップの入力と、日本語・中国語の変換確定で二重送信しないこと。
- xterm の版上げで xterm 側が直ったとき、それを検知できること。

## 評価基準（実装前に確定）

1. 観測と同じ列（keydown 229 → 約 10ms 後に input(insertText, composed) → keyup）を本物の xterm 6.0.0 に流し、onData に各文字がちょうど 1 回届く（修正前は 0 回）。
2. デスクトップ（fine pointer）の keydown → keypress、COARSE の keyCode 65 の keydown、日本語の変換確定、中国語 IME の「空白 2 回 → 。」で、onData が 1 回ずつ。
3. 読み取り専用・dispose 後は送らない。fine pointer・`insertText` 以外は元の input を止めない。
4. spec §3 の契約の範囲（公開 DOM クラスとイベントだけ）に収まる。
5. 実機: Gboard と標準キーボードで、英字・数字・日本語の確定・Enter・Backspace が 1 回ずつ入る（未実施。accepted の条件）。

## Considered Options

1. (a) helper textarea の `input` を document の capture で見て、xterm が捨てる `insertText` だけを止め、`composed` でない `InputEvent` として同じ data を送り直す。
   xterm の差分検出と二重にならないよう、送り直す前に textarea の値と選択範囲を `beforeinput`（無ければ keydown）の時点へ戻す。
2. (a') 合成の `keypress`（charCode 付き）を送る。xterm の `_keyPress` が送り、`_keyPressHandled` で後続の input を捨てる。
3. (b) helper textarea をターミナル全面に広げる（Runfusion/Fusion c7266b7 の方式）。
4. (c) helper textarea を `type=password` 相当にして入力メソッドを避ける（xterm.js issue #5377 のコメントの方式）。
5. (d) React の fiber から Terminal インスタンスを取り、`_inputEvent` を差し替える（gadzan/xacpx PR #318 の方式を DSH に当てたもの）。

## 比較実験

- 方法: `test/terminal-input.test.mjs`。happy-dom 20.14.6 上で npm の `@xterm/xterm@6.0.0` を開き、本プラグイン（lib/client.js）を同じページに適用して、合成したイベント列の onData を数える。
  npm 版と DSH 同梱版の入力処理（`_keyDown` / `_keyUp` / `_keyPress` / `_inputEvent` / CompositionHelper）が、空白・セミコロン・括弧の整形差を除いて一致することを同じファイルのテストで照合した。
- 結果（案 1。評価基準 1–3）: 28 件すべて緑（全体 89 件）。修正前の `lib/client.js`（HEAD d686e25）では 18 件が赤。
  変異 23 種（送り直しの削除、元の input を止めない、値の戻しの削除、選択範囲の戻しの削除、beforeinput・keydown の戻し先の削除、代替の取り除きの削除、
  送信待ちのガードの削除、keydown による送信待ちの解除の削除、配送停止時の解除の削除、世代の区別の削除、変換中ガードの削除、状態を textarea ごとにしない、
  readOnly ガードの削除、COARSE ゲートの削除、`composed:true` で送り直す、再入防止の無効化、dispose の削除、`insertText` 以外も対象にする、
  keydown で送り済みの判定の削除、keyup・blur による失効の削除、keydown の時点の値を 1 回で失効させない）のうち 22 種が赤。世代の区別の削除だけは赤にできなかった（順に走る timer では、古い解除が新しい待ちを先に解く列を作れなかった。防御として残す）。
- 案 2–5 は実装しての比較をしていない。以下の考察で、評価基準 1・2・4 のいずれかを満たさないと判断した。
- 補助の観察（調査用、commit しない `tmp/repro/a-only.mjs`）: プラグイン無しで keydown 229 と input の間を 0ms にすると `a` が届き、1ms 以上で落ちる。keyCode 65 の keydown なら届く。

## 外部根拠

- xterm.js issue #5835「iOS Chinese IMEs cannot input punctuation (including space)」https://github.com/xtermjs/xterm.js/issues/5835
  （GitHub API で取得、`tmp/sources/xterm-5835.json`、2026-10-26。公開 2026-04-24）。Raw event sequence: keydown（keyCode 229）→ 約 7–10ms 後に beforeinput / input（`insertText`、`composed=true`、`isComposing=false`）→ keyup（keyCode 0 または 32）。
  空白 2 回で `deleteContentBackward` → `insertText "。"` になる列も記録がある。
- xterm.js PR #5614「fix: iOS Safari Chinese punctuation input not working」https://github.com/xtermjs/xterm.js/pull/5614（同上、`tmp/sources/xterm-5614.json` / `.patch`、公開 2026-01-17、未 merge）。
  `_inputEvent` の条件 `(!ev.composed || !this._keyDownSeen)` を「変換中でなく、変換の送信待ちでない」に変える。確定直後の input を通すと絵文字が二重になる、との記述。本 ADR の「確定直後は送り直さない」の着想元。
- gadzan/xacpx PR #318（`tmp/sources/xacpx-318.patch`、2026-10-26 取得）。PR #5614 の条件を xterm の外から `_inputEvent` を差し替えて当てる。変換中に `isComposing:false` の `insertText` が来る列を e2e で扱っている。
- Runfusion/Fusion c7266b7「restore iOS terminal input by full-covering helper textarea」（`tmp/sources/fusion-c7266b7.patch`、2026-10-26 取得）。原因を「1×1 の textarea へのフォーカスと capture 段階の再フォーカス」とし、textarea を全面に広げる。
- xterm.js issue #5377 のコメント（2026-06-15）https://github.com/xtermjs/xterm.js/issues/5377#issuecomment-4709149202（`tmp/sources/xterm-5377-comments.json`）。Gboard で入力欄を password にすると直った、との報告。
- WebKit `Source/WebCore/page/EventHandler.cpp`（main、raw.githubusercontent.com から curl で取得、2026-10-27 00:0x）: `CompositionEventKeyCode = 229`。入力メソッドが処理した keydown の keyCode を 229 にする（「if an input method handles the event, its keyCode is set to 229 in keydown event」）。
  `Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm` の `_deferKeyEventToInputMethodEditing` / `insertText:`（同）。ソフトキーボードの文字は `insertText:` から `insertTextAsync` で入る。
  Gboard が実際にこの経路を通ることは一次資料で確認していない（推定）。
- Stack Overflow 28945767「JS keydown keyup keypress event doesn't work on IOS8 when using third party IME」（Stack Exchange API で取得、2026-10-27）。サードパーティキーボードではキーイベントが出ない、input で拾う、という古い報告（iOS 8）。

## Decision

案 1 を採る。評価基準 1–4 を happy-dom の比較実験で満たした。基準 5（実機）は未実施のため proposed。

## Pros and Cons of the Options

### 1. 止めて composed でない input として送り直す（採用）
- Good: 原因（`_inputEvent` の `composed` 条件）に直接効く。値を挿入前へ戻すので、差分検出の timer が input の前後どちらで走っても二重にならない（合成列で確認）。xterm の公開経路（input → `_inputEvent` → `triggerDataEvent`）を通るので、DSH の `onData` → `model.write` もそのまま動く。
  keypress で送り済みなら xterm 自身が `_keyPressHandled` で捨てる。Terminal インスタンスにも React にも触れない。
- Bad: xterm の内部の挙動（`composed` を見ること、差分検出の値の比較）に依存する。版上げで xterm が直れば不要になる（プラグイン無しの再現テストが赤になって知らせる）。
  textarea の値を書き換えるので、xterm が値を別の目的に使い始めると影響しうる。確定の送信待ちは、`compositionend` の配送中に textarea へ足したリスナーで timer を予約して近似する
  （xterm のリスナーの後に呼ばれ、xterm の timer より後に走る。間に他の timer が入れば、その間の文字は落ちうる）。
  戻し先の無い選択範囲の置換では、差分検出が DEL や余計な文字を送りうる。
  `insertReplacementText`（自動修正）・音声入力は扱わない。xterm が keydown で送り済みかの判定は `defaultPrevented` と `key` の一致による近似（keyup・blur で失効）。

### 2. 合成 keypress
- Good: xterm の古い経路で、`_keyPressHandled` により後続の input が自然に捨てられる。
- Bad: keypress は 1 文字（charCode）単位で、複数文字の `insertText`（予測候補・`你好`）を表せない。`String.fromCharCode` は BMP 外（絵文字）を壊す。keyup の前に input が来ないと `_keyPressHandled` が残る。

### 3. textarea を全面に広げる（Fusion）
- Good: CSS だけで済む。タップが textarea に直接当たるので、フォーカスとキーボード表示の問題には効く。
- Bad: 今回はキーボードが出て Enter も入る（フォーカスは成立している）ので、原因（`_inputEvent` の条件）に効く理由が無い。Fusion の commit も input の列を示していない。
  全面の textarea はタップ・縦ドラッグ（§5.3 の wheel 変換）や xterm のリンク・選択の対象を奪う。

### 4. password 化
- Good: 入力メソッドを通らなくなれば keyCode が付く可能性がある（報告 1 件、Gboard / Android と読める）。
- Bad: xterm の textarea の型は変えられない（textarea に type は無い）。パスワード管理の候補が出る、日本語入力ができなくなる。

### 5. Terminal インスタンスの `_inputEvent` を差し替える
- Good: 上流の修正（PR #5614）と同じ条件をそのまま当てられる。
- Bad: DSH は Terminal インスタンスを公開しておらず、React の内部（fiber）をたどる必要がある。spec §3 の方針に反し、DSH の更新で壊れる。

## 実装（コードの位置は `ADR-20261027-0020` で grep）

- `lib/client.js` の「iOS の文字入力を xterm へ 1 回だけ届ける」ブロック。仕様は spec.md §5.3 `TerminalInputReachesOnce`、`TerminalInputUntouched`（input の例外を追記）。

## 独立レビュー

- codex / gpt-6.1-sol（workflow、閲覧のみ・編集禁止。secret-scan --patch 済みの staged 差分）。指摘 5 件をすべて採用した。
  1. (high) 229 の状態を keyup で解くと、keyup の後の input や別キーの keydown が挟まる列で差分検出と二重になる → 値を `beforeinput` の時点へ戻す方式に変え、keydown の種類に依らなくした。
  2. (high) 変換中の状態が全ターミナル共通で、作り直しで持ち越す → textarea ごとの WeakMap にした。
  3. (medium) timer 2 段は送信待ちと同値でない（xterm の送信後も文字を捨てる、非 229 の keydown による即時確定を追わない）→ 配送中に textarea へ足すリスナーで xterm の timer の直後に解き、非 229 の keydown でも解く。
  4. (medium) 値の巻き戻しが選択範囲の置換を復元しない → `beforeinput` の時点の値と選択範囲へ戻す。
  5. (medium) テスト・文書の保証が検査範囲より広い → 反例の列をテストに足し、spec に保証の範囲を書き、Gboard の列を推定と明記した。
     keydown が preventDefault したのに UA が挿入を出す列は、`key` の一致で送らないようにした。
- 同上の 2 回目（修正後の差分）。指摘 4 件をすべて採用した。
  1. (medium) keydown の照合を 1 秒の時刻で失効させると、keydown を伴わない同じ文字の独立入力を落とす → keyup・blur で失効させ、時刻を使わない。
  2. (medium) beforeinput の無い選択範囲の置換は、data の削除だけでは戻らない → keydown の時点の値と選択範囲も戻し先にした。どちらも合わない場合の制限を spec に書いた。
  3. (medium) テストの挿入が選択範囲を置き換えておらず、置換の分岐を検査していなかった → テストの挿入を選択範囲の置換に直し、値と選択範囲の復元を検査した。
  4. (medium) 解除 timer は送信状態と同値でない・配送停止でリスナーが残る・古い解除が新しい待ちを解く → 「一致する」の記述を近似に改め、配送停止時の解除、dispose での撤去、世代の区別を足した。
- 同上の 3 回目。high は無し。指摘 2 件を採用した。
  1. (medium) keydown の時点の値は、途中の削除・置換の後でも最終値の形が合えば戻してしまう → keydown の後の最初の input・compositionstart・blur で失効させ、回帰テストを足した。
  2. (low) 配送停止時の保険が timer をもう 1 段予約し「次のタスクで解く」と一致しない → 保険の中で直接解き、その timer も dispose で取り消す。

## 検証

- 自動テスト: `npm test` 89 件（`test/terminal-input.test.mjs` 28 件。DSH 同梱版との照合 1 件は配布物が無い環境で skip）。
- 実機: 未確認。手順は spec.md §8 の 2。Gboard と標準キーボードの両方で、英字・数字・空白・日本語の確定・Enter・Backspace を試す。

## 出典の扱い

上流（xterm.js PR #5614、gadzan/xacpx PR #318、Runfusion/Fusion c7266b7）のコードは写していない。条件の考え方だけを使った。
