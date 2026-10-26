# 既知の問題

対象: `lib/client.js`（ブランチ `chore/dev-infra` 時点）、`@deepseek-ai/dsh-web-app` 0.2.0-rc.2。
各項目は GitHub issue（#1〜#8、#11）に転記済み。進捗と議論は issue で扱い、確定した仕様の変更は spec.md に反映する。
特記のない限り、コードと DSH 配布物を読んで導いた推定であり、実機では観測していない。

**モバイルへの影響の目安**: iPhone のソフトウェアキーボードには Escape キーが無い。そのため Escape 起点の問題（KI-1、KI-7）は、
外付けキーボード（iPad の Magic Keyboard、Bluetooth キーボードなど）を使うときだけ起きる。

| ID | 概要 | 影響範囲 | 状態 |
|---|---|---|---|
| KI-1 | Escape で閉じた後、フォーカスが FAB に戻らない | 外付けキーボード | 未着手（[#1](https://github.com/HARU-pc/dsh-mobile-ui/issues/1)） |
| KI-2 | ピンチズームで `#root` の高さが縮む | KI-8 次第 | 保留（[#2](https://github.com/HARU-pc/dsh-mobile-ui/issues/2)） |
| KI-3 | reduced-motion 設定でも閉じるアニメーションが残る | 視差効果を減らす設定の利用者 | 未着手（[#3](https://github.com/HARU-pc/dsh-mobile-ui/issues/3)） |
| KI-4 | iPad 横（≥1024px）ではスワイプが効かない | iPad | 検討中（[#4](https://github.com/HARU-pc/dsh-mobile-ui/issues/4)） |
| KI-5 | モーダルなど前面の UI 上のスワイプが、背後のレイアウトを操作する | スマホ | 未着手（[#5](https://github.com/HARU-pc/dsh-mobile-ui/issues/5)） |
| KI-6 | coarse 判定へ戻ったとき、キーボード追従の高さを再計算しない | ほぼ無し | 記録のみ（[#6](https://github.com/HARU-pc/dsh-mobile-ui/issues/6)） |
| KI-7 | ドロワーとモーダルが同時に開いた状態で Escape を押すと、両方とも閉じる | 外付けキーボード | 未着手（[#7](https://github.com/HARU-pc/dsh-mobile-ui/issues/7)） |
| KI-9 | 入力欄をタップすると、入力欄が画面の上へ外れていく | iPhone PWA（実機で報告あり） | 解決（ADR-20261024-0450、2026-10-24 に実機で確認） |
| KI-8 | ピンチによる拡大縮小が効かない | iPhone PWA（実機で報告あり） | 未着手（[#8](https://github.com/HARU-pc/dsh-mobile-ui/issues/8)） |
| KI-11 | リモート接続で、変更したショートカットから「Open locally」が動く | 外付けキーボード＋割当て変更 | 記録のみ |
| KI-10 | キーボード表示中、モデル選択メニューが画面上端の外へ出る | iPhone PWA（実機で報告あり） | 解決（ADR-20261024-1646、2026-10-24 に実機で確認。修正は [#11](https://github.com/HARU-pc/dsh-mobile-ui/issues/11)） |

## KI-1 Escape で閉じた後、フォーカスが FAB に戻らない（旧 Q1）

- **現象（推定）**: `onKeyDown` は、`toggle()` の直後に同期的に `fab.focus()` を呼ぶ（[client.js](../lib/client.js) の Escape ハンドラ）。
  FAB は `body[data-dsh-mobile-sidebar=closed]` のときだけ表示されるが、この属性は MutationObserver のコールバックで後から更新される。
  したがって `focus()` を呼んだ時点の FAB はまだ `display:none` で、フォーカスできない。さらに、閉じたドロワーは inert になるため、
  フォーカスの行き先は UA 次第になる。
- **期待**: 閉じた後、フォーカスが FAB に移る。
- **修正案**: `syncState()` を先に同期的に呼んでから `focus()` する。または `requestAnimationFrame` の後で focus する。
- **テスト**: happy-dom は `display:none` の要素でも focus できてしまう可能性があるため、検査の方法を併せて検討する。

## KI-2 ピンチズームで `#root` の高さが縮む（旧 Q3）

- **現象（推定）**: `visualViewport.resize` は scale を区別せず、`--dsh-mobile-vvh` に `visualViewport.height` を入れる。
  倍率 2 なら、レイアウト座標上の `#root` の高さは半分になる。
- **状態**: KI-8（そもそもピンチが効かない）を直すまでは発生しない。KI-8 を直すときに同時に扱う。
- **修正案**: `vv.scale` が 1 から十分に離れている間は更新しない。またはキーボードによる縮みだけを反映する。

## KI-3 reduced-motion 設定でも閉じるアニメーションが残る（旧 Q6）

- **現象（CSS の読解による）**: 閉時のセレクタ `[data-sidebar-collapsed]:has(> [data-rightbar-col])>:first-child` の詳細度は (0,3,0) で、
  reduced-motion 側の `:has(> [data-rightbar-col])>:first-child` の (0,2,0) より高い。このため、閉じるときは `transition:transform .25s, visibility 0s .25s` が残る。
- **修正案**: reduced-motion 側に、閉時のセレクタと同じ詳細度のルールを追加する。
- **テスト**: happy-dom の CSS カスケードで、computed の `transition` を検査できるか確認する。

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
- **修正案**: `maximum-scale=1` をやめる。フォーカス時の自動ズームは、入力 16px 化のルールだけで防げる見込み。
  修正後は KI-2 が顕在化するため、同時に扱う。

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

## KI-11 リモート接続で、変更したショートカットから「Open locally」が動く

- **現象（推定）**: spec §6.1 の遮断は、`workspace.openLocal` の Web 既定（⌘/Ctrl+Shift+O）だけを見る。
  利用者が設定で割当てを変えると遮断されず、ホストのアプリが起動しうる（手元では何も見えない）。
- **影響**: 外付けキーボードを使い、かつ割当てを変えた場合だけ。害はホストで余計なアプリが開くことにとどまる。
- **修正案**: DSH のショートカット登録をプラグインから上書きする公開 API が無いため、現状は記録のみとする。
