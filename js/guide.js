/* 首件作品的新手引导：目标 → 可供性 → 尝试 → 反馈 */
(function () {
  "use strict";

  const STEPS = [
    { key: "upload", anchor: ".sample-grid", text: "选一张示例图开始。橘猫的色块大、颜色少，第一次拼最顺手。" },
    { key: "crop", anchor: "#ratio-row", text: "拖动照片调整构图，双指可以缩放。比例会跟着钉板走。" },
    { key: "params", anchor: "#btn-generate", text: "第一件先用单板 29 × 29。点「生成图纸」，大约一秒就能看到豆图。" },
    { key: "preview", anchor: "#btn-start-making", text: "每一格都标好了目标色号，跟着填就不会错。开始吧。" },
    { key: "maker-pick", anchor: "#chips", text: "先点一个色号，再点按空格。放错颜色的豆子会弹回来，不会浪费。", pos: "top" },
    { key: "maker-swipe", anchor: "#board-canvas", text: "按住滑过同色区域，就能连续放豆。一次滑一整片，很有成就感。", pos: "top" },
    { key: "maker-find", anchor: "#btn-find", text: "找不到下一颗？点「找豆」，画面会自动带你去最近的未完成区域。", pos: "top" },
    { key: "finish", anchor: "#materials", text: "这里是材料清单：每种色号要多少颗、建议买多少，都能直接照着准备。" }
  ];

  const root = () => document.getElementById("guide-root");
  let active = false;
  let currentKey = null;
  let dismissed = new Set();
  let ring = null;
  let card = null;

  function stepIndex(key) {
    return STEPS.findIndex(s => s.key === key);
  }

  function cleanup() {
    const r = root();
    if (r) r.innerHTML = "";
    ring = null;
    card = null;
  }

  function placeRing(anchor) {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    ring = document.createElement("div");
    ring.className = "guide-ring";
    const pad = 5;
    ring.style.left = (rect.left - pad) + "px";
    ring.style.top = (rect.top - pad) + "px";
    ring.style.width = (rect.width + pad * 2) + "px";
    ring.style.height = (rect.height + pad * 2) + "px";
    root().appendChild(ring);
  }

  function placeCard(text, idx, top) {
    card = document.createElement("div");
    card.className = "guide-card" + (top ? " top" : "");
    card.innerHTML =
      `<div class="guide-top"><span class="guide-step">第 ${idx + 1} / ${STEPS.length} 步</span>` +
      `<button class="guide-skip" type="button">跳过引导</button></div>` +
      `<p>${text}</p>` +
      `<div class="guide-actions"><button class="guide-next" type="button">知道啦</button></div>`;
    card.querySelector(".guide-skip").addEventListener("click", () => Guide.skip());
    card.querySelector(".guide-next").addEventListener("click", () => Guide.dismiss());
    root().appendChild(card);
  }

  const Guide = {
    start() {
      active = true;
      currentKey = null;
      dismissed = new Set();
      cleanup();
    },

    isActive() { return active; },

    show(key) {
      if (!active || dismissed.has(key)) {
        if (!active) cleanup();
        return;
      }
      const idx = stepIndex(key);
      if (idx < 0) return;
      currentKey = key;
      cleanup();
      const step = STEPS[idx];
      const anchor = document.querySelector(step.anchor);
      placeRing(anchor);
      let top = step.pos === "top";
      if (anchor) {
        const r = anchor.getBoundingClientRect();
        if (r.top + r.height / 2 > window.innerHeight * 0.55) top = true;
      }
      placeCard(step.text, idx, top);
      window.addEventListener("resize", Guide.reposition, { passive: true });
    },

    reposition() {
      if (!active || !currentKey) return;
      if (dismissed.has(currentKey)) return;
      const idx = stepIndex(currentKey);
      if (idx < 0) return;
      const anchor = document.querySelector(STEPS[idx].anchor);
      if (ring) ring.remove();
      if (card) card.remove();
      const step = STEPS[idx];
      placeRing(anchor);
      let top = step.pos === "top";
      if (anchor) {
        const r = anchor.getBoundingClientRect();
        if (r.top + r.height / 2 > window.innerHeight * 0.55) top = true;
      }
      placeCard(step.text, idx, top);
    },

    dismiss() {
      if (card) card.remove();
      if (ring) ring.remove();
      if (currentKey) dismissed.add(currentKey);
      card = null;
      ring = null;
    },

    done(key) {
      if (!active || currentKey !== key) return;
      dismissed.add(key);
      const next = STEPS[stepIndex(key) + 1];
      if (next) {
        currentKey = null;
        cleanup();
      } else {
        Guide.finish();
      }
    },

    skip() {
      active = false;
      currentKey = null;
      cleanup();
      window.Store.setSettings({ onboarded: true, guideSkipped: true });
      if (window.App && App.toast) App.toast("随时可以在「怎么玩」里再看玩法");
    },

    finish() {
      active = false;
      currentKey = null;
      cleanup();
      window.Store.setSettings({ onboarded: true });
    }
  };

  window.Guide = Guide;
})();
