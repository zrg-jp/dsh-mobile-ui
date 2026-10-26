# Web Push 通知を host 半身で送る（SW の scope、鍵の保存、通知に載せる内容、認可）

- Status: proposed
- Date: 2026-10-26
- Level: 3
- Deciders: AI（設計担当サブエージェント）による案。独立レビュー 1 回目（Codex gpt-6.1-sol, effort high）の判定は no、2 回目（同モデル、workflow 経路・effort 指定なし）の判定は conditional（いずれも 2026-10-26）。指摘を検証して改訂した（§「独立レビューへの対応」）。オーナーは未回答
- 関連タスク: T350（設計）、T341（THIRD_PARTY_NOTICES）、T313（未確認点の洗い出し）、T272（Tailscale Serve）

## Context

dsh-mobile-ui は今、client だけのプラグインである（`lib/index.js` の `apply()` は空）。スマホを閉じている間に
「ターンが終わった」「承認・質問待ち」を知らせるには、host 側に HTTP ルート・状態ファイル・外部（push サービス）への
送信を持つ必要がある。これは本プラグインで初めての host 機能で、元に戻しにくく、セキュリティと秘密情報の扱いに関わる
（重要決定）。上流 kuraneko1/dsh-mobile-maxxing（MIT）に同機能の実装があるが、既知の不具合（#85, #86, #88）がある。
本 ADR は T350 の 7 項目に答える設計案で、実装はまだ行わない。比較実験は未実施のため、根拠は配布物の読解と外部一次資料による。

## Decision Drivers

- 背景に回ったスマホ（iPhone のホーム画面 Web アプリ）へ、TTL（600 秒）内に push サービスへ受け付けられ、端末が受信できる状態なら表示されること。
  push サービスの 201 は受付であって配達ではないため（RFC 8030 §5）、「確実に届く」は保証の対象にしない
- 通知の中身とメタデータが、第三者（push サービス、ロック画面・通知履歴・連携端末を見る人）へ必要以上に出ないこと
- DSH の公開契約だけに依存すること（spec.md §3、ADR-20261023-1720）。ハッシュ化クラス名と内部ストアに依存しない
- 秘密値（VAPID 秘密鍵、購読 endpoint）を git・docs・ログへ出さないこと
- 上流の既知の不具合を繰り返さず、自動テストで確かめられること
- runtime 依存を増やさないこと（現在 runtime 依存はゼロ）

## 評価基準（比較の前に確定）

| ID | 基準 | 判定方法 |
|---|---|---|
| E1 | 到達性 | iPhone PWA が背景・画面ロック中のときに OS 通知が出るか。出ない経路が設計上あるか |
| E2 | 露出 | 平文の内容・暗号化された内容・メタデータ（時刻・頻度・大きさ・VAPID の `sub`・endpoint）が、それぞれどこに現れるか |
| E3 | 契約 | DSH 0.2.0-rc.2 の公開 API（型定義・README に載るもの）だけで書けるか |
| E4 | 認可 | 未認証・別 origin・別サイトからのリクエストを、DSH 本体と同じ基準で拒否できるか |
| E5 | 運用 | 追加アプリ・外部アカウント・runtime 依存・常駐プロセスの数 |
| E6 | 検証 | RFC のテストベクタと偽 push サービスで自動検査できるか（A・B とも同じ条件で評価する） |
| E7 | 保守 | 暗号・プロトコルを自前で保守する負担と、依存の更新・供給網の負担 |

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
取得日時は 2026-10-26 14:53–14:55 JST（初版）。改訂時の追加分は 17:49–17:51 JST（各項目に記す）。

- WebKit Blog「Web Push for Web Apps on iOS and iPadOS」（公開 2023-02-16）https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
  iOS/iPadOS 16.4 から、ホーム画面に追加した Web アプリ（manifest の `display` が `standalone` / `fullscreen`）で Web Push が使える。
  許可の要求はユーザー操作（タップ）への応答でなければならない。push サービスは APNs で、Apple Developer Program は不要。
  サーバーが送信先を制限するなら `*.push.apple.com` を許可する。
- Apple Developer「Sending web push notifications in web apps and browsers」https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
  「Safari doesn't support invisible push notifications」。push を受けたら直ちに通知を表示しないと、通知の許可を取り消される。
  JWT の `exp` は 1 日以内。JWT の更新は 1 時間に 1 回より頻繁にしない。payload の上限は 4 KB。
  （レビュアーは同ページの本文取得に失敗し、Apple 固有の記述を独立には確認していない。本 ADR では、初版で JSON から本文を取得して確認した。）
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
- W3C Push API（TR 版）https://www.w3.org/TR/push-api/ （2026-10-26 17:49 JST、curl）
  §4: payload は暗号化されるが、push サービスは時刻・頻度・大きさのメタデータを知る。権限が取り消されたとき、UA は `pushsubscriptionchange`
  （`newSubscription = null`）を発火してもよい（MAY）。必須ではない。§10.4: `pushsubscriptionchange` は購読の更新・取消・喪失を表し、
  `newSubscription` は新しい購読が無ければ null。§10.3: 復号できない push では push イベント自体が発火しない。
- WebKit Blog「Meet Web Push」（公開 2022-06-07）https://webkit.org/blog/12945/meet-web-push/ （2026-10-26 17:50 JST、web_fetch）
  購読の要求には明示的なユーザー操作が要る。`userVisibleOnly: true` が必須で、push を受けたら必ず通知を出す。約束を破ると購読が取り消される。
  endpoint を絞るなら `push.apple.com` の任意のサブドメインを許可する。
- WHATWG Fetch https://fetch.spec.whatwg.org/ （2026-10-26 17:49 JST、curl）
  request の redirect mode は `follow` / `error` / `manual` で、既定は `follow`。`error` はリダイレクトをネットワークエラーにする。
- W3C Service Workers §3.4.2 `ready`（上記 URL、初版で取得した本文を再確認）: `ready` は、そのページ（client）に一致する registration
  （Match Service Worker Registration）を待つ。ページがその scope の外にあると、`ready` は解決しない。
- RFC 8292 §3.2（初版で取得した txt を再確認）: 鍵交換（RFC 8291）と認証トークンの署名には、異なる秘密鍵を使わなければならない（MUST）。
- RFC 8030 §5（同上）: 201 は push メッセージの受付を表し、UA への配達は表さない。§5.4: 同じ topic の新しいメッセージは、
  未配達の古いメッセージを削除して置き換える。
