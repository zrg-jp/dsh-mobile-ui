window.__ModuleLoader__.load({
	id: "dsh-mobile-ui",
	factory: (require) => {
		var module = { exports: {} };
		// ADR-20261023-1720: スマホ・タブレット対応はローカル client プラグインで行う。
		// セレクタはビルドごとに変わるハッシュ化クラス名を使わず、安定した data 属性と
		// DOM 構造（frame = [data-rightbar-col] の親、sidebar = frame の先頭子要素）に依存する。
		// 壊れた場合は media query ごと効かなくなり従来表示へ劣化する（安全側）。

		/** 狭幅 drawer 化の境界。768px 以上（iPad 縦）は既存の narrow 挙動（<1024 で rail 化）に任せる。 */
		const PHONE_MAX = 767;
		/** スマホ CSS と同じ条件の JS 側ゲート。 */
		const PHONE_QUERY = `(max-width:${PHONE_MAX}px)`;
		/** キーボード追従（visualViewport）を有効にする条件。タブレットも含める。 */
		const COARSE_QUERY = "(max-width:1023px) and (pointer:coarse)";

		// -- viewport meta の項目単位マージ（T346。Idea from kuraneko1/dsh-mobile-maxxing 24e2e49 (MIT)） --
		/**
		 * 本プラグインが管理する viewport の項目。これ以外の項目（ページ側の height 等）には触れない。
		 * ADR-20261026-1450: ズームを制限する項目（maximum-scale / minimum-scale / user-scalable）は
		 * 足さない。iPhone PWA では maximum-scale=1 がピンチ拡大を止めていた疑いがある（KI-8）。
		 * フォーカス時の自動ズームは入力 16px 化（下の CSS）だけで防ぐ。
		 */
		const VIEWPORT_MANAGED = [
			["width", "device-width"],
			["initial-scale", "1"],
			["viewport-fit", "cover"],
			["interactive-widget", "resizes-content"]
		];
		/**
		 * content を「key=value」の項目列に分解する。空の項目は捨て、key は小文字で比較する
		 * （viewport の key は大文字小文字を区別しない）。text は元の表記（前後の空白のみ除去）。
		 * @param {string|null} content
		 * @returns {{key: string, text: string}[]}
		 */
		const parseViewport = (content) => {
			const items = [];
			// 区切りは `,` が正式だが、ブラウザは `;` も受け付ける。混在も含めて両方で分け、
			// 非管理項目を 1 項目と誤認して消さない（書き出しは `, ` に揃える）。
			for (const raw of String(content ?? "").split(/[,;]/)) {
				const text = raw.trim();
				if (text === "") continue;
				const eq = text.indexOf("=");
				items.push({ key: (eq === -1 ? text : text.slice(0, eq)).trim().toLowerCase(), text });
			}
			return items;
		};
		/**
		 * items の key の項目を、最初の出現位置で text に置き換え、2 つ目以降の出現は消す
		 * （後の重複は前の値を上書きするため、残すと置換が効かない）。text が null なら全出現を消す。
		 * 出現が無く text があれば末尾へ足す。
		 */
		const replaceViewportItem = (items, key, text) => {
			const out = [];
			let placed = false;
			for (const item of items) {
				if (item.key !== key) {
					out.push(item);
					continue;
				}
				if (!placed && text !== null) out.push({ key, text });
				placed = true;
			}
			if (!placed && text !== null) out.push({ key, text });
			return out;
		};
		const serializeViewport = (items) => items.map((item) => item.text).join(", ");

		/** visualViewport.scale がこの幅を超えて 1 から離れていたらピンチズーム中とみなす（KI-2）。 */
		const PINCH_EPSILON = 0.01;
		/**
		 * ピンチズーム中か。scale を持たない実装（visualViewport 自体が無い場合も）は等倍として扱う。
		 * 許容幅は、等倍でも scale が 1 ちょうどにならない環境の丸め誤差を等倍とみなすため（推定値）。
		 */
		const isZoomed = () => {
			const scale = window.visualViewport?.scale;
			return typeof scale === "number" && Math.abs(scale - 1) > PINCH_EPSILON;
		};

		const css = [
			// ---- スマホ幅: 3 カラム grid を 1 カラム化し、サイドバーを fixed の drawer にする ----
			`@media ${PHONE_QUERY}{`,
			// frame のインライン style（gridTemplateColumns）より !important が勝つ。
			// sidebarCol は下で position:fixed（grid フロー外）になるため、残る in-flow の
			// centerCol が第 1 列（1fr）、rightbarCol が第 2 列（0px）に自動配置される。
			// center の minmax(400px,1fr) 由来の横はみ出しをここで断つ。
			":has(> [data-rightbar-col]){grid-template-columns:minmax(0,1fr) 0px 0px !important;}",
			":has(> [data-rightbar-col])>:first-child{",
			"position:fixed;top:0;bottom:0;left:0;width:min(85vw,300px);z-index:60;",
			"background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base,#fff));",
			"border-right:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.15));",
			"box-shadow:0 0 24px rgba(0,0,0,.25);",
			"transform:translateX(0);transition:transform .25s ease;",
			"box-sizing:border-box;overflow:hidden;",
			"padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);",
			"}",
			// data-sidebar-collapsed は AppFrame が frame 要素に付ける（narrow では「閉」が既定）。
			"[data-sidebar-collapsed]:has(> [data-rightbar-col])>:first-child{transform:translateX(-110%);box-shadow:none;visibility:hidden;transition:transform .25s ease,visibility 0s .25s;}",
			// バックドロップは frame の ::after として drawer（z-index:60）と同じ重なり環境に置く。
			// body 直下の要素だと frame 側の stacking context 次第で drawer の背面に回れないため。
			// クリック処理は document の pointerdown リスナーが行う（擬似要素はターゲットにならず frame が受ける）。
			":has(> [data-rightbar-col]):not([data-sidebar-collapsed])::after{content:\"\";position:fixed;inset:0;z-index:59;background:rgba(0,0,0,.35);}",
			// カラムリサイズ用 DragHandle（frame 直下の [data-side]）はタッチでは使わない。
			":has(> [data-rightbar-col])>[data-side]{display:none;}",
			"}",
			`@media ${PHONE_QUERY} and (prefers-reduced-motion:reduce){`,
			":has(> [data-rightbar-col])>:first-child{transition:none;}",
			// KI-3: 閉時の規則（[data-sidebar-collapsed]:has(...)>:first-child、詳細度 0,3,0）は上の 0,2,0 より強く、
			// 閉じる側の transition が残る。閉時と同じセレクタで打ち消す（media の後方にあるので同詳細度で勝つ）。
			"[data-sidebar-collapsed]:has(> [data-rightbar-col])>:first-child{transition:none;}",
			"}",
			// ---- drawer を開く FAB。狭幅かつ閉時のみ表示（body 属性は JS が同期する） ----
			".dsh-mobile-ui-fab{display:none;}",
			`@media ${PHONE_QUERY}{`,
			"body[data-dsh-mobile-sidebar=closed] .dsh-mobile-ui-fab{display:flex;position:fixed;z-index:55;",
			"left:calc(env(safe-area-inset-left) + 10px);top:calc(env(safe-area-inset-top) + 8px);",
			"width:36px;height:36px;border-radius:10px;align-items:center;justify-content:center;",
			"background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#444);",
			"border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.15));box-shadow:0 2px 8px rgba(0,0,0,.12);",
			"padding:0;cursor:pointer;}",
			"}",
			// ---- キーボード重なり対策: visualViewport の実高さに #root を合わせる（JS が変数を更新） ----
			`@media ${COARSE_QUERY}{`,
			// ADR-20261024-0450: iOS はキーボード表示中、layout viewport を縮めずに visual viewport を
			// パン（offsetTop>0）させるため、通常フローの #root は見えている範囲から上へずれる。
			// #root を fixed にして top を visualViewport.offsetTop に追従させ、常に見えている範囲へ重ねる。
			// html/body の overflow を止め、文書側にスクロール余地を残さない（手動スクロールで再び外へ出るのを防ぐ）。
			"html,body{overflow:hidden;overscroll-behavior:none;}",
			"#root{position:fixed;left:0;right:0;top:var(--dsh-mobile-vvtop,0px);height:var(--dsh-mobile-vvh,100%);}",
			// KI-10: iOS のキーボードで visual viewport がパンしている間、getBoundingClientRect は
			// 可視範囲（visual viewport）基準の値を返すのに、position:fixed は layout viewport 基準の
			// ままなので、body 直下へ portal された固定オーバーレイ（DSH のメニュー等）だけが
			// offsetTop の分だけ上へずれる。#root と同じ補正を translate で与えて座標系を揃える。
			// data 属性は JS（tagOverlays）が付ける。DOM 構造や hashed class には依存しない。
			"[data-dsh-mobile-overlay]{translate:0 var(--dsh-mobile-vvtop,0px);}",
			// iOS はフォーカスした編集領域の font-size が 16px 未満だと自動ズームする。
			// 入力系全般に 16px を保証する。ADR-20261026-1450 で viewport の maximum-scale=1 をやめたため
			// （iPhone PWA でピンチ拡大を止めていた疑い。KI-8）、自動ズームの抑止はこの規則だけが担う。
			"textarea,select,input:not([type=checkbox]):not([type=radio]),[data-lexical-editor],[contenteditable=true]{font-size:16px !important;}",
			"}",
			// ---- PWA（standalone / fullscreen）でのセーフエリア確保（viewport-fit=cover 前提、横向きも） ----
			"@media (max-width:1023px) and (display-mode:standalone),(max-width:1023px) and (display-mode:fullscreen){",
			"#root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);box-sizing:border-box;}",
			"}",
			// ---- T309: セッション行を 1 タップで開く（COARSE。ADR-20261026-1745） ----
			// DSH 0.2.0-rc.2 の行 CSS は :hover で「…」（rowActions）を出し、時刻とピンを消す。iOS WebKit は
			// タップで合成した :hover により display が変わると、その回の click を配送しない（推定。spec §4.4）。
			// hover の有無で表示が変わらないよう、hover 時と非 hover 時の表示を同じに固定する:
			// 「…」は常時表示（改名などの行メニューへの経路にもなる）、時刻とピンは非 hover 時の表示のまま。
			// セレクタは安定属性 data-row-key / role と子の順序（slot, title, time?, pin?, rowActions? の順）に依存し、
			// ハッシュ化クラス名は使わない。順序が変わると別の子の display を固定しうる（spec §3 の構造依存）。
			`@media ${COARSE_QUERY}{`,
			// rowActions: 最後の子でボタン（「…」）を含むもの。blank 行には無い（最後の子は title になり、button を含まない）。
			"[data-row-key^=\"session:\"][role=treeitem]>:last-child:has(button){display:inline-flex !important;}",
			// 時刻: 3 番目以降で、最後でも img（ピン）でもない子（非 blank 行の time）。非 hover 時の display（inline）に固定。
			"[data-row-key^=\"session:\"][role=treeitem]>:nth-child(n+3):not(:last-child):not([role=img]){display:inline !important;}",
			// ピン: role=img（PinnedIndicator）。非 hover 時の display（inline-flex）に固定。
			"[data-row-key^=\"session:\"][role=treeitem]>[role=img]{display:inline-flex !important;}",
			"}"
		].join("");

		/** セッション行（DSH ui-workspace の SessionNodeItem。安定属性）。 */
		const SESSION_ROW_SELECTOR = "[data-row-key^=\"session:\"]";
		/** 閉の要求から DOM への反映を待つ上限（ミリ秒）。Escape の FOCUS_FAB_TIMEOUT_MS と同じ値（推定で十分な長さ）。 */
		const CLOSE_PENDING_MS = 1000;

		/**
		 * T309-C: 表示中のセッションが切り替わったら、PHONE でドロワーが開いていれば閉じる。
		 * 表示中は ISessions.list の行で retainedBy.mainView > 0 のもの（DSH 0.2.0-rc.2 の ui-workspace と同じ判定）。
		 * 切替は旧参照の release より先に新参照を retain するため（replaceMain）、一瞬 2 件が表示中になる。
		 * 「前回の集合に無かった id が表示中になった」ときだけ閉じることで、遷移ごとに 1 回だけ反応する
		 * （旧の release、同一セッションの再描画、一覧の他の更新では反応しない）。
		 * 行のクリックだけでなく、新規作成・検索結果・fork など、表示を変える全経路を 1 か所で拾う。
		 * @param {{list: {getSnapshot(): any, subscribe(fn: () => void): () => void}}} sessions ctx.sessions（ISessions）
		 * @param {() => void} close ドロワーを閉じる操作（ctx.layout.toggleSidebar）
		 * @returns {() => void} 購読解除
		 */
		const closeDrawerOnSessionSwitch = (sessions, close) => {
			const list = sessions?.list;
			// 形が違う（版の変更など）ときは何もしない。他の機能は動かし続ける（安全側）。
			if (typeof list?.getSnapshot !== "function" || typeof list?.subscribe !== "function") return () => {};
			const mainIds = () => {
				const ids = new Set();
				const byId = list.getSnapshot()?.byId ?? {};
				for (const [id, row] of Object.entries(byId)) if ((row?.retainedBy?.mainView ?? 0) > 0) ids.add(id);
				return ids;
			};
			let previous = mainIds();
			// toggleSidebar() は DSH のストアを更新するだけで、frame の data-sidebar-collapsed は React の再描画で
			// 後から変わる（KI-1 と同じ）。反映前に次の切替（a→b→c の連続）が来ると DOM はまだ開なので、
			// もう一度トグルして開き直してしまう。閉を要求してから一定時間は、DOM が開のままでも再要求しない。
			// 期限後も開のままなら（閉が効かなかった）、次の切替でもう一度閉じる。
			let closeRequestedUntil = 0;
			return list.subscribe(() => {
				const current = mainIds();
				let switched = false;
				for (const id of current) if (!previous.has(id)) switched = true;
				previous = current;
				if (!switched || !window.matchMedia(PHONE_QUERY).matches) return;
				const frame = document.querySelector("[data-rightbar-col]")?.parentElement ?? null;
				if (frame === null || frame.hasAttribute("data-sidebar-collapsed")) return;
				if (Date.now() <= closeRequestedUntil) return;
				closeRequestedUntil = Date.now() + CLOSE_PENDING_MS;
				close();
			});
		};

		module.exports.name = "dsh-mobile-ui";
		// ctx.layout（dsh-client-ui-layout）と ctx.sidebarRight（dsh-client-ui-sidebar-right）、
		// どちらも reflect.provide される公開サービスを待つ。
		module.exports.inject = ["layout", "sidebarRight"];
		module.exports.apply = function apply(ctx) {
			ctx.effect(() => {
				const disposers = [];

				// -- CSS 注入も effect の寿命に合わせる（fiber 停止時に完全へ戻すため） --
				const tagId = "dsh-mobile-ui/override.css";
				if (document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
					const tag = document.createElement("style");
					tag.dataset.plugin = "dsh-mobile-ui";
					tag.dataset.pluginCss = tagId;
					tag.textContent = css;
					document.head.appendChild(tag);
					disposers.push(() => {
						tag.remove();
					});
				}

				const phoneMedia = window.matchMedia(PHONE_QUERY);
				const coarseMedia = window.matchMedia(COARSE_QUERY);

				// -- viewport meta: ノッチ対応・(対応環境では)キーボードで縮むレイアウト。ズームは制限しない（KI-8） --
				// 全文を置き換えず、管理する項目だけを上書き・追加する（既存の項目と順序は保つ）。T346。
				const meta = document.querySelector("meta[name=viewport]");
				if (meta !== null) {
					const previous = meta.getAttribute("content");
					const before = parseViewport(previous);
					let merged = before;
					for (const [key, value] of VIEWPORT_MANAGED) merged = replaceViewportItem(merged, key, `${key}=${value}`);
					const written = serializeViewport(merged);
					meta.setAttribute("content", written);
					disposers.push(() => {
						const current = meta.getAttribute("content");
						// 他者が触っていなければ、元の文字列（表記・属性の有無）をそのまま戻す。
						if (current === written) {
							if (previous === null) meta.removeAttribute("content");
							else meta.setAttribute("content", previous);
							return;
						}
						// 起動後に他者（DSH 本体や他プラグイン）が書き換えていた場合は、その変更を保ち、
						// 本プラグインが書いた値のまま残っている管理項目だけを元へ戻す（元に無ければ消す）。
						// 他者が値を変えた管理項目は、その値を尊重して触らない。
						let items = parseViewport(current);
						for (const [key, value] of VIEWPORT_MANAGED) {
							const now = items.filter((item) => item.key === key);
							if (now.length !== 1 || now[0].text !== `${key}=${value}`) continue;
							const original = before.filter((item) => item.key === key);
							// 元が重複していた場合も、効いていた最後の値を 1 つだけ戻す。
							items = replaceViewportItem(items, key, original.length > 0 ? original[original.length - 1].text : null);
						}
						meta.setAttribute("content", serializeViewport(items));
					});
				}

				// -- visualViewport 追従: iOS PWA はキーボードで layout viewport を縮めないため、
				//    実際に見えている高さと上端位置を CSS 変数に流し、#root の位置・高さに使う。モバイル条件下のみ。
				//    以前は window.scrollTo(0,0) で原点へ戻していたが、入力欄が画面外へ押し出される不具合があり、
				//    iOS のパンとの競合が疑われるため、ページ側は動かさず #root を追従させる（ADR-20261024-0450、原因は推定）。 --
				const vv = window.visualViewport;
				if (vv !== undefined && vv !== null) {
					// KI-10: DSH のメニュー（モデル選択など）は body 直下へ portal され、トリガーの
					// getBoundingClientRect() と window.innerHeight から position:fixed の座標を決める。
					// 再配置は window の scroll / resize でしか起きないが、iOS のキーボードは layout
					// viewport を変えず visual viewport だけを縮めるため、resize は visualViewport に
					// しか飛ばない。ここで #root を追従させるとアンカーだけが動き、メニューは可視範囲の
					// 外に取り残される。そこで可視範囲が変わったら resize を再送し、DSH 側の再配置を促す。
					// 送るのは COARSE かつ値が実際に変わったときだけ（キーボードのアニメーション中は
					// 毎フレーム発火しうるため）。issue #11 / KI-10。
					let lastVvh = Math.round(vv.height);
					let lastVvtop = Math.round(Math.max(0, vv.offsetTop));
					const onViewport = () => {
						if (!coarseMedia.matches) return;
						// KI-2 / ADR-20261026-1450: ピンチズーム中（scale≠1）は visualViewport.height / offsetTop が
						// 倍率とパンで変わる（2 倍なら高さは半分）。これを #root に流すとレイアウト上の #root が縮み、
						// 拡大した画面の中でアプリが小さく切れる。ズーム中は CSS 変数も resize の再送も据え置き、
						// 等倍へ戻ったときの最初のイベントでその時点の値へ追従し直す（値が変わっていれば再送もする）。
						if (isZoomed()) return;
						const vvh = Math.round(vv.height);
						const vvtop = Math.round(Math.max(0, vv.offsetTop));
						const rootStyle = document.documentElement.style;
						rootStyle.setProperty("--dsh-mobile-vvh", `${vvh}px`);
						rootStyle.setProperty("--dsh-mobile-vvtop", `${vvtop}px`);
						if (vvh === lastVvh && vvtop === lastVvtop) return;
						lastVvh = vvh;
						lastVvtop = vvtop;
						window.dispatchEvent(new window.Event("resize"));
					};
					onViewport();
					// resize: キーボードの出入り。scroll: パン（offsetTop の変化）。
					vv.addEventListener("resize", onViewport);
					vv.addEventListener("scroll", onViewport);
					disposers.push(() => {
						vv.removeEventListener("resize", onViewport);
						vv.removeEventListener("scroll", onViewport);
						document.documentElement.style.removeProperty("--dsh-mobile-vvh");
						document.documentElement.style.removeProperty("--dsh-mobile-vvtop");
					});
				}

				// -- drawer 開閉: frame の data-sidebar-collapsed を観測して body 属性・inert・aria を同期 --
				const findFrame = () => document.querySelector("[data-rightbar-col]")?.parentElement ?? null;
				const isOpen = () => {
					const frame = findFrame();
					return frame !== null && !frame.hasAttribute("data-sidebar-collapsed");
				};

				const fab = document.createElement("button");
				fab.type = "button";
				fab.className = "dsh-mobile-ui-fab";
				fab.setAttribute("aria-label", "Open sidebar");
				fab.setAttribute("aria-expanded", "false");
				fab.innerHTML = "<svg width='18' height='18' viewBox='0 0 18 18' aria-hidden='true'><path d='M2 4.5h14M2 9h14M2 13.5h14' stroke='currentColor' stroke-width='1.6' stroke-linecap='round'/></svg>";
				document.body.append(fab);
				disposers.push(() => {
					fab.remove();
				});

				// KI-10: body 直下の固定オーバーレイに印を付け、COARSE のあいだ CSS で offsetTop 分を
				// 補正する（上の [data-dsh-mobile-overlay] 規則）。オーバーレイは開閉のたびに
				// body へ portal されるため、追加を監視して都度付ける。位置は変えないので、
				// DSH 側の配置計算（trigger の rect と offsetHeight）には影響しない。
				const tagOverlays = () => {
					const coarse = coarseMedia.matches;
					for (const el of document.body.children) {
						if (el.id === "root") continue;
						if (!coarse) {
							// COARSE を外れたら印を外す（デスクトップ・fine pointer では DOM も変えない）。
							el.removeAttribute("data-dsh-mobile-overlay");
							continue;
						}
						if (el.hasAttribute("data-dsh-mobile-overlay")) continue;
						const style = getComputedStyle(el);
						if (style.position !== "fixed") continue;
						// 全画面（layout viewport 全体）を覆うレイヤ（inset:0 の Modal 等）は対象外。
						// キーボード時のずれは高さの問題で、offsetTop の平行移動では直らず、中央寄せを
						// 悪化させうるため触らない（KI-10 の残る制限）。rect は display:none だと 0 に
						// なるので、inset の計算値でも判定する。
						const rect = el.getBoundingClientRect();
						const coversViewport = rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1;
						const insetZero = style.top === "0px" && style.left === "0px" && style.right === "0px" && style.bottom === "0px";
						if (coversViewport || insetZero) continue;
						el.setAttribute("data-dsh-mobile-overlay", "");
					}
				};
				const overlayObserver = new MutationObserver(tagOverlays);
				overlayObserver.observe(document.body, { childList: true });
				disposers.push(() => {
					overlayObserver.disconnect();
					coarseMedia.removeEventListener("change", tagOverlays);
					for (const el of document.body.querySelectorAll("[data-dsh-mobile-overlay]")) el.removeAttribute("data-dsh-mobile-overlay");
				});

				// KI-1: Escape で閉じたあと FAB へ戻すフォーカスの予約。toggleSidebar() は DSH のストアを
				// 更新するだけで、frame の data-sidebar-collapsed は React の再描画で後から変わる。FAB は
				// body 属性が closed になるまで display:none でフォーカスできないため、閉じたことを
				// syncState が観測した時点（body 属性・inert を更新した直後）でフォーカスする。
				// 閉じが来ないまま残った予約が、後の別経路の閉（バックドロップ等）で発火しないよう期限を切る。
				const FOCUS_FAB_TIMEOUT_MS = 1000;
				let focusFabUntil = 0;
				const syncState = () => {
					const frame = findFrame();
					const open = frame !== null && !frame.hasAttribute("data-sidebar-collapsed");
					document.body.dataset.dshMobileSidebar = frame === null ? "none" : open ? "open" : "closed";
					fab.setAttribute("aria-expanded", String(open));
					// 画面外へ出した drawer にフォーカスが入らないよう、スマホ幅の閉時だけ inert にする。
					const sidebarCol = frame?.firstElementChild ?? null;
					if (sidebarCol !== null && "inert" in sidebarCol) sidebarCol.inert = phoneMedia.matches && !open;
					if (focusFabUntil !== 0 && frame !== null && !open) {
						const due = Date.now() <= focusFabUntil;
						focusFabUntil = 0;
						if (due && phoneMedia.matches) fab.focus();
					}
				};
				const observer = new MutationObserver(syncState);
				observer.observe(document.documentElement, {
					subtree: true,
					childList: true,
					attributes: true,
					attributeFilter: ["data-sidebar-collapsed"]
				});
				syncState();
				// FAB の position は body 属性と CSS で決まるため、syncState の後に一度走査する。
				coarseMedia.addEventListener("change", tagOverlays);
				tagOverlays();
				const onMediaChange = () => {
					syncState();
				};
				phoneMedia.addEventListener("change", onMediaChange);
				disposers.push(() => {
					phoneMedia.removeEventListener("change", onMediaChange);
					observer.disconnect();
					delete document.body.dataset.dshMobileSidebar;
					const sidebarCol = findFrame()?.firstElementChild ?? null;
					if (sidebarCol !== null && "inert" in sidebarCol) sidebarCol.inert = false;
				});

				// Escape 以外の経路（FAB・バックドロップ・スワイプ）の開閉は、残っている KI-1 のフォーカス予約を
				// 取り消す。予約は「Escape で閉じた」ときだけ消費させる（spec §4.3 EscapeRefocusesFab）。
				const toggle = () => {
					focusFabUntil = 0;
					ctx.layout.toggleSidebar();
				};
				const onFabClick = () => {
					toggle();
				};
				fab.addEventListener("click", onFabClick);
				disposers.push(() => {
					fab.removeEventListener("click", onFabClick);
				});

				// バックドロップ（frame の ::after）へのタップで閉じる。擬似要素はイベントターゲットに
				// ならないため、開時に drawer と FAB の外で始まったポインタ操作を「backdrop 相当」として扱う。
				const onPointerDown = (event) => {
					if (!phoneMedia.matches || !isOpen()) return;
					const frame = findFrame();
					const sidebarCol = frame?.firstElementChild ?? null;
					const target = event.target;
					if (!(target instanceof Node)) return;
					if (sidebarCol !== null && sidebarCol.contains(target)) return;
					if (fab.contains(target)) return;
					// ::after より上（z-index 60 超）のオーバーレイ（メニュー等）内のタップは除外:
					// backdrop 直撃は frame 自身か centerCol 配下に当たるので、frame の外は触らない。
					if (frame !== null && !frame.contains(target)) return;
					event.preventDefault();
					event.stopPropagation();
					toggle();
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				disposers.push(() => {
					document.removeEventListener("pointerdown", onPointerDown, true);
				});

				// Escape（iPad の外付けキーボード等）で閉じ、フォーカスを FAB へ戻す。
				// フォーカスは閉じが DOM に反映された後に syncState が行う（KI-1。上の focusFabUntil）。
				// DOM が同期的に変わる実装にも備え、toggle 直後に一度 syncState を呼ぶ。
				// KI-7: 前面のモーダル・メニューが Escape を処理するなら譲る。DSH 0.2.0-rc.2 の
				// メニューは capture 段階で preventDefault するので defaultPrevented で分かる。Modal
				// （useModalLayer）は document の bubble 段階で処理し、開いた後に登録されるため本リスナーより
				// 後に走り、defaultPrevented では防げない。そこで aria-modal=true の要素がある間も無視する。
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || !phoneMedia.matches || !isOpen()) return;
					if (event.defaultPrevented || document.querySelector("[aria-modal=true]") !== null) return;
					// 前の Escape の閉がまだ DOM に反映されていない間（予約が有効）は、isOpen() が古い値のまま
					// true を返す。ここで再びトグルすると開に戻ってしまうため、反映を待つ。
					if (focusFabUntil !== 0 && Date.now() <= focusFabUntil) return;
					toggle();
					focusFabUntil = Date.now() + FOCUS_FAB_TIMEOUT_MS;
					syncState();
				};
				document.addEventListener("keydown", onKeyDown);
				disposers.push(() => {
					document.removeEventListener("keydown", onKeyDown);
				});

				// -- スワイプジェスチャ（ADR-20261023-1750）--
				//  * 右スワイプ: 右パネル表示中は左端起点に限りチャットへ戻る（toggleExpanded で畳む）、
				//    そうでなければ起点を問わずサイドバーを開く（スマホ幅のみ）。iOS の「戻る」操作に揃える。
				//  * 左スワイプ: 開いているサイドバーを閉じる（スマホ幅のみ）。
				// preventDefault しない passive 監視なので、スクロールとは共存する。
				// diff 等の横スクロール領域との衝突は「左端起点」と可視スクロール祖先ガードで避ける。
				const EDGE_PX = 28;
				const SWIPE_MIN_DX = 60;
				/** タッチ起点の水平スクロール可能な祖先を列挙する（横スクロール操作との衝突判定用）。 */
				const horizontalScrollers = (start) => {
					const found = [];
					for (let el = start; el !== null && el !== document.body; el = el.parentElement) {
						if (el.scrollWidth > el.clientWidth + 1) {
							const overflowX = getComputedStyle(el).overflowX;
							if (overflowX === "auto" || overflowX === "scroll") found.push(el);
						}
					}
					return found;
				};
				let swipe = null;
				const onTouchStart = (event) => {
					swipe = null;
					if (!coarseMedia.matches || event.touches.length !== 1) return;
					// ADR-20261026-1450: ピンチ拡大中の単指ドラッグは拡大画面のパン（閲覧操作）なので候補にしない。
					// visual viewport のパンは要素の scrollLeft に現れず、横スクロール祖先ガードでは防げない。
					if (isZoomed()) return;
					const t = event.touches[0];
					const target = event.target;
					const el = target instanceof Element ? target : null;
					// 編集領域内の操作（テキスト選択・カーソル移動）はスワイプ候補にしない。
					if (el !== null && el.closest("textarea,input,[contenteditable=true]") !== null) return;
					// KI-5: frame 外（body へ portal されたモーダル・メニュー・トースト等の前面 UI）から
					// 始まったタッチは、背後のレイアウトを操作しない（pointerdown の BackdropOnlyInsideFrame と同じ境界）。
					// 例外は FAB（本プラグインの要素で、タップすればドロワーを開く）。frame が無いときは
					// 境界を決められないため、このガードは掛けない（spec §3 SafeDegrade の範囲限定どおり）。
					const frame = findFrame();
					if (frame !== null && target instanceof Node && !frame.contains(target) && !fab.contains(target)) return;
					// 横スクロール祖先の有無と位置は開始時に確定する（操作中の DOM 変化・スクロールに左右されない）。
					const scrollers = el !== null ? horizontalScrollers(el) : [];
					swipe = {
						// 開始時の幅。window の resize で幅が変わったら候補を捨てる（下の dropSwipeOnResize）。
						width: window.innerWidth,
						x: t.clientX,
						y: t.clientY,
						edge: t.clientX <= EDGE_PX,
						scroller: scrollers.length > 0,
						// 全スクローラが左端にある = 右スワイプしても何もスクロールしない状態。
						scrollerAtLeft: scrollers.every((s) => s.scrollLeft <= 0)
					};
				};
				const onTouchEnd = (event) => {
					const start = swipe;
					swipe = null;
					if (start === null || event.changedTouches.length !== 1) return;
					// 等倍で始まり途中でピンチへ移った操作（終了時に拡大している）も破棄する。
					if (isZoomed()) return;
					// 長押し等でテキスト選択が生じていたら、選択ハンドルのドラッグとみなして中止。
					const selection = document.getSelection();
					if (selection !== null && !selection.isCollapsed) return;
					const t = event.changedTouches[0];
					const dx = t.clientX - start.x;
					const dy = t.clientY - start.y;
					// 水平方向が支配的な一定距離以上の移動だけをスワイプとみなす。
					if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy) * 2) return;
					if (dx > 0) {
						// 右スワイプ: 横スクロール祖先（diff 等）があっても、全部が左端
						// （scrollLeft=0、右スワイプでは何もスクロールしない）なら「戻る」を許す。
						// 左端に達していない＝実スクロールが起きたはずなので発火しない。
						if (start.scroller && !start.scrollerAtLeft) return;
						// ドロワー表示中は背後の右パネルが見えないため、右スワイプでは何もしない
						// （開いているものをさらに開く操作は無く、見えないパネルを畳むと意図に反する。docs/spec.md Q2）。
						if (phoneMedia.matches && isOpen()) return;
						// 右パネルから「戻る」は左端起点に限定（パネル内コンテンツの横パンと区別するため）。
						if (ctx.sidebarRight.isExpanded()) {
							if (!start.edge) return;
							ctx.sidebarRight.toggleExpanded();
							return;
						}
						// サイドバー（一覧）を開くのは画面のどこを起点にしてもよい
						// （ADR-20261026-1416。横スクロール・選択・編集領域のガードは通過済み）。
						if (phoneMedia.matches && !isOpen()) toggle();
						return;
					}
					// 左スワイプ: 開いているサイドバーを閉じる。横スクロール操作とは衝突させない。
					if (start.scroller) return;
					if (!phoneMedia.matches || !isOpen()) return;
					toggle();
				};
				const onTouchCancel = () => {
					swipe = null;
				};
				// 回転・幅変化の途中にまたがるタッチは捨てる（Idea from kuraneko1/dsh-mobile-maxxing 24e2e49, MIT）。
				// 開始時の座標・edge・横スクロール祖先は回転前のレイアウトで測ったもので、終了点との差 dx は
				// 意味を失う。また PHONE / COARSE の境界をまたぐと、開始時に検査した前提（COARSE）が崩れる。
				// window の resize は幅が変わったときだけ捨てる: KI-10 で本プラグイン自身がキーボードの
				// 出入りごとに resize を再送しており（幅は不変）、それで入力中のスワイプを失わないため。
				const dropSwipeOnMedia = () => {
					swipe = null;
				};
				const dropSwipeOnResize = () => {
					if (swipe !== null && swipe.width !== window.innerWidth) swipe = null;
				};
				document.addEventListener("touchstart", onTouchStart, { passive: true });
				document.addEventListener("touchend", onTouchEnd, { passive: true });
				document.addEventListener("touchcancel", onTouchCancel, { passive: true });
				phoneMedia.addEventListener("change", dropSwipeOnMedia);
				coarseMedia.addEventListener("change", dropSwipeOnMedia);
				window.addEventListener("resize", dropSwipeOnResize);
				disposers.push(() => {
					document.removeEventListener("touchstart", onTouchStart);
					document.removeEventListener("touchend", onTouchEnd);
					document.removeEventListener("touchcancel", onTouchCancel);
					phoneMedia.removeEventListener("change", dropSwipeOnMedia);
					coarseMedia.removeEventListener("change", dropSwipeOnMedia);
					window.removeEventListener("resize", dropSwipeOnResize);
				});

				// -- T309: セッション行タイトルの dblclick（改名ダイアログ）を COARSE で止める --
				// iOS で 1 回目のタップが :hover の切替で click にならないと、2 回目と合わせて dblclick が成立し、
				// 行を開くつもりの操作で改名ダイアログが開く（調査メモの推定）。改名は「…」メニュー（上の CSS で常時表示）
				// から行える。React の onDoubleClick は #root の委譲リスナーで受けるので、それより先に走る document の
				// capture 段階で伝播を止めれば届かない。
				const onDblClick = (event) => {
					if (!coarseMedia.matches) return;
					const target = event.target;
					if (!(target instanceof Element) || target.closest(SESSION_ROW_SELECTOR) === null) return;
					event.preventDefault();
					event.stopPropagation();
				};
				document.addEventListener("dblclick", onDblClick, true);
				disposers.push(() => {
					document.removeEventListener("dblclick", onDblClick, true);
				});

				return () => {
					for (const dispose of disposers.reverse()) dispose();
				};
			}, "mobile-ui: viewport + drawer chrome");

			// T309-C（ADR-20261026-1745）: sessions は任意依存。必須の inject に入れると、サービスが無い構成では本プラグイン全体
			// （ドロワー・キーボード追従など）が起動しなくなるため、ctx.inject で子 fiber として待つ。
			// サービスが提供されたときだけ有効になり、外れれば子 fiber ごと止まる（親の dispose でも止まる）。
			if (typeof ctx.inject === "function") {
				ctx.inject(["sessions"], (scope) => {
					scope.effect(() => closeDrawerOnSessionSwitch(scope.sessions, () => ctx.layout.toggleSidebar()), "mobile-ui: close drawer on session switch");
				});
			}
		};
		return module.exports;
	}
});
