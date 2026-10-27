# 既知の問題

対象: `lib/client.js`（ブランチ `feat/chrome-terminal` 時点）、`@deepseek-ai/dsh-web-app` 0.2.0-rc.2。
各項目は GitHub issue（#1〜#8、#11、#12）に転記済み。進捗と議論は issue で扱い、確定した仕様の変更は spec.md に反映する。
特記のない限り、コードと DSH 配布物を読んで導いた推定であり、実機では観測していない。

**モバイルへの影響の目安**: iPhone のソフトウェアキーボードには Escape キーが無い。そのため Escape 起点の問題（KI-1、KI-7）は、
外付けキーボード（iPad の Magic Keyboard、Bluetooth キーボードなど）を使うときだけ起きる。

| ID | 概要 | 影響範囲 | 状態 |
|---|---|---|---|
| KI-1 | Escape で閉じた後、フォーカスが FAB に戻らない | 外付けキーボード | 解決（ブランチ fix/ki-small-bugs、実機未確認。[#1](https://github.com/HARU-pc/dsh-mobile-ui/issues/1)） |
| KI-2 | ピンチズームで `#root` の高さが縮む | iPhone PWA（KI-8 の修正で顕在化） | 対応済み・実機確認待ち（ADR-20261026-1450、[#2](https://github.com/HARU-pc/dsh-mobile-ui/issues/2)） |
| KI-3 | reduced-motion 設定でも閉じるアニメーションが残る | 視差効果を減らす設定の利用者 | 解決（ブランチ fix/ki-small-bugs、実機未確認。[#3](https://github.com/HARU-pc/dsh-mobile-ui/issues/3)） |
| KI-4 | iPad 横（≥1024px）ではスワイプが効かない | iPad | 検討中（[#4](https://github.com/HARU-pc/dsh-mobile-ui/issues/4)） |
| KI-5 | モーダルなど前面の UI 上のスワイプが、背後のレイアウトを操作する | スマホ | 解決（ブランチ fix/ki-small-bugs、実機未確認。[#5](https://github.com/HARU-pc/dsh-mobile-ui/issues/5)） |
| KI-6 | coarse 判定へ戻ったとき、キーボード追従の高さを再計算しない | ほぼ無し | 記録のみ（[#6](https://github.com/HARU-pc/dsh-mobile-ui/issues/6)） |
| KI-7 | ドロワーとモーダルが同時に開いた状態で Escape を押すと、両方とも閉じる | 外付けキーボード | 解決（ブランチ fix/ki-small-bugs、実機未確認。[#7](https://github.com/HARU-pc/dsh-mobile-ui/issues/7)） |
| KI-9 | 入力欄をタップすると、入力欄が画面の上へ外れていく | iPhone PWA（実機で報告あり） | 解決（ADR-20261024-0450、2026-10-24 に実機で確認） |
| KI-8 | ピンチによる拡大縮小が効かない | iPhone PWA（実機で報告あり） | 対応済み・実機確認待ち（ADR-20261026-1450、[#8](https://github.com/HARU-pc/dsh-mobile-ui/issues/8)） |
| KI-10 | キーボード表示中、モデル選択メニューが画面上端の外へ出る | iPhone PWA（実機で報告あり） | 解決（ADR-20261024-1646、2026-10-24 に実機で確認。修正は [#11](https://github.com/HARU-pc/dsh-mobile-ui/issues/11)） |
| KI-11 | FAB が会話のセッション名・右パネルのファイル名の先頭を隠す | スマホ | 対応済み・実機確認待ち（ADR-20261026-1800、[#12](https://github.com/HARU-pc/dsh-mobile-ui/issues/12)） |
| KI-12 | 右パネルのターミナルで、キーボードは出るのに文字が入らない（日本語は変換できない） | iPhone PWA（実機で報告あり） | 対応済み・実機確認待ち（ADR-20261027-1400） |

## KI-1 Escape で閉じた後、フォーカスが FAB に戻らない（旧 Q1）

- **現象（推定）**: `onKeyDown` は、`toggle()` の直後に同期的に `fab.focus()` を呼ぶ（[client.js](../lib/client.js) の Escape ハンドラ）。
  FAB は `body[data-dsh-mobile-sidebar=closed]` のときだけ表示されるが、この属性は MutationObserver のコールバックで後から更新される。
  したがって `focus()` を呼んだ時点の FAB はまだ `display:none` で、フォーカスできない。さらに、閉じたドロワーは inert になるため、
  フォーカスの行き先は UA 次第になる。
- **期待**: 閉じた後、フォーカスが FAB に移る。
- **修正案**: `syncState()` を先に同期的に呼んでから `focus()` する。または `requestAnimationFrame` の後で focus する。
- **テスト**: happy-dom は `display:none` の要素でも focus できてしまう（20.14.6 で確認）ため、focus を呼んだ時点の body 属性で検査する。
- **対応**: Escape でフォーカスの予約（期限 1 秒）を置き、`syncState()` が閉を観測して body 属性と inert を更新した直後に `fab.focus()` する。
  DSH 0.2.0-rc.2 の `toggleSidebar()` はストア（`narrowExpanded`）を反転するだけで、frame の属性は再描画後に変わるため、
  「toggle 直後に同期 syncState → focus」だけでは足りない（直後の syncState は呼ぶが、この時点ではまだ開のまま）。

## KI-2 ピンチズームで `#root` の高さが縮む（旧 Q3）

- **現象（推定）**: `visualViewport.resize` は scale を区別せず、`--dsh-mobile-vvh` に `visualViewport.height` を入れる。
  倍率 2 なら、レイアウト座標上の `#root` の高さは半分になる。
- **状態**: 対応済み・実機確認待ち。KI-8 と同時に扱った。
- **対応**: ADR-20261026-1450。`|visualViewport.scale − 1| > 0.01` の間は `--dsh-mobile-vvh` / `--dsh-mobile-vvtop` も
  `window` への `resize` 再送も更新せず、等倍へ戻った後の最初のイベントで追従し直す（spec.md §6 `PinchFreezesRoot`）。
  あわせて、拡大中の単指パンがスワイプとして誤発火しないよう、開始時・終了時にズーム中ならスワイプにしない（spec.md §5 `NoSwipeWhileZoomed`）。
- **残る制限（推定）**: ズーム中にキーボードが出入りしても `#root` は直前の高さ・上端のまま。拡大したまま入力欄へフォーカスすると
  iOS のパンに追従しない。ピンチ終了時に等倍のイベントが来なければ、次のイベントまで古い値が残る。

## KI-3 reduced-motion 設定でも閉じるアニメーションが残る（旧 Q6）

- **現象（CSS の読解による）**: 閉時のセレクタ `[data-sidebar-collapsed]:has(> [data-rightbar-col])>:first-child` の詳細度は (0,3,0) で、
  reduced-motion 側の `:has(> [data-rightbar-col])>:first-child` の (0,2,0) より高い。このため、閉じるときは `transition:transform .25s, visibility 0s .25s` が残る。
- **修正案**: reduced-motion 側に、閉時のセレクタと同じ詳細度のルールを追加する。
- **テスト**: happy-dom 20.14.6 は `settings.device.prefersReducedMotion` を media と詳細度つきのカスケードに反映するため、
  computed の `transition` で開閉の両方を検査する（修正前の版では閉で赤になることを確認）。実ブラウザの描画（アニメーションが実際に止まるか）は実機で確認する。
- **対応**: reduced-motion の media に `[data-sidebar-collapsed]:has(> [data-rightbar-col])>:first-child{transition:none;}` を追加した。

## KI-4 iPad 横（≥1024px）ではスワイプが効かない（旧 Q4）

- **現状**: スワイプは `(max-width:1023px) and (pointer:coarse)` の範囲でしか動かない。そのため、iPad 横では右パネルから「戻る」スワイプが無い。
  768–1023px（iPad 縦）で有効なスワイプは、右パネルを畳む操作だけである。
- **状態**: 検討中。iPad 実機での確認が未実施のため、必要かどうかを判断できていない。確認する点は次の 3 つ。
  1. 横向きで、右パネルの閉じるボタンだけで不便がないか。
  2. 縦向きで「戻る」スワイプが動くか。
  3. DSH 標準のレール表示とスワイプが衝突しないか。

## KI-5 前面 UI 上のスワイプが背後のレイアウトを操作する（旧 Q7）

- **現象（推定）**: touch のリスナーは起点の要素を限定していない。pointerdown 側の「frame 外は触らない」ガードが touch 側には無い。
  再現例: 幅 390px の coarse 端末で、`document.body` へ portal された Modal 上を (20,100)→(100,100) と単指でなぞる。
  背後の右パネルが展開中ならそれが畳まれ、そうでなければ背後のサイドバーが開く。
- **修正案**: touchstart で起点が frame 外なら候補にしない（pointerdown と同じ境界にそろえる）。
  これは軽微な修正で、テストも書ける（`harness.mjs` に portal 要素を足す）。
- **対応**: touchstart で、frame があり起点が frame 外なら候補にしない（spec §5.1 `SwipeOnlyInsideFrame`）。
  判断: FAB（body 直下）は例外として候補に残す（FAB 上の右スワイプは「開く」と一致し、背後の誤操作ではないため）。
  frame が無いとき（SafeDegrade）は境界が無いので掛けない（従来どおり）。テストは `harness.mjs` の `addPortal()`（role=dialog の全画面レイヤ）で行う。
  残る制限: frame 内に描画される前面 UI（frame の子孫として描かれるポップオーバー等）は区別しない。

## KI-6 coarse 判定へ戻ったとき、キーボード追従の高さを再計算しない（旧 Q9）

- **現象**: `(pointer:coarse)` の change を監視していない。coarse → fine → coarse と切り替わる間に visualViewport の高さが変わると、
  次の resize まで古い高さが `#root` に残る。
- **モバイルへの影響の評価**: iPhone では primary pointer が常に coarse なので、この経路は起きない。
  iPad にトラックパッド付きキーボードをつないだときに `(pointer:coarse)` が変わるかどうかは未確認（推定では変わらない）。
  幅の変化（回転）では `vv.resize` も発火するため、高さは更新される。結論として、実用上の影響はほぼ無いと判断し、記録だけにとどめる。
- Escape との関係: 無い（KI-1・KI-7 とは独立した問題）。

## KI-7 ドロワーとモーダルが同時に開いた状態で Escape を押すと、両方とも閉じる（旧 Q8）

- **現象（推定）**: DSH の `Modal`（primitives 0.2.0-rc.2 の `useModalLayer`）は、document の keydown で Escape を処理する。
  このとき `preventDefault()` は呼ぶが、`stopPropagation()` は呼ばない。本プラグインの keydown リスナーは `defaultPrevented` を見ないので、
  ドロワーも閉じる。ただし Modal のリスナーが後に登録されて後に実行される場合は、`defaultPrevented` を見ても防げない。
- **修正案**: `event.defaultPrevented` を確認する。あわせて、`[aria-modal=true]` が存在する間は Escape を無視する。
- **影響**: 外付けキーボードのときだけ起きる。
- **対応**: Escape のハンドラで `event.defaultPrevented` と `document.querySelector("[aria-modal=true]")` を確認し、どちらかなら何もしない（spec §4.3 `EscapeYieldsToForeground`）。
  0.2.0-rc.2 の配布物で、Modal は `[role=dialog][aria-modal=true]` を描画し document の bubble で Escape を処理すること、
  MenuSurface 系は capture 段階で `preventDefault` することを確認した。
  残る制限: aria-modal を付けず、preventDefault もしない前面 UI とは引き続き同時に閉じうる。0.2.0-rc.2 では HoverCard の preview
  （window の bubble 段階で処理）が該当する。Tooltip（openOnClick）は capture で `stopPropagation` するため対象外。

## KI-8 ピンチによる拡大縮小が効かない（旧 Q5）

- **観測**: オーナーが iPhone PWA の実機で「ピンチ操作での拡大縮小がそもそも効かない」と報告した（2026-10-24）。
  これは spec.md と README の「iOS は手動ピンチでは maximum-scale を無視する」という前提と食い違う。
- **原因の仮説（未検証）**:
  1. 本プラグインが viewport meta に付ける `maximum-scale=1`。iOS がこれを無視するのは Safari のタブでの話で、
     ホーム画面の Web アプリ（standalone）では尊重される可能性がある。
     WebKit の埋め込み向け API には、作者の指定を上書きするかどうかの設定 `ignoresViewportScaleLimits`（既定は false）がある
     （[Apple Developer: ignoresViewportScaleLimits](https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/ignoresviewportscalelimits)、2026-10-24 web_fetch で取得）。
     つまり「無視するかどうかはブラウザ側の設定次第」であり、standalone での既定値は一次資料で確認できていない。
  2. DSH 本体のアプリ外枠（`#root` の固定高さ、`overflow:hidden` など）。DSH の index.html の viewport は
     `width=device-width, initial-scale=1` だけで、ズームを禁止していない（dsh-web-frontend 0.2.0-rc.2 の dist/index.html）。
- **切り分け**: `cordis.patch.yml` からプラグインを外して再読込し、ピンチが効くかを試す。効けば仮説 1 になる。
- **対応（実機確認待ち）**: ADR-20261026-1450。`maximum-scale=1` をやめ、viewport meta は項目単位でマージする
  （`width` / `initial-scale` / `viewport-fit` / `interactive-widget` だけを上書き・追加。`user-scalable` 等のズーム制限は足さない）。
  フォーカス時の自動ズームは入力 16px 化のルールだけで防ぐ。KI-2 も同時に扱った。
  2026-10-26 に DSH 0.2.0-rc.2 の配布物を確認し、`dsh-web-frontend` の CSS で `touch-action:none` が使われるのは dock の
  分割線・タブ帯・リサイズつまみだけで、アプリ全体のピンチを止める指定は見当たらなかった（読解による。仮説 2 は未切り分け）。
- **実機での確認項目**: ピンチ拡大・縮小ができるか。入力欄（チャット入力、モデル選択の検索欄）へのフォーカスで自動ズームしないか。
  キーボード表示中にピンチしても `#root` が縮まず、等倍へ戻すと元の追従に戻るか。
  効かないままなら、プラグインを外した状態との比較で仮説 2 を切り分ける。

## KI-10 キーボード表示中、モデル選択メニューが画面上端の外へ出る

- **観測**: オーナーが iPhone PWA の実機で報告した（2026-10-24）。モデルを選択しようと一覧を開き、一覧の外側の余白を
  スクロールすると、一覧が画面上端の外へ出る。新規セッションに限らず発生する。
- **原因（実機の計測で確認）**: iOS はキーボードで visual viewport をパンしている間、`getBoundingClientRect()` を
  可視範囲基準で返すが、`position:fixed` の `top` は layout viewport 基準のまま解釈する。
  ADR-20261024-0450 で `#root` だけを `offsetTop` 分補正していたため、`document.body` へ portal される
  固定オーバーレイ（DSH のメニューなど）は `offsetTop` の分だけ上へずれる。DSH の `ModelSelect.place()` は
  可視基準の rect から layout 基準の `top` を計算するため、キーボード表示中は常にずれる。
  実測（キーボード表示中）: メニュー `top = -25`、トリガー `top = 290`。同じ `top` を持つ本プラグインの診断バッジも上端が欠けた。
- **対応**: ADR-20261024-1646。body 直下の固定要素に `data-dsh-mobile-overlay` を付け、`COARSE` のあいだ
  `translate: 0 var(--dsh-mobile-vvtop)` で `#root` と同じ座標系へ寄せる。あわせて、`visualViewport` の変化時に
  `window` へ `resize` を再送し、DSH の再配置を促す。2026-10-24 にオーナーが iPhone PWA で確認し、解決とした。
- **残る制限**: 横方向（offsetLeft）は補正しない。layout viewport 全体を覆うレイヤ（`inset:0` の Modal 等）は対象外で、
  キーボード表示中の中央寄せは従来どおり（別問題）。`translate` が containing block を作るため、
  オーバーレイ内に `position:fixed` の子要素がある場合は基準が変わりうる（DSH のメニュー・モーダル・トーストでは未確認）。

## KI-9 入力欄をタップすると、入力欄が画面の上へ外れていく

- **観測**: オーナーが iPhone PWA の実機で報告した（2026-10-24）。入力欄を手動でタップすると、入力欄が画面の上へ外れていく。
  スクロールし直すと戻るが、同じ状態から再び画面外へ出せる。
- **原因（推定）**: iOS はキーボードが出ても layout viewport を縮めず、visual viewport を下へパンする。通常フローの `#root` は、
  そのパン量だけ上へずれる。旧実装の `scrollTo(0,0)` は iOS のフォーカス時スクロールと競合した。また html/body に
  スクロールの余地が残っていた。
- **対応**: ADR-20261024-0450（`#root` を fixed にして visual viewport へ追従させる）。2026-10-24 にオーナーが iPhone PWA で確認し、解決とした。

## KI-11 FAB が会話のセッション名・右パネルのファイル名の先頭を隠す（issue #12）

- **現象**: スマホ幅でドロワーが閉じているとき、左上の FAB（右端 = `safe-left + 46px`）が会話ヘッダのセッション名の先頭と、
  右パネル（<768px で全画面）のタブ列・ファイル名の先頭に重なる。
- **対応（実機確認待ち）**: ADR-20261026-1800。閉時の frame に DSH 自身の変数 `--dsh-frame-leading-clearance` を与え、会話ヘッダのタイトルを
  FAB の右から始める（DSH 0.2.0-rc.2 の ui-conversation が参照する）。右パネル展開中は FAB を隠す（spec.md §4.5）。
  右パネルからサイドバーへは、右パネルを閉じるボタンか左端からの右スワイプで畳んでから FAB を使う。
- **残る制限**: 全画面ルート（Plugins / Schedules など）の見出しと FAB の重なりは扱っていない。DSH が変数の参照をやめると、重なる元の表示へ戻る。

## KI-12 右パネルのターミナルで、キーボードは出るのに文字が入らない（T311）

- **観測**: オーナーが iPhone PWA の実機で報告した（2026-10-26）。T343 のタップ時フォーカスより前から起きていた。
  2026-10-26 23:23 の追加報告: 読み取り専用ではない（タップでキーボードが出る）。キーボードは Gboard。Enter は入り、押すたびにプロンプトが進む。
  英字はほぼ入らず、まれに `a` だけが入った。
- **原因（コード・一次資料と happy-dom の再現による。実機のイベント記録は未取得）**:
  1. iOS の WebKit は、キーボードの入力メソッドが処理したキーの keydown を keyCode 229 にする（WebKit `EventHandler.cpp` の `CompositionEventKeyCode = 229`）。
     Gboard などのサードパーティキーボードは文字を `insertText` で入れるため、英字も keydown 229 → `beforeinput` / `input`（`insertText`、`composed:true`）→ keyup の列になる（推定。
     同じ列は iOS の中国語 IME の空白・句読点で記録がある: xterm.js issue #5835）。
  2. xterm 6.0.0 の `_inputEvent`（sidebar-terminal 0.2.0-rc.2 `client.terminal.js:532`）は、keydown から keyup まで（`_keyDownSeen`）に来た `composed` な input を捨てる。
     UA の input は常に `composed` なので、この列の文字は xterm の CompositionHelper の差分検出（同 `:1291-1326`）にしか拾われない。
  3. 差分検出は keydown のときの値を控え、`setTimeout(0)` の後の値と比べる。値の更新がこの timer より遅れると、比べた時点で値はまだ変わっておらず、文字が落ちる
     （#5835 の記録では input が keydown より 7–10ms 遅れる。iOS の実際の timer との前後は未計測）。
  4. Enter は keyCode 13 の keydown を xterm が自分で `\r` に変えて送るので通る（同 `:493-511`、`:5140` 付近の `evaluateKeyboardEvent`）。Backspace も同じ経路。
  5. まれに `a` だけ入る理由（仮説、未検証）: (i) 入力が keydown の timer より先に値へ入った打鍵だけを差分検出が拾う（happy-dom で input の遅れを 0ms にすると届き、1ms 以上で落ちる）、
     または (ii) その打鍵だけ keydown が keyCode 65 で来た（xterm は keyCode ≥ 48 の 1 文字を keydown で送る）。`a` に偏る理由は特定していない。
- **対応（1 回目、f8e4bb0）**: ADR-20261027-0020。`COARSE` で、xterm が捨てる `insertText` の input を document の capture で止め、`composed` でない input として同じ data を送り直す。
  送り直す前に textarea の値を `beforeinput` の時点へ戻し、差分検出との二重送信を避けた。
- **追加の観測（2026-10-27 13:25、f8e4bb0、Gboard）**: 英字は入るようになった。日本語はひらがなが送られる（`echo` で「こんにちは」）が、かな→漢字の変換ができない。
  （zsh の行編集でマルチバイトが `<0081><0093>` 等と出るのは、稼働中の DSH プロセスに LANG / LC_* が無く PTY の zsh が C ロケールで動くため。別件で、本項の対象外。）
- **原因（2 回目。コード・一次資料・合成列による。実機のイベント記録は未取得）**: f8e4bb0 の値の巻き戻しで、キーボードが入れたかなは textarea から即座に消える。
  iOS のサードパーティキーボードは文書を `UITextDocumentProxy` のカーソル前の文脈でしか見ず、Gboard などは marked text をほぼ使わない（推定。出典は ADR-20261027-1400）。
  候補を選ぶとき、キーボードはカーソル前の読みを消して漢字を入れるが、消す読みが textarea に無いので変換できない（推定）。
- **対応（2 回目）**: ADR-20261027-1400（spec.md §5.3 `TerminalInputReachesOnce`）。textarea の値に触れない。keyCode 229 の keydown を xterm に見せず（差分検出を起こさせない）、
  編集の input（挿入・置換・後方削除）を `beforeinput` の時点の値との差（DEL × 消えた数 ＋ 入った文字）として送る。変換中・確定の送信待ちは xterm の CompositionHelper に任せる。
  xterm が keydown で送る Backspace（keyCode 8。キーリピートを含む）は、送った数だけ textarea からも消して端末の行とそろえる。
- **テスト**: `test/terminal-input.test.mjs`（npm の `@xterm/xterm@6.0.0` を happy-dom で動かす。38 件、うち DSH 同梱版との照合 1 件は配布物が無ければ skip）。
  日本語の変換の合成列 3 件（Gboard 型 2・標準キーボード型 1）は d686e25・f8e4bb0 のどちらでも赤。変異 17 種はすべて赤。
- **残る制限**: iOS の実際の列は合成で、時刻・順序の全部は再現しない。Gboard の英字・かな・変換の列は推定（実機のイベント記録が無い）。変換の削除が「後方削除の繰り返し」か「選択して置換」かも未確認（両方を扱う）。
  端末の行のカーソルは textarea のカーソル（末尾）に対応するとみなすため、textarea 内でカーソルを動かした編集（スペースキー長押しのカーソル移動など）は端末とずれる。
  textarea の値は Enter・blur まで伸びる。確定の送信待ちの解除は timer の順序による近似。予測候補の単語挿入・自動修正・音声入力・ハードウェアキーボード付き iPad は未検証。
  xterm を版上げして `_inputEvent` が直った（PR #5614 相当）場合は、プラグイン無しの再現テストが赤になるので、介入を外すか見直す。
- **実機の確認手順**: spec.md §8 の 2。切り分け用のスニペット `tmp/terminal-input-probe.js`（worktree `fix/terminal-ios-input` の tmp/、commit しない）は、直らなかったときのイベント記録に使う。