- npm registry `web-push` latest（2026-10-26 17:51 JST、curl で `https://registry.npmjs.org/web-push/latest`）: 3.6.7、MPL-2.0、
  依存は jws・asn1.js・http_ece・minimist・https-proxy-agent の 5 件（直接依存のみ。推移的依存は数えていない）。
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
| E2 露出 | 内容は暗号化。push サービスにはメタデータと VAPID `sub` が見える | 同左 | 想定構成 C1（自前 ntfy＋`upstream-base-url`=ntfy.sh）: 内容は自前サーバーに平文、ntfy.sh にはメッセージ ID と topic URL のハッシュ。C2（ntfy.sh を直接使う）: 内容が ntfy.sh に平文で載る | 不明 | A と同等 |
| E3 契約 | 公開 API だけで書ける | 同左 | 同左 | 未確認 | client 側がハッシュ CSS に依存し、本プラグインの client と衝突する |
| E4 認可 | connection の admit を通せる | 同左 | ntfy 側の認証を別に持つ | — | 自前の guard。body の origin 申告を信用する |
| E5 運用 | runtime 依存ゼロ | 直接依存 5 件（web-push 3.6.7）。ローカルプラグインに `npm ci` の手順が増える | ntfy アプリ、C1 なら自前サーバー | 既存 | 別プラグインの導入 |
| E6 検証 | RFC ベクタ・偽 push サービス・実機（下の T/V）| 同じ T/V を同じ条件で実行できる（差は無い） | ntfy のモックで検査 | — | 上流に E2E が無い（#88） |
| E7 保守 | 暗号・JWT・ヘッダの相互運用を自前で保守する。iOS 固有の癖も自分で追う | 暗号・JWT はライブラリが保守。依存の更新・脆弱性対応と MPL-2.0 の扱いが増える | ntfy 側が保守 | — | 上流の変更を追う |

## Decision（案）

**A を採る。** 上流の暗号化・VAPID 部分は、移植するなら THIRD_PARTY_NOTICES と出典コメントを付けて移す（docs/development.md
「第三者コードの移植」）。ルート・認可・SW の振る舞いは上流を写さず、以下のとおり作り直す。
A と B は E1–E4・E6 で差が無い（同じ試験を同じ条件で実行できる）。差は E5・E7 だけで、どちらを重く見るかの判断である。
A を選ぶ理由: (1) 本プラグインは runtime 依存ゼロで、ローカルプラグインとして symlink だけで導入できる（README「Install」）。
依存を足すと導入手順と更新作業が恒常的に増える。(2) 必要な暗号処理は Node 標準の `node:crypto` だけで書け、規格（RFC 8291/8292）と
テストベクタが固定されている。そのため、保守の対象が時間とともに大きく変わることは少ないと見込む（推測）。
(3) web-push の HTTP 送信部分（プロキシ対応など）は本用途では不要である。
A の欠点（自前保守と、iOS 固有の相互運用の不具合を自分で踏む負担）は受け入れる。T1–T3 または V1–V2 で、RFC ベクタや実機との相互運用を
期限内に通せない場合は B に切り替える（その判断は新しい ADR にする）。C は追加アプリが要り、C2 では内容が外部に平文で載るため採らない。C1 は露出の点では A と同程度だが、自前の ntfy サーバーを常駐させる必要がある。
D は Taskloop にスマホへ通知する経路が無い（少なくとも今回は確認できていない）ため採らない。E は E3・E4 で劣る。

### 1. SW の scope と配信経路

- SW スクリプトは、webServer の exact ルート `/dsh-mobile-ui/push-sw.js` で配信する。scope は `/dsh-mobile-ui/push/`
  （スクリプトのディレクトリ以下なので `Service-Worker-Allowed` は付けない）。SW は `fetch` ハンドラを持たず、キャッシュもしない。
  役割は `push` と `notificationclick` だけに限る（`pushsubscriptionchange` ではサーバーへ何も送らない。§5）。
- 理由: DSH 0.2.0-rc.2 は SW を持たないが、将来 `/` に SW を置く可能性がある。1 つの scope に置ける SW は 1 つだけなので、
  上流のように `/sw.js` を scope `/` で登録すると、将来 DSH 本体の SW と取り合いになる。push の受信と通知の表示は、
  ページを制御していない SW でもできる（`clients.matchAll({ includeUncontrolled: true })` でウィンドウを探す）。
- manifest は DSH 本体の `./manifest.webmanifest`（scope `./`）をそのまま使い、本プラグインからは manifest を出さない。
  `display: fullscreen` なので、ホーム画面 Web アプリの条件（WebKit Blog）を満たす。
- SW スクリプトには秘密を含めないため、認証なしで配信する（DSH 本体の静的ファイルと同じ扱い）。
- **購読の手順（client 半身）**（レビュー指摘 5）。ページ（`/`）はこの SW の scope の外にあるため、`navigator.serviceWorker.ready` は使わない
  （ready はページに一致する registration を待つので、解決しないか、将来の別 SW を返す。SW 仕様 §3.4.2）。
  1. 設定画面を開いた時点で、`navigator.serviceWorker.register('/dsh-mobile-ui/push-sw.js', { scope: '/dsh-mobile-ui/push/' })` を呼ぶ。
     返った registration の `installing` / `waiting` / `active` を見て、active になるまで待つ。あわせて `GET /api/dsh-mobile-ui/push/vapid` で公開鍵を取っておく。
  2. ユーザーが「通知を有効にする」をタップしたら、そのハンドラの中で、間に await を挟まずに `Notification.requestPermission()` と
     `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` を呼ぶ（WebKit「Meet Web Push」: 明示的なユーザー操作と `userVisibleOnly: true` が必須）。
     iOS がユーザー操作の有効期間をどこまで認めるか（permission の解決後に subscribe しても通るか）は未確認で、V1 で確かめる。
  3. 得た購読を `POST /api/dsh-mobile-ui/push/subscribe` で送る。
  4. 起動のたびに `navigator.serviceWorker.getRegistration('/dsh-mobile-ui/push/')` で registration を取り直し、`pushManager.getSubscription()` を
     サーバーの記録と照合する。食い違えば、ページから（cookie 認証付きで）再登録または削除する。照合の規則（2 回目の指摘 2）:
     - 端末側は、最後にサーバーへ登録した購読の `id` を `localStorage`（キー `dsh-mobile-ui:push:subscriptionId`）に持つ。
     - 現在の購読の `id` が保存値と異なれば、`POST …/subscribe { subscription, replaces: <保存値> }` で新しい購読を登録し、同じリクエストの中で
       `replaces` の購読を削除する（置換）。サーバーは `replaces` が存在しなければ無視する。保存値を新しい `id` に更新する。
     - 端末に購読が無い（権限の取消・SW の消失）ときは、保存値の購読を削除し、保存値を消す。自動で購読し直さない（購読はユーザー操作から）。
     - 保存値が無い（localStorage の消失・初回）ときは、他の購読を一切削除しない。端末を特定できない記録の整理は、設定画面の一覧から手で行う。
     - サーバー側で明示的に失効させた購読（`unsubscribe` で削除した `id`）は、`revoked` 一覧（`id` と失効時刻。上限 64 件、古いものから捨てる）に残す。
       同じ endpoint を照合の自動処理で再登録しようとしたら 409 `{ reason: 'revoked' }` で拒否し、端末側は保存値を消して「通知は無効」と表示する。
       再有効化は、ユーザーが「通知を有効にする」をタップしたときの購読（リクエストに `userInitiated: true`）だけで行い、その時点で `revoked` から外す。
       `userInitiated` はページが自己申告する値であり、セキュリティ境界ではない（認証済みの操作者の誤操作を防ぐための区別）。
