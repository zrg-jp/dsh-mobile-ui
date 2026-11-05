// docs/spec.md §7 の DisposeRestoresDom / ConditionLossRestores / ForeignWriteKept（T342）を検査する。
// 本プラグインが DSH の要素（html / body / frame / sidebarCol / meta / body 直下）に付けた属性・inline style・inert が、
// dispose と条件の喪失で mount 前の値へ戻ること。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mount } from "./harness.mjs";

const IPHONE = { width: 390, height: 797, screenSize: [390, 844], standalone: true, displayMode: "standalone", safeInsets: { top: 47, bottom: 34 } };

/**
 * 要素の属性集合（名前=値、名前順）と inert。style 属性は宣言の集合として比べる
 * （happy-dom は書き戻しで末尾の `;` を足すので、表記ではなく宣言で比べる）。
 */
const snapshotEl = (el) => {
	if (el === null) return null;
	const attrs = [...el.attributes]
		.filter((a) => a.name !== "style")
		.map((a) => `${a.name}=${a.value}`)
		.sort();
	// inert は属性で見る（本プラグインは属性として読み書きする）。
	const style = el.hasAttribute("style")
		? Array.from({ length: el.style.length }, (_, i) => el.style.item(i)).map((p) => `${p}:${el.style.getPropertyValue(p)}${el.style.getPropertyPriority(p) ? "!" : ""}`).sort()
		: null;
	return { attrs, style, inert: el.hasAttribute("inert") };
};
/** html / body / frame / sidebarCol / meta と、body 直下の各要素（id で特定）。 */
const snapshot = (document) => {
	const out = {
		html: snapshotEl(document.documentElement),
		body: snapshotEl(document.body),
		frame: snapshotEl(document.getElementById("frame")),
		side: snapshotEl(document.getElementById("side")),
		meta: snapshotEl(document.querySelector("meta[name=viewport]")),
		bodyChildren: [...document.body.children].map((el) => [el.id, snapshotEl(el)])
	};
	return JSON.parse(JSON.stringify(out));
};

/** DSH 側が先に持っていた値（本プラグインと同じ要素の別の属性・style、同じ inert）を置く。 */
const preexisting = ({ document }) => {
	const html = document.documentElement;
	html.setAttribute("lang", "ja");
	html.setAttribute("style", "color-scheme: dark; --dsh-other: 3px; --dsh-mobile-vvh: 9px !important; --dsh-mobile-safe-top: 5px");
	// 本プラグインが書くのと同名の属性を、別の値で先に置く（dispose 後にこの値へ戻ること）。
	html.setAttribute("data-dsh-mobile-native-gap", "pre");
	html.setAttribute("data-dsh-mobile-remote", "pre");
	document.body.setAttribute("class", "app");
	document.body.setAttribute("data-dsh-mobile-sidebar", "pre");
	document.body.setAttribute("data-dsh-mobile-right", "pre");
	document.getElementById("side").setAttribute("data-x", "1");
	// body 直下の固定オーバーレイ（DSH のメニュー相当）を mount 前から置く。
	const menu = document.createElement("div");
	menu.id = "menu";
	menu.style.cssText = "position:fixed;top:40px;left:10px;width:100px;height:100px;";
	document.body.append(menu);
};

test("[§7 DisposeRestoresDom] 各状態を作ってから dispose すると、DSH の要素が mount 前と同一に戻る", async () => {
	for (const opt of [{}, IPHONE, { ...IPHONE, storage: { "dsh-mobile-ui:native-gap": "on" } }, { url: "http://mac.tailnet.ts.net/" }, { width: 900 }, { coarse: false, width: 1280 }]) {
		let before = null;
		const h = mount({
			...opt,
			beforeApply: (env) => {
				preexisting(env);
				before = snapshot(env.document);
			}
		});
		await h.flush();
		// 開閉・右パネル・キーボード・回転・COARSE の出入りを一通り通す。
		h.ctx.layout.toggleSidebar();
		await h.flush();
		h.setRightPanel(true);
		await h.flush();
		h.visualViewport.height = 400;
		h.visualViewport.offsetTop = 30;
		h.visualViewport.dispatchEvent(new h.window.Event("resize"));
		h.ctx.layout.toggleSidebar();
		await h.flush();
		h.setRightPanel(false);
		await h.flush();
		h.dispose();
		const after = snapshot(h.document);
		// frame の開閉は偽装の toggleSidebar を 2 回呼んで元の閉へ戻してから、全体を比べる。
		assert.deepEqual(after, before, JSON.stringify(opt));
		h.close();
	}
});

