# ADR-20261028-0330: iOS のターミナルで、消す文字がある Backspace を xterm に見せず、UA のネイティブな削除にする

- Date: 2026-10-28
- Status: proposed
- Level: 3
- Deciders: AI（DSH の Claude 系サブエージェント）。実機確認後にオーナーが accepted にする
- Task: T311 / KI-12
- Refines: ADR-20261027-1400（proposed。そのうち「Backspace の写し」を、ほとんどの場面で不要にする）・ADR-20261027-1700（proposed。影の仕組みはそのまま使う）

## Context

be2a06b（ADR-20261027-1700）の実機確認で、Gboard で「ごきげん」と打って候補「ご機嫌」を選ぶと、textarea は「ごき機嫌」、端末の行は「ごきげ機嫌」になった。
このとき、検証ブランチ（verify/all-open-prs 3ee01c8。入力処理は be2a06b と同じ）のアプリ内ロガーでイベント列を記録した。記録は `test/fixtures/20261028-gboard-gokigen.json` で、
iPhone、iOS 18.7（UA）、PWA、Gboard の日本語入力を使った。記録は trusted な keydown / beforeinput / input / keyup の配送時点の値で、ロガーは window の capture にある。
Gboard は濁点の付け替え（こ→ご、け→げ）にも、変換で読みを消すときにも後方削除を使う。そのうち一部が keyCode 8 の keydown になり、xterm がそれを DEL にして `preventDefault` する。

## 記録の読み

| t | 記録 | 解釈 |
|---|---|---|
| 26419 | keydown 8 → keyup 8。beforeinput / input なし。値「こ」は keyup@after で「」 | xterm が DEL を送って preventDefault し、UA は消さない。本プラグインの Backspace の写しが keyup で「こ」を消した |
| 27353 | 同じ（「ごきけ」→ keyup@after「ごき」） | 同上 |
| 29130 | keydown 8 → beforeinput/input deleteContentBackward ×2（「ん」「げ」）→ keyup 8 → keydown 229 → insertText「機嫌」 | Gboard は読み「きげん」の 3 文字を消そうとした。1 回目は keydown 8 になり、xterm が preventDefault したので UA は消さない（写しは「UA も値を変えた」ので消さない）。2・3 回目は keydown を伴わずにネイティブに消えた |

- 管理セッションの読みとの差:
  - 濁点の Backspace（読み 1・2）は、管理セッションの読みと一致した。
  - 変換（読み 3）の読みは異なる。管理セッションは「Gboard が 2 回しか消さなかった（内部状態のずれ）」と読んだ。本 ADR は「Gboard は 3 回消したが、1 回目を xterm が preventDefault で握りつぶした」と読む。
    根拠は、29130 の keydown 8 が be2a06b の経路では必ず xterm の `_keyDown` に届き、DEL が送られること（下の再生で、値の推移が記録と全イベントで一致する）。
    Gboard の未確定範囲のずれを仮定しなくても、textarea の「ごき機嫌」は説明がつく。
  - 端末の「ごきげ機嫌」も同じ仕組みで説明できる。1 回目の DEL は xterm が送った。2・3 回目のネイティブ削除は、直前の keydown（8）が `defaultPrevented` なので「keydown で送り済み」として送らなかった（ADR-20261027-1400 の規則）。
    「機嫌」は送った。端末の行は ごきげん → ごきげ → ごきげ機嫌 となる。
- 連続する deleteBackward のうち、なぜ 1 回目だけが keydown 8 になるのかは分からない（推定: UIKit / WebKit が、同じキー操作で最初の削除だけキーイベントを合成する）。濁点の削除は 1 回だけなので、毎回 keydown 8 になる。

## Decision Drivers

- 記録から、xterm が keyCode 8 を preventDefault すること自体が、textarea・端末・キーボードの文脈を食い違わせる原因だと分かった。
- ADR-20261027-1400・1700 の評価基準（二重送信しない、英字を落とさない、変換の文脈を保つ、キーリピート）を保つ。

## 評価基準（実装前に確定）

