# セッション選択と入力欄のタッチ操作（1 タップで開く・自動フォーカス抑止・Enter で改行）

- Status: proposed
- Date: 2026-10-26
- Level: 3
- Deciders: オーナー（T309 は A+C 案、T344 は COARSE で既定オン・送信はボタン、を決定）、実装は AI
- Task: T309（セッション選択の 1 タップ化）、T310（自動フォーカスの抑止）

## Context

iPhone PWA で、サイドバーのセッション行を開くのに 2 タップ要り、素早く 2 回タップすると改名ダイアログが開く（T309）。
DSH 0.2.0-rc.2 の行（ui-workspace `SessionNodeItem`）は JS 上は 1 クリックで開くが、行 CSS が `:hover` で「…」を表示し時刻とピンを隠す。
この規則は `@media (hover:hover)` で囲まれておらず、タッチ端末にも効く。タイトルには `onDoubleClick` の改名がある。
本プラグインは spec §3 のとおり、ハッシュ化クラス名と内部ストアに依存しない。

## 決定点

1. 2 タップ問題への対処（T309-A）。
2. 改名ダイアログの誤発火（T309）。
3. セッションを開いた後のドロワー（T309-C）と、そのための `ctx.sessions` への依存の持ち方。
4. セッションを開いたときの入力欄への自動フォーカス（T310。開くたびにキーボードが出てチャットが隠れる）。

## 評価基準（実装前に確定）

- iPhone PWA で、セッション行の 1 タップで開くこと（実機）。
- 行を開く操作で改名ダイアログが開かないこと。改名の経路がタッチでも残ること。
- 開いた後、PHONE ではドロワーが閉じてチャットが見えること。経路（行・新規・検索・fork）によらないこと。
- `ctx.sessions` が無い・形が違う構成でも、既存機能（ドロワー・キーボード追従）が起動すること。
- spec §3 の方針（ハッシュ化クラス名と内部ストアに依存しない）を守る。守れない部分は構造依存として明記する。
- 入力欄（またはその近辺のボタン）をユーザーがタップしたときは、確実にキーボードが出ること（T310 の最優先）。
- メニュー・ダイアログ内の入力（モデル検索・改名）を閉じないこと。
- 自動テストで、各ガードを壊した版が赤になること。

## 選択肢

1. 2 タップ問題
   - 1A. COARSE で行の子の display を hover 時と同じに固定する CSS（「…」常時表示、時刻・ピンは非 hover 時の表示）。
     セレクタは `[data-row-key^="session:"][role=treeitem]` と子の順序で書く。
   - 1A'. 同じことを `[class*=sessionRow]` など、クラス名の部分一致で書く。
   - 1B. pointerdown / pointerup を見て、click が来なければ行へ click を合成する（調査メモ案 B）。
2. 改名の誤発火
   - 2a. COARSE で、セッション行内の dblclick を document の capture 段階で止める。改名は「…」メニュー（1A で常時表示）から行う。
   - 2b. 何もしない（1A で 2 タップが解消すれば dblclick も起きにくい）。
3. ドロワーと依存
   - 3a. `ctx.sessions.list` を購読し、`retainedBy.mainView > 0` の id 集合に新しい id が現れたら閉じる。
     `sessions` は必須の `inject` に入れず、`ctx.inject(["sessions"], …)` の子 fiber で任意依存として待つ。
   - 3b. 3a と同じ検知で、`module.exports.inject` に `"sessions"` を足す。
   - 3c. 行の click を capture で検知して閉じる。
   - 3d. `aria-selected` の変化を MutationObserver で監視する。
4. 自動フォーカス
   - 4a. focusin の capture ガード。入力欄・入力カードで始まった押下の間でも、その開始・終了から 1.5 秒以内でもないフォーカスを、次のタスクで blur する。
     近辺の外での操作は記録を消す。keydown は場所を問わずユーザー操作とみなす。対象は `[data-composer-input]` で、menu / dialog / listbox 内は除く。
   - 4b. `inputmode="none"` を付けておき、タップでだけ外す。
   - 4c. `editor.focus` を差し替える（Lexical の内部 API）。

## 外部根拠（比較実験は iPhone 実機が要り、本 ADR の作成時点では未実施）

- Apple「Safari Web Content Guide: Handling Events」（Documentation Archive、2016-12-12 更新）:
  タップでは mouseover, mousemove, mousedown, mouseup, click の順に送られ、
  「if the contents of the page changes on the mousemove event, no subsequent events in the sequence are sent」。
  https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html
  （2026-10-26 web_fetch で取得）。古い文書であり、現行 iOS が `:hover` の display 変化を同じ扱いにするかは未確認。
- DSH 0.2.0-rc.2 の配布物（読み取りのみ）: ui-workspace `lib/client.js` の 1061 行（行 CSS）、1571–1684 行（`SessionNodeItem`）、
  986–990 行付近（`replaceMain` は新参照を retain してから旧参照を release）。api-session-controller の
  `lib/types/client/contract/sessions.d.ts`（`ISessions.list`）。cordis 4.0.4 の `src/fiber.ts` `_refresh`
  （inject の全サービスが揃うまで fiber を INACTIVE のままにする）と `src/registry.ts` の `inject()`。