test("[§7 DisposeRestoresDom] DSH が先に付けていた sidebarCol の inert は dispose 後も残る", async () => {
	const h = mount({ beforeApply: ({ document }) => { document.getElementById("side").setAttribute("inert", ""); } });
	await h.flush();
	assert.equal(h.el("side").hasAttribute("inert"), true, "PHONE ∧ 閉");
	h.ctx.layout.toggleSidebar();
	await h.flush();
	h.dispose();
	assert.equal(h.el("side").hasAttribute("inert"), true, "元の inert へ戻す（false にしない）");
	h.close();
});

test("[§7 DisposeRestoresDom] mount 前に空の style 属性があれば残し、無ければ足さない", async () => {
	for (const pre of [null, ""]) {
		const h = mount({
			beforeApply: ({ document }) => {
				if (pre !== null) document.documentElement.setAttribute("style", pre);
			}
		});
		h.visualViewport.height = 500;
		h.visualViewport.dispatchEvent(new h.window.Event("resize"));
		assert.equal(h.document.documentElement.style.getPropertyValue("--dsh-mobile-vvh"), "500px");
		h.dispose();
		assert.equal(h.document.documentElement.getAttribute("style"), pre, JSON.stringify(pre));
		h.close();
	}
});

test("[§7 ConditionLossRestores] PHONE を外れると sidebarCol の inert を元の値へ戻す（DSH の inert を消さない）", async () => {
	const h = mount();
	await h.flush();
	assert.equal(h.el("side").hasAttribute("inert"), true);
	h.setViewport({ width: 900 });
	await h.flush();
	assert.equal(h.el("side").hasAttribute("inert"), false, "元に無ければ外す");
	h.close();
	// DSH が先に inert を付けていた場合、PHONE 外（768px 以上）でもそれを外さない。
	const t = mount({ width: 900, beforeApply: ({ document }) => { document.getElementById("side").setAttribute("inert", ""); } });
	await t.flush();
	assert.equal(t.el("side").hasAttribute("inert"), true, "PHONE 外の起動で DSH の inert を消さない");
	t.setViewport({ width: 390 });
	await t.flush();
	t.ctx.layout.toggleSidebar();
	await t.flush();
	assert.equal(t.el("side").hasAttribute("inert"), true, "PHONE ∧ 開 でも、元の inert は本プラグインの管轄外");
	t.setViewport({ width: 900 });
	await t.flush();
	assert.equal(t.el("side").hasAttribute("inert"), true);
	t.close();
});

test("[§7 ConditionLossRestores] frame が作り直されたら、前の sidebarCol に付けた inert を外す", async () => {
	const h = mount();
	await h.flush();
	const oldSide = h.el("side");
	assert.equal(oldSide.hasAttribute("inert"), true);
	// DSH が AppFrame を描き直した（sidebarCol が別の要素になった）。旧要素は DOM から外れず別の場所へ移る場合もある。
	const fresh = h.document.createElement("div");
	fresh.id = "side2";
	h.el("frame").replaceChild(fresh, oldSide);
	h.document.body.append(oldSide);
	await h.flush();
	assert.equal(fresh.hasAttribute("inert"), true, "新しい sidebarCol を閉時 inert に");
	assert.equal(oldSide.hasAttribute("inert"), false, "旧 sidebarCol から外す");
	h.close();
});