1. 記録の列をそのまま再生する（keyCode 8 の keydown が preventDefault されなければ、UA がネイティブに 1 文字消す、というモデルを加える）。textarea と、UTF-8 の zsh で再生した端末の行が、どちらも「ご機嫌」になる。
   DEL は 5 個（濁点 2、読み 3）。
2. 同じ再生モデルを be2a06b に当てると、記録の値の推移（全イベントの配送時点の値）と、textarea「ごき機嫌」・端末「ごきげ機嫌」を再現する。これでモデルの妥当性を確かめる。
3. 既存の `npm test`（二重送信、英字の欠落、変換、ハードウェアキーボードの Backspace リピート）が緑のまま。新しいテストは be2a06b で赤になる。条件の各ガードを外す変異でも赤になる。
4. 確かめられないこと: Gboard の内部状態（UITextDocumentProxy・未確定範囲）は再現できない。確かめられるのは「ネイティブ削除にすると、textarea と端末が一致し続ける」ことだけ。修正後も Gboard が同じ数を消すかは実機で確かめる。

## Considered Options

1. (A) `COARSE` で、helper textarea への修飾キーなしの keyCode 8 の keydown を、消す文字があれば（カーソルが先頭でない、または選択範囲がある）document の capture で `stopImmediatePropagation` し、xterm に見せない。
   `preventDefault` はしない。UA がネイティブに消し、その `deleteContentBackward` を既存の差分の経路（送信済みの影）で DEL として送る。
   消す文字が無いとき（先に控えた写しを済ませた後で判定する）・変換中・確定の送信待ち・読み取り専用・修飾キー付き・既に `defaultPrevented` のときは、従来どおり xterm に任せる。
2. (B) 現状の「xterm の DEL ＋ スクリプトでの写し」を保ち、keydown 8 の後のネイティブ削除を「送り済み」とみなさず送る。
3. (C) keyCode 8 の keydown を止めて `preventDefault` もし、本プラグインが DEL を送って値もスクリプトで消す。

## 結果（比較実験。`test/terminal-input.test.mjs` の再生テスト、happy-dom 20.14.6 と npm の `@xterm/xterm@6.0.0`）

- 案 A: 再生で、textarea と端末の行が「ご機嫌」、DEL は 5 個。be2a06b では同じテストが赤になる（ネイティブ削除 0 回、端末「ごきげ機嫌」）。
  モデルの確認テストは、be2a06b で記録の値の推移と全イベントで一致し、textarea「ごき機嫌」・端末「ごきげ機嫌」になる（修正後の版では、前提が成り立たないので skip する）。
  `npm test` 118 件中 117 件が緑、1 件が上記の skip。`terminal-input` は 57 件（レビュー対応の 1 件を含む）。既存テストのうち、keyCode 8 の keydown を UA の既定動作なしで流していた 5 件は、UA のネイティブ削除を再現する `uaBackspace` に置き換えた
  （旧契約は「xterm が送って写す」。新契約は「UA が消して差分で送る」）。
  be2a06b では terminal-input の 5 件が赤になる（再生、ネイティブ削除 2 件、beforeinput の無いネイティブ削除、送信待ちを解いた後のリピート）。
  変異 11 種のうち 10 種は赤になった。外した・変えたものは、ネイティブ化そのもの、空の値のガード、送信待ちのガード、変換中のガード、読み取り専用のガード、修飾キーのガード、keydown の時点の値の控え、
  先に控えた Backspace の写し、`key` の記録、`defaultPrevented` のガード。
  緑のまま残る変異は 1 種で、「影と待ちの数を keydown 8 で捨てる」もの。ネイティブ削除では beforeinput の時点の値が影の代わりになるので、結果が変わらない。
  影を保つほうが、beforeinput の無い列に強いので残す。
- 案 B: 端末は記録と同じ数の DEL を受けるようになる。しかし textarea は 1 文字多く残る（「ごき機嫌」）。キーボードの文脈と端末がずれたままで、次の変換で読みの数が合わない。
  そのうえ、「keydown で送り済みなら送らない」規則（ADR-20261027-1400。UA が preventDefault を無視して消す場合の二重送信の防止）と衝突する。
