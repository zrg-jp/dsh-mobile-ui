// docs/spec.md の契約（§4 ドロワー、§5 スワイプ判定表、§6 viewport、§7 ライフサイクル）を検査する。
// 見出しの [§n] は spec の節番号。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mount, swipe } from "./harness.mjs";

const open = async (h) => { h.ctx.layout.toggleSidebar(); await h.flush(); };

test("[§4.2] body 属性・inert・aria-expanded が開閉に同期する", async () => {
	const h = mount();
	await h.flush();
	const fab = h.document.querySelector(".dsh-mobile-ui-fab");
	assert.equal(h.document.body.dataset.dshMobileSidebar, "closed");
	assert.equal(h.el("side").inert, true);
	await open(h);
	assert.equal(h.document.body.dataset.dshMobileSidebar, "open");
	assert.equal(h.el("side").inert, false);
	assert.equal(fab.getAttribute("aria-expanded"), "true");
	h.close();
});

test("[§4.2] PHONE でなければ閉でも inert にしない", async () => {
	const h = mount({ width: 900 });
	await h.flush();
	assert.equal(h.el("side").inert, false);
	h.close();
});

test("[§3 SafeDegrade] frame が無ければ body=none で FAB 非表示", async () => {
	const h = mount({ withFrame: false });
	await h.flush();
	assert.equal(h.document.body.dataset.dshMobileSidebar, "none");
	h.close();
});

test("[§4.1] PHONE ではサイドバーが fixed のドロワー、DragHandle 非表示", async () => {
	const h = mount();
	const cs = h.window.getComputedStyle(h.el("side"));
	assert.equal(cs.position, "fixed");
	assert.equal(h.window.getComputedStyle(h.el("handle")).display, "none");
	h.close();
});

test("[§4.1] prefers-reduced-motion では開閉どちらも transition を無効にする（KI-3）", async () => {
	// happy-dom は詳細度とメディア（幅・reduced-motion）を考慮して computed style を解く。
	const h = mount({ reducedMotion: true });
	assert.equal(h.window.getComputedStyle(h.el("side")).transition, "none", "閉");
	await open(h);
	assert.equal(h.window.getComputedStyle(h.el("side")).transition, "none", "開");
	h.close();
	// 対照: 既定では閉じる側に visibility の遅延付き transition がある（検査が効いていることの確認）。
	const n = mount();
	assert.match(n.window.getComputedStyle(n.el("side")).transition, /visibility 0s \.25s/);
	n.close();
});

test("[§4.3] FAB click で開く", async () => {
	const h = mount();
	h.document.querySelector(".dsh-mobile-ui-fab").click();
	await h.flush();
	assert.equal(h.document.body.dataset.dshMobileSidebar, "open");
	h.close();
});

test("[§4.3] バックドロップ相当（frame 内・drawer 外）の pointerdown で閉じ、drawer 内では閉じない", async () => {
	const h = mount();
	await open(h);
	h.el("side-btn").dispatchEvent(new h.window.PointerEvent("pointerdown", { bubbles: true }));
	assert.equal(h.calls.toggleSidebar, 1);
	h.el("msg").dispatchEvent(new h.window.PointerEvent("pointerdown", { bubbles: true }));
	assert.equal(h.calls.toggleSidebar, 2);
	h.close();
});

test("[§4.3 BackdropOnlyInsideFrame] frame 外（portal）の pointerdown では閉じない", async () => {
	const h = mount();
	await open(h);
	const portal = h.document.createElement("div");
	h.document.body.append(portal);
	portal.dispatchEvent(new h.window.PointerEvent("pointerdown", { bubbles: true }));
	assert.equal(h.calls.toggleSidebar, 1);
	h.close();
});

test("[§4.3] Escape で閉じる（PHONE・開のみ）", async () => {
	const h = mount();
	h.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape" }));
	assert.equal(h.calls.toggleSidebar, 0);
	await open(h);
	h.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape" }));
	assert.equal(h.calls.toggleSidebar, 2);
	h.close();
});

