# ADR-20261027-1700: iOS のターミナル入力の差分の起点を「送信済みの影」にする

- Date: 2026-10-27
- Status: proposed
- Level: 3
- Deciders: AI（DSH の Claude 系サブエージェント）。実機確認後にオーナーが accepted にする
- Task: T311 / KI-12
- Refines: ADR-20261027-1400（proposed。差分の起点だけを変える。値に触れない・229 を xterm に見せない・DEL＋文字で送る方針はそのまま）

## Context

ADR-20261027-1400 を実装した 4a07c17 を、UTF-8 ロケールの zsh で、iPhone PWA と Gboard を使って確かめた（2026-10-27 16:36、オーナー報告）。英字・かな・Enter は入る。
「echo ご」の後に「きげん」を打って「機嫌」へ変換し、続けて「麗しゅう」と打つと、端末の行は `echo ごきげ機嫌麗しゅう` になった。期待した行は `echo ご機嫌麗しゅう` で、読み 3 文字のうち 1 文字しか消えていない。
`echo hell.こんにちは` も入力された。ただし打鍵の意図は確認していない。
4a07c17 は、各 `input` の差分を「直前の `beforeinput` の時点の値」と比べて取る。このため `beforeinput` と `input` が 1 対 1 に並ばない列では、消した数を数え落とす。

## Decision Drivers

- 実機の列は記録していない。そのため、観測と合うどの列でも消した数を合わせる。
- ADR-20261027-1400 の評価基準 1–4（変換の文脈を保つ、二重にしない、英字を落とさない、壊した版で赤）を保つ。
- 値が編集の外で変わったときに、古い起点から誤った DEL を送らない。

## 評価基準（実装前に確定）

1. 下の再現表のすべての列で、端末の行が `echo ご機嫌麗しゅう` になる。DEL は 3 個で、textarea も同じ値になる。ただし marked text の列 M は対象外とする（後述）。
2. 既存の `test/terminal-input.test.mjs` 38 件と `npm test` 全体が緑のまま。特に、二重送信の列と、英字が落ちる列を保つ。
3. 新しいテストは 4a07c17 で赤になる。影の主な仕組み（影の更新、影を捨てる場面、`beforeinput` の数え）を外した変異でも赤になる。

## 再現（比較実験。`tmp/repro/seq.mjs`、happy-dom 20.14.6 と npm の `@xterm/xterm@6.0.0`。本プラグインを読み込み、onData を UTF-8 の zsh の行として再生する）

前提として、「echo ご」と「きげん」を 1 文字ずつ入力した後に、次の列で「機嫌」へ変換する。各文字は keydown 229 → 10ms → beforeinput/input(insertText) → keyup で入力する。
その後に「麗しゅう」を 1 回の insertText で入れる。

| 列 | 4a07c17: DEL / 端末の行 | 本 ADR: DEL / 端末の行 |
|---|---|---|
| A 後方削除 ×3（それぞれ beforeinput/input）→ insertText | 3 / `echo ご機嫌麗しゅう` | 3 / 同 |
| B 読みを選択（beforeinput より前）→ insertText | 3 / 同 | 3 / 同 |
| C beforeinput の時点ではキャレット。その後に選択して置換（選択の反映が遅れる） | 3 / 同 | 3 / 同 |
| D insertReplacementText（範囲は getTargetRanges だけ。選択は後から） | 3 / 同 | 3 / 同 |
| **E 後方削除: beforeinput は 1 回目だけ** | **1 / `echo ごきげ機嫌麗しゅう`（観測と一致）** | 3 / `echo ご機嫌麗しゅう` |
| **F 後方削除: beforeinput ×3 が先、input ×3 が後** | **1 / `echo ごきげ機嫌麗しゅう`（観測と一致）** | 3 / 同 |
| G 削除と挿入の beforeinput ×4 が先、input ×4 が後 | 0 / `echo ごきげん機嫌機嫌麗しゅう` | 3 / 同 |
| H 後方削除に beforeinput が無い | 0 / `echo ごきげん機嫌麗しゅう` | 3 / 同 |
| I 後方削除 ×3 に keyCode 8 の keydown が伴う（UA も消す） | 3 / 同 | 3 / 同 |
| J 2 回目以降の削除にだけ keyCode 8 の keydown（keyup なし） | 3 / 同 | 3 / 同 |
| K 削除と挿入の beforeinput と input の間に keydown 229 | 0 / `echo ごきげん機嫌麗しゅう` | 3 / 同 |
| L 削除ごとに keydown 229 / keyup で包む | 3 / 同 | 3 / 同 |
| M setMarkedText（読みを選択して composition で置換し、確定） | 0 / `echo ごきげん麗しゅう` | 0 / 同（対象外） |

