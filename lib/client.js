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
		/** セーフエリア padding（PWA の standalone / fullscreen）の条件。CSS と probe の計測で共有する。 */
		const SAFE_AREA_QUERY = "(max-width:1023px) and (display-mode:standalone),(max-width:1023px) and (display-mode:fullscreen)";

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
			// ADR-20261026-1800 / issue #12: FAB（右端 = safe-left + 46px）が会話ヘッダのタイトル先頭を隠さないよう、
			// DSH 自身の変数 --dsh-frame-leading-clearance を閉時の frame に与える。0.2.0-rc.2 では会話ヘッダの
			// titleRow が padding-inline-start:max(0px, calc(var(--dsh-frame-leading-clearance,0px) - 20px)) で参照し
			// （header の padding 20px と合わせて、タイトルは header 左端から値の位置で始まる）、darwin の frame 規則
			// （信号機ボタンの席、160px / 84px）だけが値を定める。darwin（デスクトップ）の規則は詳細度で勝つので触らない。
			"[data-sidebar-collapsed]:has(> [data-rightbar-col]){--dsh-frame-leading-clearance:calc(56px + env(safe-area-inset-left));}",
			// 右パネル展開中（<768px では DSH が 100vw の全画面にする）は FAB を隠す。パネルのタブ列・ファイル名を
			// 覆うため。戻る手段は右パネルの閉じるボタンと左端からの右スワイプ（§5.2 行 5）。body 属性は JS が同期する。
			"body[data-dsh-mobile-sidebar=closed][data-dsh-mobile-right=open] .dsh-mobile-ui-fab{display:none;}",
			"}",
			// PWA では #root 自体が safe-area-inset-left の padding を持つ（下のセーフエリア規則）ので、frame の左端は
			// すでに inset の分だけ右にある。FAB との相対距離は 46px になり、inset を足すと二重になる。
			`@media ${PHONE_QUERY} and (display-mode:standalone),${PHONE_QUERY} and (display-mode:fullscreen){`,
			"[data-sidebar-collapsed]:has(> [data-rightbar-col]){--dsh-frame-leading-clearance:56px;}",
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
			`@media ${SAFE_AREA_QUERY}{`,
			"#root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);box-sizing:border-box;}",
			// T347 / ADR-20261026-1800: native gap（WebView の外にホームインジケータの帯がある）と判定し、かつ
			// フラグで有効化したときだけ下端の padding を外す。属性は JS（measureSafeArea）が付ける。既定は付かない。
			"html[data-dsh-mobile-native-gap=on] #root{padding-bottom:0 !important;}",
			"}"
		].join("");

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
						// #root と、本プラグインのセーフエリア計測用 probe（0 サイズの fixed 要素）は対象外。
						if (el.id === "root" || el.hasAttribute("data-dsh-mobile-safe-probe")) continue;
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

				// -- 右パネル展開の body 属性（issue #12 / ADR-20261026-1800）--
				// <768px の右パネルは 100vw の全画面になり（sidebar-right 0.2.0-rc.2 の RightbarSeat の autoFullscreen）、
				// FAB がそのタブ列・ファイル名の先頭を覆う。展開中は CSS で FAB を隠すため、
				// body[data-dsh-mobile-right] に open / closed を同期する。判定は公開サービスの isExpanded()
				// （画面上のセッションの右パネル）を使い、背景セッションの隠れたパネルの属性には惑わされない。
				// 契機は DOM の変化: パネル要素の data-sidebar-right-open（展開時だけ付く）と、セッション切替で
				// 変わる hidden 属性、要素の出入り。isExpanded() は同期的で軽いので、変化のたびに呼んでよい。
				const syncRight = () => {
					let expanded = false;
					try {
						expanded = ctx.sidebarRight.isExpanded() === true;
					} catch {
						// サービスが一時的に使えない場合は「畳まれている」とみなす（FAB を隠さない側へ劣化）。
					}
					const value = expanded ? "open" : "closed";
					if (document.body.dataset.dshMobileRight !== value) document.body.dataset.dshMobileRight = value;
				};
				const rightObserver = new MutationObserver(syncRight);
				rightObserver.observe(document.documentElement, {
					subtree: true,
					childList: true,
					attributes: true,
					attributeFilter: ["data-sidebar-right-open", "hidden"]
				});
				syncRight();
				disposers.push(() => {
					rightObserver.disconnect();
					delete document.body.dataset.dshMobileRight;
				});

				// -- セーフエリアの実測と iOS standalone の native gap（T347 / ADR-20261026-1800）--
				// JS から env() は読めないため、env(safe-area-inset-*) を padding に持つ不可視の probe 要素を置き、
				// computed の padding を読む。値は html の CSS 変数 --dsh-mobile-safe-<辺> に出す（診断用）。
				// native gap: iOS 26 系のホーム画面アプリでは WebView が画面より短く、画面との差の帯を
				// システムが描く報告がある（WebKit Bug 301994）。帯が下にありホームインジケータを含むなら、
				// #root の padding-bottom（env の下端）は余白を二重にする（Idea from kuraneko1/dsh-mobile-maxxing
				// 24e2e49, MIT）。帯が上か下かは資料間で食い違い、実機未確認なので、padding を消すのは
				// localStorage のフラグで有効にしたときだけ（既定オフ）。条件を満たしただけでは
				// html[data-dsh-mobile-native-gap=detected] を付け、実機で観測できるようにする。
				const NATIVE_GAP_FLAG = "dsh-mobile-ui:native-gap";
				const NATIVE_GAP_MIN_PX = 8;
				/** キーボード表示中とみなす visualViewport の縮み（予測変換バーより大きく、キーボードより小さい推定値）。 */
				const KEYBOARD_MIN_PX = 100;
				const SAFE_EDGES = ["top", "right", "bottom", "left"];
				const safeProbe = document.createElement("div");
				safeProbe.setAttribute("data-dsh-mobile-safe-probe", "");
				safeProbe.setAttribute("aria-hidden", "true");
				safeProbe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
					SAFE_EDGES.map((edge) => `padding-${edge}:env(safe-area-inset-${edge},0px);`).join("");
				document.body.append(safeProbe);
				const nativeGapEnabled = () => {
					try {
						return window.localStorage?.getItem(NATIVE_GAP_FLAG) === "on";
					} catch {
						return false;
					}
				};
				const releaseSafeArea = () => {
					const root = document.documentElement;
					for (const edge of SAFE_EDGES) root.style.removeProperty(`--dsh-mobile-safe-${edge}`);
					root.removeAttribute("data-dsh-mobile-native-gap");
				};
				const measureSafeArea = () => {
					// セーフエリア padding（下の CSS）と同じ範囲だけで測る。範囲外では何も残さない。
					if (!safeAreaMedia.matches) {
						releaseSafeArea();
						return;
					}
					const root = document.documentElement;
					const style = getComputedStyle(safeProbe);
					const inset = {};
					for (const edge of SAFE_EDGES) {
						const px = parseFloat(style.getPropertyValue(`padding-${edge}`));
						inset[edge] = Number.isFinite(px) && px > 0 ? px : 0;
						root.style.setProperty(`--dsh-mobile-safe-${edge}`, `${inset[edge]}px`);
					}
					// 条件（すべて満たすとき）: iOS のホーム画面アプリ、縦向き（iOS の screen は回転しても縦の寸法を
					// 返すため、横向きで差を取ると常に大きくなる）、キーボードが閉じている、画面の長辺と innerHeight の
					// 差が 8px を超える、下端の inset が正（消す padding がある）。
					const screenLong = Math.max(Number(window.screen?.width) || 0, Number(window.screen?.height) || 0);
					const portrait = window.innerHeight >= window.innerWidth;
					const keyboardOpen = vv !== undefined && vv !== null && vv.height < window.innerHeight - KEYBOARD_MIN_PX;
					const gap = window.navigator.standalone === true && portrait && !keyboardOpen && screenLong - window.innerHeight > NATIVE_GAP_MIN_PX && inset.bottom > 0;
					if (!gap) root.removeAttribute("data-dsh-mobile-native-gap");
					else root.setAttribute("data-dsh-mobile-native-gap", nativeGapEnabled() ? "on" : "detected");
				};
				const safeAreaMedia = window.matchMedia(SAFE_AREA_QUERY);
				measureSafeArea();
				// 再計測: 回転・幅の変化（window resize）、キーボードの出入り（visualViewport resize）、表示モードの変化。
				window.addEventListener("resize", measureSafeArea);
				window.addEventListener("orientationchange", measureSafeArea);
				vv?.addEventListener("resize", measureSafeArea);
				safeAreaMedia.addEventListener("change", measureSafeArea);
				disposers.push(() => {
					window.removeEventListener("resize", measureSafeArea);
					window.removeEventListener("orientationchange", measureSafeArea);
					vv?.removeEventListener("resize", measureSafeArea);
					safeAreaMedia.removeEventListener("change", measureSafeArea);
					safeProbe.remove();
					releaseSafeArea();
				});

				// -- 右パネルのターミナル: タップでキーボード、縦ドラッグでスクロール（T311 / T343、ADR-20261026-1800）--
				// 対象は [data-sidebar-terminal]（sidebar-terminal 0.2.0-rc.2 の section）内の xterm。.xterm /
				// .xterm-helper-textarea / .xterm-scrollable-element は xterm.js（6.0.0 同梱）自身のクラスで、ハッシュ化されない。
				// (a) DSH は表示時に effect から xterm.focus() を呼ぶが、ユーザー操作の処理中ではないため iOS は
				//     キーボードを出さない。タップの touchend の中で helper textarea を同期的に focus する。
				// (b) xterm 6.0 には touch によるスクロール経路が無く、スクロール位置は wheel だけで動く。
				//     縦の単指ドラッグを wheel に変換して .xterm-scrollable-element へ送る（Idea from
				//     kuraneko1/dsh-mobile-maxxing 24e2e49, MIT）。
				const TERMINAL_SELECTOR = "[data-sidebar-terminal] .xterm";
				/** これ以下の移動はタップとみなし、これを超えた最初の移動で縦か横かを決める。 */
				const TERMINAL_SLOP_PX = 6;
				/**
				 * xterm の SmoothScrollableElement はピクセル単位の wheel の deltaY を 40 で割り、50 倍して
				 * スクロールする（1 wheel px = 1.25 px）。0.8 を掛けると指の移動量と表示の移動量が一致する。
				 */
				const TERMINAL_WHEEL_PER_PX = 0.8;
				/** 1 イベントあたりの指の移動の上限。間引かれた touchmove で表示が飛ばないようにする。 */
				const TERMINAL_MAX_STEP_PX = 32;
				/** これより長く押した操作はタップにしない（長押しの選択・メニューでキーボードを出さない）。 */
				const TERMINAL_TAP_MAX_MS = 500;
				let terminalTouch = null;
				/** touchmove（non-passive）を付けた .xterm 要素。dispose で外す。 */
				const terminalTargets = new Set();
				const terminalOf = (target) => (target instanceof Element ? target.closest(TERMINAL_SELECTOR) : null);
				const onTerminalTouchMove = (event) => {
					const drag = terminalTouch;
					if (drag === null || drag.state === "off") return;
					// ピンチ（2 本目の指）・拡大中（KI-2 と同じガード）は閲覧操作なので手を出さない。
					if (event.touches.length !== 1 || isZoomed()) {
						drag.state = "off";
						return;
					}
					const t = event.touches[0];
					const dx = t.clientX - drag.x0;
					const dy = t.clientY - drag.y0;
					if (drag.state === "pending") {
						if (Math.abs(dx) <= TERMINAL_SLOP_PX && Math.abs(dy) <= TERMINAL_SLOP_PX) return;
						// 横が優位なら追跡をやめる（スワイプ判定 §5 に任せる）。縦優位なら以降はスクロール。
						if (Math.abs(dy) <= Math.abs(dx)) {
							drag.state = "off";
							return;
						}
						drag.state = "scroll";
						// スクロールに使った操作は、終了時に曲がって横優位になってもスワイプにしない。
						// swipe は下のスワイプブロックの変数（touchmove の時点では初期化済み）。
						swipe = null;
					}
					if (event.cancelable) event.preventDefault();
					const step = Math.max(-TERMINAL_MAX_STEP_PX, Math.min(TERMINAL_MAX_STEP_PX, t.clientY - drag.y));
					drag.y = t.clientY;
					if (step === 0) return;
					// WheelEvent ではなく素の Event にする。実ブラウザの WheelEvent は wheelDeltaY を持ち、xterm はそれを
					// 優先して 120 単位で解釈するため、速度がブラウザ依存になる。素の Event ならピクセル単位の経路に入る。
					const wheel = new window.Event("wheel", { bubbles: true, cancelable: true });
					Object.assign(wheel, { deltaX: 0, deltaY: -step * TERMINAL_WHEEL_PER_PX, deltaZ: 0, deltaMode: 0, clientX: t.clientX, clientY: t.clientY });
					(drag.terminal.querySelector(".xterm-scrollable-element") ?? drag.terminal).dispatchEvent(wheel);
				};
				const onTerminalTouchStart = (event) => {
					terminalTouch = null;
					// DOM から外れたターミナル（タブを閉じた等）の登録を、次のタッチ（文書のどこでもよい）で解放する。
					// 要素の部分木を dispose まで保持し続けないため（独立レビューの指摘）。集合は高々数個なので毎回走査してよい。
					for (const old of terminalTargets) {
						if (old.isConnected) continue;
						old.removeEventListener("touchmove", onTerminalTouchMove);
						terminalTargets.delete(old);
					}
					if (!coarseMedia.matches || event.touches.length !== 1 || isZoomed()) return;
					const terminal = terminalOf(event.target);
					if (terminal === null) return;
					// non-passive の touchmove はターミナル要素にだけ付ける（文書全体のスクロールを妨げない）。
					// 要素は DSH がタブの開閉で作り直すので、最初に触れたときに付ける。
					if (!terminalTargets.has(terminal)) {
						terminal.addEventListener("touchmove", onTerminalTouchMove, { passive: false });
						terminalTargets.add(terminal);
					}
					const t = event.touches[0];
					terminalTouch = { terminal, x0: t.clientX, y0: t.clientY, y: t.clientY, state: "pending", at: Date.now() };
				};
				const onTerminalTouchEnd = (event) => {
					const drag = terminalTouch;
					terminalTouch = null;
					// タップ（閾値以内の単指）だけを対象にする。スクロール・横ドラッグ・ピンチは除く。
					if (drag === null || drag.state !== "pending" || event.changedTouches.length !== 1 || isZoomed()) return;
					if (Date.now() - drag.at > TERMINAL_TAP_MAX_MS) return;
					// touchmove が間引かれても、終了点が閾値を超えていればタップではない。
					const end = event.changedTouches[0];
					if (Math.abs(end.clientX - drag.x0) > TERMINAL_SLOP_PX || Math.abs(end.clientY - drag.y0) > TERMINAL_SLOP_PX) return;
					const input = drag.terminal.querySelector("textarea.xterm-helper-textarea");
					// 読み取り専用（xterm の disableStdin。DSH は書込権限が無いとき付ける）では何もしない。
					if (input === null || input.readOnly || input.disabled) return;
					// iOS はユーザー操作（touchend）の処理中に呼んだ focus でだけソフトキーボードを出す。
					// DSH は表示時に effect から focus するので、textarea はフォーカス済みなのにキーボードが無い状態になりうる。
					// その場合 focus() を呼び直しても何も起きないため、いったん blur してから focus し直す（独立レビューの指摘）。
					// キーボードが出ている（visualViewport が 100px を超えて縮んでいる）ときは、閉じさせないよう触らない。
					if (document.activeElement === input) {
						const keyboardShown = vv !== undefined && vv !== null && vv.height < window.innerHeight - KEYBOARD_MIN_PX;
						if (keyboardShown) return;
						input.blur();
					}
					input.focus({ preventScroll: true });
				};
				const onTerminalTouchCancel = () => {
					terminalTouch = null;
				};
				document.addEventListener("touchstart", onTerminalTouchStart, { capture: true, passive: true });
				document.addEventListener("touchend", onTerminalTouchEnd, { capture: true, passive: true });
				document.addEventListener("touchcancel", onTerminalTouchCancel, { capture: true, passive: true });
				disposers.push(() => {
					document.removeEventListener("touchstart", onTerminalTouchStart, { capture: true });
					document.removeEventListener("touchend", onTerminalTouchEnd, { capture: true });
					document.removeEventListener("touchcancel", onTerminalTouchCancel, { capture: true });
					for (const el of terminalTargets) el.removeEventListener("touchmove", onTerminalTouchMove);
					terminalTargets.clear();
					terminalTouch = null;
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

				return () => {
					for (const dispose of disposers.reverse()) dispose();
				};
			}, "mobile-ui: viewport + drawer chrome");
		};
		return module.exports;
	}
});
