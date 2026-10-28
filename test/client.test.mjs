// docs/spec.md の契約（§4 ドロワー、§5 スワイプ判定表、§6 viewport、§7 ライフサイクル）を検査する。
// 見出しの [§n] は spec の節番号。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mount, swipe, touchStart } from "./harness.mjs";

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

test("[§4.3 EscapeYieldsToForeground] モーダル表示中・処理済みの Escape ではドロワーを閉じない（KI-7）", async () => {
	const h = mount();
	await open(h);
	// 前面のメニュー等が先に処理して preventDefault した Escape。
	const handled = new h.window.KeyboardEvent("keydown", { key: "Escape", cancelable: true });
	handled.preventDefault();
	h.document.dispatchEvent(handled);
	assert.equal(h.calls.toggleSidebar, 1);
	// DSH の Modal は本リスナーより後に処理するため、aria-modal=true の存在で判定する。
	const modal = h.addPortal().parentElement;
	h.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
	assert.equal(h.calls.toggleSidebar, 1);
	// モーダルが閉じた後の Escape では閉じる。
	modal.remove();
	h.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
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
	// 反映待ちの間に Escape が重なっても再トグルしない（開に戻さない）。
	const b = mount();
	await open(b);
	const bfab = b.document.querySelector(".dsh-mobile-ui-fab");
	const bseen = [];
	bfab.focus = () => { bseen.push(b.document.body.dataset.dshMobileSidebar); };
	const bsync = b.ctx.layout.toggleSidebar.bind(b.ctx.layout);
	b.ctx.layout.toggleSidebar = () => { setTimeout(bsync, 5); };
	b.document.dispatchEvent(new b.window.KeyboardEvent("keydown", { key: "Escape" }));
	b.document.dispatchEvent(new b.window.KeyboardEvent("keydown", { key: "Escape" }));
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(b.calls.toggleSidebar, 2, "open + Escape 1 回分だけ");
	assert.deepEqual(bseen, ["closed"]);
	b.ctx.layout.toggleSidebar = bsync;
	// 予約が反映前に別経路の開閉で取り消された場合、その後の閉で FAB へ奪わない。
	const c = mount();
	await open(c);
	const cfab = c.document.querySelector(".dsh-mobile-ui-fab");
	const cseen = [];
	cfab.focus = () => { cseen.push("focus"); };
	// Escape の toggle がストアにだけ効き DOM に反映されない状況を作る（閉が失われた）。
	c.ctx.layout.toggleSidebar = () => {};
	c.document.dispatchEvent(new c.window.KeyboardEvent("keydown", { key: "Escape" }));
	c.ctx.layout.toggleSidebar = () => { c.calls.toggleSidebar++; c.el("frame").setAttribute("data-sidebar-collapsed", ""); };
	c.el("msg").dispatchEvent(new c.window.PointerEvent("pointerdown", { bubbles: true }));
	await c.flush();
	assert.deepEqual(cseen, [], "バックドロップで閉じたときは FAB へ移さない");
	c.close();
	b.close();
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

test("[§5.1 DropSwipeOnViewportChange] 回転・幅変化・判定条件の変化をまたいだタッチは破棄する（T345）", async () => {
	const h = mount();
	// 幅が変わる resize（回転）をまたぐと開かない。PHONE の範囲内（390→700）なので media の change は来ない。
	let t = touchStart(h, h.el("msg"), [10, 300]);
	h.setViewport({ width: 700 });
	await h.flush();
	t.end([120, 300]);
	assert.equal(h.calls.toggleSidebar, 0, "幅の変化");
	// 幅の変わらない resize（KI-10 でキーボードの出入りごとに本プラグインが再送する）では捨てない。
	t = touchStart(h, h.el("msg"), [10, 300]);
	h.window.dispatchEvent(new h.window.Event("resize"));
	t.end([120, 300]);
	assert.equal(h.calls.toggleSidebar, 1, "幅が同じ resize では捨てない");
	h.close();
	// 幅は同じでも COARSE が外れたら捨てる（開始時に検査した前提が崩れる）。
	const c = mount();
	t = touchStart(c, c.el("msg"), [10, 300]);
	c.setViewport({ coarse: false });
	t.end([120, 300]);
	assert.equal(c.calls.toggleSidebar, 0, "COARSE の change");
	c.close();
	// PHONE の境界をまたぐ回転（900→390）でも捨てる。PHONE の change は必ず幅の変化を伴うため、
	// resize 側の破棄と区別できない（phoneMedia の監視は resize が来ない環境への備えで、ここでは個別に検査できない）。
	const p = mount({ width: 900 });
	t = touchStart(p, p.el("msg"), [10, 300]);
	p.setViewport({ width: 390 });
	await p.flush();
	t.end([120, 300]);
	assert.equal(p.calls.toggleSidebar, 0, "PHONE の change");
	p.close();
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
	assert.equal(meta.getAttribute("content"), "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content");
	h.dispose();
	assert.equal(meta.getAttribute("content"), "width=device-width, initial-scale=1");
	h.close();
});

test("[§6 PinchAllowed] viewport meta にズームを制限する項目を足さない（KI-8）", async () => {
	const h = mount();
	const content = h.document.querySelector("meta[name=viewport]").getAttribute("content");
	assert.doesNotMatch(content, /maximum-scale/);
	assert.doesNotMatch(content, /user-scalable/);
	assert.doesNotMatch(content, /minimum-scale/);
	h.close();
});

test("[§6 ViewportMerge] 既存の項目は順序ごと保ち、必要な項目だけ上書き・追加する", async () => {
	// ページ側の未知の項目（height など）と、重複・空白・大文字の混在を含む content。
	const h = mount({ viewport: " Width=980 ,height=device-height,,initial-scale=2, initial-scale=3, minimum-scale=0.5" });
	const meta = h.document.querySelector("meta[name=viewport]");
	assert.equal(
		meta.getAttribute("content"),
		"width=device-width, height=device-height, initial-scale=1, minimum-scale=0.5, viewport-fit=cover, interactive-widget=resizes-content"
	);
	h.dispose();
	// 他者が触っていなければ、元の文字列をそのまま戻す（正規化した形にしない）。
	assert.equal(meta.getAttribute("content"), " Width=980 ,height=device-height,,initial-scale=2, initial-scale=3, minimum-scale=0.5");
	h.close();
});

test("[§6 ViewportMerge] セミコロン区切り・混在区切りでも非管理項目を保つ", async () => {
	const h = mount({ viewport: "width=980; height=device-height; user-scalable=yes, foo=1" });
	const meta = h.document.querySelector("meta[name=viewport]");
	assert.equal(
		meta.getAttribute("content"),
		"width=device-width, height=device-height, user-scalable=yes, foo=1, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
	);
	// 他者変更後の dispose でも非管理項目は残る。
	meta.setAttribute("content", `${meta.getAttribute("content")}; bar=2`);
	h.dispose();
	assert.equal(meta.getAttribute("content"), "width=980, height=device-height, user-scalable=yes, foo=1, bar=2");
	h.close();
});

test("[§6 ViewportMerge] 他者が値を変えた・重複させた管理項目は dispose で触らない", async () => {
	const h = mount();
	const meta = h.document.querySelector("meta[name=viewport]");
	meta.setAttribute("content", "width=device-width, initial-scale=2, viewport-fit=cover, viewport-fit=cover, interactive-widget=resizes-content");
	h.dispose();
	// initial-scale は他者の値、viewport-fit は重複（誰が書いたか判別できない）なので残す。interactive-widget は元に無いので消す。
	assert.equal(meta.getAttribute("content"), "width=device-width, initial-scale=2, viewport-fit=cover, viewport-fit=cover");
	h.close();
});

test("[§6 ViewportMerge] content 属性が無ければ必要な項目だけで作り、dispose で属性ごと消す", async () => {
	const h = mount({ viewport: null });
	const meta = h.document.querySelector("meta[name=viewport]");
	assert.equal(meta.getAttribute("content"), "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content");
	h.dispose();
	assert.equal(meta.hasAttribute("content"), false);
	h.close();
});

test("[§6 ViewportMerge] 起動後に他者が meta を変えていたら、dispose は本プラグインの項目だけを戻す", async () => {
	const h = mount({ viewport: "width=device-width, initial-scale=1, viewport-fit=auto" });
	const meta = h.document.querySelector("meta[name=viewport]");
	// 別の介入者（DSH 本体や他プラグイン）が後から項目を足した状態。
	meta.setAttribute("content", `${meta.getAttribute("content")}, theme-x=1`);
	h.dispose();
	// width / initial-scale は元の値、viewport-fit は元の auto、追加した interactive-widget は消え、theme-x は残る。
	assert.equal(meta.getAttribute("content"), "width=device-width, initial-scale=1, viewport-fit=auto, theme-x=1");
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

test("[§6 PinchFreezesRoot] ピンチズーム中（scale≠1）は CSS 変数も resize の再送も更新しない（KI-2）", async () => {
	const h = mount();
	const style = h.document.documentElement.style;
	// キーボード表示（scale=1）: 通常どおり追従する。
	h.visualViewport.height = 500;
	h.visualViewport.offsetTop = 290;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(style.getPropertyValue("--dsh-mobile-vvh"), "500px");
	assert.equal(style.getPropertyValue("--dsh-mobile-vvtop"), "290px");
	assert.equal(h.resizeCount(), 1);
	// キーボード表示中にピンチで 2 倍: visual viewport は半分の高さになりパンするが、#root は据え置く。
	h.visualViewport.scale = 2;
	h.visualViewport.height = 250;
	h.visualViewport.offsetTop = 400;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	h.visualViewport.dispatchEvent(new h.window.Event("scroll"));
	assert.equal(style.getPropertyValue("--dsh-mobile-vvh"), "500px");
	assert.equal(style.getPropertyValue("--dsh-mobile-vvtop"), "290px");
	assert.equal(h.resizeCount(), 1, "ズーム中の変化では DSH の再配置を促さない");
	// 拡大中にキーボードを閉じても据え置く（scale=1 に戻ったときに反映する）。
	h.visualViewport.height = 400;
	h.visualViewport.offsetTop = 0;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(style.getPropertyValue("--dsh-mobile-vvh"), "500px");
	// 等倍へ戻ると、その時点の値で追従を再開し、変化を通知する。
	h.visualViewport.scale = 1;
	h.visualViewport.height = 800;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(style.getPropertyValue("--dsh-mobile-vvh"), "800px");
	assert.equal(style.getPropertyValue("--dsh-mobile-vvtop"), "0px");
	assert.equal(h.resizeCount(), 2);
	h.close();
});

test("[§6 PinchFreezesRoot] 等倍とみなす許容幅（|scale−1| ≤ 0.01）の内側では追従し、外側では止める", async () => {
	const h = mount();
	const style = h.document.documentElement.style;
	h.visualViewport.scale = 1.009;
	h.visualViewport.height = 600;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(style.getPropertyValue("--dsh-mobile-vvh"), "600px");
	h.visualViewport.scale = 1.02;
	h.visualViewport.height = 590;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(style.getPropertyValue("--dsh-mobile-vvh"), "600px");
	h.close();
	// 起動時点で拡大中なら変数を設定しない（CSS のフォールバック: 上端 0・高さ 100%）。
	const z = mount({ scale: 2 });
	assert.equal(z.document.documentElement.style.getPropertyValue("--dsh-mobile-vvh"), "");
	z.close();
});

test("[§5.1 NoSwipeWhileZoomed] ピンチ拡大中の単指パンはスワイプにしない", async () => {
	const h = mount();
	h.visualViewport.scale = 2;
	// 閉 → 右パン: 開かない。
	swipe(h, h.el("msg"), [10, 300], [200, 300]);
	// 右パネル展開中の左端起点の右パン: 畳まない。
	h.setRightExpanded(true);
	swipe(h, h.el("msg"), [0, 300], [200, 300]);
	assert.deepEqual(h.calls, { toggleSidebar: 0, toggleExpanded: 0 });
	h.setRightExpanded(false);
	// 開 → 左パン: 閉じない。
	await open(h);
	swipe(h, h.el("msg"), [300, 300], [100, 300]);
	assert.equal(h.calls.toggleSidebar, 1);
	// 等倍で始め、終了時に拡大していたら（ピンチへ移行）破棄する。
	h.visualViewport.scale = 1;
	const t = (x) => new h.window.Touch({ identifier: 1, target: h.el("msg"), clientX: x, clientY: 300 });
	h.el("msg").dispatchEvent(new h.window.TouchEvent("touchstart", { bubbles: true, touches: [t(300)], changedTouches: [t(300)] }));
	h.visualViewport.scale = 1.5;
	h.el("msg").dispatchEvent(new h.window.TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [t(100)] }));
	assert.equal(h.calls.toggleSidebar, 1);
	// 拡大中に始まり、終了時には等倍へ戻っていた操作（ピンチアウトの終わり）も破棄する。
	h.visualViewport.scale = 2;
	h.el("msg").dispatchEvent(new h.window.TouchEvent("touchstart", { bubbles: true, touches: [t(300)], changedTouches: [t(300)] }));
	h.visualViewport.scale = 1;
	h.el("msg").dispatchEvent(new h.window.TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [t(100)] }));
	assert.equal(h.calls.toggleSidebar, 1);
	// 等倍へ戻れば従来どおり（左スワイプで閉じる）。
	h.visualViewport.scale = 1;
	swipe(h, h.el("msg"), [300, 300], [100, 300]);
	assert.equal(h.calls.toggleSidebar, 2);
	h.close();
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

// ---- §4.4 セッション行（T309） ----

/** DSH 0.2.0-rc.2 の SessionNodeItem と同じ子の順序の行を sidebarCol に置く（slot, title, time, pin?, rowActions）。 */
const addSessionRow = (h, { id = "s1", pinned = false, blank = false } = {}) => {
	const row = h.document.createElement("div");
	row.setAttribute("data-row-key", `session:${id}`);
	row.setAttribute("role", "treeitem");
	row.className = "R_sessionRow";
	row.innerHTML = blank
		? '<span class="R_slot"></span><span class="R_title">New</span>'
		: `<span class="R_slot"></span><span class="R_title">t</span><span class="R_time">1m</span>${pinned ? '<span class="R_pin" role="img"></span>' : ""}<span class="R_rowActions"><button type="button" aria-label="actions">…</button></span>`;
	h.el("side").append(row);
	return row;
};
/** DSH の行 CSS（ハッシュ化クラス）の hover 切替を模した規則。 */
const addRowCss = (h) => {
	const s = h.document.createElement("style");
	s.textContent = ".R_rowActions{display:none}.R_sessionRow:hover .R_rowActions{display:inline-flex}.R_sessionRow:hover .R_time,.R_sessionRow:hover .R_pin{display:none}.R_pin{display:inline-flex}";
	h.document.head.append(s);
};

test("[§4.4 RowStableUnderHover] COARSE ではセッション行の「…」を常時表示し、hover で時刻・ピンの表示を変えない（T309-A）", async () => {
	// happy-dom は (pointer:coarse) と :has(...) の組合せを評価できないため（20.x で確認）、注入 CSS の構造で検査する。
	const h = mount();
	const css = h.document.querySelector("style[data-plugin=dsh-mobile-ui]").textContent;
	const coarseBlock = /@media \(max-width:1023px\) and \(pointer:coarse\)\{([^@]*)\}/g;
	const blocks = [...css.matchAll(coarseBlock)].map((m) => m[1]).join("\n");
	assert.match(blocks, /\[data-row-key\^="session:"\]\[role=treeitem\]>:last-child:has\(button\)\{display:inline-flex !important;\}/);
	assert.match(blocks, /\[data-row-key\^="session:"\]\[role=treeitem\]>:nth-child\(n\+3\):not\(:last-child\):not\(\[role=img\]\)\{display:inline !important;\}/);
	assert.match(blocks, /\[data-row-key\^="session:"\]\[role=treeitem\]>\[role=img\]\{display:inline-flex !important;\}/);
	// ハッシュ化クラス名（DSH の YDXeBa_ 等）や [class*=] には依存しない（spec §3）。
	assert.doesNotMatch(css, /class\*=|YDXeBa_/);
	h.close();
	// セレクタが実際の行の形（子の順序）で意図した子に当たることを、media を外した規則で確かめる。
	const t = mount();
	addRowCss(t);
	const rule = [...css.matchAll(coarseBlock)].map((m) => m[1]).find((b) => b.includes("data-row-key"));
	const s = t.document.createElement("style");
	s.textContent = rule.replace(":has(button)", "");
	t.document.head.append(s);
	const row = addSessionRow(t, { pinned: true });
	const [, title, time, pin, actions] = row.children;
	const display = (el) => t.window.getComputedStyle(el).display;
	assert.equal(display(actions), "inline-flex", "「…」");
	assert.equal(display(time), "inline", "時刻");
	assert.equal(display(pin), "inline-flex", "ピン");
	assert.notEqual(display(title), "none", "タイトルは触らない");
	t.close();
});

test("[§4.4 NoRenameOnDoubleTap] COARSE ではセッション行の dblclick を本体へ届けない（T309）", async () => {
	const h = mount();
	const row = addSessionRow(h);
	let renamed = 0;
	// DSH の onDoubleClick は #root の React 委譲リスナー（bubble）で受ける。
	h.el("root").addEventListener("dblclick", () => { renamed++; });
	row.children[1].dispatchEvent(new h.window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
	assert.equal(renamed, 0);
	// 行の外の dblclick（チャット本文の単語選択など）には触らない。
	h.el("msg").dispatchEvent(new h.window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
	assert.equal(renamed, 1);
	h.close();
	// fine pointer（デスクトップ）では従来どおり改名できる。
	const d = mount({ coarse: false });
	const drow = addSessionRow(d);
	let drenamed = 0;
	d.el("root").addEventListener("dblclick", () => { drenamed++; });
	drow.children[1].dispatchEvent(new d.window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
	assert.equal(drenamed, 1);
	d.close();
});

test("[§4.4 CloseOnSessionSwitch] PHONE でドロワーが開いているとき、表示中のセッションが変わったら閉じる（T309-C）", async () => {
	const h = mount();
	h.setMainSessions(["a"]);
	await open(h);
	assert.equal(h.calls.toggleSidebar, 1);
	// 一覧の他の更新（表示中は同じ）では閉じない。
	h.setMainSessions(["a"], ["b"]);
	assert.equal(h.calls.toggleSidebar, 1);
	// replaceMain: 新参照の retain（一瞬 2 件）→ 旧参照の release。閉じるのは 1 回だけ。
	h.setMainSessions(["a", "b"]);
	await h.flush();
	assert.equal(h.calls.toggleSidebar, 2);
	assert.equal(h.document.body.dataset.dshMobileSidebar, "closed");
	h.setMainSessions(["b"]);
	assert.equal(h.calls.toggleSidebar, 2);
	// 閉じているときに切り替わっても開かない（toggle を呼ばない）。
	h.setMainSessions(["c"]);
	assert.equal(h.calls.toggleSidebar, 2);
	h.close();
	// DSH の実装どおり、閉が再描画で後から DOM に反映される場合: 反映前に a→b→c と続けて切り替わっても、
	// 2 回目のトグルで開き直さない（独立レビューの指摘）。
	const a = mount();
	a.setMainSessions(["a"]);
	await open(a);
	const sync = a.ctx.layout.toggleSidebar.bind(a.ctx.layout);
	a.ctx.layout.toggleSidebar = () => { a.calls.toggleSidebar++; setTimeout(sync, 5); };
	a.setMainSessions(["a", "b"]);
	a.setMainSessions(["b"]);
	a.setMainSessions(["b", "c"]);
	await new Promise((r) => setTimeout(r, 20));
	assert.equal(a.calls.toggleSidebar, 3, "open 1 回 + 閉 1 回（偽装の sync 呼出も数える）");
	assert.equal(a.document.body.dataset.dshMobileSidebar, "closed");
	a.close();
	// PHONE でなければ（768–1023px は DSH 本体の挙動に任せる）閉じない。
	const w = mount({ width: 900 });
	w.setMainSessions(["a"]);
	w.ctx.layout.toggleSidebar();
	w.setMainSessions(["b"]);
	assert.equal(w.calls.toggleSidebar, 1);
	w.close();
});

test("[§3 OptionalSessions] ctx.sessions が無くても他の機能は動き、dispose で購読を外す（T309-C）", async () => {
	const h = mount({ withSessions: false });
	h.document.querySelector(".dsh-mobile-ui-fab").click();
	await h.flush();
	assert.equal(h.document.body.dataset.dshMobileSidebar, "open");
	h.close();
	const t = mount();
	assert.equal(t.sessionListeners(), 1);
	t.dispose();
	assert.equal(t.sessionListeners(), 0, "dispose で購読解除");
	t.close();
});

// ---- §6.1 入力欄の自動フォーカス（T310） ----

/** DSH 0.2.0-rc.2 の入力カード（[data-composer-card]）と Lexical の入力欄を centerCol に置く。 */
const addComposer = (h) => {
	h.el("center").insertAdjacentHTML("beforeend", '<div data-composer-card id="card"><div id="ed" contenteditable="true" role="textbox" data-composer-input data-lexical-editor="true"></div><button id="send" type="button">send</button></div>');
	return h.el("ed");
};
const pointer = (h, el) => el.dispatchEvent(new h.window.PointerEvent("pointerdown", { bubbles: true }));

test("[§6.1 NoProgrammaticComposerFocus] COARSE では、ユーザー操作の無い入力欄へのフォーカスを次のタスクで外す（T310）", async () => {
	const h = mount();
	const ed = addComposer(h);
	// セッション行のタップで開いた → DSH の InputBar が focus する、の再現。
	pointer(h, h.el("side-btn"));
	ed.focus();
	assert.equal(h.document.activeElement, ed, "同期の blur はしない（再フォーカスとの再帰を避ける）");
	await h.flush();
	assert.notEqual(h.document.activeElement, ed);
	h.close();
	// fine pointer（デスクトップ）ではフォーカスを保つ。
	const d = mount({ coarse: false });
	const ded = addComposer(d);
	ded.focus();
	await d.flush();
	assert.equal(d.document.activeElement, ded);
	d.close();
});

test("[§6.1 UserTapKeepsFocus] 入力欄・入力カードを直近にタップしたときのフォーカスは外さない（T310）", async () => {
	for (const [kind, id] of [["pointerdown", "ed"], ["touchstart", "ed"], ["pointerdown", "send"]]) {
		const h = mount();
		const ed = addComposer(h);
		const target = h.el(id);
		if (kind === "pointerdown") pointer(h, target);
		else touchStart(h, target, [10, 700]);
		ed.focus();
		await h.flush();
		assert.equal(h.document.activeElement, ed, `${kind} on ${id}`);
		h.close();
	}
	// 外付けキーボードの操作の直後（ショートカット等）も外さない。
	const k = mount();
	const ked = addComposer(k);
	k.document.dispatchEvent(new k.window.KeyboardEvent("keydown", { key: "k", metaKey: true }));
	ked.focus();
	await k.flush();
	assert.equal(k.document.activeElement, ked, "keydown");
	k.close();
	// 長押し: 押下の開始から 1.5 秒を超えてフォーカスしても、押下中と押下の終了直後は外さない（独立レビューの指摘）。
	const l = mount();
	const led = addComposer(l);
	const realNow = Date.now;
	try {
		let now = realNow();
		Date.now = () => now;
		pointer(l, led);
		now += 3000;
		led.focus();
		await l.flush();
		assert.equal(l.document.activeElement, led, "押下中");
		led.blur();
		led.dispatchEvent(new l.window.PointerEvent("pointerup", { bubbles: true }));
		now += 1000;
		led.focus();
		await l.flush();
		assert.equal(l.document.activeElement, led, "押下の終了から 1 秒");
	} finally {
		Date.now = realNow;
	}
	l.close();
	// 入力欄をタップした後でも、その後にセッション行を触って開いた場合は外す。
	const r = mount();
	const red = addComposer(r);
	pointer(r, red);
	pointer(r, r.el("side-btn"));
	red.focus();
	await r.flush();
	assert.notEqual(r.document.activeElement, red);
	r.close();
});

test("[§6.1 NoProgrammaticComposerFocus] 期限後・メニュー/ダイアログ内・入力欄以外は対象を正しく分ける（T310）", async () => {
	// 期限（1.5 秒）を過ぎた操作は、ユーザー操作とみなさない。
	const h = mount();
	const ed = addComposer(h);
	const realNow = Date.now;
	try {
		let now = realNow();
		Date.now = () => now;
		pointer(h, ed);
		ed.dispatchEvent(new h.window.PointerEvent("pointerup", { bubbles: true }));
		now += 1501;
		ed.focus();
		await h.flush();
		assert.notEqual(h.document.activeElement, ed, "期限後");
		now += 1;
		pointer(h, ed);
		ed.dispatchEvent(new h.window.PointerEvent("pointerup", { bubbles: true }));
		now += 1500;
		ed.focus();
		await h.flush();
		assert.equal(h.document.activeElement, ed, "期限ちょうど");
	} finally {
		Date.now = realNow;
	}
	h.close();
	// dispose 後は、予約済みの blur も実行しない（独立レビューの指摘）。
	const z = mount();
	const zed = addComposer(z);
	zed.focus();
	z.dispose();
	await z.flush();
	assert.equal(z.document.activeElement, zed, "dispose 後");
	z.close();
	// ダイアログ内の入力欄（改名など）と、入力欄以外（textarea）には触らない。
	const t = mount();
	t.el("center").insertAdjacentHTML("beforeend", '<div role="dialog"><div id="dlg" contenteditable="true" data-composer-input></div></div>');
	t.el("dlg").focus();
	t.el("ta").focus();
	await t.flush();
	assert.equal(t.document.activeElement, t.el("ta"));
	t.el("dlg").focus();
	await t.flush();
	assert.equal(t.document.activeElement, t.el("dlg"), "dialog 内");
	t.close();
});

// ---- §6.2 Enter で改行（T344） ----

/**
 * 入力欄を置き、Lexical の代わりに keydown（送信）と beforeinput（改行）を数える。
 * happy-dom の InputEvent は getTargetRanges を持たないので、iOS Safari と同じく持つように補う（ranges=true）。
 */
const mountComposer = ({ ranges = true, ...opt } = {}) => {
	const h = mount(opt);
	// happy-dom はクラスを Window 間で共有しうるため、prototype は書き換えず、この window にだけ派生クラスを置く。
	if (ranges) h.window.InputEvent = class extends h.window.InputEvent { getTargetRanges() { return []; } };
	const ed = addComposer(h);
	const seen = { submit: 0, lineBreak: 0 };
	// Lexical は root（入力欄）に keydown / beforeinput を登録する（target 段階）。
	ed.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) seen.submit++; });
	ed.addEventListener("beforeinput", (e) => { if (e.inputType === "insertLineBreak") seen.lineBreak++; });
	const enter = (init = {}, el = ed) => {
		const ev = new h.window.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true, ...init });
		el.dispatchEvent(ev);
		return ev;
	};
	return { h, ed, seen, enter };
};

