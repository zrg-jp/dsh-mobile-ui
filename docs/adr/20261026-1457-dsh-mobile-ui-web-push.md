# Web Push 通知を host 半身で送る（SW の scope、鍵の保存、通知に載せる内容、認可）

- Status: proposed
- Date: 2026-10-26
- Level: 3
- Deciders: AI（設計担当サブエージェント）による案。独立レビューとオーナー判断の前
- 関連タスク: T350（設計）、T341（THIRD_PARTY_NOTICES）、T313（未確認点の洗い出し）、T272（Tailscale Serve）

## Context

dsh-mobile-ui は今、client だけのプラグインである（`lib/index.js` の `apply()` は空）。スマホを閉じている間に
「ターンが終わった」「承認・質問待ち」を知らせるには、host 側に HTTP ルート・状態ファイル・外部（push サービス）への
送信を持つ必要がある。これは本プラグインで初めての host 機能で、元に戻しにくく、セキュリティと秘密情報の扱いに関わる
（重要決定）。上流 kuraneko1/dsh-mobile-maxxing（MIT）に同機能の実装があるが、既知の不具合（#85, #86, #88）がある。
本 ADR は T350 の 7 項目に答える設計案で、実装はまだ行わない。比較実験は未実施のため、根拠は配布物の読解と外部一次資料による。

## Decision Drivers

- 背景に回ったスマホ（iPhone のホーム画面 Web アプリ）へ、確実に届くこと
- 通知の中身が、第三者（push サービス、ロック画面を覗く人）へ必要以上に出ないこと
- DSH の公開契約だけに依存すること（spec.md §3、ADR-20261023-1720）。ハッシュ化クラス名と内部ストアに依存しない
- 秘密値（VAPID 秘密鍵、購読 endpoint）を git・docs・ログへ出さないこと
- 上流の既知の不具合を繰り返さず、自動テストで確かめられること
- runtime 依存を増やさないこと（現在 runtime 依存はゼロ）

## 評価基準（比較の前に確定）

| ID | 基準 | 判定方法 |
|---|---|---|
| E1 | 到達性 | iPhone PWA が背景・画面ロック中のときに OS 通知が出るか。出ない経路が設計上あるか |
| E2 | 露出 | 通知内容がどこに平文で現れるか（push サービス、ロック画面、ログ、ファイル） |
| E3 | 契約 | DSH 0.2.0-rc.2 の公開 API（型定義・README に載るもの）だけで書けるか |
| E4 | 認可 | 未認証・別 origin・別サイトからのリクエストを、DSH 本体と同じ基準で拒否できるか |
| E5 | 運用 | 追加アプリ・外部アカウント・runtime 依存・常駐プロセスの数 |
| E6 | 検証 | RFC のテストベクタと、push サービスを偽装した E2E で自動検査できるか |

## 確認した事実（DSH 0.2.0-rc.2 配布物）

pnpm global store の `@deepseek-ai/*` 0.2.0-rc.2 を 2026-10-26 に読んだ。パスはパッケージ内の相対パス。

