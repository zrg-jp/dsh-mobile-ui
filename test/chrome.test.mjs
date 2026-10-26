// docs/spec.md の §4.5（FAB とヘッダ・右パネル）、§6（セーフエリアの実測）、§5.3（ターミナルのタッチ）を検査する。
// 見出しの [§n] は spec の節番号。client.test.mjs と分けるのは、並行ブランチとの競合を減らすため。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mount, touchStart } from "./harness.mjs";

const cssOf = (h) => h.document.querySelector("style[data-plugin=dsh-mobile-ui]").textContent;
const fabOf = (h) => h.document.querySelector(".dsh-mobile-ui-fab");

// ---- §4.5 FAB とヘッダ（issue #12）----

test("[§4.5 FabClearsHeader] PHONE で閉の frame に --dsh-frame-leading-clearance を与え、開では与えない", async () => {
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

test("[§4.5 FabClearsHeader] PWA では #root が inset 分の padding を持つので inset を足さない", async () => {
	const h = mount({ displayMode: "standalone" });
	const css = cssOf(h);
	// happy-dom は display-mode を CSS のカスケードで評価しないため、規則の構造で検査する。
	assert.match(css, /@media \(max-width:767px\) and \(display-mode:standalone\),\(max-width:767px\) and \(display-mode:fullscreen\)\{\[data-sidebar-collapsed\]:has\(> \[data-rightbar-col\]\)\{--dsh-frame-leading-clearance:56px;\}\}/);
	h.close();
});

test("[§4.5 FabHiddenWhileRightPanel] 右パネル展開中は body[data-dsh-mobile-right=open] になり FAB を隠す", async () => {
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

test("[§4.5 FabHiddenWhileRightPanel] 判定は isExpanded()。背景の隠れたパネルの属性だけでは隠さない", async () => {
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

test("[§4.5] 右パネル展開中も左端からの右スワイプで畳める（FAB を隠した後の戻り道）", async () => {
	const h = mount();
	h.setRightPanel(true);
	await h.flush();
	touchStart(h, h.el("right"), [0, 300]).end([120, 300]);
	assert.equal(h.calls.toggleExpanded, 1);
	h.close();
});

// ---- §6 セーフエリアの実測（T347）----

const IPHONE = { width: 390, height: 797, screenSize: [390, 844], standalone: true, displayMode: "standalone", safeInsets: { top: 47, bottom: 34 } };

test("[§6 SafeAreaProbe] probe で 4 辺を測り --dsh-mobile-safe-* に出す。PWA 外では測らない", async () => {
	const h = mount(IPHONE);
	const s = h.document.documentElement.style;
	assert.equal(s.getPropertyValue("--dsh-mobile-safe-top"), "47px");
	assert.equal(s.getPropertyValue("--dsh-mobile-safe-bottom"), "34px");
	assert.equal(s.getPropertyValue("--dsh-mobile-safe-left"), "0px");
	// probe は body 直下に 1 つだけ残り、オーバーレイ補正の対象にならない。
	const probes = h.document.querySelectorAll("[data-dsh-mobile-safe-probe]");
	assert.equal(probes.length, 1);
	await h.flush();
	assert.equal(probes[0].hasAttribute("data-dsh-mobile-overlay"), false);
	h.dispose();
	assert.equal(s.getPropertyValue("--dsh-mobile-safe-top"), "");
	assert.equal(h.document.querySelector("[data-dsh-mobile-safe-probe]"), null);
	h.close();
	const b = mount({ ...IPHONE, displayMode: "browser" });
	assert.equal(b.document.documentElement.style.getPropertyValue("--dsh-mobile-safe-top"), "");
	assert.equal(b.document.documentElement.hasAttribute("data-dsh-mobile-native-gap"), false);
	b.close();
});

test("[§6 NativeGapOptIn] native gap の条件を満たすと detected。padding を消す on はフラグ有効時だけ", async () => {
	const attr = (h) => h.document.documentElement.getAttribute("data-dsh-mobile-native-gap");
	const h = mount(IPHONE);
	assert.equal(attr(h), "detected", "既定（フラグなし）は観測用の印だけ");
	h.close();
	const on = mount({ ...IPHONE, storage: { "dsh-mobile-ui:native-gap": "on" } });
	assert.equal(attr(on), "on");
	// padding-bottom を消す規則は on のときだけ一致する（CSS 構造で検査）。
	assert.match(cssOf(on), /html\[data-dsh-mobile-native-gap=on\] #root\{padding-bottom:0 !important;\}/);
	assert.doesNotMatch(cssOf(on), /native-gap=detected\]/);
	on.close();
});

test("[§6 NativeGapOptIn] 条件の各項（standalone・縦向き・キーボード閉・差 > 8px・下端 inset > 0）", async () => {
	const attr = (h) => h.document.documentElement.getAttribute("data-dsh-mobile-native-gap");
	const cases = [
		[{ standalone: undefined }, null, "navigator.standalone が無い（Android 等）"],
		[{ standalone: false }, null, "Safari のタブ"],
		[{ screenSize: [390, 805] }, null, "差 8px（境界: 超えない）"],
		[{ screenSize: [390, 806] }, "detected", "差 9px"],
		[{ safeInsets: { top: 47, bottom: 0 } }, null, "下端 inset 0（消す padding が無い）"],
		[{ width: 797, height: 390, screenSize: [390, 844] }, null, "横向き（screen は縦の寸法のまま）"]
	];
	for (const [opt, want, why] of cases) {
		const h = mount({ ...IPHONE, ...opt });
		assert.equal(attr(h), want, why);
		h.close();
	}
	// キーボード表示（visualViewport が 100px より大きく縮む）で外れ、閉じると戻る。
	const k = mount(IPHONE);
	k.visualViewport.height = 797 - 101;
	k.visualViewport.dispatchEvent(new k.window.Event("resize"));
	assert.equal(attr(k), null, "キーボード表示中");
	k.visualViewport.height = 797;
	k.visualViewport.dispatchEvent(new k.window.Event("resize"));
	assert.equal(attr(k), "detected");
	k.close();
});

// ---- §5.3 ターミナルのタッチ（T311 / T343）----

/** 単指の touchstart → touchmove* → touchend。moves は [x,y] の列。 */
function drag(h, target, points) {
	const { window } = h;
	const mk = (p) => new window.Touch({ identifier: 1, target, clientX: p[0], clientY: p[1] });
	const [first, ...rest] = points;
	target.dispatchEvent(new window.TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [mk(first)], changedTouches: [mk(first)] }));
	const moves = [];
	for (const p of rest) {
		const ev = new window.TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [mk(p)], changedTouches: [mk(p)] });
		target.dispatchEvent(ev);
		moves.push(ev);
	}
	const last = points[points.length - 1];
	target.dispatchEvent(new window.TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [mk(last)] }));
	return moves;
}
const wheelsOn = (h) => {
	const got = [];
	h.el("xscroll").addEventListener("wheel", (e) => got.push(e.deltaY));
	return got;
};