- 前提の origin は Tailscale Serve の `https://<host>.<tailnet>.ts.net`（T272）。HTTPS なので secure context の条件を満たす。
- **未検証のリスク**: iOS が、ホーム画面アプリの scope（`/`）より狭い scope の SW を push に使えるか。検証計画 V1 で確かめ、
  使えない場合だけ「scope `/` に `Service-Worker-Allowed: /` を付けて、DSH 本体が SW を持ったら撤退する」案へ切り替える（新 ADR）。

### 2. VAPID 鍵と購読の保存先

- `<DSH_HOME>/dsh-mobile-ui/push.json`（`$DSH_HOME` が無ければ `~/.dsh`）。ディレクトリは 0700、ファイルは 0600 で作る。
- 書込み（レビュー指摘 3）: 一時ファイルは同じディレクトリに `open(…, 'wx', 0o600)` で作る（作成の瞬間から 0600、既存なら失敗）。
  書いて fsync してから rename する。退避ファイル（下記）も同じ方法で作る。プロセス内の更新はキュー 1 本で直列化し、
  鍵の初回生成もその中で行う。複数プロセス（同じ DSH_HOME を使う複数 profile）との間では、更新を次の 1 トランザクションとして行う（2 回目の指摘 1）:
  1. `push.json.lock` を `wx` で作ってロックを取る（中身は pid・ホスト名・取得時刻。取れなければ 50 ms 間隔で最大 2 秒まで再試行し、だめなら失敗）。
  2. ロックの中で `push.json` を読み直し、読込み時の検査（下記）を通す。メモリ上の古い状態は使わない。
  3. 変更を適用する。鍵が無いときだけ鍵を作る（他プロセスが先に作っていれば、それを使う）。
  4. 一時ファイルへ書いて fsync し、rename する。
  5. ロックファイルを消す。
  ロックが残っていた場合（異常終了）は、ロックの pid が同じホストで生きていない（`process.kill(pid, 0)` が ESRCH）か、取得から 30 秒を超えていれば、
  古いロックとして消してから取り直す（pid の再利用で誤判定しうるが、30 秒の上限で回復する）。
  送信側は購読の一覧をキャッシュしない。送信の直前に（ロックなしで）`push.json` を読み直し、削除済みの購読へは送らない。
  404/410 による削除もトランザクションで行う。
- 読込み時の検査: ディレクトリとファイルの所有者が現在のユーザーであること、通常ファイル（`lstat` で symlink でない）であること、
  権限が 0600（ディレクトリは 0700）より広くないこと。どれかに反するか JSON が壊れていれば、**送信と上書きを止め**、
  理由だけ（鍵や endpoint の値は出さない）をログと `GET …/status` に出す。鍵を勝手に作り直さない（作り直すと全購読が無効になる）。
  復旧手順（権限を直す、壊れたファイルを退避して作り直す＝全端末で購読し直し）は実装時に docs に書く。
- 中身: VAPID 鍵対（秘密鍵は PKCS#8 PEM）と購読の一覧（`id`, `endpoint`, `keys.p256dh`, `keys.auth`, `origin`, `label`, `addedAt`, `lastOkAt`）。
  `id` は endpoint の SHA-256 の先頭 16 桁で、画面と API で購読を指すのに使う（endpoint そのものは返さない）。
- 上限は 16 件。超えたら新しい購読を 409 で拒否し、既存の削除を求める（古いものを黙って消さない）。同じ endpoint の再登録は上書き（冪等）。
- 診断出力: 例外や push サービスの応答本文をそのままログへ渡さない。ログは「購読 id・push サービスの origin・HTTP ステータス・
  `reason` コード」に限り、この形式をテストで固定する（2 回目の指摘 4）:
  - 応答本文は先頭 4 KiB までしか読まず、残りは捨てる（`response.body` を読み切らずに cancel する）。
  - `reason` は JSON の `reason` 項目が、次の許可リストのどれかと完全一致する場合だけ使う。それ以外（未知の値、文字列でない、JSON でない）は固定値 `unknown` とする。
    許可リストは Apple Developer の文書に載る値: `BadTtl` `BadUrgency` `BadWebPushRequest` `BadWebPushTopic` `VapidPkHashMismatch` `IdleTimeout`
    `BadAuthorizationHeader` `BadJwtToken` `BadVapidPublicKey` `BadPath` `MethodNotAllowed` `PayloadTooLarge` `TooManyRequests`
    `InternalServerError` `ServiceUnavailable` `Shutdown`（初版で取得した本文で確認）。
  - API の応答（`test` の `rejected`）にも同じ値だけを載せる。
- 購読の endpoint は、知っている人なら誰でも push を送れる URL なので、秘密鍵と同じく秘密として扱う。
  ログ・エラー応答・Taskloop・docs には、endpoint の origin（例 `https://web.push.apple.com`）までしか出さない。
- リポジトリには入らない（DSH_HOME 配下なので作業ツリーの外）。テストでは一時ディレクトリを `DSH_HOME` に指定する。

### 3. 通知に載せる内容

- payload は `{ v: 1, kind, sessionId }` に限る。`kind` は `turn-completed` / `turn-failed` / `approval` / `question` / `test` のどれか。
  本文・質問文・ツール名・承認理由・エラーメッセージは載せない。表示する文言（「完了」「承認待ち」など）は SW 側で `kind` から作る。