| 事実 | 根拠 |
|---|---|
| ローカルプラグインの host 半身は、`cordis.patch.yml` の insert で指す `lib/index.js` の `apply(ctx, config)`。package.json に host 用の追加宣言は要らない。`dsh.client` は client 半身の宣言 | dsh-client-modules `lib/index.js:712-719`（`dsh.client` を読む）。上流 `index.js` の `apply()` が `ctx.inject(["webServer"], …)` で host 機能を持つ |
| `webServer.register({ kind: 'exact' \| 'prefix', path, handler(req, res) })` は disposer を返す。照合は exact → 最長 prefix → fallback。同じ path の二重登録は throw | dsh-host-webserver `lib/types/index.d.ts`（`WebRoute`, `register`）、README「Registering routes」 |
| webserver 自身には認証・origin 方針が無い。各ルートの持ち主が守る | dsh-host-webserver README「Known Limitations」 |
| `/api` は dsh-client-connection が prefix ルートとして持ち、全リクエストを `connection.admit(req)` で検査してから処理する | dsh-client-connection `lib/index.js:820-843` |
| `connection.requestRejection(req)` は Host/Origin の柵（`isTrustedApiRequest`）→ cookie 認証の順で 403 / 401 を返す | 同 `lib/index.js:586-589`、`lib/types/rpc.d.ts:162-168` |
| 柵の中身: Host が loopback か `trustedHosts` に一致、`Sec-Fetch-Site: cross-site` なら拒否、`Origin` があれば `Origin.host === Host` | 同 `lib/index.js:205-218` |
| 認証 cookie は `HttpOnly; SameSite=Strict; Path=/` | 同 `lib/index.js:297` |
| `connection.fetch.register({ path: '/api/…', methods, requestBody, fetch(Request) })` で、`/api` 配下に exact の Fetch ルートを足せる。上記の admit を通った後にだけ呼ばれる。DSH 本体（file-upload）もこれを使う | 同 `lib/types/rpc.d.ts:121-129, 207-216`、`lib/index.js:625-638`、dsh-client-file-upload `lib/index.js:171-176` |
| index.html は `connection.authorizeIndex` で認証する。それ以外の静的ファイルは認証しない | dsh-host-frontend-static `lib/index.js:49-74, 87-96` |
| DSH 本体は Service Worker を持たない。`navigator.serviceWorker` の登録コードは dist にも各 `lib/` にも無い | dsh-web-frontend `dist/`、`@deepseek-ai/dsh-*/lib` を grep して 0 件 |
| DSH 本体の manifest は `dist/manifest.webmanifest`（`start_url: "./"`, `scope: "./"`, `display: "fullscreen"`, SVG アイコンのみ）。index.html が `<link rel="manifest" href="./manifest.webmanifest">` で参照する | dsh-web-frontend `dist/manifest.webmanifest`, `dist/index.html` |
| `session/event(session, event)` は追記後の通知（fire-and-forget）。`turn/start {turn}` と `turn/end {turn, reason}` がある。`reason.kind` は `completed` / `aborted` / `blocked` / `error` / `max-tokens` / `interrupted` / `forked` | dsh-session `lib/types/index.d.ts:64`、`lib/types/types.d.ts:165-210, 262-276` |
| ターンのイベントに「どの端末・接続から送られたか」の情報は無い | 同上（`SessionEvent` は `type/seq/time/data` のみ。`types.d.ts:489-`） |
| 承認は session/event の `approval/asked {id, toolName, callId?, reason?}`（ログ専用の監査イベント）として観測できる。応答は `approval/request`（waterfall） | dsh-user-approval `lib/types/types.d.ts:37-51, 81` |
| 質問は `user-questions/request(request, next)`（waterfall）。`request.questions[]`、`request.agent` を持つ。対応する session/event の「質問が出た」イベントは見当たらない | dsh-user-questions `lib/types/types.d.ts:118-145` |
| `agents.roots()` で、親エージェントを持たないエージェント（サブエージェント以外）を判定できる | dsh-agent `lib/types/index.d.ts:358-364` |
| `sessionTitle.get(session)?.title` でセッション名を引ける | dsh-session-title `lib/types/index.d.ts:123` |
| `$DSH_HOME` → `~/.dsh` の順で DSH のホームを決める | dsh-home-paths `lib/types/index.d.ts:7-48` |

未確認: cordis の `ctx.on(…, { prepend: true })` の正式な仕様（上流は使っているが型定義を読んでいない）。
SW スクリプトの取得や SW 内 `fetch` に `SameSite=Strict` の cookie が付くか（iOS Safari で未検証）。
`webServer.getOrigin()`（上流が呼ぶ）は 0.2.0-rc.2 の型定義に無い。

## 外部根拠（一次資料）

取得手段は、webkit.org のみ web_fetch、それ以外は curl（RFC は rfc-editor.org の txt、Apple は documentation の JSON）。
取得日時は 2026-10-26 14:53–14:55 JST。