test("[§4.3 EscapeRefocusesFab] Escape で閉じた後、FAB が表示状態（body=closed）になってから focus する（KI-1）", async () => {
	// happy-dom は display:none の要素にも focus できてしまうため、focus を呼んだ時点の body 属性で検査する。
	const h = mount();
	await open(h);
	const fab = h.document.querySelector(".dsh-mobile-ui-fab");
	const seen = [];
	const original = fab.focus.bind(fab);
	fab.focus = () => { seen.push(h.document.body.dataset.dshMobileSidebar); original(); };
	h.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape" }));
	await h.flush();
	assert.deepEqual(seen, ["closed"]);
	assert.equal(h.document.activeElement, fab);
	// 予約は 1 回で消費する: 後で別経路（バックドロップ）で閉じても FAB へ奪わない。
	await open(h);
	h.el("msg").dispatchEvent(new h.window.PointerEvent("pointerdown", { bubbles: true }));
	await h.flush();
	assert.deepEqual(seen, ["closed"]);
	h.close();
	// DSH の実装どおり、data-sidebar-collapsed が再描画で後から変わる場合も、変わった後に focus する。
	const a = mount();
	await open(a);
	const afab = a.document.querySelector(".dsh-mobile-ui-fab");
	const aseen = [];
	afab.focus = () => { aseen.push(a.document.body.dataset.dshMobileSidebar); };
	const sync = a.ctx.layout.toggleSidebar.bind(a.ctx.layout);
	a.ctx.layout.toggleSidebar = () => { setTimeout(sync, 5); };
	a.document.dispatchEvent(new a.window.KeyboardEvent("keydown", { key: "Escape" }));
	assert.deepEqual(aseen, [], "閉じが反映される前には focus しない");
	await new Promise((r) => setTimeout(r, 20));
	assert.deepEqual(aseen, ["closed"]);
	a.close();
});

// ---- §5.2 スワイプ判定表 ----
test("[§5.2 行7 OpenOnlyWhenClosedPhone] 右スワイプは起点の位置を問わず開く", async () => {
	// 起点が右半分（幅 390 の 300px）でも開く（ADR-20261026-1416）。
	const h = mount();
	swipe(h, h.el("msg"), [300, 300], [380, 300]);
	assert.equal(h.calls.toggleSidebar, 1);
	h.close();
	// PHONE 外（iPad 縦相当の coarse 768/900px）ではサイドバーを操作しない。
	for (const width of [768, 900]) {
		const t = mount({ width });
		swipe(t, t.el("msg"), [10, 300], [120, 300]);
		assert.equal(t.calls.toggleSidebar, 0, `width=${width}`);
		t.close();
	}
	const edge = mount({ width: 767 });
	swipe(edge, edge.el("msg"), [10, 300], [120, 300]);
	assert.equal(edge.calls.toggleSidebar, 1, "width=767 は PHONE");
	edge.close();
});

test("[§5.1 SwipeOnlyInsideFrame] frame 外（portal されたモーダル）起点のスワイプは背後を操作しない（KI-5）", async () => {
	const h = mount();
	const modal = h.addPortal();
	// 閉: 右スワイプでも背後のサイドバーを開かない。
	swipe(h, modal, [20, 100], [100, 100]);
	assert.deepEqual(h.calls, { toggleSidebar: 0, toggleExpanded: 0 });
	// 右パネル展開中: 左端起点でも畳まない。
	h.setRightExpanded(true);
	swipe(h, modal, [10, 100], [100, 100]);
	assert.deepEqual(h.calls, { toggleSidebar: 0, toggleExpanded: 0 });
	h.setRightExpanded(false);
	// 開: 左スワイプでも閉じない。
	await open(h);
	swipe(h, modal, [250, 100], [100, 100]);
	assert.equal(h.calls.toggleSidebar, 1);
	h.close();
	// FAB は frame 外だが例外（タップと同じく開いてよい）。
	const f = mount();
	await f.flush();
	swipe(f, f.document.querySelector(".dsh-mobile-ui-fab"), [20, 20], [100, 20]);
	assert.equal(f.calls.toggleSidebar, 1);
	f.close();
	// frame が無いときはガードを掛けない（§3 SafeDegrade の範囲限定どおり、従来の判定に任せる）。
	const n = mount({ withFrame: false });
	swipe(n, n.addPortal(), [20, 100], [100, 100]);
	assert.equal(n.calls.toggleSidebar, 1);
	n.close();
});