- セッション名（`title`）は既定では載せない（レビュー指摘 8、U78 の暫定値）。セッション名は最初のプロンプトから LLM が自動で付ける場合があり
  （`dsh-session-title-first-prompt-llm`）、プロンプトの内容が含まれうるため。設定 `notify.includeSessionName: true` のときだけ、
  60 文字に切って `title` として payload に入れる。false のときは表示だけでなく payload からも除く。
- 露出先の区別:
  - 平文の内容: 送信 host（メモリ上）、端末の通知（ロック画面・通知センターの履歴・連携する Apple Watch。WebKit Blog 13878）。
  - 暗号化された内容: push サービス（RFC 8291。復号できない）。
  - メタデータ: push サービスは送信の時刻・頻度・大きさを知る（Push API §4）。VAPID の `sub` と `aud`、endpoint も push サービスに見える。
    `sub` は暗号化の保護の外にある（下記 Q5）。
- `Topic` は種類ごとに分ける（レビュー指摘 10）。値は `base64url(SHA-256(sessionId + ':' + kind))` の先頭 32 文字。
  同じ topic の新しいメッセージは、未配達の古いメッセージを削除して置き換える（RFC 8030 §5.4）。種類を分けることで、未配達の「質問待ち」が
  「完了」に消されることは無くなる。同じセッション・同じ種類では最新の 1 件だけが残る（これは仕様として受け入れる）。
  SW の通知 `tag` も同じ値にして、端末上の表示も種類ごとに置き換える。
- TTL は 600 秒、Urgency は `high`。600 秒はイベントの寿命であり、キュー待ちと再試行を含む（2 回目の指摘 3）:
  通知を作るとき（イベント発生時）に `createdAt` と `expiresAt = createdAt + 600 秒` を固定する。初回の送信と再試行の直前に期限を調べ、
  過ぎていれば送らずに破棄する（件数を `status` に出す）。HTTP の `TTL` ヘッダは残り秒数（切り捨て、1 以上）とし、600 を超えない。
  再試行の待ち時間が期限を越えるなら、再試行せずに破棄する。平文は UTF-8 のバイト数で 3993 octets 以下（RFC 8291 §4）でなければならないが、上の形式なら 200 バイト未満に収まる。
  上限を超える payload は送らずにエラーとする（切り詰めて送らない）。

### 4. ルートの認可

- API は `ctx.connection.fetch.register` で `/api/dsh-mobile-ui/push/*` に置く。DSH 本体の `/api` と同じ admit（Host/Origin の柵と cookie 認証）を、
  DSH 本体のコードが必ず先に通す（dsh-client-connection `lib/index.js:820-843`）。上流は webServer の exact ルートで `/api/…` を横取りし、
  ルートごとに guard を呼んでいた。これだと guard を呼び忘れたルートが無防備になるので、この方式は採らない。
- ルートごとの契約（レビュー指摘 2）。`fetch.register` に宣言した method 以外は DSH の通常の `/api` 経路へ流れ、本プラグインの handler には届かない。
  変更系は handler の中でも次の Origin 検査を行う（柵だけに頼らない多重化）。

  | path | method | body | Origin 検査 | 成功 | 拒否 |
  |---|---|---|---|---|---|
  | `vapid` | GET | なし | 不要（公開鍵だけ） | 200 `{ publicKey }` | admit の 401/403 |
  | `status` | GET | なし | 不要 | 200 `{ enabled, reason?, subscriptions: [{ id, service, label, addedAt, lastOkAt }] }` | admit の 401/403 |
  | `subscribe` | POST | JSON `{ subscription, label? }`、`content-type: application/json` 必須 | 必須 | 200 `{ id }` | 400（JSON・形式・endpoint 不正）、403（Origin）、409（上限）、415、503（送信停止中） |
  | `unsubscribe` | POST | JSON `{ id }` または `{ all: true }` | 必須 | 200 `{ removed }` | 400、403、415 |
  | `test` | POST | JSON `{}` | 必須 | 200（下記） | 403、415、503 |

  Origin 検査（handler 内）: `Origin` ヘッダが有り、`null` でなく、`new URL(origin).origin` が、リクエストの scheme と Host から作った origin と
  完全に一致すること。scheme は、loopback 以外の Host では `https` に限る（Tailscale Serve は TLS を終端して http で DSH へ転送するため、
  scheme は `X-Forwarded-Proto` ではなく「loopback 以外は https」とみなす。この前提は V1 で確かめる）。
  DSH の柵は `Origin.host === Host` しか見ず scheme を比べないため（`lib/index.js:212-218`）、この検査で補う。反すれば 403。
- 購読に記録する origin は、上の検査を通った `Origin` ヘッダの値とする。上流のように body の自己申告は使わない。用途は表示と、
  origin が変わったときの購読の整理（下記）に限る。送信先の決定には使わない。
- endpoint の検査（レビュー指摘 1）。`subscribe` の受付時、設定の読込み時、送信の直前の 3 か所で同じ関数を通す。
  - `new URL(endpoint)` で正規化し、`protocol === 'https:'`、`port === ''`（443 以外の明示ポートを禁止）、`username === '' && password === ''`、
    hostname が IP リテラルでないこと。
  - hostname（小文字化・末尾の `.` を除去）が許可リストに一致すること。項目は「完全一致」か「`.` 区切りの suffix 一致」（`*.push.apple.com` は
    `x.push.apple.com` に一致し、`push.apple.com.evil.example` や `evilpush.apple.com` には一致しない）。
  - 既定の許可リストは `*.push.apple.com`（WebKit Blog 12945・13878）、`fcm.googleapis.com`、`updates.push.services.mozilla.com`、`*.notify.windows.com`。
    Apple 以外の 3 件は一次資料を確認していない（iPhone 以外を使う場合に確認する）。設定で変更できるが、IP リテラルと private アドレスは設定でも許可しない。
  - 送信は `fetch(endpoint, { redirect: 'error' })` とする（Fetch の既定は `follow` で、入口の検査をリダイレクト先が迂回できるため）。
  - DNS の向け先（hostname がどの IP に解決されるか）は検査しない。許可リストの hostname は外部の push サービスのものに限るため、
    その DNS を信頼する（残るリスクとして記録する）。
- `test` の応答（レビュー指摘 7）は購読ごとに `{ id, service, result }` を返す。`result` は `accepted`（push サービスが 2xx で受け付けた）、
  `gone`（404/410。購読を削除した）、`rejected`（その他の 4xx。Apple の `reason` コードを添える）、`failed`（5xx・429・タイムアウト・ネットワーク）のどれか。
  画面には「push サービスが受け付けた／送信に失敗した」と、「端末での表示は確認できない」を分けて示す。201 は配達の証明ではない（RFC 8030 §5）。