- WebKit Blog「Web Push for Web Apps on iOS and iPadOS」（公開 2023-02-16）https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
  iOS/iPadOS 16.4 から、ホーム画面に追加した Web アプリ（manifest の `display` が `standalone` / `fullscreen`）で Web Push が使える。
  許可の要求はユーザー操作（タップ）への応答でなければならない。push サービスは APNs で、Apple Developer Program は不要。
  サーバーが送信先を制限するなら `*.push.apple.com` を許可する。
- Apple Developer「Sending web push notifications in web apps and browsers」https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
  「Safari doesn't support invisible push notifications」。push を受けたら直ちに通知を表示しないと、通知の許可を取り消される。
  JWT の `exp` は 1 日以内。JWT の更新は 1 時間に 1 回より頻繁にしない。payload の上限は 4 KB。
  404 / 410 は無効な購読を表す。`BadJwtToken` の原因の一つは、`sub` が URL でも `mailto:` でもないこと。
- RFC 8030（Generic Event Delivery Using HTTP Push）https://www.rfc-editor.org/rfc/rfc8030.txt
  §5.2 TTL ヘッダは必須。§5.3 Urgency。§5.4 Topic は 32 文字以内の base64url で、同じ topic の古いメッセージを置き換える。
- RFC 8291（Message Encryption for Web Push）https://www.rfc-editor.org/rfc/rfc8291.txt
  payload は aes128gcm で端末まで暗号化され、push サービスは中身を読めない。push サービスが受け付ける大きさは 4096 octets までの保証で、
  平文は最大 3993 octets。Appendix A に暗号化の中間値（テストベクタ）がある。
- RFC 8292（VAPID）https://www.rfc-editor.org/rfc/rfc8292.txt
  ES256 の JWT。`aud` は push サービスの origin、`exp` は 24 時間以内、`sub` は `mailto:` か `https:`。
- W3C Service Workers https://w3c.github.io/ServiceWorker/
  scope の既定の上限はスクリプトのあるディレクトリ。それより上を scope にするには、スクリプトの応答に `Service-Worker-Allowed` ヘッダが要る。
  path による制限は強いセキュリティ境界ではなく、境界は origin である。
- Tailscale Docs「Tailscale Serve」https://tailscale.com/kb/1312/serve
  Serve は tailnet 内だけに HTTPS で公開する（インターネットへ出すのは Funnel）。Serve を使うには tailnet の HTTPS 証明書を有効にする必要がある。
- ntfy「Configuring the ntfy server」https://docs.ntfy.sh/config/
  自前の ntfy サーバーから iOS へ即時に届けるには `upstream-base-url`（例 ntfy.sh）を設定する。設定しないと、届くまで数時間かかることがある。
  上流サーバーへ送るのはメッセージ ID と topic URL の SHA-256 だけ。

上流（参照のみ、コードは未移植）: https://github.com/kuraneko1/dsh-mobile-maxxing commit `24e2e49`（v0.6.1）
`packages/dsh-mobile-maxxing/notify/host.js`（VAPID 89-123、暗号化 148-195、送信 230-257、endpoint 検査 460-476、
保存 503-646、イベント購読 869-918、ルート 920-1108）、`sw.js`（push 307-341、notificationclick 343-、pushsubscriptionchange 397-）、
`index.js`（`/sw.js` を `Service-Worker-Allowed: /` で配信 399-457）、`client.js:5265`（mobile-send）。

## Considered Options（全体方式）

1. **A. host 半身で Web Push を自前実装する**（`node:crypto` だけ。RFC 8291/8292 を直接実装）
2. **B. A と同じだが、送信に npm `web-push` ライブラリを使う**
3. **C. ntfy に送る**（host 半身は ntfy の topic へ HTTP POST、スマホは ntfy アプリで受ける）
4. **D. Taskloop の通知経路に載せる**
5. **E. 上流 dsh-mobile-maxxing の notify 部分をそのまま入れる**

