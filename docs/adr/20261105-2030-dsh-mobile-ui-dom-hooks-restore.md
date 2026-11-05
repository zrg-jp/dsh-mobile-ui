# DSH の要素へ書いた属性・inline style を、書く前の値と一緒に記録して戻す（T342）

- Status: proposed
- Date: 2026-11-05
- Level: 3
- Deciders: AI（Claude 系の実装担当）。オーナーの確認待ち
- Task: T342
- 出典: Idea from kuraneko1/dsh-mobile-maxxing 24e2e49 (MIT)。`packages/dsh-mobile-maxxing/client.js` 2568–2719（`PHONE_HOOKS` と一括の後始末）、5906・6225–6260（書く前の属性を保存して戻す）。コードは写していない

## Context

本プラグインは DSH の要素（html / body / sidebarCol）へ属性・inline style・`inert` を書く。後始末はこれまで項目ごとに手で書いていた。
棚卸し（下表）の結果、次の 3 つの漏れが見つかった。(1) sidebarCol の `inert` を開・`PHONE` 外・dispose で `false` にしており、DSH が先に付けていた inert を消す。PHONE 外の起動でも書く。
(2) DSH が frame を描き直して sidebarCol が別の要素になると、前の要素に inert が残る。(3) `COARSE` を外れても `--dsh-mobile-vv*` が残る（KI-6）。
また、書き戻しはどれも「消す」で、元の値（DSH や他者が先に書いていた同名の値）を戻せなかった。

## 棚卸し（main d3d2c77 の lib/client.js）

| 対象 | 種類 | 後始末（dispose） | 条件を外れたとき | 判定 |
|---|---|---|---|---|
| `head` の style タグ | 子要素の追加 | 取り除く | ―（常時） | 問題なし |
| `html[data-dsh-mobile-remote]` | attribute | 消す | ―（起動時に判定） | 元の値を戻さない |
| viewport meta の content | meta | 項目単位で戻す（T346） | ―（常時） | 問題なし（触らない） |
| html の `--dsh-mobile-vvh` / `--dsh-mobile-vvtop` | CSS 変数 | 消す | **戻さない**（COARSE の change を見ない。KI-6） | 漏れ |
| body 直下の FAB | 子要素の追加 | 取り除く | CSS で隠す | 問題なし |
| body 直下の要素の `data-dsh-mobile-overlay` | dataset | 全部外す | COARSE を外れたら外す | 問題なし |
| `body[data-dsh-mobile-sidebar]` | dataset | 消す | ―（値が状態） | 元の値を戻さない |
| sidebarCol の `inert` | inert | **`false` にする** | **`false` にする**（DSH の inert を消す。PHONE 外の起動でも書く） | 漏れ |
| 差し替え前の sidebarCol の `inert` | inert | **残る** | **残る** | 漏れ |
| `body[data-dsh-mobile-right]` | dataset | 消す | ―（値が状態） | 元の値を戻さない |
| body 直下の safe probe | 子要素の追加 | 取り除く | ―（常時） | 問題なし |
| html の `--dsh-mobile-safe-*` / `data-dsh-mobile-native-gap` | CSS 変数 / attribute | 消す | SAFE_AREA を外れたら消す | 元の値を戻さない |
| frame の `--dsh-frame-leading-clearance` | CSS 規則（要素に書かない） | style タグごと消える | media で外れる | 問題なし |
| ターミナルの helper textarea | 値・選択範囲・リスナー | リスナーを外す | ― | 値は入力そのもの（戻す対象でない） |
| document / window / visualViewport / media のリスナー、MutationObserver | リスナー | 全部外す | ― | 問題なし |

重複: `--dsh-mobile-vv*`・`--dsh-mobile-safe-*` の削除が、関数（`releaseSafeArea`）と disposer の 2 か所にあった。

## 評価基準（実装前に確定）

1. 漏れの 3 件を、壊した版で赤になる自動テストで検出できる。修正後に緑になる。
2. DSH が先に持っていた同名の属性・style・inert を壊さず、元の値へ戻す。
3. 既存のテスト（122 件）を変えずに通す。T311 のターミナル入力ブロックと T346 の viewport マージの内部に触れない。
4. 差分を必要な箇所だけにとどめる（T360 を main 起点で始める別セッションとの競合を減らすため。大きな並べ替えはしない）。

## Considered Options

1. **A: 小さな記録係 `createDomHooks`（effect ごと）**。`set(el, kind, name, value)` が初回だけ元の値を記録し、`restore(el, kind?, name?)`・`restoreAll()` で戻す。記録は Map（`restoreAll` で列挙するため）。戻すのは、今の値が最後に書いた値のままの項目だけ。
2. **B: 上流と同じ、属性名の一覧で一括削除**（`PHONE_HOOKS` + `querySelectorAll`）。元の値は戻さない。
3. **C: 項目ごとの手書きの後始末を直すだけ**（inert の元の値を変数に持つ等）。