test("[§7 ConditionLossRestores] COARSE を外れると --dsh-mobile-vv* を外し、戻ったら今の値で付け直す（KI-6）", async () => {
	const h = mount();
	const s = h.document.documentElement.style;
	h.visualViewport.height = 500;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(s.getPropertyValue("--dsh-mobile-vvh"), "500px");
	h.setViewport({ coarse: false });
	assert.equal(s.getPropertyValue("--dsh-mobile-vvh"), "");
	assert.equal(s.getPropertyValue("--dsh-mobile-vvtop"), "");
	// fine の間にキーボードが閉じた（resize は COARSE 外なので無視され、変数を付け直さない）。
	h.visualViewport.height = 800;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(s.getPropertyValue("--dsh-mobile-vvh"), "", "COARSE 外の resize で付け直さない");
	// （元の値がある場合は下のテスト。外すのではなく元の値へ戻す。）
	const resizes = h.resizeCount();
	h.setViewport({ coarse: true });
	assert.equal(s.getPropertyValue("--dsh-mobile-vvh"), "800px", "戻った時点の値");
	assert.equal(h.resizeCount(), resizes + 1, "値が前回の再送時から変わったので resize を再送する（KI-10）");
	// 同じ値のまま出入りしても再送しない。
	h.setViewport({ coarse: false });
	h.setViewport({ coarse: true });
	assert.equal(h.resizeCount(), resizes + 1);
	h.close();
});

test("[§7 ConditionLossRestores] COARSE を外れたとき、mount 前に同名の変数があればその値（priority も）へ戻す", async () => {
	const h = mount({ beforeApply: ({ document }) => { document.documentElement.style.setProperty("--dsh-mobile-vvh", "9px", "important"); } });
	const s = h.document.documentElement.style;
	h.visualViewport.height = 500;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	assert.equal(s.getPropertyValue("--dsh-mobile-vvh"), "500px");
	h.setViewport({ coarse: false });
	assert.equal(s.getPropertyValue("--dsh-mobile-vvh"), "9px");
	assert.equal(s.getPropertyPriority("--dsh-mobile-vvh"), "important");
	h.close();
});

test("[§7 ConditionLossRestores] SAFE_AREA を外れると --dsh-mobile-safe-* と native gap の印を外す", async () => {
	const h = mount({ ...IPHONE, beforeApply: ({ document }) => { document.documentElement.setAttribute("style", "--dsh-other: 1px"); } });
	const html = h.document.documentElement;
	assert.equal(html.style.getPropertyValue("--dsh-mobile-safe-top"), "47px");
	assert.equal(html.getAttribute("data-dsh-mobile-native-gap"), "detected");
	h.setViewport({ displayMode: "browser" });
	assert.equal(html.style.getPropertyValue("--dsh-mobile-safe-top"), "");
	assert.equal(html.hasAttribute("data-dsh-mobile-native-gap"), false);
	assert.equal(html.style.getPropertyValue("--dsh-other"), "1px", "他の宣言は残る");
	h.close();
});

test("[§7 ForeignWriteKept] 本プラグインが書いた後に他者が書き換えた値は、dispose で戻さない", async () => {
	// 属性: body[data-dsh-mobile-sidebar] を他者が書き換えたら残す。
	const a = mount();
	await a.flush();
	a.document.body.setAttribute("data-dsh-mobile-sidebar", "foreign");
	a.dispose();
	assert.equal(a.document.body.getAttribute("data-dsh-mobile-sidebar"), "foreign");
	a.close();
	// 他者が style を書いていない要素に後から付けた空の style="" も消さない（本プラグインは style を書いていない）。
	const b = mount();
	await b.flush();
	b.document.body.setAttribute("style", "");
	b.dispose();
	assert.equal(b.document.body.getAttribute("style"), "");
	b.close();
	const h = mount();
	const html = h.document.documentElement;
	h.visualViewport.height = 500;
	h.visualViewport.dispatchEvent(new h.window.Event("resize"));
	html.style.setProperty("--dsh-mobile-vvh", "123px");
	h.dispose();
	assert.equal(html.style.getPropertyValue("--dsh-mobile-vvh"), "123px");
	// 自分が書いたままの値は戻す。
	assert.equal(html.style.getPropertyValue("--dsh-mobile-vvtop"), "");
	h.close();
});