| 基準 | A 自前 | B web-push | C ntfy | D Taskloop | E 上流そのまま |
|---|---|---|---|---|---|
| E1 到達性 | 標準の APNs 経路 | 同左 | 自前サーバーだと即時性は ntfy.sh 経由が前提 | スマホへ届ける経路が確認できない | #86 で「何も届かない」経路がある |
| E2 露出 | 暗号化され、push サービスは読めない | 同左 | 自前 ntfy + ntfy.sh。ntfy.sh 上の topic が公開名前空間 | 不明 | A と同等 |
| E3 契約 | 公開 API だけで書ける | 同左 | 同左 | 未確認 | client 側がハッシュ CSS に依存し、本プラグインの client と衝突する |
| E4 認可 | connection の admit を通せる | 同左 | ntfy 側の認証を別に持つ | — | 自前の guard。body の origin 申告を信用する |
| E5 運用 | 依存ゼロ | 依存が増える（推移的依存を含む） | ntfy アプリ、サーバー、アカウント | 既存 | 別プラグインの導入 |
| E6 検証 | RFC のテストベクタで単体検査 | ライブラリ任せ | ntfy のモックで検査 | — | 上流に E2E が無い（#88） |

## Decision（案）

**A を採る。** 上流の暗号化・VAPID 部分は、移植するなら THIRD_PARTY_NOTICES と出典コメントを付けて移す（docs/development.md
「第三者コードの移植」）。ルート・認可・SW の振る舞いは上流を写さず、以下のとおり作り直す。
B は依存を増やす代わりに暗号部分の正しさを任せられるが、暗号部分は 150 行程度で RFC のテストベクタが揃っているため、自前で検査できる。
B は A の実装中に RFC のテストベクタを通せなかった場合の退避先とする。C は追加アプリと外部の名前空間が要るため採らない。
D は Taskloop にスマホへ通知する経路が無い（少なくとも今回は確認できていない）ため採らない。E は E3・E4 で劣る。

### 1. SW の scope と配信経路

- SW スクリプトは、webServer の exact ルート `/dsh-mobile-ui/push-sw.js` で配信する。scope は `/dsh-mobile-ui/push/`
  （スクリプトのディレクトリ以下なので `Service-Worker-Allowed` は付けない）。SW は `fetch` ハンドラを持たず、キャッシュもしない。
  役割は `push`・`notificationclick`・`pushsubscriptionchange` だけに限る。
- 理由: DSH 0.2.0-rc.2 は SW を持たないが、将来 `/` に SW を置く可能性がある。1 つの scope に置ける SW は 1 つだけなので、
  上流のように `/sw.js` を scope `/` で登録すると、将来 DSH 本体の SW と取り合いになる。push の受信と通知の表示は、
  ページを制御していない SW でもできる（`clients.matchAll({ includeUncontrolled: true })` でウィンドウを探す）。
- manifest は DSH 本体の `./manifest.webmanifest`（scope `./`）をそのまま使い、本プラグインからは manifest を出さない。
  `display: fullscreen` なので、ホーム画面 Web アプリの条件（WebKit Blog）を満たす。
- SW スクリプトには秘密を含めないため、認証なしで配信する（DSH 本体の静的ファイルと同じ扱い）。
- 前提の origin は Tailscale Serve の `https://<host>.<tailnet>.ts.net`（T272）。HTTPS なので secure context の条件を満たす。
- **未検証のリスク**: iOS が、ホーム画面アプリの scope（`/`）より狭い scope の SW を push に使えるか。検証計画 V1 で確かめ、
  使えない場合だけ「scope `/` に `Service-Worker-Allowed: /` を付けて、DSH 本体が SW を持ったら撤退する」案へ切り替える（新 ADR）。

### 2. VAPID 鍵と購読の保存先

- `<DSH_HOME>/dsh-mobile-ui/push.json`（`$DSH_HOME` が無ければ `~/.dsh`）。ディレクトリは 0700、ファイルは 0600 で作る。
  一時ファイルへ書いて rename し、書込みの途中で壊れないようにする。読込み時に権限が 0600 より広ければ警告する（鍵の値は出さない）。