- 購読のライフサイクル（レビュー指摘 9）:
  - 購読は「この DSH の操作者が、この端末で通知を受ける」ことを表し、cookie の有効期限（`cookieMaxAgeDays` 既定 30 日、dsh-client-connection
    `lib/index.js:802`）とは独立に続く。DSH 0.2.0-rc.2 には明示的なログアウトや端末ごとの cookie 失効の API が見当たらないため、
    「ログアウトで購読を止める」連動は作らない。代わりに、設定画面から端末ごとの削除（`unsubscribe { id }`）と全購読の失効（`unsubscribe { all: true }`）を行えるようにする。
  - 端末を紛失したら、別の端末から全購読を失効させる。鍵を作り直したい場合は `push.json` を手で退避する（全購読が無効になる）。
  - origin が変わったら（Tailscale のマシン名の変更など）、その origin の購読は新しい origin のページからは見えるが、送信は続ける
    （push の送信先は endpoint で決まり、origin に依存しないため）。整理は画面から手で行う。
  - 単一オーナー前提である。DSH 0.2.0-rc.2 の認証は操作者 1 人（`operator` Peer）なので、ユーザー別の購読は持たない。

### 5. 前面にいるときの扱い

- SW は push を受けたら、**必ず** `event.waitUntil(self.registration.showNotification(…))` を呼ぶ（レビュー指摘 6）。ページが見えているかどうかで抑止しない。
  payload が空・JSON でない・`v` が未知・`kind` が未知のときも、汎用の通知（「DSH: 新しい通知」）を出す。解析は try の中で行い、
  どの分岐でも `showNotification` へ到達するようにする。
  理由: Apple は、通知を表示しない push があると許可を取り消すと明記している（Apple Developer、WebKit「Meet Web Push」）。
  また上流 #86 は、見えているページからの ack を待って OS 通知を出さない作りだったため、何も届かない経路ができていた。
- `pushsubscriptionchange` の扱い（レビュー指摘 6）: SW からサーバーへの更新専用の経路は作らない（cookie 認証と Origin 検査を迂回する経路を増やさないため）。
  SW は何も送らず、次にページを開いたときの照合（§1 の手順 4）で、新しい購読の登録と古い購読の削除を行う。
  その間に古い購読へ送った push は 404/410 になり、送信側で削除される。権限の取消で必ずこのイベントが来るとは限らない（Push API §4 は MAY）。
  そのため、取消の検出は「404/410 を受けたら削除」と「ページを開いたときの照合」の 2 つで行う。
- アプリ内バナーは push に頼らず、client 半身がページ内の情報だけで出す。初版ではアプリ内バナーを実装しない（確認質問 Q4）。
  初版では、前面で OS 通知が重なることを受け入れる（U78 の暫定値）。`tag` はセッションと種類ごとに付け（§3 の Topic と同じ値）、同じセッション・同じ種類の通知は置き換える。
- `notificationclick` は、既存のウィンドウがあれば focus して `postMessage({ type: 'dsh-mobile-ui:open-session', sessionId })` を送り、
  無ければ `clients.openWindow('/')` を呼ぶ。client 半身がセッションを開く手段（公開 API があるか）は未確認で、実装時に調べる。
  手段が無ければ、初版では「アプリを前面に出す」だけにする。

### 6. 対象とするイベント

- 通知するのはルートエージェント（`agents.roots()` に含まれるもの）だけ。サブエージェントは通知しない。
- ターン終了: `session/event` の `turn/end` のうち、`reason.kind` が `completed`（→ `turn-completed`）、または `error` / `max-tokens` / `blocked`
  （→ `turn-failed`）のもの。`aborted`（ユーザーが止めた）、`interrupted`、`forked` は通知しない。
- 承認待ち: `session/event` の `approval/asked` を観測する。waterfall の `approval/request` には加わらない（観測だけなら応答の連鎖へ入る必要が無いため）。
- 質問待ち: `user-questions/request` に、先頭で必ず `next()` を返す listener として加わる（対応する session/event が無いため）。
  listener は通知を送信キューに積むだけで、送信の完了を待たずに `return next()` する（レビュー指摘 10）。キューへの投入で例外が出ても握りつぶし、
  `next()` の結果（回答）をそのまま返す。`prepend` の正式な仕様は実装時に cordis の型定義で確かめる。
- 「スマホから送ったターンだけ」に絞る機能は初版に入れない。ターンのイベントには送信元の情報が無く、絞るには client 半身が
  送信のたびに印を付ける必要がある（上流の mobile-send）。送信の検出が DOM 依存になり、spec.md §3 の公開契約の外へ出るためである。
  初版は「購読した端末へ、すべてのルートセッションのイベントを送る」とし、絞り込みは設定 `notify.events` で種類単位に止められるようにする（確認質問 Q1）。
- 連打を避けるため、同じセッション・同じ種類の通知は 10 秒以内に 1 件までにする。
- 送信の失敗隔離（レビュー指摘 10）: イベントの listener は送信キューに積むだけで、DSH の処理（session/event、waterfall）を待たせない。
  - キューは 1 本、上限 64 件。溢れたら古いものから捨て、件数を `status` に出す。
  - 同時に送る数は 4 まで。1 回の送信は 10 秒で打ち切る（`AbortSignal.timeout`）。
  - 429 と 5xx は、`Retry-After` があればそれに従い、無ければ 2 秒・8 秒で最大 2 回まで再試行する（§3 の期限を過ぎるなら打ち切る）。
    再試行を待つ間は同時送信の枠（4）を占有しない。待ちの間はタイマーで保持し、時刻が来たらキューへ戻す。待ちの件数もキュー上限 64 に数える。
    ネットワークエラーとタイムアウトも同じ扱い。それ以外の 4xx は再試行しない。404/410 は購読を削除する。
  - プラグインの dispose 時は、キューを捨て、送信中のものを中止する。

### 7. 代替案

上の表のとおり。A と B の差は E5・E7（依存と保守の負担）だけである。C（ntfy、想定構成 C1）は、自前の Web Push を iOS で使えないと分かった場合（V1・V2 が不成立）の次点とする。

## Pros and Cons of the Options