- 観測と一致するのは E と F だけで、どちらも 4a07c17 で読みが 1 文字分だけ消える。WebKit の `TypingCommand` は、続けて打つ後方削除を開いたままの typing command に足し、`beforeinput` を `willAddTypingToOpenCommand` で出す。
  `input` は `typingAddedToOpenCommand` で scoped queue に積まれる（`Editor.cpp` の `dispatchInputEvent` の FIXME。tmp/sources に 2026-10-27 取得の写しがある）。
  このため F のように、`beforeinput` と `input` の配送の順序が 1 対 1 にならない列は起こりうる。ただし、どちらが実機の列かはコードからは決められない（推定）。
- 「hell.」: `echo hello` の後に、1 文字消して「.」を入れる列（例: 予測・自動修正が「o」を「.」へ置き換える）なら、A でも E/F でも同じ行になる。
  この観測だけでは列を見分けられない（`tmp/repro/hell.mjs`）。打鍵の意図も確認していない。
- M（読みを選択して marked text で置き換える列）は、4a07c17 でも本 ADR でも読みが残る。xterm の CompositionHelper は、compositionstart の時点の値の長さを起点に確定文字を送るため、選択した読みの削除を表せない。
  観測（漢字は入り、読みが 1 文字だけ消えた）とは一致しないので、本 ADR の対象外とする。

## Considered Options

1. (A) 送信済みの影を起点にする。本プラグインが差分を送った時点と Backspace を写した時点の値を影として持ち、次の `input` はその影との差を送る。影が無いときは `beforeinput` の時点の値を起点にする。
   xterm が値を変える場面や、xterm 自身が送る場面（229 以外の keydown、compositionstart、blur、対象外の inputType）では影を捨てる。値が編集の外で変わったことは、input を待つ beforeinput が 0 個のときに来た beforeinput の値が影と違うことで見分けて、影を捨てる。
2. (B) `beforeinput` の時点の値を列（キュー）で持ち、`input` ごとに 1 つずつ取り出す。
3. (C) 後方削除だけは、差分ではなく `input` 1 回につき DEL を 1 つ送る。
4. (D) 現状のまま（列を実機で確かめてから直す）。

## 結果

- 案 A: 再現表の A–L で 3 / `echo ご機嫌麗しゅう`。`npm test` は 112 件すべて緑（`terminal-input` 51 件）。
  4a07c17 では、新しいテスト 13 件のうち 7 件が赤になった（4 列の変換、Backspace の写しの後の変換、229 が挟まる削除、input が別のタスクに遅れる削除）。
  残る 6 件は影を捨てる場面・変換の後・編集外の変化・取り消された beforeinput・input の来ない beforeinput・貼り付けの検査で、4a07c17 でも緑になる。これらは 4a07c17 に無い仕組みを外した変異を検出するためのテスト。
  変異 15 種（時間で待ちの数を失効させる、値が空での後方削除を待ちに数える、paste で影と数を捨てない、229 でも待ちの数を 0 に戻す、取り消された beforeinput を数えたままにする、編集外の変化の判定を外す、beforeinput を数えない、229 以外の keydown・compositionstart・blur・対象外の input で影を捨てない、送信後に影を更新しない、Backspace の写しの後に影を更新しない、起点を beforeinput の値を優先に戻す）は、すべて赤になった。
  緑のまま残る変異が 2 種ある。input で待ちの数を減らす処理を外す変異と、paste で数だけ捨てて影を残す変異。後者は、次の beforeinput の値が影と違うことで影が捨てられるので吸収される。どちらの処理も防御として残す。
  （次のタスクで数を 0 に戻す案は 3 回目のレビューで取り下げた。その案を足す変異は赤になる。）
  変異として試したところ、実装には冗長な更新が 3 か所あった（変換中の input・読み取り専用の input で影を捨てる箇所、keydown で送り済みの打鍵の後に影を更新する箇所）。変換中は compositionstart で、送り済みの打鍵は keydown で、影をすでに捨てている。読み取り専用の間に値が変わった場合は、次の beforeinput の時点の値が影と違うことで捨てられる。このため 3 か所とも削除した。
- 案 B: F と G には効く。しかし E と H（beforeinput が無い削除）では、取り出す値が無いか、別の編集の値になり、数え落とす。
- 案 C: 削除が 1 文字単位なら効く。しかし `deleteWordBackward`、選択範囲の削除、置換と組み合わさった列に対応できず、`beforeinput` の時点の値との二重計上も別に防ぐ必要がある。
- 案 D: 実機の列が分かるまで不具合が残る。案 A は既存の列の結果を変えないので、待つ利点が小さい。

## Decision