- 案 C: 値をスクリプトで消す点は今と同じで、キーボードから見た文書の変化が「ユーザーの削除」にならない。iOS のキーボードの文脈・取り消しの履歴とずれる恐れが残る。

## Decision

案 A を採る。Backspace の写し（`flushTermBackspace`）は、xterm に任せる Backspace のうち、確定の送信待ちを解く場合だけに残る（変換中・空の値・修飾キー付きは、xterm が値を変えないか、写す文字が無い）。
実機での確認が済むまでは proposed とする。

## Pros and Cons

### A. ネイティブ削除（採用）
- Good: textarea・端末・キーボードの文脈が、同じ 1 回の削除でそろう。スクリプトで値を書き換える場面がほぼ無くなる（ADR-20261027-1400 の「値に触れない」に近づく）。
- Good: ハードウェアキーボードの Backspace とキーリピートも、UA の削除＋差分の経路で 1 文字ずつ DEL になる。
- Bad: UA が keydown を取り消されないまま削除しない場合（未知の UA の挙動）、DEL が出ない。xterm に任せる経路は空の値のときだけになる。
- Bad: 修飾キーなしの Backspace は、xterm の `_keyDown`（`attachCustomKeyEventHandler` を含む）を通らない。DSH の sidebar-terminal 0.2.0-rc.2 は custom key handler を付けていない（配布物の `client.terminal.js` で `.attachCustomKeyEventHandler(` の呼出しは xterm 自身の定義だけ）。
  xterm 6.0.0 のキーマップでは、修飾キーなしの keyCode 8 は常に DEL（0x7f）で、差分の経路が送る DEL と同じ。付けられれば COARSE だけ挙動が変わる。

### B. ネイティブ削除を送る
- Good: 変更が小さい。
- Bad: textarea と端末がずれたまま。

### C. スクリプトで消す
- Good: UA の挙動に依らない。
- Bad: 今回の不具合の原因（キーボードから見て削除が反映されない）を残す恐れがある。

## 独立レビュー

- codex / gpt-6.1-sol（workflow、閲覧のみ・編集禁止・再委譲禁止。secret-scan --patch 済みの staged 差分）。指摘 1 件を採用した。
  1. (medium) 送信待ちを解いた Backspace（xterm が確定文字と DEL を送る）が最後の 1 文字を消す場面で、keyup 前のリピートの keydown は「消す文字がある」と判定されてから写しで値が空になり、
     UA は何も消さず DEL が落ちる（確定文字＋DEL×1。期待は ×2）→ 写しを済ませてから消す文字の有無を判定し、空なら xterm に任せる。回帰テストを足した（修正前の差分で赤）。
- 同上の 2 回目（修正後の差分）。high / medium の指摘なし。

## 実装（`ADR-20261028-0330` で grep）

- `lib/client.js` の「iOS の文字入力を xterm へ 1 回だけ届ける」ブロック（`onTermKeyDown` の (3)）。仕様は spec.md §5.3 `TerminalInputReachesOnce`。
- `test/terminal-input.test.mjs` の「実機の列の再生」と「Backspace をネイティブ削除にする条件の境界」。記録は `test/fixtures/20261028-gboard-gokigen.json`。

## 検証

- 自動テスト: 上記。
- 実機: 未確認。手順は spec.md §8 の 2。

## 出典

- 実機の記録（2026-10-28、オーナー、検証ブランチのアプリ内ロガー）。原本は worktree の `tmp/device-logs/20261028-gboard-gokigen.json`（commit しない）。テスト用の抜粋を `test/fixtures/` に置いた。
- xterm 6.0.0 `src/browser/CoreBrowserTerminal.ts`（`_keyDown` を textarea の capture で登録、`cancel`）、`src/common/input/Keyboard.ts`（keyCode 8 → DEL、Ctrl → `\b`、Alt → ESC＋DEL）。npm の `@xterm/xterm@6.0.0` で確認した。
