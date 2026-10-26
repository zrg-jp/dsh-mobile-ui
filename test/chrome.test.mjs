// docs/spec.md の §4.4（FAB とヘッダ・右パネル）を検査する。
// 見出しの [§n] は spec の節番号。client.test.mjs と分けるのは、並行ブランチとの競合を減らすため。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mount, touchStart } from "./harness.mjs";

const cssOf = (h) => h.document.querySelector("style[data-plugin=dsh-mobile-ui]").textContent;
const fabOf = (h) => h.document.querySelector(".dsh-mobile-ui-fab");

// ---- §4.4 FAB とヘッダ（issue #12）----

test("[§4.4 FabClearsHeader] PHONE で閉の frame に --dsh-frame-leading-clearance を与え、開では与えない", async () => {
	const h = mount();
	await h.flush();
	const value = () => h.window.getComputedStyle(h.el("frame")).getPropertyValue("--dsh-frame-leading-clearance").trim();
	assert.equal(value(), "calc(56px + env(safe-area-inset-left))");
	// 子孫（会話ヘッダの titleRow）への継承は CSS の仕様による。happy-dom 20.14.6 はカスタムプロパティを
	// 継承しないため検査しない（実機で確認する）。
	h.ctx.layout.toggleSidebar();
	await h.flush();
	assert.equal(value(), "", "開（ドロワー表示中は FAB が無い）では与えない");
	h.close();
	// PHONE 外（768px 以上）では DSH の既定（darwin 以外は未定義）に任せる。
	const t = mount({ width: 900 });
	assert.equal(t.window.getComputedStyle(t.el("frame")).getPropertyValue("--dsh-frame-leading-clearance").trim(), "");
	t.close();
});

test("[§4.4 FabClearsHeader] PWA では #root が inset 分の padding を持つので inset を足さない", async () => {
	const h = mount({ displayMode: "standalone" });
	const css = cssOf(h);
	// happy-dom は display-mode を CSS のカスケードで評価しないため、規則の構造で検査する。
	assert.match(css, /@media \(max-width:767px\) and \(display-mode:standalone\),\(max-width:767px\) and \(display-mode:fullscreen\)\{\[data-sidebar-collapsed\]:has\(> \[data-rightbar-col\]\)\{--dsh-frame-leading-clearance:56px;\}\}/);
	h.close();
});

test("[§4.4 FabHiddenWhileRightPanel] 右パネル展開中は body[data-dsh-mobile-right=open] になり FAB を隠す", async () => {
	const h = mount();
	await h.flush();
	assert.equal(h.document.body.dataset.dshMobileRight, "closed");
	assert.equal(h.window.getComputedStyle(fabOf(h)).display, "flex");
	h.setRightPanel(true);
	await h.flush();
	assert.equal(h.document.body.dataset.dshMobileRight, "open");
	assert.equal(h.window.getComputedStyle(fabOf(h)).display, "none");
	// 畳むと戻る。
	h.setRightPanel(false);
	await h.flush();
	assert.equal(h.document.body.dataset.dshMobileRight, "closed");
	assert.equal(h.window.getComputedStyle(fabOf(h)).display, "flex");
	h.close();
});

test("[§4.4 FabHiddenWhileRightPanel] 判定は isExpanded()。背景の隠れたパネルの属性だけでは隠さない", async () => {
	const h = mount();
	await h.flush();
	// 公開サービスは畳まれていると言うが、DOM には別セッションの開いたパネル（hidden の中）がある。
	const bg = h.document.createElement("div");
	bg.hidden = true;
	bg.innerHTML = "<div data-sidebar-right-open></div>";
	h.el("right").append(bg);
	await h.flush();
	assert.equal(h.document.body.dataset.dshMobileRight, "closed");
	// 起動時に展開済みでも同期する。
	const t = mount({ rightExpanded: true });
	t.setRightExpanded(true);
	t.el("right").setAttribute("data-x", "");
	t.setRightPanel(true);
	await t.flush();
	assert.equal(t.document.body.dataset.dshMobileRight, "open");
	t.dispose();
	assert.equal(t.document.body.dataset.dshMobileRight, undefined, "dispose で外す");
	t.close();
	h.close();
});

test("[§4.4] 右パネル展開中も左端からの右スワイプで畳める（FAB を隠した後の戻り道）", async () => {
	const h = mount();
	h.setRightPanel(true);
	await h.flush();
	touchStart(h, h.el("right"), [0, 300]).end([120, 300]);
	assert.equal(h.calls.toggleExpanded, 1);
	h.close();
});