test("[§5.3 TerminalTapFocuses] ターミナルのタップで helper textarea を同期的に focus する", async () => {
	const h = mount({ terminal: true });
	drag(h, h.el("xrows"), [[100, 100]]);
	assert.equal(h.document.activeElement, h.el("xinput"));
	h.close();
});

test("[§5.3 TerminalTapFocuses] DSH が先に focus 済み（キーボード無し）でも、タップで blur → focus し直す", async () => {
	const h = mount({ terminal: true });
	const input = h.el("xinput");
	// DSH の表示時 effect 相当（ユーザー操作外の focus）。
	input.focus();
	const seen = [];
	input.addEventListener("blur", () => seen.push("blur"));
	input.addEventListener("focus", () => seen.push("focus"));
	drag(h, h.el("xrows"), [[100, 100]]);
	assert.deepEqual(seen, ["blur", "focus"]);
	assert.equal(h.document.activeElement, input);
	// キーボードが出ている（visualViewport が 100px を超えて縮んでいる）ときは閉じさせない。
	seen.length = 0;
	h.visualViewport.height = 800 - 300;
	drag(h, h.el("xrows"), [[100, 100]]);
	assert.deepEqual(seen, []);
	h.close();
});

test("[§5.3] DOM から外れたターミナルの touchmove 登録は次のタッチで解放する", async () => {
	const h = mount({ terminal: true });
	const xterm = h.el("xterm");
	const removed = [];
	const orig = xterm.removeEventListener.bind(xterm);
	xterm.removeEventListener = (type, ...rest) => { removed.push(type); return orig(type, ...rest); };
	drag(h, h.el("xrows"), [[100, 300], [100, 250]]);
	h.el("right").innerHTML = "";
	touchStart(h, h.el("msg"), [100, 100]).end([100, 100]);
	assert.deepEqual(removed, ["touchmove"]);
	h.close();
});