test("[§6.2 EnterInsertsLineBreak] COARSE の入力欄で修飾なしの Enter は送信せず、beforeinput insertLineBreak を送る（T344）", async () => {
	const { h, seen, enter } = mountComposer();
	const ev = enter();
	assert.equal(ev.defaultPrevented, true);
	assert.deepEqual(seen, { submit: 0, lineBreak: 1 });
	h.close();
	// fine pointer（デスクトップ）では DSH のまま（Enter で送信）。
	const d = mountComposer({ coarse: false });
	d.enter();
	assert.deepEqual(d.seen, { submit: 1, lineBreak: 0 });
	d.h.close();
});

test("[§6.2 EnterInsertsLineBreak] IME 変換中・修飾キー・候補選択中・入力欄外・dialog 内では触らない（T344）", async () => {
	const { h, ed, seen, enter } = mountComposer();
	enter({ isComposing: true });
	enter({ keyCode: 229 });
	ed.setAttribute("data-composer-composing", "");
	enter();
	ed.removeAttribute("data-composer-composing");
	assert.deepEqual(seen, { submit: 3, lineBreak: 0 }, "変換中（Lexical / DSH が自分で判定する）");
	for (const mod of ["shiftKey", "ctrlKey", "metaKey", "altKey"]) enter({ [mod]: true });
	assert.equal(seen.lineBreak, 0, "修飾キー付き");
	// 入力補完の候補が強調されている間は、Enter で候補を確定させる。
	const list = h.document.createElement("div");
	list.setAttribute("role", "listbox");
	list.setAttribute("aria-activedescendant", "opt-1");
	h.document.body.append(list);
	enter();
	list.remove();
	assert.equal(seen.lineBreak, 0, "候補選択中");
	// 入力欄の外（textarea）と dialog 内の入力欄。
	const ev = enter({}, h.el("ta"));
	assert.equal(ev.defaultPrevented, false);
	h.el("center").insertAdjacentHTML("beforeend", '<div role="dialog"><div id="dlg" contenteditable="true" data-composer-input></div></div>');
	assert.equal(enter({}, h.el("dlg")).defaultPrevented, false);
	// 前面の UI が処理済みの Enter。
	const handled = new h.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
	handled.preventDefault();
	ed.dispatchEvent(handled);
	assert.equal(seen.lineBreak, 0);
	// 条件が外れた後は改行になる（検査が効いていることの確認）。
	enter();
	assert.equal(seen.lineBreak, 1);
	// compositionend 直後（10ms 以内）の確定 Enter は、属性・フラグが消えていても本体へ渡す（独立レビューの指摘）。
	const realNow = Date.now;
	try {
		let now = realNow();
		Date.now = () => now;
		ed.dispatchEvent(new h.window.CompositionEvent("compositionend", { bubbles: true }));
		now += 10;
		enter();
		assert.equal(seen.lineBreak, 1, "確定直後（前の改行 1 回のまま）");
		now += 1;
		enter();
		assert.equal(seen.lineBreak, 2, "猶予の後は改行");
	} finally {
		Date.now = realNow;
	}
	h.close();
});

test("[§6.2 EnterNewlineOptOut] localStorage の dsh-mobile-ui:enterNewline='0' と、beforeinput 非対応環境では従来どおり送信する（T344）", async () => {
	const { h, seen, enter } = mountComposer();
	h.window.localStorage.setItem("dsh-mobile-ui:enterNewline", "0");
	enter();
	assert.deepEqual(seen, { submit: 1, lineBreak: 0 });
	h.window.localStorage.setItem("dsh-mobile-ui:enterNewline", "1");
	enter();
	assert.deepEqual(seen, { submit: 1, lineBreak: 1 }, "'0' 以外は有効（再読込なしで反映）");
	h.close();
	// InputEvent に getTargetRanges が無い環境では、Lexical が beforeinput を処理しないので奪わない。
	const n = mountComposer({ ranges: false });
	n.enter();
	assert.deepEqual(n.seen, { submit: 1, lineBreak: 0 });
	n.h.close();
	// dispose 後は触らない。
	const z = mountComposer();
	z.h.dispose();
	z.enter();
	assert.deepEqual(z.seen, { submit: 1, lineBreak: 0 });
	z.h.close();
});