### A 自前実装
- Good: runtime 依存ゼロで、導入手順が増えない。payload・認可・SW を本プラグインの要件に合わせて設計できる
- Bad: 暗号処理と相互運用を自分で保守する。iOS 固有の癖（BadJwtToken の `sub`、JWT の更新頻度）を自分で踏む。暗号の実装ミスはテストで見落としうる
### B web-push ライブラリ
- Good: 利用者の多い実装で、暗号と JWT の細部と相互運用の修正を任せられる。A と同じ試験を同じ条件で実行できる
- Bad: 直接依存 5 件とその推移的依存が増え、供給網のリスクと更新作業が増える。ローカルプラグインに `npm ci` の手順が増える。ライセンスが MPL-2.0
### C ntfy
- Good: 実績のある配信基盤。iOS アプリがあり、SW や iOS PWA の制約から自由
- Bad: 追加アプリが要る。C1 は自前サーバーの常駐が要り、即時に届けるには ntfy.sh（外部）へメッセージ ID と topic のハッシュを送る。C2 は内容が ntfy.sh に平文で載る。topic 名が実質の秘密になる
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
  - A の相互運用（T1–T3、V1–V2）を期限内に通せない → B へ切り替える新 ADR
  - 許可リストの push サービスの hostname が、DNS で想定外の宛先へ向いた → 残るリスク（§4）。発生したら送信を止める

## 検証計画（accepted にする条件）

自動（`npm test`、node:test）:
- T1 暗号（レビュー指摘 4）:
  - RFC 8291 Appendix A の入力（鍵・salt・auth_secret・平文）を注入して暗号化し、ヘッダと暗号文が付録の値と一致する。
  - 本番の経路では、salt（16 バイト）と ECDH の一時鍵が `node:crypto` の CSPRNG で毎回作られ、2 回の暗号化で異なる（注入口はテストからしか使えない）。
  - 独立の復号（テスト内で RFC 8291 の受信側の手順を別に書いたもの）で元の平文に戻る。
  - 不正入力を拒否する: `p256dh` が base64url で 65 バイトの非圧縮点でない、`auth` が 16 バイトでない、点が曲線上にない、平文が 3993 octets を超える。
- T2 VAPID（レビュー指摘 4）: ヘッダ `{typ:"JWT",alg:"ES256"}`。`aud` が endpoint の origin（`https://` + host、パスなし）と一致する。
  `exp` が 24 時間以内（実装は 12 時間）。`sub` が `mailto:` / `https:`。署名が `dsaEncoding: 'ieee-p1363'` の 64 バイトで、`node:crypto` の公開鍵で検証できる。
  JWT は `aud` ごとに再利用し、1 時間より短い間隔では作り直さない（Apple）。VAPID の署名鍵と、メッセージごとの ECDH 鍵が異なる（RFC 8292 §3.2）。
- T3 送信: 送信関数へ注入した偽の fetch に対し、`content-encoding: aes128gcm`・`ttl`・`urgency`・`topic`・`authorization` が付き、
  `content-length` を手で付けていない（#85）こと、`redirect: 'error'` で呼んでいることを確かめる。2xx で `accepted`、404/410 で購読を削除して `gone`。
  429/5xx/タイムアウトは規定の回数だけ再試行して `failed`。その他の 4xx は再試行せずに `rejected`。
- T4 endpoint（レビュー指摘 1）: 許可する例 `https://web.push.apple.com/x`、`https://WEB.push.apple.com./x`。拒否する例 `http://…`、`https://web.push.apple.com:8443/`、
  `https://u:p@web.push.apple.com/`、`https://push.apple.com.evil.example/`、`https://evilpush.apple.com/`、`https://127.0.0.1/`、`https://[::1]/`、
  `https://0x7f000001/`。設定ファイルを書き換えて不正な endpoint を入れた場合、読込み時と送信直前に止まる。偽 fetch が 3xx を返すと送信は失敗する。
- T5 認可の統合試験（レビュー指摘 2）: DSH 0.2.0-rc.2 の `@deepseek-ai/dsh-client-connection` と `@deepseek-ai/dsh-host-webserver` を
  devDependency として実際に組み立て、本プラグインの host 半身を載せて、ローカルのポートで次を確かめる（実装時に組み立て可能か確認する。
  不可能なら、DSH の配布物を読み込む E2E に切り替え、その方法を新しい ADR にする）:
  cookie なしで 401。不正な Host、`Sec-Fetch-Site: cross-site`、別 host の Origin で 403。いずれも handler に届かない（handler の呼出回数 0）。
  cookie ありでも、`Origin` なし・`Origin: null`・`http://` の Origin（loopback 以外の Host）で 403。宣言していない method（`GET subscribe`）は handler に届かない。
  `content-type` が JSON でなければ 415。
- T6 保存（レビュー指摘 3）: 一時 `DSH_HOME` に作ったファイルが 0600、ディレクトリが 0700。一時ファイルも作成時から 0600（作成直後の `stat`）。
  `push.json` が symlink、他人の所有、0644、壊れた JSON のとき、送信と上書きが止まり、鍵が作り直されない。並行する 2 つの更新が両方とも反映される。
  ログ出力に endpoint・鍵・応答本文が含まれない。
- T6b 複数プロセスの更新（2 回目の指摘 1）: 子プロセス 2 つ（`node:child_process`）で、(a) 空の DSH_HOME で同時に初回の鍵生成 →
  両者が同じ鍵を使い、鍵は 1 組だけ。(b) 同時に別々の購読を追加 → 両方が残る。(c) 一方が追加、他方が削除 → 互いの変更を消さない。
  (d) ロックファイルを残したまま pid の無いプロセスとして放置 → 次の更新が古いロックを消して進む。(e) 一方が削除した購読へ、他方が送らない。
- T7 イベント: 偽の `agents` / `session/event` を流し、ルートだけ・対象の `reason.kind` だけ・10 秒の間引き、を確かめる。
  `user-questions/request` の listener は、送信が 30 秒止まる偽 fetch の下でも、すぐに `next()` の結果を返す。キュー上限を超えたら古いものから捨てる。
  承認→blocked、質問の連続、送信停止の順に流しても、種類の異なる通知が互いを置き換えない（Topic が種類ごとに異なる）。
- T7b 期限（2 回目の指摘 3）: 偽の時計を注入し、(a) キューで 600 秒待った通知は送られない、(b) 400 秒待った通知の `TTL` ヘッダが 200 以下、
  (c) 再試行の待ちが期限を越える場合は再試行しない、(d) 再試行待ちの間も他の送信が 4 並行で進む。
- T7c 応答の診断（2 回目の指摘 4）: 偽応答として、許可リストの `reason`、未知の `reason`、数値の `reason`、制御文字や改行を含む値、
  JSON でない本文、1 MiB の本文を返し、ログと API に出る値が許可リストの値か `unknown` だけで、本文の読取りが 4 KiB で止まる。
