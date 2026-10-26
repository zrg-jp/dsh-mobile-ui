# dsh-mobile-ui

Mobile / tablet support for the [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) Web GUI, as a local client plugin. No rebuild of DSH required — register it in your profile's `cordis.patch.yml` and reload the page.

DSH Web GUI をスマホ・タブレットで使いやすくするローカル client プラグイン。DSH 本体の再ビルドは不要で、profile の `cordis.patch.yml` に登録してページを再読み込みするだけで反映される。

## Features / 機能

- **Phone layout (≤767px)**: the sidebar becomes a fixed overlay drawer; the 3-column grid collapses to one column, eliminating horizontal overflow from the center column's 400px minimum. A hamburger FAB opens the drawer; backdrop tap / Escape closes it (the hidden drawer is `inert`).
  スマホ幅ではサイドバーをドロワー化し、中央カラム最小幅 400px 由来の横はみ出しを解消。
- **Swipe gestures**: right-swipe from the left half opens the sidebar; right-swipe from the left edge collapses the right panel (diff viewer etc.) back to the chat; left-swipe closes the sidebar. Guards against horizontal scrollers (allowed again once scrolled fully left), text selection, and edit areas. Passive listeners only — native scrolling is never blocked.
  スワイプ操作: 左半分からの右スワイプでサイドバー、左端からの右スワイプで右パネルから戻る、左スワイプで閉じる。
- **iOS keyboard & zoom fixes**: viewport meta (`maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-content`), 16px inputs to stop focus auto-zoom, and `visualViewport` tracking so the keyboard does not cover the composer in PWA (standalone/fullscreen) mode.
  iOS のフォーカスズーム抑止と、PWA でキーボードが入力欄を覆う問題の補正。
- **Portal overlays stay in view**: overlays portaled to `document.body` (the model picker, modals, toasts) are translated by the same visual-viewport offset as `#root`, so the iOS keyboard no longer pushes them off-screen.
  body 直下へ portal されるオーバーレイ（モデル選択メニュー等）も `#root` と同じ補正を受け、キーボード表示中も画面内に留まる（KI-10、ADR-20261024-1646）。
- **Safe-area padding** for notch / home-indicator in PWA display modes.

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
- `maximum-scale=1` was expected to be ignored by iOS for manual pinch-zoom, but pinch-zoom has been reported not to work in iPhone PWA mode (see [known issues](docs/known-issues.md) KI-8). Primary targets are iPhone PWA and iPad.

## Development / 開発

`npm ci && npm test` runs the test suite (node:test + happy-dom). Branch flow, test harness and checklist: [docs/development.md](docs/development.md). Known issues: [docs/known-issues.md](docs/known-issues.md).

開発手順・ブランチ運用・テストは [docs/development.md](docs/development.md)、既知の問題は [docs/known-issues.md](docs/known-issues.md)。

## License

MIT. Third-party notices (including code adapted from [dsh-mobile-maxxing](https://github.com/kuraneko1/dsh-mobile-maxxing), MIT): [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

第三者ソフトウェアの表示（上流 dsh-mobile-maxxing から移植したコードの一覧とライセンス全文）は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照。
