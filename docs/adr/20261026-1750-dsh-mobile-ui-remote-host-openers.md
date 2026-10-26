# リモート接続ではホストの画面で開く操作を隠し、フォルダ選択はアプリ内ブラウザに固定する

- Status: proposed
- Date: 2026-10-26
- Issue: #18

## Context

スマホ（Tailscale Serve 経由）から DSH Web を使うと、「Open In…」「ファイルの場所を表示」「Workspace 追加」が機能しない。
DSH 0.2.0-rc.2 はこれらをホスト Mac の画面で実行する（`dsh-host-open-in-app`、`dsh-host-directory-picker-native` の osascript）。
`dsh-host-directory-picker-auto` は bind が 127.0.0.1 なら native を選ぶが、Serve は 127.0.0.1 へ転送するので、
リモート利用でも native になる。

評価基準: (a) スマホから押して何も起きない操作を残さない、(b) 代替のある機能は使えるようにする、
(c) DSH 本体を変更しない、(d) ローカル（Mac 本体）での利用を壊さない。

## 選択肢

1. Workspace 追加: プロファイル設定で picker を browse に固定する。Open 系: プラグインでリモート時に非表示にする。
2. Workspace 追加: プラグインがリモート時にパス入力欄を出す（`uiWorkspace.pickDirectory` 等の差替え）。
3. どちらもリモート時に非表示にするだけ。
4. 判定をスマホ幅（≤767px）にする。

## 決定

選択肢 1。判定は「ページのホスト名がループバック以外」（ユーザー選択、2026-10-26）。

## 理由

- browse は DSH が公式に用意する「remote clients」向けの方式で、一覧・新規作成ができる（b）。設定 3 エントリで済み、
  DSH 内部のサービスを差し替えない（c）。ローカルでもアプリ内ダイアログになるだけで機能は保つ（d）。
- 選択肢 2 は DSH のサービス・slot の登録順に依存し、壊れやすい。
- Open 系はホスト上でしか意味を持たず、ブラウザ側の代替（ダウンロード等）は既存のプレビューで足りるため隠す（a）。
- ホスト名で判定すると、Windows など広い画面の別端末から開いた場合も同じく隠せる。幅の判定（選択肢 4）では残る。

## 検証

- `npm test`（24 件）。変異 2 種（CSS セレクタ・stopPropagation を壊した版）で、対応するテストが赤になることを確認。
- 実機で、スマホから Open 系の操作が見えないこと、Workspace 追加でフォルダ一覧のダイアログが開いて追加できること、
  Mac 本体（localhost）では Open 系が表示されることを確認した後に accepted とする。
  browse 固定は DSH の再起動後に効く。