- 中身: VAPID 鍵対（秘密鍵は PKCS#8 PEM）と購読の一覧（`endpoint`, `keys.p256dh`, `keys.auth`, `origin`, `label`, `addedAt`）。上限は 16 件。
- 購読の endpoint は、知っている人なら誰でも push を送れる URL なので、秘密鍵と同じく秘密として扱う。
  ログ・エラー応答・Taskloop・docs には、endpoint の origin（例 `https://web.push.apple.com`）までしか出さない。
- リポジトリには入らない（DSH_HOME 配下なので作業ツリーの外）。テストでは一時ディレクトリを `DSH_HOME` に指定する。

### 3. 通知に載せる内容

- payload は `{ v: 1, kind, sessionId, title }` に限る。`kind` は `turn-completed` / `turn-failed` / `approval` / `question` のどれか。
  `title` はセッション名（`sessionTitle` の値。無ければ空）を 60 文字に切ったもの。
  本文・質問文・ツール名・承認理由・エラーメッセージは載せない。表示する文言（「完了」「承認待ち」など）は SW 側で `kind` から作る。
- 暗号化（RFC 8291）されるため、push サービス（APNs など）は payload を読めない。平文で現れるのは端末の通知、つまりロック画面である。
  そのため、ロック画面に何を出すかが本当の露出点になる。
- 注意: セッション名は、最初のプロンプトから LLM が自動で付ける場合がある（`dsh-session-title-first-prompt-llm`）。
  そのため、セッション名にもプロンプトの内容が含まれうる。設定 `notify.showSessionName`（既定は true）で外せるようにする（確認質問 Q2）。
- `Topic` ヘッダにセッション単位の値（`sessionId` のハッシュを 32 文字以内）を付け、端末が圏外の間に溜まった同じセッションの通知を、push サービス側でまとめさせる。
  TTL は 600 秒、Urgency は `high`。

### 4. ルートの認可

- 状態を変える API は `ctx.connection.fetch.register` で `/api/dsh-mobile-ui/push/{vapid,subscribe,unsubscribe,test}` に置く。
  こうすると、DSH 本体の `/api` と同じ admit（Host/Origin の柵と cookie 認証）を、DSH 本体のコードが必ず先に通す。
  上流は webServer の exact ルートで `/api/…` を横取りし、ルートごとに guard を呼んでいた。これだと guard を呼び忘れたルートが無防備になる。この方式は採らない。
- 購読に記録する origin は、リクエストの `Origin` ヘッダから取る（柵が `Origin.host === Host` を保証する）。上流のように body の自己申告は使わない。
  `Origin` が無い POST は 400 で拒否する。
- `subscribe` で受け取る endpoint は、https で、既知の push サービスの許可リストに一致するものに限る。
  許可リストの既定は `*.push.apple.com`、`fcm.googleapis.com`、`updates.push.services.mozilla.com`、`*.notify.windows.com`。設定で変えられる。
  上流の拒否リスト方式は、プライベートアドレスの書き方の揺れ（IPv6、10 進表記、DNS の向け先変更）を取りこぼしうるため採らない。
- `test` は、実際の送信結果（購読ごとの HTTP ステータスと push サービスの origin）を返す。push を 1 件も送れなければ `ok: false` を返す（#88 の反省）。

### 5. 前面にいるときの扱い

- SW は push を受けたら、**必ず** `showNotification` を呼ぶ。ページが見えているかどうかで抑止しない。
  理由: Apple は、通知を表示しない push があると許可を取り消すと明記している。また上流 #86 は、見えているページからの ack を待って
  OS 通知を出さない作りだったため、何も届かない経路ができていた。
- アプリ内バナーは push に頼らず、client 半身がページ内の情報だけで出す。初版ではアプリ内バナーを実装しない（確認質問 Q4）。
  初版では、前面で OS 通知が重なることを受け入れる。`tag` をセッションごとに付け、同じセッションの通知は置き換える。