案 A を採る。実機の列は E か F と推定する（観測と一致し、WebKit の配送の仕組みと矛盾しない）。案 A はそれ以外の列でも同じ結果になるので、列を特定しなくても直る見込みが高い。
実機での確認が済むまでは proposed とする。

## Pros and Cons

### A. 送信済みの影（採用）
- Good: beforeinput と input の対応に頼らない。端末へ送った内容と textarea の値の差を、そのまま次の送信にする。
- Bad: 状態が 1 つ（影と、待っている beforeinput の数）増える。影を捨て損ねる場面があると、古い影から誤った DEL を送る。主な場面はテストで押さえたが、xterm の版上げや DSH の値の書換えが増えたときは見直す。
  値が編集の外で変わり、その直後の beforeinput が別の beforeinput の後（input を待っている間）に来る場合は、影を捨てられない。

### B. beforeinput のキュー
- Good: 起点の意味が今と変わらない。
- Bad: beforeinput が無い列に効かない。

### C. 削除は input ごとに DEL を 1 つ
- Good: 単純。
- Bad: 単語削除と置換を表せない。

## 独立レビュー

- codex / gpt-6.1-sol（workflow、閲覧のみ・編集禁止・再委譲禁止。secret-scan --patch 済みの staged 差分）。指摘 2 件を両方採用した。
  1. (high) 229 の keydown で待ちの beforeinput の数を 0 に戻すため、「beforeinput → 値の変更 → keydown 229 → beforeinput → 値の変更 → input ×2」の列で
     2 つ目の beforeinput が未送信の値を編集外の変化と誤り、影を捨てて DEL を 1 つ落とす → 229 では数を戻さないようにした。回帰テストを足した。
  2. (medium) 取り消された beforeinput（input が来ない）を数えたままにするため、その後の編集外の変化で影を捨てられず、古い影から誤った DEL と再送が出る
     → 配送の後（window の bubble）に `defaultPrevented` を見て数から外す。回帰テストを足した。伝播を止めたうえで取り消すリスナーには効かない（229 以外の keydown・blur で 0 に戻る）。
- 同上の 2 回目（修正後の差分）。指摘 1 件を採用した。
  1. (medium) 取り消されていないのに input が来ない beforeinput（値が空での後方削除）が数に残り、229 では戻らないので、その後の編集外の変化を見逃して文字を再送する
     → 最後の beforeinput の次のタスクで数を 0 に戻す案を一度入れたが、3 回目のレビューで反例が出たので取り下げた（下記）。
       代わりに、値が空での後方削除（本プラグインが DEL を送る場合）を数えないようにした。回帰テストを足した。
- 同上の 3 回目。指摘 1 件を採用した。
  1. (medium) 次のタスクで数を 0 に戻すと、input が別のタスクに遅れて来る列（beforeinput → 値の変更 →〔timer〕→ beforeinput → 値の変更 → input ×2）で、
     2 つ目の beforeinput が未送信の値を編集外の変化と誤り、DEL を 1 つ落とす → 時間による失効をやめた。編集外の変化のうち実際に起きる xterm の貼り付け（paste で値を空にする）は、
     paste で影と数を捨てて扱う。回帰テストを 2 件足した（遅れて来る input、貼り付け）。
     残る制限: 取り消されず input も来ない beforeinput（値が空での後方削除以外）があると、次の 229 以外の keydown・compositionstart・blur・paste まで編集外の変化を見分けられない。
     その間にスクリプトが値を変えると、余分な DEL や再送が出うる。DSH と xterm には、そうした書換えは見つけていない（xterm が値を書き換えるのは Enter・Ctrl+C・blur・paste だけ）。
- 同上の 4 回目（修正後の差分）。high / medium の指摘なし。

## 実装（`ADR-20261027-1700` で grep）

- `lib/client.js` の「iOS の文字入力を xterm へ 1 回だけ届ける」ブロック（`shadow` と `pendingBi`）。仕様は spec.md §5.3 `TerminalInputReachesOnce`。

## 検証

- 自動テスト: `npm test` 112 件、`test/terminal-input.test.mjs` 51 件。
- 実機: 未確認。手順は spec.md §8 の 2。直らない場合は `tmp/terminal-input-probe.md` の「変換で読みが残る」の手順で、イベント列を 1 回記録する。

## 出典

- WebKit `Source/WebCore/editing/TypingCommand.cpp`、`Editor.cpp`、`CompositeEditCommand.cpp`（main。2026-10-27 に raw.githubusercontent.com から curl で取得し、tmp/sources に置いた）。
  `deleteKeyPressed` と `willAddTypingToOpenCommand` は開いた typing command に削除を足し、`dispatchInputEvent` は scoped queue に積む。
- ADR-20261027-1400 の出典（UITextDocumentProxy、azooKey の記事、xterm.js issue #5835 など）はそのまま有効。