## 決定

1A、2a、3a。

## 理由

- 1A: 原因（推定）である「hover で表示が変わる」を直接なくす。「…」が見えるので、改名・ピン留めなどの行メニューにもタッチで届く。
  1A' はハッシュ化クラス名の一部（`sessionRow`）がビルドで保たれることに依存し、spec §3 の方針に反する。安定属性（`data-row-key`・`role`）で
  行は特定できるため不要。子の特定は順序に依存する（構造依存。spec §3 に明記）。
  1B は合成 click が本物の click と二重に届く経路の検証が要り、1A で解消するなら不要。1A が実機で効かなければ 1B を検討する。
- 2a: 2 タップが残る間も、改名の誤発火を確実に止める。改名の経路は「…」メニューとショートカットに残る。fine pointer では従来どおり。
- 3a: 表示中の判定は DSH 自身（ui-workspace）と同じで、公開サービスの公開型だけを使う。行・新規・検索・fork の全経路を 1 か所で拾う。
  「新しい id が現れたときだけ」にすると、`replaceMain` の一時的な 2 件と旧の release で二重に反応しない。
  3b は cordis が必須依存の揃うまで `apply` を呼ばないため、`sessions` が無い構成で本プラグイン全体が止まる。
  3c は経路ごとの対応が要る。3d は行が描画されていない（折りたたみ・仮想化）と取りこぼす。

- 4a: DSH の focus を止めずに後から外すので、iOS がキーボードを出す条件（同期区間の focus）に手を加えない。
  ユーザーのタップは focus より前に capture で記録されるため、タップした回は外さない（評価基準の最優先）。
  blur を次のタスクにするのは、focus の処理中の同期 blur が DSH / Lexical の再フォーカスと再帰しうるため。
  近辺の外での操作で記録を消すのは、入力欄に触れた直後に行を開いた場合も、切替による自動フォーカスを外すため。
  4b は React が `inputmode` を管理しないものの、フォーカス中に属性を外したとき iOS がキーボードを出すか不確実。4c は内部実装への依存。
  上流（kuraneko1/dsh-mobile-maxxing 24e2e49、MIT）の focusin ガードの考え方を参考にした（コードは独立）。

## Consequences

- Positive: 行を 1 タップで開ける見込み（実機未確認）。開いた後にドロワーが自動で閉じる。開いた後にキーボードが出ない見込み。
- Negative: 「…」が常時見えるため、タイトルの表示幅が狭くなる。COARSE ではタイトルのダブルタップで改名できない。
  T310: キーボードが一瞬出て引っ込む可能性がある。キーボード付きの iPad（COARSE）でも、開いた直後は入力欄にフォーカスしない。
- Risk / 再検討条件: 実機で 2 タップが残る（原因が hover 以外: HoverCard の 800ms タイマー、marquee の rAF 等）なら 1B を検討する。
  DSH の行の子の順序が変われば別の子の display を固定する（誤作動）。版の更新時に spec §3 の契約を確認する。

## 検証

- 自動テスト（`npm test`、38 件）: CSS の構造（COARSE の media 内、安定属性のみ）、media を外した規則が DSH と同じ子の順序の行で
  「…」・時刻・ピンに当たること、dblclick の抑止（COARSE のみ・行内のみ）、切替時に 1 回だけ閉じること（一時 2 件・旧の release・
  他の更新・閉時・PHONE 外では呼ばない）、`sessions` が無い構成で他機能が動くこと、dispose で購読を外すこと。
  閉が再描画で後から反映される場合に、反映前の連続切替（a→b→c）で開き直さないこと。
  変異 6 種（dblclick リスナー削除、「新しい id」判定の削除、`:has(button)` の削除、PHONE 判定の削除、開判定の削除、閉要求の保留の削除）でいずれも赤になることを確認した。
- 独立レビュー（codex / gpt-6.1-sol、閲覧のみ）: 閉の反映前に次の切替が来ると再トグルで開き直す、との指摘を採用し、1 秒の保留を加えた。
- 実機: 未確認。

- T310 自動テスト（41 件時点）: ユーザー操作の無いフォーカスを次のタスクで外すこと（同期では外さない）、fine pointer では外さないこと、
  入力欄への pointerdown / touchstart、送信ボタンへの pointerdown、keydown の直後は外さないこと、入力欄の後に行を触った場合は外すこと、
  期限 1.5 秒の境界、長押し（押下中・押下の終了直後）、dispose 後に予約済みの blur を実行しないこと、dialog 内と入力欄以外には触らないこと。
  変異 10 種のうち 9 種で赤。
  赤にならなかった 1 種（focusin 側の同期判定 `userIntendedFocus()` の削除）は、setTimeout 側の同じ判定が結果を決めるため挙動が変わらない（冗長な早期 return）。
- T310 独立レビュー（codex / gpt-6.1-sol、閲覧のみ）: (1) 期限が押下の開始基準なので、長押し後の正当なフォーカスを外す、
  (2) dispose 後も予約済みの blur が走る、の 2 件を採用した。押下中の状態と押下の終了時刻を記録し、撤去フラグで予約を無効にした。
- T310 実機: 未確認。

## 関連ADR

- ADR-20261023-1720