- `notificationclick` は、既存のウィンドウがあれば focus して `postMessage({ type: 'dsh-mobile-ui:open-session', sessionId })` を送り、
  無ければ `clients.openWindow('/')` を呼ぶ。client 半身がセッションを開く手段（公開 API があるか）は未確認で、実装時に調べる。
  手段が無ければ、初版では「アプリを前面に出す」だけにする。

### 6. 対象とするイベント

- 通知するのはルートエージェント（`agents.roots()` に含まれるもの）だけ。サブエージェントは通知しない。
- ターン終了: `session/event` の `turn/end` のうち、`reason.kind` が `completed`（→ `turn-completed`）、または `error` / `max-tokens` / `blocked`
  （→ `turn-failed`）のもの。`aborted`（ユーザーが止めた）、`interrupted`、`forked` は通知しない。
- 承認待ち: `session/event` の `approval/asked` を観測する。waterfall の `approval/request` には加わらない（観測だけなら応答の連鎖へ入る必要が無いため）。
- 質問待ち: `user-questions/request` に、先頭で必ず `next()` を返す listener として加わる（対応する session/event が無いため）。
  `prepend` の正式な仕様は実装時に cordis の型定義で確かめる。
- 「スマホから送ったターンだけ」に絞る機能は初版に入れない。ターンのイベントには送信元の情報が無く、絞るには client 半身が
  送信のたびに印を付ける必要がある（上流の mobile-send）。送信の検出が DOM 依存になり、spec.md §3 の公開契約の外へ出るためである。
  初版は「購読した端末へ、すべてのルートセッションのイベントを送る」とし、絞り込みは設定 `notify.events` で種類単位に止められるようにする（確認質問 Q1）。
- 連打を避けるため、同じセッション・同じ種類の通知は 10 秒以内に 1 件までにする。

### 7. 代替案

上の表のとおり。C（ntfy）は、自前の Web Push を iOS で使えないと分かった場合（V1・V2 が不成立）の次点とする。

## Pros and Cons of the Options

### A 自前実装
- Good: 依存ゼロ。RFC のテストベクタで単体検査できる。payload・認可・SW を本プラグインの要件に合わせて設計できる
- Bad: 暗号処理を自分で保守する。iOS 固有の癖（BadJwtToken の `sub`、JWT の更新頻度）を自分で踏む
### B web-push ライブラリ
- Good: 利用者の多い実装で、暗号と JWT の細部を任せられる
- Bad: runtime 依存とその推移的依存が増え、供給網のリスクと更新作業が増える。ローカルプラグインは `npm ci` の手順も増える
### C ntfy
- Good: 実績のある配信基盤。iOS アプリがあり、SW や iOS PWA の制約から自由
- Bad: 追加アプリと追加サーバーが要る。自前サーバーで即時に届けるには ntfy.sh（外部）を経由する。topic 名が実質の秘密になる
### D Taskloop
- Good: 既存の作業記録と通知の窓口を一本化できる
- Bad: スマホへの配信経路が確認できない。DSH セッションのイベントと Taskloop を結ぶ部分を別に作る必要がある
### E 上流をそのまま
- Good: 動く実装が既にある
- Bad: 既知の不具合（#85 は 24e2e49 の `notify/host.js:248-249` で修正済み。#86 は同 `sw.js:318-327` で見えているウィンドウがあると OS 通知を出さない作りのまま。#88 の現状は未確認）。認可が自前 guard 頼み。client 側が本プラグインと衝突する

## Consequences

- Positive: 背景のスマホへ「完了」「承認待ち」が届く。DSH の認証境界をそのまま使える。秘密値は DSH_HOME の 0600 ファイルだけに置かれる
- Negative: 本プラグインが host 半身・状態ファイル・外部への送信を持つ。テストに host 側の層（node:test のみ、happy-dom 不要）が増える。
  spec.md に host 側の節を足す必要がある（実装時。今回は spec を変えない）