test("[§5.3 TerminalTapFocuses] 読み取り専用・ドラッグ・COARSE 外・ズーム中・ターミナル外では focus しない", async () => {
	const cases = [
		["readOnly", (h) => { h.el("xinput").readOnly = true; }, {}],
		["COARSE 外", () => {}, { coarse: false }],
		["ピンチズーム中", () => {}, { scale: 2 }]
	];
	for (const [why, prep, opt] of cases) {
		const h = mount({ terminal: true, ...opt });
		prep(h);
		drag(h, h.el("xrows"), [[100, 100]]);
		assert.notEqual(h.document.activeElement, h.el("xinput"), why);
		h.close();
	}
	const d = mount({ terminal: true });
	drag(d, d.el("xrows"), [[100, 100], [100, 140]]);
	assert.notEqual(d.document.activeElement, d.el("xinput"), "縦ドラッグ（スクロール）");
	// touchmove が届かなくても、終了点が閾値を超えていればタップではない。
	drag(d, d.el("xrows"), [[100, 100]].concat([]));
	d.el("xinput").blur();
	touchStart(d, d.el("xrows"), [100, 100]).end([100, 120]);
	assert.notEqual(d.document.activeElement, d.el("xinput"), "終了点が離れている");
	touchStart(d, d.el("msg"), [100, 100]).end([100, 100]);
	assert.notEqual(d.document.activeElement, d.el("xinput"), "ターミナル外");
	d.close();
});

test("[§5.3 TerminalDragScrolls] 縦ドラッグを合成 wheel（deltaY = −Δy×0.8、Δy は ±32 でクランプ）に変える", async () => {
	const h = mount({ terminal: true });
	const got = wheelsOn(h);
	// 6px 以内は保留（タップかもしれない）、超えた最初の移動から送る。
	const moves = drag(h, h.el("xrows"), [[100, 300], [100, 296], [100, 280], [100, 200], [100, 190]]);
	assert.deepEqual(got, [16, 32 * 0.8, 8]);
	assert.equal(moves[0].defaultPrevented, false, "閾値内は既定動作を止めない");
	assert.equal(moves[1].defaultPrevented, true, "スクロール中はネイティブのスクロール・パンを止める");
	h.close();
});

test("[§5.3 TerminalDragScrolls] 横優位・2 本指・ズーム中は wheel を送らず、ターミナル外では何もしない", async () => {
	const h = mount({ terminal: true });
	const got = wheelsOn(h);
	const moves = drag(h, h.el("xrows"), [[100, 300], [140, 305], [100, 250]]);
	assert.deepEqual(got, [], "横で始まったら最後まで追わない");
	assert.equal(moves.some((m) => m.defaultPrevented), false);
	h.visualViewport.scale = 2;
	drag(h, h.el("xrows"), [[100, 300], [100, 250]]);
	assert.deepEqual(got, [], "ズーム中");
	// 等倍で始め、途中でピンチ拡大へ移ったら、その時点から送らない。
	h.visualViewport.scale = 1;
	const { window: w } = h;
	const tz = (y) => new w.Touch({ identifier: 1, target: h.el("xrows"), clientX: 100, clientY: y });
	h.el("xrows").dispatchEvent(new w.TouchEvent("touchstart", { bubbles: true, touches: [tz(300)], changedTouches: [tz(300)] }));
	h.visualViewport.scale = 1.5;
	h.el("xrows").dispatchEvent(new w.TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [tz(250)], changedTouches: [tz(250)] }));
	h.visualViewport.scale = 1;
	h.el("xrows").dispatchEvent(new w.TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [tz(200)], changedTouches: [tz(200)] }));
	assert.deepEqual(got, [], "途中でズーム");
	// 2 本目の指が加わった時点で追跡をやめる。
	const { window } = h;
	const t1 = (y) => new window.Touch({ identifier: 1, target: h.el("xrows"), clientX: 100, clientY: y });
	const t2 = new window.Touch({ identifier: 2, target: h.el("xrows"), clientX: 200, clientY: 300 });
	h.el("xrows").dispatchEvent(new window.TouchEvent("touchstart", { bubbles: true, touches: [t1(300)], changedTouches: [t1(300)] }));
	h.el("xrows").dispatchEvent(new window.TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [t1(250), t2], changedTouches: [t1(250)] }));
	h.el("xrows").dispatchEvent(new window.TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [t1(200)], changedTouches: [t1(200)] }));
	assert.deepEqual(got, [], "ピンチ");
	h.close();
});

