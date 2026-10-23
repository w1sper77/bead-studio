/* 豆豆工坊 · 页面流程与业务逻辑 */
(function () {
  "use strict";

  const P = window.BeadPalette;
  const IMG = window.BeadImage;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const BOARDS = {
    single: { id: "single", w: 29, h: 29, label: "单板 29 × 29", short: "单板", minutes: 12 },
    "double-v": { id: "double-v", w: 29, h: 58, label: "双板竖 29 × 58", short: "双板竖", minutes: 23 },
    "double-h": { id: "double-h", w: 58, h: 29, label: "双板横 58 × 29", short: "双板横", minutes: 23 },
    quad: { id: "quad", w: 58, h: 58, label: "四板 58 × 58", short: "四板", minutes: 47 }
  };

  const SAMPLE_IMAGES = window.SAMPLE_IMAGES || {};
  const SAMPLES = [
    { name: "橘猫", key: "cat", file: SAMPLE_IMAGES.cat || "assets/samples/cat.png", note: "约 13 色 · 新手推荐" },
    { name: "向日葵", key: "sunflower", file: SAMPLE_IMAGES.sunflower || "assets/samples/sunflower.png", note: "约 10 色 · 明亮" },
    { name: "落日", key: "sunset", file: SAMPLE_IMAGES.sunset || "assets/samples/sunset.png", note: "约 20 色 · 渐变" },
    { name: "草莓", key: "strawberry", file: SAMPLE_IMAGES.strawberry || "assets/samples/strawberry.png", note: "约 9 色 · 可爱" }
  ];

  const S = {
    screen: "home",
    sourceName: "",
    baseSource: null,
    crop: {
      working: null, base: null, ratio: 1, zoom: 1, ox: 0, oy: 0,
      rot: 0, mirror: false, pointers: new Map(), pinch: null, drag: null,
      frame: { x: 0, y: 0, w: 0, h: 0 }, cover: 1, cw: 0, ch: 0
    },
    cropResult: null,
    sourceArt: null,
    params: { board: "single", palette: "std50", dither: false },
    conversion: null,
    work: null,
    board: null,
    filledCount: 0,
    placeTotal: 0,
    swipeCount: 0,
    selectedId: 0,
    sessionStart: 0,
    saveTimer: 0,
    settings: null,
    iron: { raf: 0, start: 0, done: false, particles: [] },
    libraryTab: "doing",
    lastFilledToast: 0,
    lastSkipSound: 0,
    freshWork: false
  };

  const App = window.App = {
    toast, show, go, state: S,
    startMaking, openWork,
    saveWork
  };

  /* ---------------- 通用 UI ---------------- */

  let toastTimer = 0;
  function toast(msg, ms) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), ms || 2000);
  }

  function openModal(html, mount, opts) {
    const root = $("#modal-root");
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal ${opts && opts.className ? opts.className : ""}">${html}</div>`;
    root.appendChild(back);
    const close = () => { if (back.parentNode) back.parentNode.removeChild(back); };
    back.addEventListener("click", e => { if (e.target === back && !(opts && opts.sticky)) close(); });
    if (mount) mount(back.querySelector(".modal"), close);
    return close;
  }

  function confirmDialog(title, message, okText, danger) {
    return new Promise(resolve => {
      const close = openModal(
        `<h3>${title}</h3><p>${message}</p>
         <div class="modal-actions">
           <button class="btn btn-ghost" data-act="cancel">取消</button>
           <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="ok">${okText || "确定"}</button>
         </div>`,
        (box, closeFn) => {
          box.querySelector('[data-act="cancel"]').onclick = () => { closeFn(); resolve(false); };
          box.querySelector('[data-act="ok"]').onclick = () => { closeFn(); resolve(true); };
        }
      );
      void close;
    });
  }

  function promptDialog(title, value, placeholder) {
    return new Promise(resolve => {
      openModal(
        `<h3>${title}</h3>
         <input class="text-input" id="dialog-input" maxlength="24" value="${escapeAttr(value || "")}" placeholder="${escapeAttr(placeholder || "")}">
         <div class="modal-actions">
           <button class="btn btn-ghost" data-act="cancel">取消</button>
           <button class="btn btn-primary" data-act="ok">保存</button>
         </div>`,
        (box, closeFn) => {
          const input = box.querySelector("#dialog-input");
          input.focus();
          input.select();
          const done = ok => { closeFn(); resolve(ok ? input.value : null); };
          box.querySelector('[data-act="cancel"]').onclick = () => done(false);
          box.querySelector('[data-act="ok"]').onclick = () => done(true);
          input.addEventListener("keydown", e => { if (e.key === "Enter") done(true); });
        }
      );
    });
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function navigate(screen) {
    $$(".screen").forEach(s => s.classList.toggle("active", s.id === "screen-" + screen));
    S.screen = screen;
    if (window.Guide) window.Guide.reposition();
  }

  function show(screen) {
    if (window.Guide && Guide.isActive() && S.screen !== screen) Guide.dismiss();
    if (S.screen === "maker" && screen !== "maker") leaveMaker();
    if (S.screen === "iron" && screen !== "iron") stopIron();
    navigate(screen);
    const enter = {
      home: enterHome,
      upload: enterUpload,
      crop: enterCrop,
      params: enterParams,
      preview: enterPreview,
      maker: enterMaker,
      finish: enterFinish,
      library: enterLibrary
    }[screen];
    if (enter) enter();
  }

  function go(screen) { show(screen); }

  /* ---------------- 首页 ---------------- */

  function enterHome() {
    renderHomeSamples();
    renderContinue();
    const works = Store.list();
    const doing = works.filter(w => w.status !== "done").length;
    $("#library-count").textContent = works.length
      ? `${works.length} 件作品${doing ? " · " + doing + " 件进行中" : ""}`
      : "把做了一半的作品接上";
    drawHeroArt();
  }

  function renderHomeSamples() {
    const wrap = $("#home-samples");
    wrap.innerHTML = "";
    SAMPLES.slice(0, 3).forEach(s => {
      const b = document.createElement("button");
      b.className = "sample-card";
      b.innerHTML = `<img src="${s.file}" alt="${s.name}"><b>${s.name}</b><span>${s.note.split(" · ")[0]}</span>`;
      b.addEventListener("click", () => loadSample(s));
      wrap.appendChild(b);
    });
  }

  function renderContinue() {
    const wrap = $("#home-continue");
    const works = Store.list().filter(w => w.status !== "done");
    if (!works.length) {
      wrap.innerHTML = "";
      return;
    }
    const w = works[0];
    const pct = Math.round((w.filledCount / w.total) * 100);
    const div = document.createElement("button");
    div.className = "continue-card";
    div.innerHTML =
      `<img src="${w.thumbnail || w.sourceThumb}" alt="">
       <span class="continue-copy">
         <b>${escapeAttr(w.name)}</b>
         <span>${w.status === "ironing" ? "已完成 · 待熨烫" : `进行中 ${pct}% · ${w.filledCount}/${w.total} 颗`}</span>
         <span class="continue-bar"><i style="width:${pct}%"></i></span>
       </span>
       <span class="continue-go">→</span>`;
    div.addEventListener("click", () => openWork(w));
    wrap.appendChild(div);
  }

  let heroDrawn = false;
  function drawHeroArt() {
    if (heroDrawn) return;
    const canvas = $("#hero-art");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = 420;
    canvas.width = size;
    canvas.height = size;
    const pattern = [
      "..#####..",
      ".#######.",
      "#########",
      "#########",
      "#########",
      ".#######.",
      "..#####..",
      "...###...",
      "....#...."
    ];
    const cols = ["#F6C95B", "#F3A05C", "#EF705A", "#E85E68", "#EF705A", "#F3A05C", "#F6C95B", "#F3D39B"];
    const cell = 38;
    const ox = (size - cell * 9) / 2;
    const oy = (size - cell * 9) / 2 - 4;
    ctx.save();
    ctx.translate(ox, oy);
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        if (pattern[y][x] !== "#") continue;
        const cx = (x + 0.5) * cell;
        const cy = (y + 0.5) * cell;
        const color = cols[(x + y + Math.floor(x / 2)) % cols.length];
        ctx.beginPath();
        ctx.arc(cx, cy, cell * 0.46, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx - cell * 0.08, cy - cell * 0.1, cell * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,.35)";
        ctx.fill();
      }
    }
    ctx.restore();
    // 点缀
    const dots = [[70, 88, 5, "#EF705A"], [356, 150, 4, "#F6C95B"], [330, 330, 6, "#2F9C8A"], [90, 330, 3.5, "#F3A05C"]];
    dots.forEach(([x, y, r, c]) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
    });
    heroDrawn = true;
  }

  function showWelcome() {
    openModal(
      `<h3>第一次拼豆？</h3>
       <p>用一张示例图走完整个流程：<br>裁图 → 生成图纸 → 按号填豆 → 熨烫 → 材料清单。<br><span style="color:#91857a">作品只保存在这台设备，记得导出。</span></p>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-act="skip">自己探索</button>
         <button class="btn btn-primary" data-act="guide">带我走一遍</button>
       </div>`,
      (box, close) => {
        box.querySelector('[data-act="skip"]').onclick = () => {
          close();
          Store.setSettings({ onboarded: true });
          S.settings.onboarded = true;
          show("upload");
        };
        box.querySelector('[data-act="guide"]').onclick = () => {
          close();
          if (window.Guide) Guide.start();
          Store.track("onboarding_step", { step: 0, action: "start" });
          show("upload");
          setTimeout(() => {
            if (window.Guide) Guide.show("upload");
          }, 300);
        };
      },
      { sticky: true }
    );
  }

  /* ---------------- 上传 ---------------- */

  function enterUpload() {
    const grid = $("#upload-samples");
    grid.innerHTML = "";
    SAMPLES.forEach(s => {
      const b = document.createElement("button");
      b.className = "sample-tile";
      b.innerHTML = `<img src="${s.file}" alt="${s.name}"><span>${s.name} · ${s.note}</span>`;
      b.addEventListener("click", () => loadSample(s));
      grid.appendChild(b);
    });
  }

  let sampleCache = {};
  async function loadSample(s) {
    Store.track("upload_start", { source: "sample" });
    try {
      let canvas = sampleCache[s.file];
      if (!canvas) {
        canvas = await IMG.loadUrl(s.file, 1600);
        sampleCache[s.file] = canvas;
      }
      beginCrop(canvas, s.name, s.file);
      Store.track("upload_result", { success: true, source: "sample" });
      if (window.Guide) Guide.done("upload");
    } catch (e) {
      toast("示例图加载失败，请重试");
    }
  }

  $("#file-input").addEventListener("change", async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    Store.track("upload_start", { source: "album" });
    if (file.size > 40 * 1024 * 1024) {
      toast("图片超过 40MB，请先压缩后再试");
      Store.track("upload_result", { success: false, fail_reason: "too_large" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) toast("图片较大，已在本地压缩");
    const btn = $(".upload-drop");
    const label = btn.querySelector("b");
    const prevLabel = label ? label.textContent : "";
    if (label) label.textContent = "正在读取图片…";
    btn.classList.add("loading");
    btn.style.opacity = ".6";
    try {
      const canvas = await IMG.fileToCanvas(file, 1600);
      const name = (file.name || "我的作品").replace(/\.[^.]+$/, "").slice(0, 20);
      beginCrop(canvas, name, file.name);
      Store.track("upload_result", { success: true, source: "album", file_size: file.size });
      if (window.Guide) Guide.done("upload");
    } catch (err) {
      const isHeic = /\.(heic|heif)$/i.test(file.name || "");
      const msg = err && err.message === "UNSUPPORTED"
        ? "不支持这个格式，请选择 JPG / PNG / HEIC / WebP"
        : isHeic
          ? "当前浏览器无法解码 HEIC，请改用 JPG 或 PNG"
          : "图片无法读取，可能已损坏";
      toast(msg, 2600);
      Store.track("upload_result", { success: false, fail_reason: err && err.message });
    } finally {
      btn.style.opacity = "";
      btn.classList.remove("loading");
      if (label) label.textContent = prevLabel;
    }
  });

  /* ---------------- 裁剪 ---------------- */

  function beginCrop(canvas, name, fileName) {
    S.sourceName = name || "我的作品";
    S.baseSource = canvas;
    S.crop.base = canvas;
    S.crop.working = canvas;
    S.crop.rot = 0;
    S.crop.mirror = false;
    S.crop.zoom = 1;
    S.crop.ratio = boardRatio(S.params.board);
    S.cropPointers = new Map();
    syncRatioButtons();
    show("crop");
  }

  function boardRatio(boardId) {
    const b = BOARDS[boardId] || BOARDS.single;
    return b.w / b.h;
  }

  function syncRatioButtons() {
    const r = S.crop.ratio;
    $$("#ratio-row .ratio-pill").forEach(b => {
      const val = parseFloat(b.dataset.ratio);
      b.classList.toggle("active", Math.abs(val - r) < 0.02);
    });
  }

  function enterCrop() {
    const stage = $("#crop-stage");
    const canvas = $("#crop-canvas");
    const rect = stage.getBoundingClientRect();
    S.crop.cw = Math.max(1, rect.width);
    S.crop.ch = Math.max(1, rect.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(S.crop.cw * dpr);
    canvas.height = Math.round(S.crop.ch * dpr);
    canvas.style.width = S.crop.cw + "px";
    canvas.style.height = S.crop.ch + "px";
    S.crop.dpr = dpr;
    computeCropFrame();
    centerCropImage();
    renderCrop();
    $("#crop-zoom").value = S.crop.zoom;
    if (window.Guide) setTimeout(() => Guide.show("crop"), 350);
  }

  function computeCropFrame() {
    const { cw, ch, ratio } = S.crop;
    const maxW = Math.max(40, cw - 20);
    const maxH = Math.max(40, ch - 20);
    let fw, fh;
    if (maxW / maxH > ratio) { fh = maxH; fw = fh * ratio; }
    else { fw = maxW; fh = fw / ratio; }
    S.crop.frame = { x: (cw - fw) / 2, y: (ch - fh) / 2, w: fw, h: fh };
  }

  function centerCropImage() {
    const { frame, working, zoom } = S.crop;
    if (!working) return;
    const cover = Math.max(frame.w / working.width, frame.h / working.height);
    S.crop.cover = cover;
    const dw = working.width * cover * zoom;
    const dh = working.height * cover * zoom;
    S.crop.ox = (frame.w - dw) / 2;
    S.crop.oy = (frame.h - dh) / 2;
    clampCropOffsets();
  }

  function clampCropOffsets() {
    const { frame, working, zoom, cover } = S.crop;
    if (!working) return;
    const dw = working.width * cover * zoom;
    const dh = working.height * cover * zoom;
    S.crop.ox = Math.min(0, Math.max(frame.w - dw, S.crop.ox));
    S.crop.oy = Math.min(0, Math.max(frame.h - dh, S.crop.oy));
  }

  function renderCrop() {
    const c = S.crop;
    const canvas = $("#crop-canvas");
    if (!canvas || !c.working) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
    ctx.clearRect(0, 0, c.cw, c.ch);
    ctx.fillStyle = "#241d18";
    ctx.fillRect(0, 0, c.cw, c.ch);
    const dw = c.working.width * c.cover * c.zoom;
    const dh = c.working.height * c.cover * c.zoom;
    const dx = c.frame.x + c.ox;
    const dy = c.frame.y + c.oy;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(c.working, dx, dy, dw, dh);

    // 蒙层
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, c.cw, c.ch);
    ctx.rect(c.frame.x, c.frame.y, c.frame.w, c.frame.h);
    ctx.fillStyle = "rgba(20, 15, 12, .58)";
    ctx.fill("evenodd");
    ctx.restore();

    // 三分线
    ctx.save();
    ctx.strokeStyle = "rgba(255, 248, 236, .22)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const x = c.frame.x + (c.frame.w * i) / 3;
      const y = c.frame.y + (c.frame.h * i) / 3;
      ctx.beginPath(); ctx.moveTo(x, c.frame.y); ctx.lineTo(x, c.frame.y + c.frame.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.frame.x, y); ctx.lineTo(c.frame.x + c.frame.w, y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255, 250, 242, .92)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.frame.x + 0.5, c.frame.y + 0.5, c.frame.w - 1, c.frame.h - 1);
    // 四角
    ctx.strokeStyle = "#fff8ec";
    ctx.lineWidth = 3;
    const L = 18;
    [[c.frame.x, c.frame.y, 1, 1], [c.frame.x + c.frame.w, c.frame.y, -1, 1],
     [c.frame.x, c.frame.y + c.frame.h, 1, -1], [c.frame.x + c.frame.w, c.frame.y + c.frame.h, -1, -1]]
      .forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x + sx * L, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * L);
        ctx.stroke();
      });
    ctx.restore();
  }

  function setCropZoom(z, pivotX, pivotY) {
    const c = S.crop;
    const oldZoom = c.zoom;
    const newZoom = Math.max(1, Math.min(3, z));
    if (Math.abs(newZoom - oldZoom) < 0.001) return;
    const px = pivotX == null ? c.frame.w / 2 : pivotX;
    const py = pivotY == null ? c.frame.h / 2 : pivotY;
    const wx = (px - c.ox) / oldZoom;
    const wy = (py - c.oy) / oldZoom;
    c.zoom = newZoom;
    c.ox = px - wx * newZoom;
    c.oy = py - wy * newZoom;
    clampCropOffsets();
    $("#crop-zoom").value = newZoom;
    renderCrop();
  }

  // 裁剪手势
  (function bindCropGestures() {
    const canvas = $("#crop-canvas");
    const pointers = new Map();
    let pinch = null;
    let drag = null;

    canvas.addEventListener("pointerdown", e => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (pointers.size === 1) {
        drag = { ox: S.crop.ox, oy: S.crop.oy, x: e.clientX, y: e.clientY };
      } else if (pointers.size === 2) {
        drag = null;
        const pts = [...pointers.values()];
        const rect = canvas.getBoundingClientRect();
        pinch = {
          dist: Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
          zoom: S.crop.zoom,
          midX: (pts[0].x + pts[1].x) / 2 - rect.left - S.crop.frame.x,
          midY: (pts[0].y + pts[1].y) / 2 - rect.top - S.crop.frame.y,
          ox: S.crop.ox, oy: S.crop.oy
        };
      }
    });
    canvas.addEventListener("pointermove", e => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      p.x = e.clientX; p.y = e.clientY;
      if (pinch && pointers.size >= 2) {
        const pts = [...pointers.values()];
        const dist = Math.max(10, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        const nz = Math.max(1, Math.min(3, pinch.zoom * (dist / pinch.dist)));
        const wx = (pinch.midX - pinch.ox) / pinch.zoom;
        const wy = (pinch.midY - pinch.oy) / pinch.zoom;
        S.crop.zoom = nz;
        S.crop.ox = pinch.midX - wx * nz;
        S.crop.oy = pinch.midY - wy * nz;
        clampCropOffsets();
        $("#crop-zoom").value = nz;
        renderCrop();
      } else if (drag) {
        S.crop.ox = drag.ox + (e.clientX - drag.x);
        S.crop.oy = drag.oy + (e.clientY - drag.y);
        clampCropOffsets();
        renderCrop();
      }
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) drag = null;
      else if (pointers.size === 1) {
        const p = [...pointers.values()][0];
        drag = { ox: S.crop.ox, oy: S.crop.oy, x: p.x, y: p.y };
      }
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left - S.crop.frame.x;
      const py = e.clientY - rect.top - S.crop.frame.y;
      setCropZoom(S.crop.zoom * Math.exp(-e.deltaY * 0.0015), px, py);
    }, { passive: false });
  })();

  $$("#ratio-row .ratio-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      S.crop.ratio = parseFloat(btn.dataset.ratio);
      if (Math.abs(S.crop.ratio - 0.5) < 0.01) S.params.board = "double-v";
      else if (Math.abs(S.crop.ratio - 2) < 0.01) S.params.board = "double-h";
      else if (Math.abs(S.crop.ratio - 1) < 0.01 && /^double/.test(S.params.board)) S.params.board = "single";
      syncRatioButtons();
      computeCropFrame();
      centerCropImage();
      renderCrop();
    });
  });

  $("#crop-zoom").addEventListener("input", e => {
    setCropZoom(parseFloat(e.target.value));
  });
  $("#crop-zoom-in").onclick = () => setCropZoom(S.crop.zoom + 0.2);
  $("#crop-zoom-out").onclick = () => setCropZoom(S.crop.zoom - 0.2);

  $("#btn-rotate").onclick = () => {
    S.crop.rot = (S.crop.rot + 90) % 360;
    S.crop.working = IMG.rotateCanvas(S.crop.base, S.crop.rot, S.crop.mirror);
    S.crop.zoom = 1;
    centerCropImage();
    renderCrop();
  };
  $("#btn-mirror").onclick = () => {
    S.crop.mirror = !S.crop.mirror;
    S.crop.working = IMG.rotateCanvas(S.crop.base, S.crop.rot, S.crop.mirror);
    centerCropImage();
    renderCrop();
  };

  function confirmCrop() {
    const c = S.crop;
    if (!c.working) return;
    const z = c.cover * c.zoom;
    const sx = Math.max(0, -c.ox / z);
    const sy = Math.max(0, -c.oy / z);
    const sw = Math.min(c.working.width - sx, c.frame.w / z);
    const sh = Math.min(c.working.height - sy, c.frame.h / z);
    S.cropResult = IMG.cropRect(c.working, sx, sy, sw, sh, 1200);
    if (window.Guide) Guide.done("crop");
    show("params");
  }

  $("#btn-crop-next").onclick = confirmCrop;
  $("#btn-crop-next-top").onclick = confirmCrop;

  /* ---------------- 参数 ---------------- */

  function enterParams() {
    if (!S.cropResult) { show("upload"); return; }
    const thumb = $("#param-thumb");
    const ctx = thumb.getContext("2d");
    ctx.fillStyle = "#f3e8d8";
    ctx.fillRect(0, 0, thumb.width, thumb.height);
    const s = Math.min(thumb.width / S.cropResult.width, thumb.height / S.cropResult.height);
    const dw = S.cropResult.width * s, dh = S.cropResult.height * s;
    ctx.drawImage(S.cropResult, (thumb.width - dw) / 2, (thumb.height - dh) / 2, dw, dh);
    updateParamsUI();
    buildPaletteDots("palette-dots-50", "std50");
    buildPaletteDots("palette-dots-30", "std30");
    if (window.Guide) setTimeout(() => Guide.show("params"), 300);
  }

  function buildPaletteDots(id, paletteId) {
    const el = document.getElementById(id);
    if (!el || el.childElementCount) return;
    P.getPalette(paletteId).colors.slice(0, 20).forEach(c => {
      const i = document.createElement("i");
      i.style.background = c.hex;
      el.appendChild(i);
    });
  }

  function updateParamsUI() {
    const board = BOARDS[S.params.board];
    $$("#board-grid .board-card").forEach(b => b.classList.toggle("active", b.dataset.board === S.params.board));
    $$("#palette-options .palette-card").forEach(b => b.classList.toggle("active", b.dataset.palette === S.params.palette));
    $("#dither-toggle").checked = S.params.dither;
    const minutes = Math.max(1, Math.round((board.w * board.h) / 1.2 / 60));
    $("#param-estimate").textContent = `${board.short} · ${S.params.palette === "std30" ? "30 色" : "50 色"} · 预计 ${board.w * board.h} 颗，约 ${minutes} 分钟`;
    const meta = $("#param-crop-meta");
    const cropRatio = S.cropResult ? S.cropResult.width / S.cropResult.height : 1;
    if (Math.abs(cropRatio - board.w / board.h) < 0.03) meta.textContent = `${board.label} · 构图比例刚好`;
    else meta.textContent = `${board.label} · 将按板型居中裁切`;
  }

  $$("#board-grid .board-card").forEach(btn => {
    btn.addEventListener("click", () => {
      S.params.board = btn.dataset.board;
      updateParamsUI();
    });
  });
  $$("#palette-options .palette-card").forEach(btn => {
    btn.addEventListener("click", () => {
      S.params.palette = btn.dataset.palette;
      updateParamsUI();
    });
  });
  $("#dither-toggle").addEventListener("change", e => {
    S.params.dither = e.target.checked;
    updateParamsUI();
  });
  $("#btn-recrop").onclick = () => {
    S.crop.ratio = boardRatio(S.params.board);
    syncRatioButtons();
    show("crop");
  };

  $("#btn-generate").onclick = () => {
    generatePattern();
  };

  async function generatePattern() {
    if (!S.cropResult) return;
    const btn = $("#btn-generate");
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "正在生成图纸…";
    await new Promise(r => setTimeout(r, 60));
    const board = BOARDS[S.params.board];
    try {
      const result = IMG.convert(S.cropResult, {
        w: board.w, h: board.h,
        paletteId: S.params.palette,
        dither: S.params.dither
      });
      result.board = board;
      S.conversion = result;
      S.sourceArt = IMG.centerCrop(S.cropResult, board.w / board.h, 640);
      Store.track("convert_result", {
        board_type: board.id, palette_size: P.getPalette(S.params.palette).colors.length,
        dither: S.params.dither, duration_ms: Math.round(result.duration), colors_used: result.colorsUsed
      });
      if (result.duration > 3000) toast("转换有点慢，可以试试更小的板型", 2600);
      if (window.Guide) Guide.done("params");
      show("preview");
    } catch (err) {
      console.error(err);
      toast(location.protocol === "file:"
        ? "浏览器限制了本地图片读取，请用本地服务器打开（见 README）"
        : "生成失败，请重试", 3000);
    } finally {
      btn.disabled = false;
      btn.textContent = "生成图纸";
    }
  }

  /* ---------------- 预览 ---------------- */

  function enterPreview() {
    const conv = S.conversion;
    if (!conv) { show("upload"); return; }
    const canvas = $("#preview-canvas");
    IMG.renderArt(canvas, {
      grid: conv.grid, w: conv.w, h: conv.h, paletteId: conv.paletteId,
      fused: false, edge: true, size: 1000
    });
    $("#preview-badge").textContent = `${conv.w} × ${conv.h}`;
    $("#prev-total").textContent = conv.total.toLocaleString("en-US");
    $("#prev-colors").textContent = conv.colorsUsed;
    $("#prev-time").textContent = Math.max(1, Math.round(conv.total / 1.2 / 60));
    const top = conv.colorStats.slice(0, 5);
    const wrap = $("#top-colors");
    wrap.innerHTML = "";
    top.forEach(c => {
      const el = document.createElement("span");
      el.className = "top-color";
      el.innerHTML = `<i style="background:${c.color.hex}"></i><b>${c.color.code}</b><span>${c.color.name} ${c.count}</span>`;
      wrap.appendChild(el);
    });
    $("#prev-topnote").textContent = `${conv.colorsUsed} 色 · 共 ${conv.total} 颗`;
    let hint = "";
    if (conv.colorsUsed <= 2) hint = "图案只有 " + conv.colorsUsed + " 种颜色，适合练手，效果会比较像图标。";
    else if (conv.avgLum < 0.22 && conv.colorsUsed < 14) hint = "这张图偏暗，细节可能看不清。可以回去提亮照片，或开启抖动试试。";
    else if (!S.params.dither && conv.colorsUsed < 12) hint = "颜色过渡略生硬，回去开启「抖动过渡」会更细腻。";
    const hintEl = $("#preview-hint");
    hintEl.textContent = hint;
    hintEl.classList.toggle("show", !!hint);
    $("#btn-start-making").textContent = "开始制作";
    if (window.Guide) setTimeout(() => Guide.show("preview"), 300);
  }

  $("#btn-readjust").onclick = () => show("params");

  function startMaking() {
    if (!S.conversion) return;
    const conv = S.conversion;
    const board = BOARDS[S.params.board];
    const total = conv.w * conv.h;
    const work = {
      id: Store.uid(),
      name: (S.sourceName || "我的作品").slice(0, 24),
      w: conv.w, h: conv.h,
      boardType: board.id, boardLabel: board.label,
      paletteId: conv.paletteId,
      paletteName: P.getPalette(conv.paletteId).name,
      dither: S.params.dither,
      grid: new Uint8Array(conv.grid),
      filled: new Uint8Array(total),
      total, filledCount: 0,
      counts: new Int32Array(conv.counts),
      colorsUsed: conv.colorsUsed,
      createdAt: Date.now(), updatedAt: Date.now(),
      status: "draft", errors: 0, activeMs: 0, sessions: 1,
      thumbnail: "",
      sourceThumb: smallDataURL(S.sourceArt, 480),
      mode: "bynumber"
    };
    work.thumbnail = work.sourceThumb;
    try {
      Store.save(work);
    } catch (e) {
      handleSaveError(e);
      return;
    }
    S.work = work;
    S.freshWork = true;
    Store.track("bead_session_start", { work_id: work.id });
    if (window.Guide) Guide.done("preview");
    show("maker");
  }

  $("#btn-start-making").onclick = startMaking;

  function smallDataURL(canvas, size) {
    if (!canvas) return "";
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    const s = Math.min(size / canvas.width, size / canvas.height);
    const w = canvas.width * s, h = canvas.height * s;
    ctx.fillStyle = "#f6efe2";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(canvas, (size - w) / 2, (size - h) / 2, w, h);
    return c.toDataURL("image/jpeg", 0.82);
  }

  /* ---------------- 制作 ---------------- */

  function enterMaker() {
    if (!S.work) { show("home"); return; }
    const work = S.work;
    if (!S.freshWork) work.sessions = (work.sessions || 1) + 1;
    S.freshWork = false;
    if (work.status === "done") {
      show("finish");
      return;
    }
    const stage = $("#board-stage");
    const canvas = $("#board-canvas");
    if (!S.board) {
      S.board = new BoardView(canvas, stage, {
        onPlace: handlePlace,
        onMismatch: handleMismatch,
        onSkip: handleSkip,
        onPick: handlePick,
        onFilledTap: handleFilledTap,
        onComplete: handleComplete,
        onFind: handleFind,
        onFindEmpty: handleFindEmpty,
        onToolChange: handleToolChange
      });
    }
    S.board.setNumbers(S.settings.numbers !== false);
    S.board.load(work, { numbers: S.settings.numbers !== false });
    S.selectedId = 0;
    S.showCompleted = false;
    S.board.setPanMode(false);
    $("#btn-pan").classList.remove("active");
    $("#btn-numbers").classList.toggle("active", S.settings.numbers !== false);
    S.filledCount = S.board.filledCount();
    S.placeTotal = S.filledCount;
    S.swipeCount = 0;
    $("#maker-name").textContent = work.name;
    updateProgressUI();
    buildChips(true);
    S.sessionStart = Date.now();
    clearInterval(S.saveTimer);
    S.saveTimer = setInterval(() => { if (S.screen === "maker") saveWork(true); }, 30000);
    $("#btn-iron").hidden = S.filledCount < work.total;
    $("#maker-hint").textContent = S.filledCount >= work.total
      ? "全部填完啦，可以熨烫了"
      : "点选色号，再点按或滑过格子";
    if (S.filledCount >= work.total) $("#btn-iron").hidden = false;
    if (window.Guide) {
      setTimeout(() => {
        if (S.screen !== "maker") return;
        Guide.show("maker-pick");
      }, 500);
    }
    Store.track("bead_session_start", { work_id: work.id, resume: true });
  }

  function handlePlace(index, colorId, method) {
    S.filledCount++;
    S.placeTotal++;
    Sfx.pop(S.placeTotal % 12);
    updateProgressUI();
    updateChipCount(colorId);
    Store.track("bead_place", { method, count: 1 });
    if (S.placeTotal % 10 === 0) saveWork(true);
    clearTimeout(S.saveDebounce);
    S.saveDebounce = setTimeout(() => { if (S.screen === "maker") saveWork(true); }, 700);
    if (S.board.remainingOf(colorId) <= 0) {
      updateChipCount(colorId);
      setTimeout(() => {
        buildChips(false);
        autoSelectNext(colorId);
      }, 180);
    }
    if (window.Guide) {
      if (S.filledCount <= 1) {
        Guide.done("maker-pick");
        setTimeout(() => { if (S.screen === "maker") Guide.show("maker-swipe"); }, 700);
      }
    }
    if (method === "swipe") {
      S.swipeCount++;
      if (S.swipeCount === 3 && window.Guide) {
        Guide.done("maker-swipe");
        setTimeout(() => { if (S.screen === "maker") Guide.show("maker-find"); }, 600);
      }
    }
    if (S.filledCount >= S.work.total) {
      $("#maker-hint").textContent = "全部填完啦，可以熨烫了";
    }
  }

  function handleMismatch(index, target, selected, method) {
    S.work.errors = (S.work.errors || 0) + 1;
    Sfx.error();
    const c = P.colorById(target);
    if (c) toast(`这一格要用 ${c.code} ${c.name}`, 1400);
    Store.track("bead_error", { selected_color: selected, target_color: target });
  }

  let skipToastAt = 0;
  function handleSkip(index) {
    const now = performance.now();
    if (now - S.lastSkipSound > 110) {
      Sfx.tick();
      S.lastSkipSound = now;
    }
    if (now - skipToastAt > 2600) {
      skipToastAt = now;
      toast("这一格颜色不同，已自动跳过", 1200);
    }
  }

  function handlePick(colorId) {
    selectColor(colorId, true);
    Sfx.pick();
    const c = P.colorById(colorId);
    if (c) toast(`已取色 ${c.code} ${c.name}`, 1400);
    if (window.Guide) Guide.done("maker-pick");
    if (S.board && S.board.remainingOf(colorId) === 0) {
      toast(`这个颜色已经填完了，换一个继续`, 1500);
      autoSelectNext(0);
    }
  }

  let filledToastAt = 0;
  function handleFilledTap(index, colorId) {
    const now = performance.now();
    if (now - filledToastAt < 2500) return;
    filledToastAt = now;
    const c = P.colorById(colorId);
    if (c) toast(`这一格是 ${c.code} ${c.name} · 长按可取色`, 1600);
  }

  function handleFind(colorId) {
    Store.track("find_bead", { color_id: colorId });
    if (window.Guide) Guide.done("maker-find");
  }

  function handleFindEmpty() {
    toast("这个颜色已经填完了，换下一个吧");
    autoSelectNext(0);
  }

  function handleToolChange(tool) {
    $("#btn-pan").classList.toggle("active", tool === "pan");
  }

  function handleComplete() {
    Sfx.complete();
    $("#btn-iron").hidden = false;
    $("#maker-hint").textContent = "全部填完啦，可以熨烫了";
    toast(`${S.work.total.toLocaleString("en-US")} 颗都放好了，开始熨烫吧`, 2400);
    saveWork(true);
  }

  function updateProgressUI() {
    const total = S.work.total;
    const pct = Math.min(100, Math.round((S.filledCount / total) * 100));
    $("#maker-bar").style.width = pct + "%";
    $("#maker-percent").textContent = pct + "%";
    $("#maker-sub").textContent = `${pct}% · 已填 ${S.filledCount} / ${total}`;
    $("#btn-iron").hidden = S.filledCount < total;
  }

  function usedColors() {
    return S.conversion ? S.conversion.colorStats : [];
  }

  function buildChips(initial) {
    const work = S.work;
    const palette = P.getPalette(work.paletteId);
    const stats = [];
    for (const c of palette.colors) {
      const total = work.counts[c.id] || 0;
      if (!total) continue;
      const remaining = S.board ? S.board.remainingOf(c.id) : total;
      stats.push({ color: c, total, remaining });
    }
    stats.sort((a, b) => b.remaining - a.remaining || b.total - a.total);
    const open = stats.filter(s => s.remaining > 0);
    const done = stats.filter(s => s.remaining === 0);
    const wrap = $("#chips");
    wrap.innerHTML = "";
    open.forEach(s => wrap.appendChild(makeChip(s)));
    const doneBtn = $("#btn-completed");
    if (done.length) {
      doneBtn.hidden = false;
      doneBtn.textContent = `已完成 ${done.length} 色 · 点开查看`;
      const showDone = S.showCompleted;
      if (showDone) done.forEach(s => wrap.appendChild(makeChip(s)));
    } else {
      doneBtn.hidden = true;
      doneBtn.textContent = "";
    }
    if (initial || !S.selectedId || (S.board && S.board.remainingOf(S.selectedId) === 0)) {
      autoSelectNext(0, true);
    } else {
      selectColor(S.selectedId);
    }
  }

  function makeChip(s) {
    const b = document.createElement("button");
    b.className = "chip" + (s.remaining === 0 ? " done" : "");
    b.dataset.id = s.color.id;
    b.innerHTML = `<span class="dot" style="background:${s.color.hex}"></span><b>${s.color.code}</b><span>${s.remaining > 0 ? "剩 " + s.remaining : "完成"}</span>`;
    b.addEventListener("click", () => {
      selectColor(s.color.id);
      Sfx.pick();
    });
    return b;
  }

  function updateChipCount(id) {
    const chip = document.querySelector(`.chip[data-id="${id}"]`);
    if (!chip || !S.board) return;
    const remaining = S.board.remainingOf(id);
    const span = chip.querySelector("span:last-child");
    if (span) span.textContent = remaining > 0 ? "剩 " + remaining : "完成";
    chip.classList.toggle("done", remaining === 0);
  }

  function autoSelectNext(exceptId, silent) {
    if (!S.board) return;
    let best = null;
    for (const c of P.getPalette(S.work.paletteId).colors) {
      if (!S.work.counts[c.id]) continue;
      const rem = S.board.remainingOf(c.id);
      if (rem > 0 && (!best || rem > best.rem)) best = { id: c.id, rem };
    }
    if (best) {
      selectColor(best.id);
      if (!silent && exceptId) {
        const c = P.colorById(exceptId);
        if (c) toast(`${c.code} ${c.name} 完成，继续下一个颜色`, 1600);
      }
    } else {
      S.selectedId = 0;
      $("#sel-swatch").style.background = "#e6dacb";
      $("#sel-name").textContent = "全部完成";
      $("#sel-left").textContent = "可以熨烫了";
    }
  }

  function selectColor(id, fromPick) {
    S.selectedId = id;
    if (S.board) S.board.setColor(id);
    const c = P.colorById(id);
    if (!c) return;
    $("#sel-swatch").style.background = c.hex;
    $("#sel-name").textContent = `${c.code} ${c.name}`;
    const rem = S.board ? S.board.remainingOf(id) : 0;
    $("#sel-left").textContent = rem > 0 ? `还剩 ${rem} 颗 · 共 ${S.work.counts[id]}` : "这个颜色已完成";
    $$("#chips .chip").forEach(el => el.classList.toggle("active", Number(el.dataset.id) === id));
    const el = document.querySelector(`.chip[data-id="${id}"]`);
    if (el && !fromPick) el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  $("#btn-completed").onclick = () => {
    S.showCompleted = !S.showCompleted;
    buildChips(false);
  };

  $("#btn-find").onclick = () => { if (S.board) S.board.findBead(); };
  $("#btn-find-2").onclick = () => { if (S.board) S.board.findBead(); };
  $("#btn-numbers").onclick = () => {
    const on = !(S.settings.numbers !== false);
    S.settings = Store.setSettings({ numbers: on });
    $("#btn-numbers").classList.toggle("active", on);
    if (S.board) S.board.setNumbers(on);
  };
  $("#btn-pan").onclick = () => {
    const on = !S.board.panMode;
    S.board.setPanMode(on);
  };
  $("#btn-fit").onclick = () => { if (S.board) S.board.fit(true); };

  $("#btn-maker-back").onclick = () => {
    saveWork(true);
    show("home");
  };
  $("#btn-maker-menu").onclick = () => {
    openModal(
      `<h3>${escapeAttr(S.work.name)}</h3>
       <div class="sheet-list">
         <button class="sheet-item" data-act="rename">重命名作品</button>
         <button class="sheet-item" data-act="duplicate">重制为新作品</button>
         <button class="sheet-item" data-act="library">去作品库</button>
         <button class="sheet-item danger" data-act="delete">删除这个作品</button>
       </div>
       <div class="modal-actions"><button class="btn btn-ghost" data-act="close">关闭</button></div>`,
      (box, close) => {
        box.querySelector('[data-act="close"]').onclick = close;
        box.querySelector('[data-act="rename"]').onclick = async () => {
          close();
          const name = await promptDialog("作品名称", S.work.name);
          if (name) {
            S.work.name = name.trim().slice(0, 24) || S.work.name;
            $("#maker-name").textContent = S.work.name;
            saveWork(true);
            Store.track("work_operate", { type: "rename" });
          }
        };
        box.querySelector('[data-act="duplicate"]').onclick = () => {
          close();
          duplicateCurrent();
        };
        box.querySelector('[data-act="library"]').onclick = () => {
          close();
          saveWork(true);
          show("library");
        };
        box.querySelector('[data-act="delete"]').onclick = async () => {
          close();
          const ok = await confirmDialog("删除这个作品？", "已填的豆子会一起删除，无法恢复。", "删除", true);
          if (ok) {
            Store.remove(S.work.id);
            Store.track("work_operate", { type: "delete" });
            S.work = null;
            show("home");
            toast("作品已删除");
          }
        };
      }
    );
  };

  async function duplicateCurrent() {
    try {
      const copy = Store.duplicate(S.work);
      if (!copy) throw new Error("NOT_FOUND");
      saveWork(true);
      Store.track("work_operate", { type: "duplicate" });
      toast("已复制为一份空白新作品");
      S.work = copy;
      S.freshWork = true;
      show("maker");
    } catch (e) {
      if (e.message === "FULL") showFullDialog();
      else toast("复制失败，请重试");
    }
  }

  function leaveMaker() {
    if (!S.work) return;
    saveWork(true);
    if (S.board) {
      S.board.cache = null;
      S.board.cacheKey = "";
    }
    clearInterval(S.saveTimer);
    S.saveTimer = 0;
  }

  function saveWork(silent) {
    if (!S.work) return;
    const work = S.work;
    if (S.screen === "maker" && S.sessionStart) {
      work.activeMs = (work.activeMs || 0) + (Date.now() - S.sessionStart);
      S.sessionStart = Date.now();
    }
    work.updatedAt = Date.now();
    work.filledCount = S.board ? S.board.filledCount() : work.filledCount;
    if (work.filledCount > 0 || work.status === "done") {
      work.thumbnail = makeThumb(work);
    }
    try {
      Store.save(work);
      Store.track("auto_save", { trigger: silent ? "interval" : "manual", beads_placed: work.filledCount });
      if (!silent) flashSaved();
    } catch (e) {
      handleSaveError(e);
    }
  }

  let saveFlashTimer = 0;
  function flashSaved() {
    const el = $("#maker-hint");
    if (!el || S.screen !== "maker") return;
    const prev = el.textContent;
    el.textContent = "进度已保存在本机";
    clearTimeout(saveFlashTimer);
    saveFlashTimer = setTimeout(() => {
      if (S.screen === "maker" && el.textContent === "进度已保存在本机") {
        el.textContent = S.filledCount >= S.work.total ? "全部填完啦，可以熨烫了" : "点选色号，再点按或滑过格子";
      }
    }, 1200);
  }

  function makeThumb(work) {
    const temp = document.createElement("canvas");
    IMG.renderArt(temp, {
      grid: work.grid, w: work.w, h: work.h, paletteId: work.paletteId,
      filled: work.filled,
      fused: work.status === "done", edge: false, size: 360, pad: 8, bg: "#f4e9d9"
    });
    const out = document.createElement("canvas");
    out.width = 200; out.height = 200;
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#f4e9d9";
    ctx.fillRect(0, 0, 200, 200);
    const s = Math.min(188 / temp.width, 188 / temp.height);
    const w = temp.width * s, h = temp.height * s;
    ctx.drawImage(temp, (200 - w) / 2, (200 - h) / 2, w, h);
    return out.toDataURL("image/jpeg", 0.78);
  }

  function handleSaveError(e) {
    if (e && e.message === "FULL") showFullDialog();
    else if (e && e.message === "QUOTA") {
      toast("本机存储已满，请先删除旧作品再保存", 3000);
    } else {
      toast("保存失败，请检查浏览器存储权限", 2800);
    }
  }

  function showFullDialog() {
    openModal(
      `<h3>作品库已满</h3><p>最多保存 50 件作品。先导出或删除几件旧作品，就能继续创作。</p>
       <div class="modal-actions"><button class="btn btn-ghost" data-act="cancel">稍后</button><button class="btn btn-primary" data-act="go">去作品库</button></div>`,
      (box, close) => {
        box.querySelector('[data-act="cancel"]').onclick = close;
        box.querySelector('[data-act="go"]').onclick = () => { close(); show("library"); };
      }
    );
  }

  $("#btn-iron").onclick = () => {
    if (S.filledCount < S.work.total) return;
    saveWork(true);
    show("iron");
    startIron();
  };

  /* ---------------- 熨烫 ---------------- */

  function startIron() {
    const work = S.work;
    if (!work) return;
    work.status = "ironing";
    work.updatedAt = Date.now();
    try { Store.save(work); } catch (e) { /* ignore */ }

    const screen = $("#screen-iron");
    const canvas = $("#iron-canvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = screen.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    const ctx = canvas.getContext("2d");

    const raw = document.createElement("canvas");
    IMG.renderArt(raw, { grid: work.grid, w: work.w, h: work.h, paletteId: work.paletteId, fused: false, edge: true, size: 1200, bg: "#f6eddf" });
    const fused = document.createElement("canvas");
    IMG.renderArt(fused, { grid: work.grid, w: work.w, h: work.h, paletteId: work.paletteId, fused: true, edge: true, size: 1200, bg: "#f6eddf" });

    const scale = Math.min((rect.width * 0.84) / raw.width, (rect.height * 0.48) / raw.height);
    const artW = raw.width * scale;
    const artH = raw.height * scale;
    const artX = (rect.width - artW) / 2;
    const artY = Math.max(rect.height * 0.08, rect.height * 0.30 - artH / 2);
    const duration = 4200;
    S.iron = { raf: 0, start: performance.now(), done: false, particles: [], screen: true };
    let last = performance.now();
    Sfx.iron();

    const draw = now => {
      const t = Math.min(1, (now - S.iron.start) / duration);
      const p = easeInOut(t);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = ctx.createLinearGradient(0, 0, 0, rect.height);
      bg.addColorStop(0, "#3a2d25");
      bg.addColorStop(1, "#201915");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, rect.width, rect.height);
      // 光晕
      const glow = ctx.createRadialGradient(rect.width / 2, artY + artH / 2, 10, rect.width / 2, artY + artH / 2, artW * 0.9);
      glow.addColorStop(0, "rgba(255, 219, 166, .16)");
      glow.addColorStop(1, "rgba(255, 219, 166, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, rect.width, rect.height);

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.5)";
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 16;
      ctx.drawImage(raw, artX, artY, artW, artH);
      ctx.restore();

      const edgeX = artX + artW * p;
      ctx.save();
      ctx.beginPath();
      ctx.rect(artX, artY, artW * p, artH);
      ctx.clip();
      ctx.drawImage(fused, artX, artY, artW, artH);
      ctx.restore();

      // 熨面光带
      if (p > 0.001 && p < 0.999) {
        const band = ctx.createLinearGradient(edgeX - 70, 0, edgeX + 40, 0);
        band.addColorStop(0, "rgba(255,220,170,0)");
        band.addColorStop(0.55, "rgba(255,238,205,.28)");
        band.addColorStop(0.8, "rgba(255,250,235,.55)");
        band.addColorStop(1, "rgba(255,220,170,0)");
        ctx.fillStyle = band;
        ctx.fillRect(edgeX - 80, artY - 20, 130, artH + 40);
        // 熨斗
        ctx.save();
        ctx.translate(edgeX, artY - 26);
        ctx.fillStyle = "#d8cbbc";
        window.BeadImage.roundRect(ctx, -46, 2, 92, 26, 9);
        ctx.fill();
        ctx.fillStyle = "#4a3d33";
        window.BeadImage.roundRect(ctx, -22, -26, 44, 32, 12);
        ctx.fill();
        ctx.fillStyle = "#f2e6d8";
        window.BeadImage.roundRect(ctx, -40, 8, 80, 12, 6);
        ctx.fill();
        ctx.restore();
      }

      // 蒸汽
      if (p > 0.02 && p < 0.98) {
        if (Math.random() < 0.4) {
          S.iron.particles.push({
            x: edgeX + (Math.random() - 0.5) * 60,
            y: artY + Math.random() * artH,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -0.4 - Math.random() * 0.5,
            r: 2 + Math.random() * 4,
            a: 0.35
          });
        }
        S.iron.particles.forEach(pt => {
          pt.x += pt.vx; pt.y += pt.vy; pt.a *= 0.985; pt.r += 0.25;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 244, 228, ${pt.a})`;
          ctx.fill();
        });
        S.iron.particles = S.iron.particles.filter(pt => pt.a > 0.02);
      }

      const sub = $("#iron-sub");
      if (sub) sub.textContent = t < 0.98 ? `熨面正在融合豆子 · ${Math.round(p * 100)}%` : "表面已经变得平整有光泽";
      if (t >= 1 && !S.iron.done) {
        S.iron.done = true;
        setTimeout(finishIron, 450);
        return;
      }
      if (S.screen === "iron") S.iron.raf = requestAnimationFrame(draw);
    };
    S.iron.raf = requestAnimationFrame(draw);
  }

  function stopIron() {
    if (S.iron.raf) cancelAnimationFrame(S.iron.raf);
    S.iron.raf = 0;
  }

  function finishIron() {
    stopIron();
    const work = S.work;
    if (!work) return;
    work.status = "done";
    work.completedAt = Date.now();
    work.updatedAt = Date.now();
    work.activeMs = (work.activeMs || 0) + (S.sessionStart ? Date.now() - S.sessionStart : 0);
    S.sessionStart = 0;
    work.thumbnail = makeThumb(work);
    try { Store.save(work); } catch (e) { /* ignore */ }
    Store.track("iron_complete", {
      total_beads: work.total, colors: work.colorsUsed,
      total_session_s: Math.round(work.activeMs / 1000), errors: work.errors
    });
    Sfx.finish();
    S.libraryTab = "done";
    S.libraryOpenTo = "done";
    show("finish");
  }

  $("#btn-skip-iron").onclick = () => {
    stopIron();
    finishIron();
  };

  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /* ---------------- 成品 ---------------- */

  function enterFinish() {
    const work = S.work;
    if (!work) { show("library"); return; }
    if (work.status === "draft") { show("maker"); return; }
    $("#finish-name").textContent = work.name;
    const d = new Date(work.completedAt || Date.now());
    const pad = n => String(n).padStart(2, "0");
    $("#finish-date").textContent = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} 完成 · ${work.boardLabel}`;
    renderFinishArt();
    $("#compare-orig").src = work.sourceThumb || work.thumbnail;
    setCompare(50);
    const minutes = Math.max(1, Math.round((work.activeMs || 0) / 60000));
    $("#stat-beads").textContent = work.total.toLocaleString("en-US");
    $("#stat-colors").textContent = work.colorsUsed;
    $("#stat-time").textContent = minutes >= 60
      ? `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`
      : `${minutes} 分`;
    const sessions = work.sessions || 1;
    const errs = work.errors || 0;
    $("#finish-note").textContent = `跨 ${sessions} 次打开完成${errs ? ` · 放错 ${errs} 次，很正常` : " · 一次完成，很稳"}`;
    renderMaterials();
    $("#materials").classList.remove("open");
    $("#btn-materials").setAttribute("aria-expanded", "false");
    if (window.Guide) setTimeout(() => { if (S.screen === "finish") Guide.show("finish"); }, 700);
  }

  function renderFinishArt() {
    const work = S.work;
    if (!work) return;
    const edge = S.finishEdge !== false;
    IMG.renderArt($("#finish-art"), {
      grid: work.grid, w: work.w, h: work.h, paletteId: work.paletteId,
      fused: true, edge, size: 1000
    });
    IMG.renderArt($("#compare-art"), {
      grid: work.grid, w: work.w, h: work.h, paletteId: work.paletteId,
      fused: true, edge: false, size: 900
    });
    // 对比容器是正方形，双板作品需要用留白方式居中
    const src = $("#compare-art");
    const square = document.createElement("canvas");
    square.width = 900; square.height = 900;
    const sctx = square.getContext("2d");
    sctx.fillStyle = "#f1e6d6";
    sctx.fillRect(0, 0, 900, 900);
    const s = Math.min(860 / src.width, 860 / src.height);
    const dw = src.width * s, dh = src.height * s;
    sctx.drawImage(src, (900 - dw) / 2, (900 - dh) / 2, dw, dh);
    src.width = 900; src.height = 900;
    src.getContext("2d").drawImage(square, 0, 0);
  }

  function setCompare(v) {
    const pct = Math.max(0, Math.min(100, v));
    $(".compare-top").style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    $(".compare-handle").style.left = pct + "%";
    $("#compare-range").value = pct;
  }

  $("#compare-range").addEventListener("input", e => setCompare(parseFloat(e.target.value)));

  $$("#edge-toggle .seg").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("#edge-toggle .seg").forEach(b => b.classList.toggle("active", b === btn));
      S.finishEdge = btn.dataset.edge === "1";
      renderFinishArt();
    });
  });

  function materialRows(work) {
    const palette = P.getPalette(work.paletteId);
    const rows = [];
    for (const c of palette.colors) {
      const count = work.counts[c.id] || 0;
      if (!count) continue;
      rows.push({ color: c, count, buy: Math.ceil((count * 11) / 10) });
    }
    rows.sort((a, b) => b.count - a.count || a.color.id - b.color.id);
    return rows;
  }

  function renderMaterials() {
    const work = S.work;
    const rows = materialRows(work);
    const totalBuy = rows.reduce((s, r) => s + r.buy, 0);
    $("#mat-sub").textContent = `${rows.length} 色 · ${work.total.toLocaleString("en-US")} 颗 · 建议采购 ${totalBuy.toLocaleString("en-US")} 颗`;
    const wrap = $("#mat-rows");
    wrap.innerHTML = "";
    rows.forEach(r => {
      const div = document.createElement("div");
      div.className = "mat-row";
      div.innerHTML =
        `<span class="mat-color"><i style="background:${r.color.hex}"></i><b>${r.color.code}</b><span>${r.color.name}</span></span>
         <span>${r.count}</span><span class="buy">${r.buy}</span>`;
      wrap.appendChild(div);
    });
    $("#mat-total").innerHTML = `<span>合计 ${rows.length} 色</span><span>${work.total}</span><span>${totalBuy}</span>`;
    $("#mat-palette-note").textContent = `色板版本：${P.getPalette(work.paletteId).version} · ${P.getPalette(work.paletteId).name}`;
  }

  $("#btn-materials").onclick = () => {
    const box = $("#materials");
    const open = box.classList.toggle("open");
    $("#btn-materials").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      if (window.Guide) Guide.done("finish");
      setTimeout(() => box.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    }
  };

  function buildExportImage(work) {
    const W = 1080;
    const M = 76;
    const art = document.createElement("canvas");
    IMG.renderArt(art, {
      grid: work.grid, w: work.w, h: work.h, paletteId: work.paletteId,
      fused: true, edge: true, size: 1000, bg: "#f6ecdd"
    });
    const artW = 920;
    const artH = Math.round(art.height * (artW / art.width));
    const rows = materialRows(work);
    const perCol = Math.ceil(rows.length / 2);
    const listH = perCol * 54 + 26;
    const H = 300 + artH + 190 + 90 + listH + 190;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fbf6ec";
    ctx.fillRect(0, 0, W, H);
    // 顶部色块
    ctx.fillStyle = "#f4e7d5";
    ctx.fillRect(0, 0, W, 12);

    // 品牌
    const bdots = ["#EF705A", "#F6C95B", "#2F9C8A", "#F3A05C"];
    bdots.forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(M + i * 22, 64, 7, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });
    ctx.fillStyle = "#2B2520";
    ctx.font = '650 26px "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.textBaseline = "middle";
    ctx.fillText("豆豆工坊", M + 100, 64);
    ctx.fillStyle = "#9C8D7D";
    ctx.font = '500 14px "PingFang SC", sans-serif';
    ctx.fillText("BEAD STUDIO", M + 100 + 128, 66);

    ctx.fillStyle = "#2B2520";
    let titleSize = 64;
    do {
      ctx.font = `700 ${titleSize}px "Songti SC", "Noto Serif SC", serif`;
      if (ctx.measureText(work.name).width <= W - M * 2) break;
      titleSize -= 3;
    } while (titleSize > 34);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(work.name, M, 186);

    const d = new Date(work.completedAt || Date.now());
    const pad = n => String(n).padStart(2, "0");
    ctx.fillStyle = "#8F8173";
    ctx.font = '500 22px "PingFang SC", sans-serif';
    ctx.fillText(`${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} · ${work.boardLabel} · ${work.colorsUsed} 色`, M, 230);

    // 作品
    const ax = (W - artW) / 2;
    const ay = 272;
    ctx.save();
    ctx.shadowColor = "rgba(90, 60, 30, .18)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    IMG.roundRect(ctx, ax, ay, artW, artH, 32);
    ctx.fillStyle = "#f4e9d9";
    ctx.fill();
    ctx.restore();
    ctx.save();
    IMG.roundRect(ctx, ax, ay, artW, artH, 32);
    ctx.clip();
    ctx.drawImage(art, ax, ay, artW, artH);
    ctx.restore();

    let y = ay + artH + 62;
    const stats = [
      [work.total.toLocaleString("en-US"), "颗豆子"],
      [String(work.colorsUsed), "种颜色"],
      [`${Math.max(1, Math.round((work.activeMs || 0) / 60000))} 分`, "总用时"]
    ];
    stats.forEach((s, i) => {
      const cx = W * (0.22 + i * 0.28);
      ctx.textAlign = "center";
      ctx.fillStyle = "#2B2520";
      ctx.font = '700 44px "Songti SC", serif';
      ctx.fillText(s[0], cx, y);
      ctx.fillStyle = "#9C8D7D";
      ctx.font = '500 19px "PingFang SC", sans-serif';
      ctx.fillText(s[1], cx, y + 32);
    });
    ctx.textAlign = "left";

    y += 92;
    ctx.strokeStyle = "#E5D8C6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(M, y);
    ctx.lineTo(W - M, y);
    ctx.stroke();
    y += 52;
    ctx.fillStyle = "#2B2520";
    ctx.font = '700 30px "PingFang SC", "Noto Sans SC", sans-serif';
    ctx.fillText("材料清单", M, y);
    ctx.fillStyle = "#9C8D7D";
    ctx.font = '500 18px "PingFang SC", sans-serif';
    ctx.textAlign = "right";
    ctx.fillText("建议采购数 = 颗数 × 1.1 向上取整", W - M, y);
    ctx.textAlign = "left";
    y += 34;

    const colW = (W - M * 2 - 40) / 2;
    rows.forEach((r, i) => {
      const col = i < perCol ? 0 : 1;
      const rowIdx = i < perCol ? i : i - perCol;
      const x = M + col * (colW + 40);
      const ry = y + rowIdx * 54 + 24;
      ctx.beginPath();
      ctx.arc(x + 12, ry - 7, 11, 0, Math.PI * 2);
      ctx.fillStyle = r.color.hex;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.08)";
      ctx.stroke();
      ctx.fillStyle = "#2B2520";
      ctx.font = '600 20px "PingFang SC", sans-serif';
      ctx.fillText(r.color.code, x + 34, ry);
      ctx.fillStyle = "#6E6154";
      ctx.font = '500 18px "PingFang SC", sans-serif';
      ctx.fillText(r.color.name, x + 78, ry);
      ctx.textAlign = "right";
      ctx.fillStyle = "#2B2520";
      ctx.fillText(String(r.count), x + colW - 100, ry);
      ctx.fillStyle = "#D4553F";
      ctx.font = '600 20px "PingFang SC", sans-serif';
      ctx.fillText(String(r.buy), x + colW, ry);
      ctx.textAlign = "left";
    });

    y = y + perCol * 54 + 56;
    const totalBuy = rows.reduce((s, r) => s + r.buy, 0);
    ctx.fillStyle = "#2B2520";
    ctx.font = '650 22px "PingFang SC", sans-serif';
    ctx.fillText(`合计 ${work.colorsUsed} 色 · ${work.total} 颗`, M, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#D4553F";
    ctx.fillText(`建议采购 ${totalBuy} 颗`, W - M, y);
    ctx.textAlign = "left";

    y += 44;
    ctx.fillStyle = "#9C8D7D";
    ctx.font = '500 18px "PingFang SC", sans-serif';
    ctx.fillText(`色板版本：${P.getPalette(work.paletteId).version} · ${P.getPalette(work.paletteId).name}`, M, y);
    y += 30;
    ctx.fillText("豆豆工坊 · 作品只保存在本机，记得把这张图也存一份", M, y);
    return canvas;
  }

  function downloadCanvas(canvas, filename) {
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, "image/png");
  }

  function showExport(work) {
    const canvas = buildExportImage(work);
    const url = canvas.toDataURL("image/png");
    openModal(
      `<h3>成品长图</h3><div class="export-preview"><img src="${url}" alt="成品长图"></div>
       <p>手机上可以长按图片保存到相册</p>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-act="close">关闭</button>
         <button class="btn btn-primary" data-act="save">保存图片</button>
       </div>`,
      (box, close) => {
        box.querySelector('[data-act="close"]').onclick = close;
        box.querySelector('[data-act="save"]').onclick = () => {
          downloadCanvas(canvas, `${work.name}-拼豆图纸.png`);
          Store.track("material_export", { format: "png" });
          toast("已开始下载长图");
        };
      },
      { className: "modal-export" }
    );
  }

  function exportCSV(work) {
    const rows = materialRows(work);
    const lines = ["色号,颜色,颗数,建议采购数,色板版本"];
    rows.forEach(r => lines.push(`${r.color.code},${r.color.name},${r.count},${r.buy},${P.getPalette(work.paletteId).version}`));
    const totalBuy = rows.reduce((s, r) => s + r.buy, 0);
    lines.push(`合计,${rows.length} 色,${work.total},${totalBuy},`);
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${work.name}-材料清单.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    Store.track("material_export", { format: "csv" });
    toast("CSV 已导出");
  }

  $("#btn-export-art").onclick = () => showExport(S.work);
  $("#btn-export-long").onclick = () => showExport(S.work);
  $("#btn-export-csv").onclick = () => exportCSV(S.work);
  $("#btn-copy-list").onclick = async () => {
    const rows = materialRows(S.work);
    const text = `${S.work.name} · 拼豆材料清单\n` +
      rows.map(r => `${r.color.code} ${r.color.name}：${r.count} 颗（建议买 ${r.buy}）`).join("\n") +
      `\n合计 ${S.work.total} 颗 · ${rows.length} 色\n色板：${P.getPalette(S.work.paletteId).name}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("清单已复制，可以直接发给商家");
    } catch (e) {
      toast("复制失败，请长按选择文本");
    }
  };

  $("#btn-again").onclick = () => {
    S.work = null;
    S.conversion = null;
    show("upload");
  };
  $("#btn-finish-share").onclick = () => {
    if (navigator.share && navigator.canShare) {
      const canvas = buildExportImage(S.work);
      canvas.toBlob(async blob => {
        if (!blob) return;
        const file = new File([blob], `${S.work.name}-拼豆图纸.png`, { type: "image/png" });
        try {
          await navigator.share({ files: [file], title: S.work.name, text: "我用豆豆工坊拼的作品" });
        } catch (e) {
          if (e && e.name !== "AbortError") toast("系统分享不可用，可以改用「导出成品长图」", 2200);
        }
      }, "image/png");
    } else {
      showExport(S.work);
    }
  };

  /* ---------------- 作品库 ---------------- */

  function enterLibrary() {
    const works = Store.list();
    const doing = works.filter(w => w.status !== "done");
    const done = works.filter(w => w.status === "done");
    let opened = false;
    if (S.libraryOpenTo) {
      S.libraryTab = S.libraryOpenTo;
      S.libraryOpenTo = null;
      opened = true;
    }
    if (!opened && !S.libraryTabTouched) {
      S.libraryTab = doing.length ? "doing" : "done";
    }
    renderLibrary();
  }

  function renderLibrary() {
    const works = Store.list();
    const doing = works.filter(w => w.status !== "done");
    const done = works.filter(w => w.status === "done");
    $("#tab-count-doing").textContent = doing.length;
    $("#tab-count-done").textContent = done.length;
    $$("#library-tabs .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === S.libraryTab));
    const list = $("#library-list");
    list.innerHTML = "";
    const items = S.libraryTab === "doing" ? doing : done;
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "lib-empty";
      empty.innerHTML =
        `<div class="empty-art">
           <svg viewBox="0 0 120 120" width="86" height="86">
             <rect x="16" y="20" width="88" height="80" rx="14" fill="#fbf4e8" stroke="#e0d2be" stroke-width="2"/>
             <circle cx="40" cy="44" r="8" fill="#f6c95b"/><circle cx="58" cy="44" r="8" fill="#ef705a"/>
             <circle cx="76" cy="44" r="8" fill="#2f9c8a"/><circle cx="40" cy="62" r="8" fill="#f3a05c"/>
             <circle cx="58" cy="62" r="8" fill="#fbe4dd"/><circle cx="76" cy="62" r="8" fill="#c9a7d8"/>
             <circle cx="40" cy="80" r="8" fill="#a9d86e"/><circle cx="58" cy="80" r="8" fill="#6ec6e8"/>
             <circle cx="76" cy="80" r="8" fill="#f7a8bb"/>
           </svg>
         </div>
         <b>${S.libraryTab === "doing" ? "还没有进行中的作品" : "还没有完成的作品"}</b>
         <p>${S.libraryTab === "doing" ? "从一张照片开始，进度会自动保存在这里。" : "做完一件，熨烫后的成品会收进这里。"}</p>
         <button class="btn btn-primary" id="empty-start">开始制作</button>`;
      list.appendChild(empty);
      const b = empty.querySelector("#empty-start");
      if (b) b.onclick = () => show("upload");
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "lib-list";
    items.forEach(w => wrap.appendChild(libraryCard(w)));
    list.appendChild(wrap);
  }

  function libraryCard(w) {
    const card = document.createElement("div");
    card.className = "lib-card";
    const done = w.status === "done";
    const pct = Math.round((w.filledCount / w.total) * 100);
    const meta = done
      ? `${formatDate(w.completedAt)} 完成 · ${w.total} 颗 · ${w.colorsUsed} 色`
      : w.status === "ironing"
        ? "已完成 · 等待熨烫"
        : `${w.filledCount} / ${w.total} 颗 · ${pct}%`;
    card.innerHTML =
      `<div class="lib-thumb"><img src="${w.thumbnail || w.sourceThumb}" alt=""></div>
       <div class="lib-main">
         <b>${escapeAttr(w.name)}</b>
         <small>${meta}</small>
         ${done ? "" : `<div class="lib-progress ${w.status === "ironing" ? "done" : ""}"><i style="width:${w.status === "ironing" ? 100 : pct}%"></i></div>`}
         <small>${w.boardLabel} · ${w.paletteName}</small>
       </div>
       <div class="lib-actions">
         <button class="lib-btn primary" data-act="open">${done ? "查看" : w.status === "ironing" ? "熨烫" : "继续"}</button>
         <button class="lib-btn" data-act="menu" aria-label="更多">⋯</button>
       </div>`;
    card.querySelector('[data-act="open"]').onclick = () => openWork(w);
    card.querySelector(".lib-thumb").onclick = () => openWork(w);
    card.querySelector(".lib-main").onclick = () => openWork(w);
    card.querySelector('[data-act="menu"]').onclick = () => libraryMenu(w);
    return card;
  }

  function formatDate(ts) {
    const d = new Date(ts || Date.now());
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  }

  function libraryMenu(w) {
    openModal(
      `<h3>${escapeAttr(w.name)}</h3>
       <div class="sheet-list">
         <button class="sheet-item" data-act="open">${w.status === "done" ? "查看成品" : "继续制作"}</button>
         <button class="sheet-item" data-act="rename">重命名</button>
         <button class="sheet-item" data-act="duplicate">重制为新作品</button>
         ${w.status === "done" ? '<button class="sheet-item" data-act="export">导出材料清单</button>' : ""}
         <button class="sheet-item danger" data-act="delete">删除</button>
       </div>
       <div class="modal-actions"><button class="btn btn-ghost" data-act="close">关闭</button></div>`,
      (box, close) => {
        box.querySelector('[data-act="close"]').onclick = close;
        box.querySelector('[data-act="open"]').onclick = () => { close(); openWork(w); };
        box.querySelector('[data-act="rename"]').onclick = async () => {
          close();
          const name = await promptDialog("作品名称", w.name);
          if (name && name.trim()) {
            Store.rename(w.id, name);
            Store.track("work_operate", { type: "rename" });
            renderLibrary();
            renderContinue();
            toast("已重命名");
          }
        };
        box.querySelector('[data-act="duplicate"]').onclick = () => {
          close();
          try {
            const copy = Store.duplicate(w);
            Store.track("work_operate", { type: "duplicate" });
            renderLibrary();
            toast("已复制为一份空白新作品");
            openWork(copy);
          } catch (e) {
            if (e.message === "FULL") showFullDialog();
            else toast("复制失败");
          }
        };
        const ex = box.querySelector('[data-act="export"]');
        if (ex) ex.onclick = () => { close(); S.work = Store.get(w.id); showExport(S.work); };
        box.querySelector('[data-act="delete"]').onclick = async () => {
          close();
          const ok = await confirmDialog("删除这个作品？", "删除后无法恢复。已经导出的长图和清单不受影响。", "删除", true);
          if (ok) {
            Store.remove(w.id);
            Store.track("work_operate", { type: "delete" });
            renderLibrary();
            renderContinue();
            toast("作品已删除");
          }
        };
      }
    );
  }

  function openWork(w) {
    const fresh = typeof w === "string" ? Store.get(w) : Store.get(w.id);
    if (!fresh) { toast("作品不存在，可能已被删除"); renderLibrary(); return; }
    S.work = fresh;
    S.freshWork = false;
    Store.track("work_operate", { type: "continue" });
    if (fresh.status === "done") {
      show("finish");
    } else if (fresh.status === "ironing") {
      openModal(
        `<h3>这件作品已经拼完了</h3><p>还差最后一次熨烫。可以看一遍熨烫动画，或直接查看成品。</p>
         <div class="modal-actions">
           <button class="btn btn-ghost" data-act="skip">直接看成品</button>
           <button class="btn btn-primary" data-act="iron">播放熨烫</button>
         </div>`,
        (box, close) => {
          box.querySelector('[data-act="skip"]').onclick = () => {
            close();
            fresh.status = "done";
            fresh.completedAt = Date.now();
            S.work = fresh;
            try { Store.save(fresh); } catch (e) { /* ignore */ }
            show("finish");
          };
          box.querySelector('[data-act="iron"]').onclick = () => {
            close();
            show("iron");
            startIron();
          };
        }
      );
    } else {
      show("maker");
    }
  }

  $$("#library-tabs .tab").forEach(t => {
    t.onclick = () => {
      S.libraryTab = t.dataset.tab;
      S.libraryTabTouched = true;
      renderLibrary();
    };
  });
  $("#btn-new-work").onclick = () => show("upload");

  /* ---------------- 设置 / 玩法 ---------------- */

  function openHomeMenu() {
    const settings = Store.getSettings();
    openModal(
      `<h3>豆豆工坊</h3>
       <div class="sheet-list">
         <button class="sheet-item" data-act="howto">怎么玩 · 30 秒看懂</button>
         <button class="sheet-item" data-act="guide">用示例图走一遍引导</button>
         <button class="sheet-item" data-act="sound">音效 · ${settings.sound ? "开" : "关"}</button>
         <button class="sheet-item" data-act="vibrate">震动反馈 · ${settings.vibrate !== false ? "开" : "关"}</button>
         <button class="sheet-item" data-act="numbers">色号数字 · ${settings.numbers ? "显示" : "隐藏"}</button>
       </div>
       <p style="font-size:10.5px;color:#91857a;margin:0 0 14px">作品只保存在本机浏览器。当前占用约 ${Math.max(1, Math.round(Store.estimateBytes() / 1024))} KB，最多 50 件。</p>
       <div class="modal-actions"><button class="btn btn-ghost" data-act="close">关闭</button></div>`,
      (box, close) => {
        box.querySelector('[data-act="close"]').onclick = close;
        box.querySelector('[data-act="howto"]').onclick = () => { close(); openHowto(); };
        box.querySelector('[data-act="guide"]').onclick = () => {
          close();
          if (window.Guide) Guide.start();
          show("upload");
          setTimeout(() => Guide.show("upload"), 300);
        };
        box.querySelector('[data-act="sound"]').onclick = () => {
          const s = Store.getSettings();
          const next = Store.setSettings({ sound: !s.sound });
          S.settings = next;
          Sfx.setMuted(!next.sound);
          close();
          openHomeMenu();
        };
        box.querySelector('[data-act="vibrate"]').onclick = () => {
          const s = Store.getSettings();
          const next = Store.setSettings({ vibrate: s.vibrate === false });
          S.settings = next;
          Sfx.setVibration(next.vibrate);
          close();
          openHomeMenu();
        };
        box.querySelector('[data-act="numbers"]').onclick = () => {
          const s = Store.getSettings();
          S.settings = Store.setSettings({ numbers: !s.numbers });
          if (S.board) {
            S.board.setNumbers(S.settings.numbers);
            $("#btn-numbers").classList.toggle("active", S.settings.numbers);
          }
          close();
          openHomeMenu();
        };
      }
    );
  }

  function openHowto() {
    openModal(
      `<h3>怎么玩</h3>
       <div class="sheet-list">
         <div class="sheet-item">① 选一张照片，裁成钉板比例</div>
         <div class="sheet-item">② 生成带色号的图纸，每格一个答案</div>
         <div class="sheet-item">③ 点选色号，点按或滑动填豆</div>
         <div class="sheet-item">④ 填满后熨烫，导出成品和材料清单</div>
       </div>
       <p style="font-size:11.5px;color:#91857a">放错颜色豆子会弹回来，不会扣豆。长按格子可以取色，双指缩放，右上角「找豆」带你找到下一种颜色。</p>
       <div class="modal-actions">
         <button class="btn btn-ghost" data-act="close">知道了</button>
         <button class="btn btn-primary" data-act="try">拿示例试一下</button>
       </div>`,
      (box, close) => {
        box.querySelector('[data-act="close"]').onclick = close;
        box.querySelector('[data-act="try"]').onclick = () => {
          close();
          if (window.Guide) Guide.start();
          show("upload");
          setTimeout(() => Guide.show("upload"), 300);
        };
      }
    );
  }

  $("#btn-howto").onclick = openHowto;
  $("#btn-home-menu").onclick = openHomeMenu;

  /* ---------------- 返回键 ---------------- */

  const BACK = {
    upload: "home",
    crop: "upload",
    params: "crop",
    preview: "params",
    finish: "library",
    library: "home"
  };

  $$("[data-back]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = BACK[S.screen];
      if (target) show(target);
    });
  });

  /* ---------------- 全局事件 ---------------- */

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (S.screen === "maker") saveWork(true);
    } else {
      if (S.screen === "maker" && S.work) S.sessionStart = Date.now();
    }
  });
  window.addEventListener("pagehide", () => {
    if (S.screen === "maker" && S.work) saveWork(true);
  });
  window.addEventListener("resize", () => {
    if (S.screen === "crop") {
      const stage = $("#crop-stage");
      const rect = stage.getBoundingClientRect();
      S.crop.cw = rect.width;
      S.crop.ch = rect.height;
      const canvas = $("#crop-canvas");
      canvas.width = Math.round(rect.width * S.crop.dpr);
      canvas.height = Math.round(rect.height * S.crop.dpr);
      computeCropFrame();
      centerCropImage();
      renderCrop();
    }
  });

  $("#btn-start").onclick = () => {
    Sfx.unlock();
    show("upload");
    Store.track("upload_start", { source: "home" });
  };
  $("#btn-library").onclick = () => show("library");

  /* ---------------- 开发/验收辅助 ---------------- */

  App.fillAllForTest = function () {
    if (!S.board || !S.work) return;
    S.board.filled.fill(1);
    S.board.remaining.fill(0);
    S.filledCount = S.work.total;
    S.work.filledCount = S.work.total;
    updateProgressUI();
    buildChips(false);
    $("#btn-iron").hidden = false;
    $("#maker-hint").textContent = "全部填完啦，可以熨烫了";
    saveWork(true);
    handleComplete();
  };

  App.getWork = () => S.work;
  App.getBoard = () => S.board;

  /* ---------------- 启动 ---------------- */

  function init() {
    S.settings = Store.getSettings();
    Sfx.setMuted(!S.settings.sound);
    Sfx.setVibration(S.settings.vibrate !== false);
    S.finishEdge = true;
    show("home");
    Store.track("app_open", { platform: "h5", version: "1.0.0" });
    if (!S.settings.onboarded) {
      setTimeout(showWelcome, 600);
    }
  }

  window.BeadStudio = { App, Store, state: S, palette: P };
  init();
})();
