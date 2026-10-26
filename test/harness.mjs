// lib/client.js を happy-dom 上で読み込み、DSH の ModuleLoader / ctx を最小限で偽装する試験用ハーネス。
// 方式の比較は docs/adr/20261024-0410-dsh-mobile-ui-test-harness.md を参照（ADR-20261024-0410）。
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

// DSH_MOBILE_UI_CLIENT: 変異テスト（壊した版で赤になるかの確認）用に読込元を差し替える。
const source = readFileSync(process.env.DSH_MOBILE_UI_CLIENT ?? new URL("../lib/client.js", import.meta.url), "utf8");

/**
 * DSH AppFrame の DOM 形（frame > sidebarCol, centerCol, rightbarCol）を再現する。
 * 実物は 0.2.0-rc.2 の ui-layout AppFrame（docs/spec.md §3）。
 */
const FRAME_HTML = `<div id="root"><div id="frame" data-sidebar-collapsed>
<div id="side"><button id="side-btn">s</button></div>
<div id="center"><p id="msg">hello</p><div id="hscroll" style="overflow-x:auto;width:100px"><div style="width:400px">wide</div></div><textarea id="ta"></textarea></div>
<div data-rightbar-col id="right"></div>
<div data-side="sidebar" id="handle"></div>
</div></div>`;

/**
 * @param {object} opt
 * @param {number} [opt.width=390] innerWidth
 * @param {boolean} [opt.coarse=true] (pointer:coarse) の真偽
 * @param {boolean} [opt.withFrame=true] AppFrame を描画するか
 * @param {boolean} [opt.reducedMotion=false] prefers-reduced-motion:reduce を CSS の media で一致させるか
 */
export function mount({ width = 390, height = 800, coarse = true, withFrame = true, reducedMotion = false, viewport = "width=device-width, initial-scale=1", scale = 1 } = {}) {
	// prefers-reduced-motion は happy-dom の device 設定で CSS のカスケードに反映される（20.14.6 で確認）。
	const window = new Window({ width, height, url: "http://localhost/", settings: { device: { prefersReducedMotion: reducedMotion ? "reduce" : "no-preference" } } });
	const document = window.document;
	// viewport: 起動前の meta content（既定は DSH 0.2.0-rc.2 の dist/index.html と同じ値）。null なら content 属性なし。
	const metaAttr = viewport === null ? "" : ` content="${viewport}"`;
	document.write(`<!doctype html><html><head><meta name="viewport"${metaAttr}></head><body>${withFrame ? FRAME_HTML : '<div id="root"></div>'}</body></html>`);

	// happy-dom の matchMedia は pointer 特性を評価しないため、幅と coarse を明示的に解く置換を入れる。
	const media = new Map();
	const state = { width, coarse };
	const evaluate = (q) => {
		const max = /max-width:\s*(\d+)px/.exec(q);
		if (max && !(state.width <= Number(max[1]))) return false;
		if (q.includes("pointer:coarse") && !state.coarse) return false;
		return true;
	};
	window.matchMedia = (q) => {
		if (!media.has(q)) {
			const listeners = new Set();
			media.set(q, {
				get matches() { return evaluate(q); },
				media: q,
				addEventListener: (_t, f) => listeners.add(f),
				removeEventListener: (_t, f) => listeners.delete(f),
				listeners
			});
		}
		return media.get(q);
	};
	// 実ブラウザと同じく、matches が実際に変わった media だけに change を通知する。
	const setViewport = (next) => {
		const before = new Map([...media].map(([q, m]) => [q, m.matches]));
		Object.assign(state, next);
		if (next.width !== undefined) window.happyDOM.setViewport({ width: next.width });
		for (const [q, m] of media) if (m.matches !== before.get(q)) for (const f of m.listeners) f({ matches: m.matches });
	};

	// visualViewport は happy-dom に無いので、resize を発火できる簡易版を置く。
	const vvTarget = new window.EventTarget();
	// scale はピンチズームの倍率（KI-2）。
	const visualViewport = Object.assign(vvTarget, { height, offsetTop: 0, scale });
	window.visualViewport = visualViewport;

	// プラグイン適用前に window の resize を数える（KI-10: 起動時に送らないことの検査に要る）。
	let windowResizes = 0;
	window.addEventListener("resize", () => { windowResizes++; });

	// 公開サービスの偽装: toggleSidebar は AppFrame の data-sidebar-collapsed を反転する
	// （<1024px の narrowExpanded 反転に相当）。呼出回数も記録する。
	const calls = { toggleSidebar: 0, toggleExpanded: 0 };
	let rightExpanded = false;
	const ctx = {
		layout: {
			toggleSidebar() {
				calls.toggleSidebar++;
				const frame = document.getElementById("frame");
				if (frame === null) return;
				if (frame.hasAttribute("data-sidebar-collapsed")) frame.removeAttribute("data-sidebar-collapsed");
				else frame.setAttribute("data-sidebar-collapsed", "");
			}
		},
		sidebarRight: {
			isExpanded: () => rightExpanded,
			toggleExpanded() { calls.toggleExpanded++; rightExpanded = !rightExpanded; }
		},
		effects: [],
		effect(fn) { this.effects.push(fn()); }
	};

	let plugin = null;
	window.__ModuleLoader__ = { load: ({ factory }) => { plugin = factory(() => { throw new Error("require unused"); }); } };
	// client.js は window のグローバル名を素で参照するため、必要なものを引数として束縛して評価する。
	const globals = ["window", "document", "getComputedStyle", "MutationObserver", "Node", "Element"];
	new Function(...globals, source)(window, document, window.getComputedStyle.bind(window), window.MutationObserver, window.Node, window.Element);
	plugin.apply(ctx);

	const flush = () => new Promise((r) => setTimeout(r, 0));
	const dispose = () => { for (const d of ctx.effects.splice(0)) d?.(); };
	return {
		window, document, ctx, calls, flush, dispose, setViewport, visualViewport,
		resizeCount: () => windowResizes,
		setRightExpanded: (v) => { rightExpanded = v; },
		// DSH の Modal 相当（createPortal(..., document.body) される全画面の前面レイヤ）を body 直下に足し、
		// その中の要素（タッチの起点）を返す。
		addPortal: () => {
			const layer = document.createElement("div");
			layer.setAttribute("role", "dialog");
			layer.setAttribute("aria-modal", "true");
			layer.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;";
			layer.innerHTML = "<p>modal</p>";
			document.body.append(layer);
			return layer.firstElementChild;
		},
		el: (id) => document.getElementById(id),
		close: () => { dispose(); window.happyDOM.close(); }
	};
}

/** 単指の touchstart を target から発火する。終了は返り値の end(to) で発火する（途中に操作を挟む検査用）。 */
export function touchStart(h, target, from) {
	const { window } = h;
	const mk = (x, y) => new window.Touch({ identifier: 1, target, clientX: x, clientY: y });
	const start = mk(from[0], from[1]);
	target.dispatchEvent(new window.TouchEvent("touchstart", { bubbles: true, touches: [start], changedTouches: [start] }));
	return {
		end(to) {
			const end = mk(to[0], to[1]);
			target.dispatchEvent(new window.TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [end] }));
		}
	};
}

/** 単指の touchstart → touchend を target から発火する。 */
export function swipe(h, target, from, to) {
	touchStart(h, target, from).end(to);
}