test("[§5.2 行3] 閾値: |dx|=59 や縦優勢は無視", async () => {
	const h = mount();
	swipe(h, h.el("msg"), [10, 300], [69, 300]);
	swipe(h, h.el("msg"), [10, 300], [70, 331]);
	assert.equal(h.calls.toggleSidebar, 0);
	swipe(h, h.el("msg"), [10, 300], [70, 330]);
	assert.equal(h.calls.toggleSidebar, 1);
	h.close();
});

test("[§5.2 行5 CollapseOnlyFromEdge] 右パネル展開中は左端28px起点だけ畳む", async () => {
	const h = mount();
	h.setRightExpanded(true);
	swipe(h, h.el("msg"), [29, 300], [120, 300]);
	assert.deepEqual(h.calls, { toggleSidebar: 0, toggleExpanded: 0 });
	swipe(h, h.el("msg"), [28, 300], [120, 300]);
	assert.deepEqual(h.calls, { toggleSidebar: 0, toggleExpanded: 1 });
	h.close();
});

test("[§5.2 行9] 左スワイプで開いているサイドバーを閉じる", async () => {
	const h = mount();
	await open(h);
	swipe(h, h.el("side-btn"), [250, 300], [100, 300]);
	assert.equal(h.calls.toggleSidebar, 2);
	h.close();
});

test("[§5.1] 編集領域起点・COARSE 外はスワイプにしない", async () => {
	const h = mount();
	swipe(h, h.el("ta"), [10, 300], [120, 300]);
	assert.equal(h.calls.toggleSidebar, 0);
	h.close();
	const d = mount({ coarse: false });
	swipe(d, d.el("msg"), [10, 300], [120, 300]);
	assert.equal(d.calls.toggleSidebar, 0);
	d.close();
});

test("[§5.2 行4/8] 横スクロール祖先: 左端なら右スワイプ可、スクロール済みなら不可、左スワイプは常に不可", async () => {
	const h = mount();
	const inner = h.el("hscroll").firstElementChild;
	// happy-dom はレイアウトしないので、スクロール可能な寸法を与える。
	Object.defineProperty(h.el("hscroll"), "scrollWidth", { value: 400 });
	Object.defineProperty(h.el("hscroll"), "clientWidth", { value: 100 });
	swipe(h, inner, [10, 300], [120, 300]);
	assert.equal(h.calls.toggleSidebar, 1, "左端なら開く");
	await h.flush();
	swipe(h, inner, [250, 300], [100, 300]);
	assert.equal(h.calls.toggleSidebar, 1, "左スワイプは横スクロールに譲る");
	h.ctx.layout.toggleSidebar(); // 閉に戻す
	h.el("hscroll").scrollLeft = 50;
	swipe(h, inner, [10, 300], [120, 300]);
	assert.equal(h.calls.toggleSidebar, 2, "スクロール済みでは開かない");
	h.close();
});

// ---- §6 / §7 ----
test("[§6] viewport meta を書換え、dispose で元に戻す", async () => {
	const h = mount();
	const meta = h.document.querySelector("meta[name=viewport]");
	assert.match(meta.getAttribute("content"), /viewport-fit=cover/);
	h.dispose();
	assert.equal(meta.getAttribute("content"), "width=device-width, initial-scale=1");
	h.close();
});