- T8 SW（レビュー指摘 6）: `push` イベントの偽装で、見えているウィンドウがあっても、payload が空・不正 JSON・未知の `v`・未知の `kind` でも、
  `event.waitUntil` に渡した promise が `showNotification` の完了まで解決しない（#86）。

実機（iPhone、ホーム画面 Web アプリ、Tailscale Serve の origin）:
- V1 scope `/dsh-mobile-ui/push/` で登録・購読でき、アプリを閉じた状態でテスト通知が出る。次の 3 つの状況で確かめる:
  初回（SW 未登録）、再訪（登録済み）、別の SW（scope `/` の試験用 SW）が共存している状態。あわせて、permission の解決後に subscribe しても
  ユーザー操作として認められるか、Tailscale Serve 経由で Origin が `https://` になるかを記録する
- V2 画面ロック中・アプリを閉じた状態で、ターン完了と承認待ちの通知が出る
- V3 通知をタップするとアプリが開く（前面化。セッションを開けるかは手段次第）
- V4 テスト通知（#88）: 画面の結果（`accepted` などの API の結果）と、端末で表示されたかどうか（目視）を、別々の欄に記録する。両者の一致は要件にしない
- V4b 購読の照合（2 回目の指摘 2）: 2 台（または同じ端末の 2 つのホーム画面アプリ）で購読した状態から、(a) 片方の購読が更新された後の再訪、
  (b) 片方の権限を取り消した後の再訪、(c) 片方の localStorage を消した後の再訪（他方の購読が消えない）、(d) 設定画面から片方を失効させた後の、
  その端末の再訪（自動で再登録されず、「通知は無効」と出る）を確かめる。ブラウザ側の流れの部分は、happy-dom 上の自動試験でも検査する。
- V5 権限の取消: iOS の「設定」で通知を切った後に、(a) `pushsubscriptionchange` が来るか、(b) 送信が 404/410 になるか、(c) 次にページを開いたときの照合で
  購読が消えるか、を別々に記録する。即時の 410 は要件にしない。404/410 を受けたときの削除は T3 で検査する

## 着手条件（2 回目のレビューの判定 conditional による）

proposed のまま、T351 の可逆な実装に着手してよい。ただし次を守る。
1. 2 回目の medium 指摘 3 件（複数プロセスの更新、端末の購読の照合、期限）は、本 ADR に契約として書いた（§1 手順 4、§2、§3、§6）。該当部分を実装する前に、この契約を変えない。変えるなら先に本 ADR を改訂する。
2. 次の既定を保つ: 通知は明示的な opt-in（ユーザーが「通知を有効にする」をタップしたときだけ購読する）。VAPID の `sub` が未設定の間は 503 を返し送信しない。セッション名は既定で送らない。
3. **V1 を T351 の最初の小さな実機スパイクにする。** 狭い scope（`/dsh-mobile-ui/push/`）での登録・購読、許可と購読の手順（ユーザー操作の扱い）、
   既存 SW との共存を iPhone で確かめるまでは、それに依存する本実装（SW の配置、購読の照合、ルート一式）を確定しない。
   V1 が成り立たなければ、scope `/` 案を新しい ADR にしてから進める。
4. Q1–Q6 の暫定値を、合意済みとして扱わない。

## accepted 条件

次をすべて満たしたら accepted にする。
1. Q1–Q6 へのオーナーの回答を本 ADR に記録する（暫定値と異なれば本文を改訂する）。
2. 残る指摘（1 回目の部分解消 3 件と 2 回目の 4 件を含む）を、修正するか、根拠を付けて受け入れる。
3. 自動試験 T1–T8（T6b・T7b・T7c を含む）に合格する。T5 は、実際のルーティングと認証（dsh-client-connection・dsh-host-webserver）を経由して合格する。
4. 実機確認 V1–V5（V4b を含む）を実施し、結果を記録する。
5. 最終実装（コード）の独立レビューを受け、指摘に対応する。

## 確認質問（オーナー）

Taskloop check U78（non-blocking）に同じ質問を置いた。以下の暫定値で設計を進めるが、**いずれもオーナー未回答**である。
accepted にする前にオーナーの回答を得る。

- Q1 通知の対象: すべてのルートセッションのイベントを送るか、スマホから送ったターンだけに絞るか。
  **暫定: 全ルートセッション**（オーナー未回答）。絞る場合は、client 半身が送信を検出する方法（DOM 依存になりうる）を別途決める
- Q2 ロック画面にセッション名を出すか。自動命名の場合、セッション名に最初のプロンプトの内容が含まれうる。
  **暫定: 出さない。`notify.includeSessionName` の既定は false で、payload からも除く**（レビュー指摘 8 を採用。オーナー未回答）
- Q3 承認待ちと質問待ちも既定で送るか。**暫定: 送る**（オーナー未回答）
- Q4 前面で OS 通知が重なるのを初版では受け入れてよいか。アプリ内バナー（push に依存しない）は後続のタスクに分ける。**暫定: 許容**（オーナー未回答）
- Q5 VAPID の `sub` に購読した origin（`https://<host>.ts.net`）を使ってよいか。使うと tailnet 内の名前が Apple / Google に渡る（暗号化の保護の外）。
  **暫定: 不可。`mailto:` のアドレスの指定を待つ**（オーナー未回答）。
  未指定の間は送信機能を無効にする（`subscribe` と `test` は 503 `{ reason: 'vapid-subject-not-configured' }` を返し、イベントも送らない。
  `status` に理由を出す）。RFC 8292 §2.1 では `sub` は MAY（任意）だが、Apple は `sub` が URL でも `mailto:` でもないと BadJwtToken とする。
  `sub` を省いたときの Apple の挙動は確認していないため、省略では代用しない。設定 `notify.vapidSubject`（`mailto:` か `https:`）で与える
- Q6 上流の暗号化コード（`notify/host.js:89-268`）を出典付きで移植するか、RFC から書き起こすか。**暫定: RFC から書き起こす**（オーナー未回答）。
  上流のコードは写さない。アイデアの出典は本 ADR に残してある

## 独立レビューへの対応（1 回目、2026-10-26）

レビュー: Codex gpt-6.1-sol、effort high、新しい文脈・閲覧のみ。判定は no。11 件をそれぞれ根拠に照らして検証した。
外部資料は、本 ADR の「外部根拠」に挙げたものを本文で確認してから使った。

