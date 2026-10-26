# 開発手順

現在の仕様は [spec.md](spec.md)、決定の経緯は [adr/](adr/README.md) を参照。

## ブランチ運用（ADR-20261024-0430）

- `main` へは直接 commit・push しない。作業ごとにブランチを切り、PR を作り、CI（`test`）が通ってから merge する。
- ブランチ名は `<種別>/<内容>` とする。種別は `feat`（機能追加）、`fix`（不具合修正）、`docs`（文書のみ）、`chore`（基盤・設定）、`test`（テストのみ）。
- 1 PR = 1 目的。仕様が変わる変更では、同じ PR の中で `docs/spec.md` を更新する。決定を伴う場合は ADR も追加する。
- このリポジトリは public。push・PR 作成・issue 起票は、その都度オーナーの承認を得る（エージェント作業時）。
- force push・履歴の書換え・ブランチの削除は、オーナーの確認なしに行わない。

### 実機での確認とブランチの関係

`~/.dsh/local-plugins/dsh-mobile-ui` はこの作業ツリーへの symlink になっている。そのため、**チェックアウト中のブランチが、
稼働中の DSH Web にそのまま読み込まれる**（ページの再読込で反映される）。

- 実機での確認は作業ブランチ上で行い、確認できたら PR に結果を書く。
- 別件の作業で worktree を使う場合、稼働中の DSH が読むのは symlink 先（このディレクトリ）だけである。
  worktree 側の変更を実機で見るには、このディレクトリで該当ブランチをチェックアウトする。

## テスト（ADR-20261024-0410）

```sh
npm ci
npm test
```

- `test/harness.mjs` は、happy-dom 上で `lib/client.js` をそのまま評価する。DSH の ModuleLoader と、
  `ctx.layout` / `ctx.sidebarRight` / `ctx.effect` を偽装し、次の補助を返す。
  - `mount({ width, coarse, withFrame })`: 画面幅・タッチ端末かどうか・AppFrame の有無を指定して起動する
  - `swipe()`: 単指のタッチを発火する
  - `calls`: 公開サービスの呼出回数
- テスト名の先頭の `[§n]` は spec.md の節番号を示す。spec の契約を追加・変更したら、対応するテストも同じ PR で直す。
- 新しいガードや判定を足すときは、テストが実際にそれを検査しているか確かめる。手順は、
  先に失敗するテストを書くか、`DSH_MOBILE_UI_CLIENT=<壊した版> npm test` を実行してテストが赤になるのを見るか、のどちらか。
- 制限: happy-dom はレイアウトしない。transition・視覚表現・iOS 固有の挙動（visualViewport・キーボード・ピンチ・PWA）は
  検査できないため、実機で確認する。

## 変更時のチェックリスト

1. 関係する spec.md の節と ADR を読む。
2. 実装し、テストを追加・更新する。
3. `npm test` を通す。
4. 仕様が変わる場合は spec.md を更新する。決定を伴う場合は ADR を追加し、`adr/README.md` に索引を足す。
5. 実機で確認する（iPhone PWA。iPad・Android は、確認したら spec.md §8 に記録する）。
6. 差分を見直し、秘密情報の検査（`~/.config/git/hooks/secret-scan`）をしてから commit する。

## 第三者コードの移植

上流 [kuraneko1/dsh-mobile-maxxing](https://github.com/kuraneko1/dsh-mobile-maxxing)（MIT, Copyright (c) 2026 kuraneko1）
からコードを持ち込むときの運用。ライセンス全文と取り込み一覧の正本は [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

- **コードを移植・翻案した場合**: ファイル冒頭（一部だけなら該当箇所）に出典コメントを付ける。
  書く内容は上流 repo・commit・ファイルと行範囲（例: `// Adapted from kuraneko1/dsh-mobile-maxxing@24e2e49 packages/dsh-mobile-maxxing/notify/host.js:89-268 (MIT)`）。
  同じ変更の中で THIRD_PARTY_NOTICES.md の「取り込んだファイル・箇所」の表へ 1 行追加する。基準 commit 以外から取り込んだ場合は、その commit を表に書く。
- **アイデアだけを参照した場合**: ライセンス上の表示義務は無い。経緯を追えるよう、commit message か ADR に出典（repo・commit・ファイル）を残す。
- 手元の `LICENSE`（本リポジトリの MIT 表示）は書き換えない。上流の著作権表示は THIRD_PARTY_NOTICES.md に置く。
- 上流の README・画像・UI 文言（locale 等）は写さない。
- 上流でハッシュ化クラス名や DSH の非公開 API（内部ストア等）に依存している箇所は、そのまま写さない。
  [spec.md §3](spec.md#3-依存する外部契約) の公開契約（安定した `data-*` 属性・公開サービス）だけを使うよう書き直す（ADR-20261023-1720）。

## 既知の問題

[known-issues.md](known-issues.md) を参照。