test("[§6] visualViewport の高さと上端を CSS 変数に流し、ページはスクロールさせない（COARSE のみ）", async () => {
	const h = mount();
	let scrolled = 0;
	h.window.scrollTo = () => { scrolled++; };
	// 旧実装はページがずれているとき（scrollY≠0）に scrollTo していた。その条件を作った上で呼ばれないことを見る。
	Object.defineProperty(h.window, "scrollY", { value: 120, configurable: true });
	h.visualViewport.height = 500.4;
	h.visualViewport.offsetTop = 0;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	const style = h.document.documentElement.style;
	assert.equal(style.getPropertyValue("--dsh-mobile-vvh"), "500px");
	// iOS がキーボード表示中に visual viewport をパンしたら、#root の上端を追従させる（KI-9）。
	h.visualViewport.offsetTop = 290.6;
	h.visualViewport.dispatchEvent(new h.window.Event("scroll"));
	assert.equal(style.getPropertyValue("--dsh-mobile-vvtop"), "291px");
	assert.equal(scrolled, 0, "フォーカス時スクロールと競合する scrollTo は呼ばない");
	// happy-dom は CSS の (pointer:coarse) を評価しないため、注入 CSS の構造で検査する。
	const css = h.document.querySelector("style[data-plugin=dsh-mobile-ui]").textContent;
	assert.match(css, /@media \(max-width:1023px\) and \(pointer:coarse\)\{[^@]*#root\{position:fixed;[^}]*top:var\(--dsh-mobile-vvtop,0px\)/);
	assert.match(css, /@media \(max-width:1023px\) and \(pointer:coarse\)\{[^@]*html,body\{overflow:hidden;/);
	h.close();
	// fine pointer・1024px 以上では、起動時も resize/scroll 時も変数を設定しない。
	for (const opt of [{ coarse: false }, { width: 1024 }]) {
		const t = mount(opt);
		t.visualViewport.height = 400;
		t.visualViewport.offsetTop = 100;
		t.visualViewport.dispatchEvent(new t.window.Event("resize"));
		t.visualViewport.dispatchEvent(new t.window.Event("scroll"));
		const st = t.document.documentElement.style;
		assert.equal(st.getPropertyValue("--dsh-mobile-vvh"), "", JSON.stringify(opt));
		assert.equal(st.getPropertyValue("--dsh-mobile-vvtop"), "", JSON.stringify(opt));
		t.close();
	}
});

test("[§6] 可視範囲が変わったら window の resize を再送する（KI-10、COARSE のみ）", async () => {
	const h = mount();
	// 起動時の初期化では送らない（開いているメニューが無い）。
	assert.equal(h.resizeCount(), 0);
	// キーボード表示に相当する高さの変化では送る（DSH のメニューがトリガー位置を取り直す契機）。
	h.visualViewport.height = 500.4;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(h.resizeCount(), 1);
	// 丸め値が変わる変化では送る（500 -> 501）。
	h.visualViewport.height = 500.9;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(h.resizeCount(), 2);
	// 丸め値が変わらない再通知では送らない（501 のまま）。
	h.visualViewport.height = 501.2;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(h.resizeCount(), 2);
	// パン（offsetTop の変化）でも送る。
	h.visualViewport.offsetTop = 120.2;
	h.visualViewport.dispatchEvent(new h.window.Event("scroll"));
	assert.equal(h.resizeCount(), 3);
	h.close();
	// COARSE 外（fine pointer / 1024px 以上）では送らない。
	for (const opt of [{ coarse: false }, { width: 1024 }]) {
		const t = mount(opt);
		t.visualViewport.height = 400;
		t.visualViewport.offsetTop = 100;
		t.visualViewport.dispatchEvent(new t.window.Event("resize"));
		t.visualViewport.dispatchEvent(new t.window.Event("scroll"));
		assert.equal(t.resizeCount(), 0, JSON.stringify(opt));
		// 印も付けない（DOM を変えない）。
		const el = t.document.createElement("div");
		el.style.position = "fixed";
		t.document.body.append(el);
		await t.flush();
		assert.equal(el.hasAttribute("data-dsh-mobile-overlay"), false, JSON.stringify(opt));
		t.close();
	}
});

test("[§6] body 直下の固定オーバーレイに座標補正の印を付ける（KI-10）", async () => {
	const h = mount();
	const fixed = h.document.createElement("div");
	fixed.style.position = "fixed";
	h.document.body.append(fixed);
	await h.flush();
	assert.equal(fixed.hasAttribute("data-dsh-mobile-overlay"), true);
	// 通常フローの要素には付けない（同時に、次の走査の契機にもする）。
	const normal = h.document.createElement("div");
	h.document.body.append(normal);
	await h.flush();
	assert.equal(normal.hasAttribute("data-dsh-mobile-overlay"), false);
	// アプリ本体（#root）は top で補正済みなので、fixed でも対象外。
	h.el("root").style.position = "fixed";
	const trigger = h.document.createElement("div");
	h.document.body.append(trigger);
	await h.flush();
	assert.equal(h.el("root").hasAttribute("data-dsh-mobile-overlay"), false);
	// 全画面レイヤ（inset:0 の Modal 等）は対象外。
	const full = h.document.createElement("div");
	full.style.position = "fixed";
	full.style.top = "0px";
	full.style.left = "0px";
	full.style.right = "0px";
	full.style.bottom = "0px";
	h.document.body.append(full);
	await h.flush();
	assert.equal(full.hasAttribute("data-dsh-mobile-overlay"), false);
	// 補正は COARSE の media 内の CSS で行う（happy-dom は (pointer:coarse) を評価しないため構造で検査する）。
	const css = h.document.querySelector("style[data-plugin=dsh-mobile-ui]").textContent;
	assert.match(css, /@media \(max-width:1023px\) and \(pointer:coarse\)\{[^@]*\[data-dsh-mobile-overlay\]\{translate:0 var\(--dsh-mobile-vvtop,0px\);\}/);
	// dispose 後は印を付けず、可視範囲が変わっても resize を送らない。
	h.dispose();
	assert.equal(fixed.hasAttribute("data-dsh-mobile-overlay"), false);
	const after = h.document.createElement("div");
	after.style.position = "fixed";
	h.document.body.append(after);
	await h.flush();
	assert.equal(after.hasAttribute("data-dsh-mobile-overlay"), false);
	const before = h.resizeCount();
	h.visualViewport.height = 600;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(h.resizeCount(), before);
	h.close();
});

test("[§7] dispose ですべての DOM 介入を撤去する", async () => {
	const h = mount();
	await h.flush();
	h.dispose();
	const d = h.document;
	assert.equal(d.querySelector("style[data-plugin=dsh-mobile-ui]"), null);
	assert.equal(d.querySelector(".dsh-mobile-ui-fab"), null);
	assert.equal(d.body.dataset.dshMobileSidebar, undefined);
	assert.equal(d.documentElement.style.getPropertyValue("--dsh-mobile-vvh"), "");
	assert.equal(d.documentElement.style.getPropertyValue("--dsh-mobile-vvtop"), "");
	assert.equal(h.el("side").inert, false);
	swipe(h, h.el("msg"), [10, 300], [120, 300]);
	assert.equal(h.calls.toggleSidebar, 0, "リスナーも外れる");
	h.close();
});

test("[§5.2 行5a DrawerShadowsRightPanel] ドロワー表示中の右スワイプは背後の右パネルを畳まない（Q2）", async () => {
	const h = mount();
	await open(h);
	h.setRightExpanded(true);
	swipe(h, h.el("side-btn"), [0, 300], [120, 300]);
	assert.deepEqual(h.calls, { toggleSidebar: 1, toggleExpanded: 0 });
	h.close();
});