| # | 指摘 | 判断 | 根拠 | 反映箇所 |
|---|---|---|---|---|
| 1 | endpoint の許可リストだけでは送信先を制約しきれない | 採用 | Fetch の redirect 既定は `follow`（WHATWG Fetch）。初版は正規化・ポート・保存済みの再検査を定めていなかった | §4 endpoint の検査、T4。DNS の向け先は検査しない（残るリスクとして記録） |
| 2 | 認可の中心となる経路を T4 が検証していない。Origin.host 比較は scheme を見ない | 採用 | `isTrustedApiRequest` は `new URL(origin).host === hostUrl.host` で scheme を比べない（dsh-client-connection `lib/index.js:212-218`） | §4 ルートの契約表・Origin 検査、T5 統合試験 |
| 3 | 秘密ファイルの一時ファイル権限・symlink・並行更新・破損時の動作 | 採用 | 初版は最終ファイルの権限しか定めず、「退避して復帰」と「鍵を作り直さない」が両立していなかった | §2 書込み・読込み時の検査・診断出力、T6 |
| 4 | 暗号の受入条件が正常系ベクタに偏っている | 採用 | RFC 8291 §3.1（送信ごとに新しい ECDH 鍵）、RFC 8292 §3.2（署名鍵と鍵交換鍵は別の秘密鍵 MUST）、`aud` の検査が T2 に無かった | T1・T2 |
| 5 | 狭い scope に対応した購読手順が未定義 | 採用 | SW 仕様 §3.4.2: `ready` はページに一致する registration を待つ。WebKit「Meet Web Push」: ユーザー操作と `userVisibleOnly: true` が必須 | §1 購読の手順、V1 |
| 6 | SW の「必ず通知」と購読更新の条件が足りない | 採用 | `waitUntil` が無いと SW が先に終わりうる。初版は不正 payload の扱いと `pushsubscriptionchange` の中身が未定義。Push API §4 で権限取消時の発火は MAY | §5、T8、V5 |
| 7 | テスト通知の「受付」と「到達」の混同 | 採用 | RFC 8030 §5: 201 は配達を示さない | Decision Drivers、§4 `test` の応答、V4・V5 |
| 8 | セッション名の既定送信がプライバシー判断より先に決まっている | 採用 | 自動命名でプロンプトの内容が入りうると初版自身が書いていた。WebKit Blog 13878: 通知は Apple Watch にも出る | §3（既定 false、payload から除去、露出先の区別）、Q2・Q5 |
| 9 | 購読の認可ライフサイクルが未定義 | 採用 | 初版は失効手段・上限到達時・origin 変更を定めていなかった | §2（`id`・上限 409）、§4 ライフサイクル |
| 10 | 送信の失敗隔離と Topic による上書き | 採用 | RFC 8030 §5.4: 同じ topic の新しいメッセージは古い未配達メッセージを削除する。初版はセッション単位の topic で、種類の違う通知を消しえた | §3 Topic、§6 質問待ち・失敗隔離、T7 |
| 11 | 代替案比較が自前実装に有利 | 採用 | B でも同じ試験を実行でき、「ライブラリ任せ」は検証能力の差ではない。C の構成が混在していた | 評価基準 E6・E7、比較表、Decision、Pros and Cons |

### 2 回目（2026-10-26 18:00 JST）

レビュー: Codex gpt-6.1-sol、**workflow 経路・effort 指定なし**（workflow の `agent()` では effort を指定できないため。1 回目の high とは条件が異なる）。
判定は conditional（proposed のまま T351 の可逆な実装に着手してよい）。1 回目の 11 件のうち 8 件は解消、3 件は部分解消（#3 秘密ファイル、
#6 再同期、#10 TTL）とされた。部分解消の 3 件は、以下の新規 1–3 と同じ論点なので、そこで扱った。

| # | 指摘 | 判断 | 根拠 | 反映箇所 |
|---|---|---|---|---|
| 2-1 | [medium] 複数プロセスの排他だけでは、鍵・購読の lost update を防げない | 採用 | 1 回目の改訂はロックの取得だけを定め、ロックの中で読み直すことを定めていなかった。読み直さずに書けば、他プロセスの変更を上書きする | §2 の 1 トランザクション（読み直し・必要時だけ鍵生成・古いロックの回収・送信側でキャッシュしない）、T6b |
| 2-2 | [medium] 起動時の照合で、この端末の古い購読を特定できない | 採用 | 購読が更新されると端末からは古い endpoint が分からず、サーバーのどの記録がこの端末のものかを決められない。また 1 回目の改訂の照合は、サーバーで失効させた購読を自動で再登録しうる | §1 手順 4（端末側に `id` を保持、`replaces` による置換、localStorage 消失時は他を消さない、`revoked` と `userInitiated`）、V4b |
| 2-3 | [medium] TTL をキュー待ち・再試行込みの寿命として定義していない | 採用 | 1 回目の改訂は HTTP の `TTL` を常に 600 としていたため、キューで待った分だけ通知の寿命が延びた。再試行の待ちが枠を占有するかも未定義だった | §3（`createdAt` / `expiresAt`、残り秒数の `TTL`）、§6（再試行待ちは枠を占有しない）、T7b |
| 2-4 | [low] 外部応答の `reason` を診断に転記するときの制約が弱い | 採用 | 1 回目の改訂は「`reason` の 1 項目だけ」としか定めず、値の型・文字種・長さを制限していなかった。外部の値がそのままログと API に出うる | §2 診断出力（本文 4 KiB 上限、Apple の文書に載る値の許可リスト、それ以外は `unknown`）、T7c |

2 回目では、採らなかった指摘は無い。

### 1 回目で一部を採らなかった点
- 指摘 1 の「カスタム許可先で private IP を認めるか」→ 設定でも認めないと決めた（推奨の選択肢の一つを採った）。DNS 解決結果の検査は行わない。
  許可リストを外部の push サービスに限ることで、検査の手間に見合わないと判断した（推測を含む判断。残るリスクとして Consequences に記録）。
- 指摘 3 の「破損時は復元手順を示す」→ 手順の本文は実装時の docs に置き、ADR には方針だけを書く。
- 指摘 6 の「購読更新の再同期」→ SW からの更新専用経路は作らず、ページを開いたときの照合で行う（レビューの推奨のうち、迂回経路を作らない方を採った）。
  そのため、ページを開くまでの間は通知が届かないことがある。これは受け入れる。

## 関連ADR

- ADR-20261023-1720（公開契約だけに依存する）
- ADR-20261024-0410（テスト基盤）
- ADR-20261024-0430（ブランチ運用）