test("[§5.3] 縦スクロールに使った操作はスワイプにしない。横ドラッグは従来どおりスワイプ判定へ", async () => {
	const h = mount({ terminal: true });
	h.setRightPanel(true);
	await h.flush();
	// 左端から始め、縦にスクロールした後で右へ大きく流れても、右パネルを畳まない。
	drag(h, h.el("xrows"), [[0, 300], [0, 280], [200, 280]]);
	assert.equal(h.calls.toggleExpanded, 0);
	// 横のドラッグ（左端起点の右スワイプ）は §5.2 行 5 のとおり畳む。
	drag(h, h.el("xrows"), [[0, 300], [60, 302], [150, 302]]);
	assert.equal(h.calls.toggleExpanded, 1);
	h.close();
});

test("[§7] dispose でターミナルのリスナーも外す", async () => {
	const h = mount({ terminal: true });
	drag(h, h.el("xrows"), [[100, 300], [100, 250]]);
	h.dispose();
	const got = wheelsOn(h);
	drag(h, h.el("xrows"), [[100, 300], [100, 250]]);
	assert.deepEqual(got, []);
	h.el("xinput").blur();
	drag(h, h.el("xrows"), [[100, 100]]);
	assert.notEqual(h.document.activeElement, h.el("xinput"));
	h.close();
});

test("[§5.3 TerminalInputUntouched] ターミナルの helper textarea のキー・変換イベントには介入しない。input は送り直しだけ（T311）", async () => {
	// xterm 6.0.0 の入力経路（keydown / keypress / input / composition*。sidebar-terminal 0.2.0-rc.2 の client.terminal.js:310）
	// が本プラグインの document capture リスナー（T344 の Enter、T310 の focusin ガード等）で止められないことを検査する。
	// xterm 本体の処理（onData に届くか）は tmp/repro で同梱版を動かして確認した（spec §5.3）。
	const h = mount({ terminal: true });
	const realNow = Date.now;
	try {
	// iOS Safari と同じく InputEvent に getTargetRanges を持たせる（無いと T344 の Enter 処理が最初に抜け、検査にならない）。
	h.window.InputEvent = class extends h.window.InputEvent { getTargetRanges() { return []; } };
	const input = h.el("xinput");
	drag(h, h.el("xrows"), [[100, 100]]);
	assert.equal(h.document.activeElement, input);
	const reached = [];
	const types = ["keydown", "keypress", "keyup", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"];
	// window の bubble 段階で記録する。document の capture・bubble（本プラグインが付ける段階）の後なので、
	// どこかで伝播を止めれば届かず、preventDefault すれば defaultPrevented が立つ（独立レビューの指摘）。
	// input は composed も記録する。COARSE の insertText は §5.3 TerminalInputReachesOnce により、元の（composed:true の）input を止め、
	// composed:false の input を送り直す（xterm 本体を使った検査は test/terminal-input.test.mjs）。
	const onWindow = (e) => { if (e.target === input) reached.push(`${e.type}:${e.defaultPrevented}${e.type === "input" ? `:composed=${e.composed}` : ""}`); };
	for (const type of types) h.window.addEventListener(type, onWindow);
	const W = h.window;
	const fire = (e) => input.dispatchEvent(e);
	const key = (type, init, keyCode) => {
		const e = new W.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
		if (keyCode !== undefined) Object.defineProperty(e, "keyCode", { get: () => keyCode });
		return e;
	};
	// 修飾なしの Enter（T344 が composer で奪う形）、iOS の keyCode 229 / Unidentified、通常の文字。
	fire(key("keydown", { key: "Enter" }, 13));
	fire(key("keydown", { key: "Unidentified" }, 229));
	fire(key("keypress", { key: "a" }, 97));
	fire(key("keyup", { key: "a" }, 65));
	fire(new W.InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "a" }));
	// 実物の input / composition* は cancelable ではないが、preventDefault の呼出しを検出するため cancelable にする。
	fire(new W.InputEvent("input", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: "a" }));
	fire(new W.CompositionEvent("compositionstart", { bubbles: true, cancelable: true }));
	fire(new W.CompositionEvent("compositionupdate", { bubbles: true, cancelable: true, data: "か" }));
	fire(new W.CompositionEvent("compositionend", { bubbles: true, cancelable: true, data: "か" }));
	assert.deepEqual(reached, ["keydown:false", "keydown:false", "keypress:false", "keyup:false", "beforeinput:false", "input:false:composed=false", "compositionstart:false", "compositionupdate:false", "compositionend:false"]);
	// T310 の focusin ガードは composer 限定。ユーザー操作の期限（1.5 秒）外のフォーカスでもターミナルからは外さない。
	const later = realNow() + 60_000;
	Date.now = () => later;
	input.blur();
	input.focus();
	await h.flush();
	assert.equal(h.document.activeElement, input, "focusin ガードが helper textarea を外さない");
	} finally {
		Date.now = realNow;
		h.close();
	}
});
