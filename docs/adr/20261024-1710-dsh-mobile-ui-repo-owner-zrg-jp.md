# リポジトリの所有者を HARU-pc から zrg-jp Organization へ移す

- Status: accepted
- Date: 2026-10-24
- Task: T324

## Context

このリポジトリは public で、`HARU-pc/dsh-mobile-ui` として運用してきた。関連する自作プロジェクト
（zrg-llm、zrg-jev 等）は zrg 系の名前で管理しており、オーナーは dsh-mobile-ui も同じ場所へまとめたい。
issue #1〜#12 と PR #9・#10・#13 の履歴、および旧 URL からのリダイレクトを失わない移行方法が必要になる。

## 選択肢

1. `gh api repos/HARU-pc/dsh-mobile-ui/transfer` で `zrg-jp` へ所有ごと transfer する。
2. `zrg-jp/dsh-mobile-ui` を新規作成し、全ブランチを push して origin を切り替える。

## 決定

選択肢 1。`zrg-jp/dsh-mobile-ui`（public）へ transfer し、ローカルの origin と docs 内の URL を新所有者へ更新する。

## 理由

- transfer は issue・PR・wiki・star・watch・webhook・secret・deploy key を保持し、旧 URL は新 URL へ
  301 リダイレクトされる（GitHub Docs "Transferring a repository"、2026-10-24 取得）。
  選択肢 2 では issue / PR の履歴と旧 URL のリダイレクトが失われる。
- 移行前の前提を確認済み: 対象 repo は admin 権限あり・fork/archive でない・Pages と branch protection は未設定、
  Actions secret / deploy key / webhook / release はいずれも 0 件、`zrg-jp` に同名 repo は無い。
  `zrg-jp` は 2FA 必須ではなく、メンバーの repo 作成は許可されている。
- 制限: 個人アカウント → Organization の transfer では、Organization メンバー以外への issue アサインが外れる。
  移行後に全 issue のアサインが空であることを確認した（元々どの issue にもアサインは無く、実害は無い）。

## 検証

2026-10-24 に実行し、次を確認した。

- `zrg-jp/dsh-mobile-ui` が存在し、default branch は `main`、issue 10 件（open #1〜#8・#12、closed #11）と
  merged PR #9・#10・#13 が移行されている。
- `HARU-pc/dsh-mobile-ui` への HTTPS アクセスは 301 で `https://github.com/zrg-jp/dsh-mobile-ui` へ転送される。
- Actions workflow `test` が残っている。
- ローカルの `origin` を `https://github.com/zrg-jp/dsh-mobile-ui.git` に変更し、`git fetch` が成功した。

注意: 旧所有者名で同名リポジトリを作り直すと、このリダイレクトは恒久的に消える（GitHub Docs 記載）。