- Risk / 再検討条件:
  - V1 が不成立（iOS が狭い scope の SW で push を受けない）→ scope `/` 案の新 ADR
  - DSH 本体が SW を持った、または `connection.fetch.register` の契約が変わった → 本 ADR を見直す
  - `approval/asked` がログ専用の監査イベントでなくなった → 承認の検出方法を見直す
  - 前面での重複通知が実用上うるさい → アプリ内バナーと抑止の新 ADR（push 依存にはしない）

## 検証計画（accepted にする条件）

自動（`npm test`、node:test）:
- T1 RFC 8291 Appendix A の入力（鍵・salt・auth_secret・平文）で暗号化し、ヘッダと暗号文が付録の値と一致する
- T2 VAPID の JWT: ヘッダ `{typ:"JWT",alg:"ES256"}`、`exp` が 24 時間以内、`sub` が `mailto:` / `https:`。公開鍵で署名を検証できる（RFC 8292 §2–3）
- T3 送信: 送信関数へ注入した偽の fetch（push サービスの代わり）に対し、`content-encoding: aes128gcm`・`ttl`・`urgency`・`authorization` が付き、
  `content-length` を手で付けていない（#85）ことを確かめる。201 で成功、404 / 410 で購読を削除、それ以外では購読を残す
- T4 認可: `fetch.register` へ渡した route だけを使い、admit を通らないリクエストが handler に届かないことは DSH 側の契約として、
  handler 自身については `Origin` 無しで 400、許可リスト外の endpoint で 400、を検査する
- T5 保存: 一時 `DSH_HOME` に作ったファイルが 0600、ディレクトリが 0700。壊れた JSON から復帰し、鍵を作り直さない（作り直すと全購読が無効になるため、壊れていたら退避して警告）
- T6 イベント: 偽の `agents` / `session/event` を流し、ルートだけ・対象の `reason.kind` だけ・10 秒の間引き、を確かめる
- T7 SW: `push` イベントの偽装で、見えているウィンドウがあっても `showNotification` が必ず呼ばれる（#86）

実機（iPhone、ホーム画面 Web アプリ、Tailscale Serve の origin）:
- V1 scope `/dsh-mobile-ui/push/` で登録・購読でき、アプリを閉じた状態でテスト通知が出る
- V2 画面ロック中・アプリを閉じた状態で、ターン完了と承認待ちの通知が出る
- V3 通知をタップするとアプリが開く（前面化。セッションを開けるかは手段次第）
- V4 設定画面のテスト通知ボタンの結果表示が、実際の到達と一致する（#88）
- V5 iOS の「設定」で通知を切ると、`test` が push サービスのエラー（410 など）を返し、購読が消える

## 確認質問（オーナー）

- Q1 通知の対象: すべてのルートセッションのイベントを送る（初版の案）か、スマホから送ったターンだけに絞るか。絞る場合は、client 半身が送信を検出する方法（DOM 依存になりうる）を別途決める
- Q2 ロック画面にセッション名を出すか（既定は出す案）。自動命名の場合、セッション名に最初のプロンプトの内容が含まれうる
- Q3 承認待ちと質問待ちは、ターン完了と同じ扱いでよいか（どちらも既定で送る案）
- Q4 前面で OS 通知が重なるのを初版では受け入れてよいか。アプリ内バナー（push に依存しない）は後続のタスクに分ける案
- Q5 VAPID の `sub`: 既定は購読した origin（`https://<host>.ts.net`）を使う案。tailnet 内の名前を Apple / Google へ送ることになるが、よいか。
  代わりに `mailto:` の連絡先を使う場合は、使うアドレスを指定してほしい
- Q6 上流の暗号化コード（`notify/host.js:89-268`）を出典付きで移植するか、RFC から書き起こすか（どちらでも THIRD_PARTY_NOTICES の運用で扱える）

## 関連ADR

- ADR-20261023-1720（公開契約だけに依存する）
- ADR-20261024-0410（テスト基盤）
- ADR-20261024-0430（ブランチ運用）