## Decision

A を採る。適用範囲は、DSH の要素へ書く属性・inline style（html の `data-dsh-mobile-remote` / `--dsh-mobile-vv*` / `--dsh-mobile-safe-*` / `data-dsh-mobile-native-gap`、body の `data-dsh-mobile-sidebar` / `data-dsh-mobile-right`、sidebarCol の `inert`）。

ヘルパーを通さないもの:
- FAB・safe probe・style タグ: 本プラグインが作る要素で、取り除けば戻る。
- viewport meta: T346 のマージが記録と復元を自前で持ち、項目単位の扱い（他者の変更を保つ）がヘルパーの属性単位より細かい。
- `data-dsh-mobile-overlay`: portal のたびに作り直される要素に付ける印で、記録すると要素を保持し続ける。元の値も無い（DSH 0.2.0-rc.2 は同名の属性を使わない）。一括削除（B と同じ）で足りる。
- ターミナル: 書くのは helper textarea の値（端末への入力）だけで、戻す対象が無い。
- `--dsh-frame-leading-clearance`: CSS 規則で与え、要素に書かない。

## 理由（考察と、自動テストによる検証）

- A は評価基準 2 を満たす唯一の案。B は元の値を戻せず、DSH の inert を消す漏れ (1) を直せない。C は直せるが、項目ごとに「元の値・他者が書き換えたか」の判定を書くことになり、次に項目を足すときに同じ漏れを繰り返しうる。
- 「最後に書いた値のままなら戻す」は viewport meta の T346 と同じ考え方で、DSH が後から同じ項目を書いた場合にその値を壊さない。
- inline style は `getPropertyValue` / `getPropertyPriority` で項目ごとに記録する（style 属性の全文を保存すると、他者の後の変更を巻き戻す）。元に style 属性が無ければ、宣言が尽きた時点で属性ごと消す（実ブラウザは `removeProperty` の後も `style=""` を残す）。元に空の `style=""` があれば残す。
- `inert` は属性として扱う（`inert` プロパティは属性の反映。HTML 標準）。
- 着想: 上流は書く前の属性を WeakMap に保存して戻し、付けた data-* を一覧で後始末する。本 ADR は前者を一般化し、後者はオーバーレイの印だけに残した。

検証（2026-11-05、happy-dom 20.14.6）:
- 新しいテスト `test/hooks.test.mjs` 9 件のうち 8 件が修正前の lib/client.js（main d3d2c77）で赤、修正後に緑（SAFE_AREA の喪失は修正前から満たしていた）。全体 131 件が通る（条件付き skip 2 件のうち、DSH の配布物があるこの環境では 1 件が skip）。
- 壊した版 8 種（inert を false に戻す、COARSE の監視なし、他者の変更の判定なし、旧 sidebarCol の後始末なし、空の style の復元なし、restoreAll と remote の後始末なし、style を書いていない要素の style 属性を消す、onViewport の COARSE ガードなし）が、それぞれ 1〜3 件赤になる。
- 独立レビュー（OpenCode 無料枠 GLM-5.3-Flash / DeepSeek V4.1 Flash）の指摘で、テストに「同名属性の元の値」「属性の ForeignWriteKept」「COARSE 外の resize」「付け直し時の resize 再送」の検査を足し、style 属性の後始末を style を書いた要素に限った。
- 実機（iPhone PWA）は未確認。

## Consequences

- Positive: dispose と条件の喪失で DSH の要素が元の値へ戻る（spec §7.1 の `DisposeRestoresDom` / `ConditionLossRestores` / `ForeignWriteKept`）。KI-6 が解ける。
- Negative: 記録係は要素への強参照を dispose まで持つ（項目は高々 html・body・sidebarCol の数個。差し替え前の sidebarCol は restore で外す）。
  他者が本プラグインと同じ値を書いた場合は区別できず、dispose で元の値へ戻す（値の一致で判定するため）。
  mount 前に style 属性が無かった要素で、本プラグインの宣言が尽きたときに他者が付けた空の `style=""` があれば、それも消す（宣言の無い属性で、表示は変わらない）。
- Risk / 再検討条件: DSH が sidebarCol に自分で inert を付けるようになった場合（0.2.0-rc.2 の ui-layout は付けない）、本プラグインの開閉と競合しうる。その場合は `ForeignWriteKept` で DSH の値を優先するが、実機で確認する。

## 関連ADR

- ADR-20261024-0450（#root の visual viewport 追従）
- ADR-20261024-1646（固定オーバーレイの座標補正）
- ADR-20261026-1800（セーフエリアの実測）
