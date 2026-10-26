# dsh-mobile-ui

Mobile / tablet support for the [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web GUI, as a local client plugin. No rebuild of DSH required — register it in your profile's `cordis.patch.yml` and reload the page.

DSH Web GUI をスマホ・タブレットで使いやすくするローカル client プラグイン。DSH 本体の再ビルドは不要で、profile の `cordis.patch.yml` に登録してページを再読み込みするだけで反映される。

## Features / 機能

- **Phone layout (≤767px)**: the sidebar becomes a fixed overlay drawer; the 3-column grid collapses to one column, eliminating horizontal overflow from the center column's 400px minimum. A hamburger FAB opens the drawer; backdrop tap / Escape closes it (the hidden drawer is `inert`).
  スマホ幅ではサイドバーをドロワー化し、中央カラム最小幅 400px 由来の横はみ出しを解消。
- **Swipe gestures**: right-swipe from the left half opens the sidebar; right-swipe from the left edge collapses the right panel (diff viewer etc.) back to the chat; left-swipe closes the sidebar. Guards against horizontal scrollers (allowed again once scrolled fully left), text selection, and edit areas. Passive listeners only — native scrolling is never blocked.
  スワイプ操作: 左半分からの右スワイプでサイドバー、左端からの右スワイプで右パネルから戻る、左スワイプで閉じる。
- **iOS keyboard & zoom fixes**: viewport meta merged per directive (`width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`; other directives are kept, no zoom limit is added, so pinch-zoom stays available), 16px inputs to stop focus auto-zoom, and `visualViewport` tracking so the keyboard does not cover the composer in PWA (standalone/fullscreen) mode. Tracking and swipe gestures pause while pinch-zoomed.
  iOS のフォーカスズーム抑止（入力 16px）と、PWA でキーボードが入力欄を覆う問題の補正。viewport meta は項目単位でマージし、ズームは制限しない（ピンチ中は追従を止める。ADR-20261026-1450）。
- **Portal overlays stay in view**: overlays portaled to `document.body` (the model picker, modals, toasts) are translated by the same visual-viewport offset as `#root`, so the iOS keyboard no longer pushes them off-screen.
  body 直下へ portal されるオーバーレイ（モデル選択メニュー等）も `#root` と同じ補正を受け、キーボード表示中も画面内に留まる（KI-10、ADR-20261024-1646）。
- **Safe-area padding** for notch / home-indicator in PWA display modes.
- **Header clearance & right panel**: the conversation title starts right of the FAB (via DSH's own `--dsh-frame-leading-clearance`); the FAB hides while the full-screen right panel is open.
  会話タイトルを FAB の右から始め、右パネル（全画面）展開中は FAB を隠す（issue #12）。
- **Terminal on touch**: tapping the right-panel terminal focuses xterm's input (shows the keyboard); a vertical drag scrolls the scrollback.
  右パネルのターミナルはタップでキーボード、縦ドラッグでスクロール（T311 / T343）。

## Install / 導入

```sh
git clone https://github.com/HARU-pc/dsh-mobile-ui.git
ln -s "$(pwd)/dsh-mobile-ui" ~/.dsh/local-plugins/dsh-mobile-ui
```

Add to your DSH web profile patch layer (e.g. `~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
- insert:
    - id: mobile-ui
      name: /Users/<you>/.dsh/local-plugins/dsh-mobile-ui/lib/index.js
```

Then reload the DSH web page on your device. To uninstall, remove the insert entry (and the symlink).

`package.json` の `"private": true` は npm への誤 publish を防ぐためのもので、GitHub 上での公開とは無関係。

## Design / 設計

The plugin never touches DSH's hashed CSS class names or internal stores. It relies only on:

- stable `data-*` attributes (`data-rightbar-col`, `data-sidebar-collapsed`, `data-side`, `data-lexical-editor`) and the frame's DOM shape,
- public cross-plugin services: `ctx.layout` (sidebar toggle) and `ctx.sidebarRight` (right-panel expand state).

If a future DSH build changes these, the media queries simply stop matching and the stock desktop-style layout returns — degradation is safe.

The current specification is [docs/spec.md](docs/spec.md); decision records live in [docs/adr/](docs/adr/) (both Japanese). Code comments reference them by number (e.g. `ADR-20261023-1720`).

ハッシュ化クラス名や内部ストアには依存せず、安定した data 属性と公開サービスだけを使う。壊れた場合は従来表示へ劣化する（安全側）。現在の仕様は [docs/spec.md](docs/spec.md)、設計判断の経緯は [docs/adr/](docs/adr/) を参照。

## Compatibility / 互換性

- Developed against `@deepseek-ai/dsh-web-app` 0.2.0-rc.2 (web profile).
- `:has()` requires iOS 15.4+ / modern browsers; older browsers keep the stock layout.
- Earlier versions added `maximum-scale=1`, and pinch-zoom was reported not to work in iPhone PWA mode. It is no longer added; the fix is awaiting confirmation on a device (see [known issues](docs/known-issues.md) KI-8). Primary targets are iPhone PWA and iPad.

## Development / 開発

`npm ci && npm test` runs the test suite (node:test + happy-dom). Branch flow, test harness and checklist: [docs/development.md](docs/development.md). Known issues: [docs/known-issues.md](docs/known-issues.md).

開発手順・ブランチ運用・テストは [docs/development.md](docs/development.md)、既知の問題は [docs/known-issues.md](docs/known-issues.md)。

## License

MIT
