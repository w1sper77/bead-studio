/* 钉板画布：离屏缓存、相机、手势、找豆、放大镜 */
(function () {
  "use strict";

  const P = window.BeadPalette;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 4;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  class BoardView {
    constructor(canvas, stage, opts) {
      this.canvas = canvas;
      this.stage = stage;
      this.ctx = canvas.getContext("2d");
      this.opts = opts || {};
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.work = null;
      this.w = 0; this.h = 0;
      this.grid = null;
      this.filled = null;
      this.colors = new Map();
      this.remaining = new Int32Array(51);
      this.selectedId = 0;
      this.zoom = 1;
      this.scale = 10;
      this.offsetX = 0;
      this.offsetY = 0;
      this.cw = 1; this.ch = 1;
      this.showNumbers = true;
      this.panMode = false;
      this.pointers = new Map();
      this.stroke = null;
      this.pinch = null;
      this.longTimer = 0;
      this.longFired = false;
      this.panning = false;
      this.anims = new Map();
      this.shakes = new Map();
      this.ripples = new Map();
      this.pulse = null;
      this.cameraAnim = null;
      this.cameraToken = 0;
      this.raf = 0;
      this.dirty = true;
      this.magnifier = null;
      this.lastPointer = null;
      this.magHideTimer = 0;
      this.completed = false;
      this.lastActive = 0;
      this.cache = null;
      this.cacheKey = "";
      this.resizeObserver = null;

      this._bind();
      this._observeSize();
    }

    _bind() {
      this._onDown = this.onPointerDown.bind(this);
      this._onMove = this.onPointerMove.bind(this);
      this._onUp = this.onPointerUp.bind(this);
      this._onCancel = this.onPointerCancel.bind(this);
      this._onWheel = this.onWheel.bind(this);
      this.canvas.addEventListener("pointerdown", this._onDown, { passive: false });
      this.canvas.addEventListener("pointermove", this._onMove, { passive: false });
      this.canvas.addEventListener("pointerup", this._onUp);
      this.canvas.addEventListener("pointercancel", this._onCancel);
      this.canvas.addEventListener("wheel", this._onWheel, { passive: false });
      this.canvas.addEventListener("contextmenu", e => e.preventDefault());
    }

    _observeSize() {
      if (!window.ResizeObserver) return;
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.resize()) return;
        const wasFit = Math.abs(this.zoom - 1) < 0.02;
        if (wasFit) this.fit(false);
        else this.clampPan();
        this.render();
      });
      this.resizeObserver.observe(this.stage);
    }

    resize() {
      const rect = this.stage.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return false;
      this.cw = Math.max(1, rect.width);
      this.ch = Math.max(1, rect.height);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(this.cw * this.dpr);
      this.canvas.height = Math.round(this.ch * this.dpr);
      this.canvas.style.width = this.cw + "px";
      this.canvas.style.height = this.ch + "px";
      return true;
    }

    load(work, options) {
      options = options || {};
      this.work = work;
      this.w = work.w;
      this.h = work.h;
      this.grid = work.grid;
      this.filled = work.filled;
      this.colors = new Map(P.getPalette(work.paletteId).colors.map(c => [c.id, c]));
      this.remaining = new Int32Array(51);
      for (let i = 0; i < this.grid.length; i++) {
        const id = this.grid[i];
        if (id && !this.filled[i]) this.remaining[id]++;
      }
      this.showNumbers = options.numbers !== false;
      this.panMode = false;
      this.completed = false;
      this.anims.clear();
      this.shakes.clear();
      this.ripples.clear();
      this.pulse = null;
      this.cache = null;
      this.cacheKey = "";
      this.resize();
      this.fit(false);
      this.render();
    }

    fit(animate) {
      const pad = 18;
      const fitScale = Math.max(1, Math.min((this.cw - pad * 2) / this.w, (this.ch - pad * 2) / this.h));
      const targetZoom = 1;
      const scale = fitScale * targetZoom;
      const ox = (this.cw - this.w * scale) / 2;
      const oy = (this.ch - this.h * scale) / 2;
      this.zoom = targetZoom;
      this.scale = scale;
      if (animate) {
        this.animateCamera(ox, oy, targetZoom, 320);
      } else {
        this.offsetX = ox;
        this.offsetY = oy;
        this.cameraAnim = null;
        this.afterCamera();
      }
    }

    clampPan() {
      const bw = this.w * this.scale;
      const bh = this.h * this.scale;
      const minVisible = Math.min(90, bw * 0.4, bh * 0.4);
      const minX = minVisible - bw;
      const maxX = this.cw - minVisible;
      const minY = minVisible - bh;
      const maxY = this.ch - minVisible;
      this.offsetX = clamp(this.offsetX, minX, maxX);
      this.offsetY = clamp(this.offsetY, minY, maxY);
    }

    afterCamera() {
      if (this.opts.onCamera) this.opts.onCamera(this.zoom, this.scale);
      const pill = document.getElementById("zoom-pill");
      if (pill) {
        pill.textContent = Math.round(this.zoom * 100) + "%";
        pill.classList.add("show");
        clearTimeout(this._pillTimer);
        this._pillTimer = setTimeout(() => pill.classList.remove("show"), 1100);
      }
    }

    setColor(id) {
      this.selectedId = id;
      this.dirty = true;
      this.render();
    }

    setNumbers(on) {
      this.showNumbers = !!on;
      this.dirty = true;
      this.render();
    }

    setPanMode(on) {
      this.panMode = !!on;
      this.canvas.style.cursor = on ? "grab" : "crosshair";
      if (this.opts.onToolChange) this.opts.onToolChange(on ? "pan" : "paint");
    }

    remainingOf(id) { return this.remaining[id] || 0; }

    filledCount() {
      let n = 0;
      for (let i = 0; i < this.filled.length; i++) if (this.filled[i]) n++;
      return n;
    }

    ensureCache() {
      const key = this.w + "x" + this.h;
      if (this.cache && this.cacheKey === key) return this.cache;
      const C = this.w >= 50 || this.h >= 50 ? 44 : 56;
      const canvas = document.createElement("canvas");
      canvas.width = this.w * C;
      canvas.height = this.h * C;
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;

      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#fcf6ec");
      grad.addColorStop(1, "#f3e7d6");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = "rgba(184, 155, 118, .5)";
      ctx.lineWidth = Math.max(2, C * 0.06);
      ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);

      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          const cx = (x + 0.5) * C, cy = (y + 0.5) * C;
          const r = C * 0.355;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = "#efe3d0";
          ctx.fill();
          ctx.lineWidth = Math.max(1, C * 0.035);
          ctx.strokeStyle = "rgba(168, 140, 105, .35)";
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy - r * 0.12, r * 0.82, Math.PI * 1.05, Math.PI * 1.55);
          ctx.strokeStyle = "rgba(120, 92, 60, .14)";
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy + r * 0.15, r * 0.7, Math.PI * 1.65, Math.PI * 2.05);
          ctx.strokeStyle = "rgba(255, 255, 255, .55)";
          ctx.stroke();
        }
      }

      ctx.save();
      ctx.setLineDash([C * 0.22, C * 0.18]);
      ctx.strokeStyle = "rgba(150, 122, 88, .55)";
      ctx.lineWidth = Math.max(2, C * 0.055);
      for (let x = 29; x < this.w; x += 29) {
        ctx.beginPath();
        ctx.moveTo(x * C, 0);
        ctx.lineTo(x * C, H);
        ctx.stroke();
      }
      for (let y = 29; y < this.h; y += 29) {
        ctx.beginPath();
        ctx.moveTo(0, y * C);
        ctx.lineTo(W, y * C);
        ctx.stroke();
      }
      ctx.restore();

      this.cache = canvas;
      this.cacheKey = key;
      return canvas;
    }

    render() {
      if (!this.work) return;
      this.dirty = false;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cw, this.ch);
      this.drawScene(ctx, {
        scale: this.scale, ox: this.offsetX, oy: this.offsetY,
        width: this.cw, height: this.ch, numbers: this.showNumbers
      }, false);
    }

    drawScene(ctx, cam, forLens) {
      const scale = cam.scale, ox = cam.ox, oy = cam.oy;
      if (!(scale > 0) || !this.w || !this.h) return;
      const now = performance.now();
      const bw = this.w * scale, bh = this.h * scale;

      ctx.save();
      ctx.shadowColor = "rgba(90, 60, 30, .28)";
      ctx.shadowBlur = Math.min(30, scale * 2);
      ctx.shadowOffsetY = Math.min(10, scale * 0.8);
      ctx.fillStyle = "#f8f1e6";
      window.BeadImage.roundRect(ctx, ox, oy, bw, bh, Math.min(14, scale * 1.1));
      ctx.fill();
      ctx.restore();

      const cache = this.ensureCache();
      ctx.drawImage(cache, ox, oy, bw, bh);

      const cell = scale;
      const startX = Math.max(0, Math.floor((-ox) / cell));
      const endX = Math.min(this.w - 1, Math.ceil((cam.width - ox) / cell));
      const startY = Math.max(0, Math.floor((-oy) / cell));
      const endY = Math.min(this.h - 1, Math.ceil((cam.height - oy) / cell));

      if (this.selectedId && !forLens) {
        ctx.save();
        ctx.strokeStyle = "rgba(43, 37, 32, .16)";
        ctx.lineWidth = Math.max(1, cell * 0.055);
        for (let y = startY; y <= endY; y++) {
          for (let x = startX; x <= endX; x++) {
            const i = y * this.w + x;
            if (this.filled[i] || this.grid[i] !== this.selectedId) continue;
            ctx.beginPath();
            ctx.arc(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell, cell * 0.46, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      const beadR = cell * 0.44;
      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          const i = y * this.w + x;
          if (!this.filled[i]) continue;
          const color = this.colors.get(this.grid[i]);
          if (!color) continue;
          let px = ox + (x + 0.5) * cell;
          let py = oy + (y + 0.5) * cell;
          let r = beadR;
          const anim = this.anims.get(i);
          if (anim) {
            const t = (now - anim) / 170;
            if (t >= 1) this.anims.delete(i);
            else {
              const k = t < 0.45 ? 0.55 + (t / 0.45) * 0.55 : 1.1 - ((t - 0.45) / 0.55) * 0.1;
              r *= k;
            }
          }
          if (r < 1.4) continue;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fillStyle = color.hex;
          ctx.fill();
          if (cell > 5) {
            ctx.beginPath();
            ctx.arc(px, py, r * 0.84, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(0,0,0,.14)";
            ctx.lineWidth = Math.max(0.5, cell * 0.045);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(px, py, r * 0.6, Math.PI * 1.05, Math.PI * 1.55);
            ctx.strokeStyle = "rgba(255,255,255,.42)";
            ctx.lineWidth = Math.max(0.6, cell * 0.075);
            ctx.stroke();
          }
        }
      }

      // 放错：豆子弹起后消失，同时目标格闪一下
      if (this.shakes.size) {
        for (const [i, shake] of this.shakes) {
          const t = (now - shake.start) / 380;
          if (t >= 1) { this.shakes.delete(i); continue; }
          const x = i % this.w, y = Math.floor(i / this.w);
          const cx = ox + (x + 0.5) * cell;
          const cy = oy + (y + 0.5) * cell;
          const lift = Math.sin(Math.min(1, t * 1.5) * Math.PI) * cell * 0.55;
          const alpha = 1 - t;
          const color = this.colors.get(shake.color);
          if (color) {
            ctx.globalAlpha = alpha * 0.85;
            ctx.beginPath();
            ctx.arc(cx, cy - lift, cell * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = color.hex;
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          const target = this.colors.get(this.grid[i]);
          ctx.beginPath();
          ctx.arc(cx, cy, cell * (0.42 + 0.14 * t), 0, Math.PI * 2);
          ctx.strokeStyle = target ? hexA(target.hex, 0.85 * alpha) : `rgba(239,112,90,${alpha})`;
          ctx.lineWidth = Math.max(1.2, cell * 0.07);
          ctx.stroke();
        }
      }

      if (cam.numbers && cell >= 8) {
        const font = Math.max(6, Math.min(14, cell * 0.42));
        ctx.save();
        ctx.font = `650 ${font}px -apple-system, "PingFang SC", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(96, 78, 58, .82)";
        for (let y = startY; y <= endY; y++) {
          for (let x = startX; x <= endX; x++) {
            const i = y * this.w + x;
            if (this.filled[i]) continue;
            const id = this.grid[i];
            if (!id) continue;
            const code = id < 10 ? "0" + id : String(id);
            ctx.fillText(code, ox + (x + 0.5) * cell, oy + (y + 0.5) * cell);
          }
        }
        ctx.restore();
      } else if (cell >= 3.5 && this.selectedId && !forLens) {
        ctx.save();
        ctx.fillStyle = "rgba(43, 37, 32, .22)";
        for (let y = startY; y <= endY; y++) {
          for (let x = startX; x <= endX; x++) {
            const i = y * this.w + x;
            if (this.filled[i] || this.grid[i] !== this.selectedId) continue;
            ctx.beginPath();
            ctx.arc(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell, Math.max(0.8, cell * 0.1), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      if (this.pulse && !forLens) {
        const elapsed = now - this.pulse.start;
        if (elapsed > this.pulse.duration) {
          this.pulse = null;
        } else {
          const a = 0.35 + 0.65 * Math.abs(Math.sin(elapsed / 420));
          const color = this.colors.get(this.pulse.colorId);
          ctx.save();
          for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
              const i = y * this.w + x;
              if (this.filled[i] || this.grid[i] !== this.pulse.colorId) continue;
              const px = ox + (x + 0.5) * cell;
              const py = oy + (y + 0.5) * cell;
              ctx.beginPath();
              ctx.arc(px, py, cell * (0.5 + a * 0.14), 0, Math.PI * 2);
              ctx.strokeStyle = color ? hexA(color.hex, 0.55 + a * 0.4) : "rgba(239,112,90,.8)";
              ctx.lineWidth = Math.max(1.2, cell * 0.09);
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }

      if (!forLens && this.ripples.size) {
        for (const [i, start] of this.ripples) {
          const t = (now - start) / 320;
          if (t >= 1) { this.ripples.delete(i); continue; }
          const x = i % this.w, y = Math.floor(i / this.w);
          ctx.beginPath();
          ctx.arc(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell, cell * (0.3 + t * 0.4), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(150, 120, 90, ${(1 - t) * 0.4})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }

    startLoop() {
      if (this.raf) return;
      const tick = () => {
        this.raf = 0;
        if (!this.work) return;
        const now = performance.now();
        const busy = this.anims.size || this.shakes.size || this.ripples.size ||
          (this.pulse && now < this.pulse.start + this.pulse.duration) || this.cameraAnim;
        this.render();
        if (this.magnifier && this.magnifier.classList.contains("show") && this.lastPointer) {
          this.drawMagnifier(this.lastPointer.x, this.lastPointer.y);
        }
        if (busy) this.startLoop();
      };
      this.raf = requestAnimationFrame(tick);
    }

    requestRender() {
      this.dirty = true;
      if (!this.raf) this.startLoop();
    }

    animateCamera(tx, ty, tzoom, dur) {
      const token = ++this.cameraToken;
      const sx = this.offsetX, sy = this.offsetY, sz = this.zoom;
      const t0 = performance.now();
      const fromScale = this.scale;
      const fitScale = Math.max(1, Math.min((this.cw - 36) / this.w, (this.ch - 36) / this.h));
      const toScale = fitScale * tzoom;
      this.cameraAnim = true;
      const step = () => {
        if (token !== this.cameraToken) return;
        const t = clamp((performance.now() - t0) / (dur || 380), 0, 1);
        const k = easeOutCubic(t);
        this.offsetX = sx + (tx - sx) * k;
        this.offsetY = sy + (ty - sy) * k;
        this.zoom = sz + (tzoom - sz) * k;
        this.scale = fromScale + (toScale - fromScale) * k;
        this.render();
        if (t < 1) requestAnimationFrame(step);
        else {
          this.scale = toScale;
          this.cameraAnim = null;
          this.afterCamera();
          this.startLoop();
        }
      };
      requestAnimationFrame(step);
    }

    zoomBy(factor, cx, cy) {
      this.cameraToken++;
      this.cameraAnim = null;
      cx = cx == null ? this.cw / 2 : cx;
      cy = cy == null ? this.ch / 2 : cy;
      const worldX = (cx - this.offsetX) / this.scale;
      const worldY = (cy - this.offsetY) / this.scale;
      const fitScale = Math.max(1, Math.min((this.cw - 36) / this.w, (this.ch - 36) / this.h));
      const targetZoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const newScale = fitScale * targetZoom;
      this.offsetX = cx - worldX * newScale;
      this.offsetY = cy - worldY * newScale;
      this.scale = newScale;
      this.zoom = targetZoom;
      this.clampPan();
      this.afterCamera();
      this.render();
      this.updateMagnifierState(this.canvas.getBoundingClientRect().left + cx, this.canvas.getBoundingClientRect().top + cy);
    }

    centerOn(x, y, zoomTarget, dur) {
      const fitScale = Math.max(1, Math.min((this.cw - 36) / this.w, (this.ch - 36) / this.h));
      const z = clamp(zoomTarget || this.zoom, MIN_ZOOM, MAX_ZOOM);
      const s = fitScale * z;
      const ox = this.cw / 2 - x * s;
      const oy = this.ch / 2 - y * s;
      this.animateCamera(ox, oy, z, dur || 420);
    }

    cellAt(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const x = (clientX - rect.left - this.offsetX) / this.scale;
      const y = (clientY - rect.top - this.offsetY) / this.scale;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
      return Math.floor(y) * this.w + Math.floor(x);
    }

    onPointerDown(e) {
      if (!this.work) return;
      e.preventDefault();
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (window.Sfx) Sfx.unlock();
      const p = {
        id: e.pointerId, x: e.clientX, y: e.clientY,
        startX: e.clientX, startY: e.clientY, moved: false
      };
      this.pointers.set(e.pointerId, p);
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.lastActive = performance.now();

      if (this.pointers.size === 2) {
        this.cancelSingle();
        this.cameraToken++;
        this.cameraAnim = null;
        this.beginPinch();
        return;
      }
      if (this.pointers.size > 2) return;

      if (this.panMode) {
        this.cameraToken++;
        this.cameraAnim = null;
        this.panning = true;
        this.panStart = { x: e.clientX, y: e.clientY, ox: this.offsetX, oy: this.offsetY };
        this.canvas.style.cursor = "grabbing";
        return;
      }

      this.stroke = { cells: new Set(), last: -1, active: false, startCell: this.cellAt(e.clientX, e.clientY) };
      this.longFired = false;
      clearTimeout(this.longTimer);
      this.longTimer = setTimeout(() => {
        if (!this.stroke || this.stroke.active || p.moved) return;
        this.longFired = true;
        const idx = this.cellAt(p.x, p.y);
        if (idx >= 0) this.pickCell(idx);
      }, 430);
      this.updateMagnifierState(e.clientX, e.clientY);
    }

    beginPinch() {
      const pts = [...this.pointers.values()];
      const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
      this.pinch = {
        dist: Math.max(10, Math.hypot(dx, dy)),
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
        zoom: this.zoom,
        scale: this.scale,
        ox: this.offsetX,
        oy: this.offsetY
      };
    }

    onPointerMove(e) {
      if (!this.work) return;
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      p.x = e.clientX; p.y = e.clientY;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.lastActive = performance.now();

      if (this.pinch && this.pointers.size >= 2) {
        const pts = [...this.pointers.values()];
        const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
        const dist = Math.max(10, Math.hypot(dx, dy));
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const fitScale = Math.max(1, Math.min((this.cw - 36) / this.w, (this.ch - 36) / this.h));
        const targetZoom = clamp(this.pinch.zoom * (dist / this.pinch.dist), MIN_ZOOM, MAX_ZOOM);
        const newScale = fitScale * targetZoom;
        const worldX = (this.pinch.midX - this.pinch.ox) / this.pinch.scale;
        const worldY = (this.pinch.midY - this.pinch.oy) / this.pinch.scale;
        this.scale = newScale;
        this.zoom = targetZoom;
        this.offsetX = midX - worldX * newScale;
        this.offsetY = midY - worldY * newScale;
        this.clampPan();
        this.afterCamera();
        this.render();
        this.updateMagnifierState(midX, midY);
        return;
      }

      if (this.panning) {
        this.offsetX = this.panStart.ox + (e.clientX - this.panStart.x);
        this.offsetY = this.panStart.oy + (e.clientY - this.panStart.y);
        this.clampPan();
        this.render();
        return;
      }

      if (!this.stroke) return;
      const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
      if (!p.moved && dist > 6) {
        p.moved = true;
        clearTimeout(this.longTimer);
        this.stroke.active = true;
        this.paintLine(this.stroke.startCell, this.cellAt(e.clientX, e.clientY), true);
      } else if (this.stroke.active) {
        const idx = this.cellAt(e.clientX, e.clientY);
        this.paintLine(this.stroke.last, idx, false);
      }
      this.updateMagnifierState(e.clientX, e.clientY);
    }

    onPointerUp(e) {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      clearTimeout(this.longTimer);
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

      if (this.pinch) {
        if (this.pointers.size === 1) {
          this.pinch = null;
          this.panning = true;
          const rem = [...this.pointers.values()][0];
          this.panStart = { x: rem.x, y: rem.y, ox: this.offsetX, oy: this.offsetY };
        } else if (this.pointers.size === 0) {
          this.pinch = null;
          this.panning = false;
        }
        this.scheduleMagHide();
        return;
      }

      if (this.panning) {
        this.panning = false;
        this.canvas.style.cursor = this.panMode ? "grab" : "crosshair";
        this.scheduleMagHide();
        return;
      }

      if (this.stroke && this.pointers.size === 0) {
        if (!this.stroke.active && !this.longFired && p && !p.moved) {
          const idx = this.cellAt(e.clientX, e.clientY);
          if (idx >= 0) this.tapCell(idx);
        }
        this.stroke = null;
      }
      this.scheduleMagHide();
    }

    onPointerCancel(e) {
      this.pointers.delete(e.pointerId);
      clearTimeout(this.longTimer);
      this.stroke = null;
      this.pinch = null;
      this.panning = false;
      this.scheduleMagHide();
    }

    onWheel(e) {
      if (!this.work) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      this.zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
      this.scheduleMagHide();
    }

    cancelSingle() {
      clearTimeout(this.longTimer);
      this.stroke = null;
      this.panning = false;
    }

    tapCell(index) {
      if (this.filled[index]) {
        const colorId = this.grid[index];
        const c = this.colors.get(colorId);
        if (this.opts.onFilledTap) this.opts.onFilledTap(index, colorId, c);
        return;
      }
      const target = this.grid[index];
      if (!target) return;
      if (!this.selectedId) {
        if (this.opts.onPick) this.opts.onPick(target, index);
        return;
      }
      if (target !== this.selectedId) {
        this.shakes.set(index, { start: performance.now(), color: this.selectedId });
        this.startLoop();
        if (this.opts.onMismatch) this.opts.onMismatch(index, target, this.selectedId, "tap");
        return;
      }
      this.place(index, "tap");
    }

    paintLine(from, to, includeFrom) {
      if (to < 0) return;
      if (from < 0) from = to;
      const x0 = from % this.w, y0 = Math.floor(from / this.w);
      const x1 = to % this.w, y1 = Math.floor(to / this.w);
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      if (steps === 0) {
        if (includeFrom) this.paintCell(to);
      } else {
        for (let s = 0; s <= steps; s++) {
          const x = Math.round(x0 + ((x1 - x0) * s) / steps);
          const y = Math.round(y0 + ((y1 - y0) * s) / steps);
          this.paintCell(y * this.w + x);
        }
      }
      this.stroke.last = to;
    }

    paintCell(index) {
      if (!this.stroke || this.stroke.cells.has(index)) return;
      this.stroke.cells.add(index);
      if (this.filled[index] || !this.grid[index]) return;
      if (!this.selectedId) return;
      if (this.grid[index] !== this.selectedId) {
        this.ripples.set(index, performance.now());
        if (this.opts.onSkip) this.opts.onSkip(index);
        this.startLoop();
        return;
      }
      this.place(index, "swipe");
    }

    place(index, method) {
      const target = this.grid[index];
      if (!target || this.filled[index]) return false;
      this.filled[index] = 1;
      this.remaining[target] = Math.max(0, this.remaining[target] - 1);
      this.anims.set(index, performance.now());
      this.startLoop();
      if (this.opts.onPlace) this.opts.onPlace(index, target, method);
      const totalFilled = this.filledCount();
      if (totalFilled >= this.w * this.h && !this.completed) {
        this.completed = true;
        if (this.opts.onComplete) setTimeout(() => this.opts.onComplete(), 260);
      }
      return true;
    }

    pickCell(index) {
      const id = this.grid[index];
      if (!id) return;
      if (this.opts.onPick) this.opts.onPick(id, index);
      if (window.Sfx) Sfx.vibrate(12);
    }

    findBead() {
      const id = this.selectedId;
      if (!id || this.remaining[id] <= 0) {
        if (this.opts.onFindEmpty) this.opts.onFindEmpty(id);
        return;
      }
      const viewCenterX = (this.cw / 2 - this.offsetX) / this.scale;
      const viewCenterY = (this.ch / 2 - this.offsetY) / this.scale;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < this.grid.length; i++) {
        if (this.filled[i] || this.grid[i] !== id) continue;
        const x = (i % this.w) + 0.5, y = Math.floor(i / this.w) + 0.5;
        const d = (x - viewCenterX) * (x - viewCenterX) + (y - viewCenterY) * (y - viewCenterY);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return;
      this.pulse = { colorId: id, start: performance.now(), duration: 3000 };
      const x = (best % this.w) + 0.5, y = Math.floor(best / this.w) + 0.5;
      this.centerOn(x, y, Math.max(this.zoom, 1.7), 420);
      this.startLoop();
      if (this.opts.onFind) this.opts.onFind(id, best);
    }

    ensureMagnifier() {
      if (this.magnifier) return this.magnifier;
      const div = document.createElement("div");
      div.className = "magnifier";
      const c = document.createElement("canvas");
      c.width = 240; c.height = 240;
      div.appendChild(c);
      this.stage.appendChild(div);
      this.magnifier = div;
      this.magCanvas = c;
      this.magCtx = c.getContext("2d");
      return div;
    }

    updateMagnifierState(clientX, clientY) {
      if (!this.work) return;
      if (this.zoom >= 1.99) {
        const mag = this.ensureMagnifier();
        const rect = this.stage.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        let left = x + 40;
        let top = y - 150;
        if (left + 118 > this.cw - 4) left = x - 158;
        if (left < 4) left = 4;
        if (top < 4) top = y + 42;
        if (top + 118 > this.ch - 4) top = this.ch - 122;
        mag.style.left = left + "px";
        mag.style.top = top + "px";
        mag.classList.add("show");
        this.lastPointer = { x: clientX, y: clientY };
        this.drawMagnifier(clientX, clientY);
        clearTimeout(this.magHideTimer);
      } else {
        this.scheduleMagHide(true);
      }
    }

    scheduleMagHide(fast) {
      clearTimeout(this.magHideTimer);
      this.magHideTimer = setTimeout(() => {
        if (this.magnifier) this.magnifier.classList.remove("show");
      }, fast ? 0 : 600);
    }

    drawMagnifier(clientX, clientY) {
      if (!this.magCtx || !this.work) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const worldX = (px - this.offsetX) / this.scale;
      const worldY = (py - this.offsetY) / this.scale;
      const cellCx = Math.floor(worldX) + 0.5;
      const cellCy = Math.floor(worldY) + 0.5;
      const size = 240;
      const lensCell = 30;
      const ox = size / 2 - cellCx * lensCell;
      const oy = size / 2 - cellCy * lensCell;
      const ctx = this.magCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#f8f1e6";
      ctx.fillRect(0, 0, size, size);
      this.drawScene(ctx, { scale: lensCell, ox, oy, width: size, height: size, numbers: true }, true);
      ctx.strokeStyle = "rgba(43, 37, 32, .22)";
      ctx.lineWidth = 2;
      ctx.strokeRect(size / 2 - lensCell / 2, size / 2 - lensCell / 2, lensCell, lensCell);
    }

    destroy() {
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.raf) cancelAnimationFrame(this.raf);
      clearTimeout(this.longTimer);
      clearTimeout(this.magHideTimer);
      if (this.magnifier && this.magnifier.parentNode) this.magnifier.parentNode.removeChild(this.magnifier);
    }
  }

  function hexA(hex, a) {
    const { r, g, b } = P.hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  window.BoardView = BoardView;
})();
