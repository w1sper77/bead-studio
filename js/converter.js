/* 图片预处理、图片转豆图、豆图渲染 */
(function () {
  "use strict";

  const P = window.BeadPalette;

  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  async function fileToCanvas(file, maxSide) {
    maxSide = maxSide || 1600;
    const type = (file.type || "").toLowerCase();
    if (type && !/^image\//.test(type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "")) {
      throw new Error("UNSUPPORTED");
    }

    let source = null;
    let width = 0, height = 0;
    if (window.createImageBitmap) {
      try {
        source = await createImageBitmap(file, { imageOrientation: "from-image" });
        width = source.width;
        height = source.height;
      } catch (err) {
        source = null;
      }
    }

    if (!source) {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("DECODE"));
          el.src = url;
        });
        source = img;
        width = img.naturalWidth;
        height = img.naturalHeight;
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
    }

    if (!width || !height) throw new Error("DECODE");
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = makeCanvas(width * scale, height * scale);
    const ctx = canvas.getContext("2d");
    // 透明 PNG 按白底合成
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (source.close) source.close();
    return canvas;
  }

  function loadUrl(url, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, (maxSide || 1600) / Math.max(img.naturalWidth, img.naturalHeight));
        const c = makeCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = () => reject(new Error("DECODE"));
      img.src = url;
    });
  }

  function centerCrop(canvas, ratio, outSize) {
    const cw = canvas.width, ch = canvas.height;
    let sw, sh;
    if (cw / ch > ratio) {
      sh = ch; sw = ch * ratio;
    } else {
      sw = cw; sh = cw / ratio;
    }
    const outW = outSize || Math.min(1400, Math.round(sw));
    const outH = Math.round(outW / ratio);
    const out = makeCanvas(outW, outH);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, (cw - sw) / 2, (ch - sh) / 2, sw, sh, 0, 0, outW, outH);
    return out;
  }

  function cropRect(canvas, sx, sy, sw, sh, outSize) {
    sw = Math.max(1, Math.min(canvas.width - sx, sw));
    sh = Math.max(1, Math.min(canvas.height - sy, sh));
    const ratio = sw / sh;
    let outW = Math.min(outSize || 1200, Math.round(sw));
    const outH = Math.round(outW / ratio);
    const out = makeCanvas(outW, outH);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, outW, outH);
    return out;
  }

  function rotateCanvas(canvas, deg, mirror) {
    const swap = deg % 180 !== 0;
    const out = makeCanvas(swap ? canvas.height : canvas.width, swap ? canvas.width : canvas.height);
    const ctx = out.getContext("2d");
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    if (mirror) ctx.scale(-1, 1);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return out;
  }

  function downsample(canvas, w, h) {
    const out = makeCanvas(w, h);
    const ctx = out.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // 分级缩小，避免一次性降采样出现锯齿
    let src = canvas;
    let cw = canvas.width, ch = canvas.height;
    while (cw / 2 >= w && ch / 2 >= h) {
      const step = makeCanvas(Math.max(w, Math.round(cw / 2)), Math.max(h, Math.round(ch / 2)));
      const sctx = step.getContext("2d");
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(src, 0, 0, step.width, step.height);
      src = step; cw = step.width; ch = step.height;
    }
    ctx.drawImage(src, 0, 0, w, h);
    return out;
  }

  function nearest(rgb, colors) {
    const lab = P.rgbToLab(rgb.r, rgb.g, rgb.b);
    let best = colors[0], bestD = Infinity;
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      const dL = lab.L - c.lab.L, da = lab.a - c.lab.a, db = lab.b - c.lab.b;
      const d = dL * dL + da * da + db * db;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function convert(canvas, opts) {
    const w = opts.w, h = opts.h;
    const palette = P.getPalette(opts.paletteId);
    const colors = palette.colors;
    const ratio = w / h;
    const ratioCanvas = centerCrop(canvas, ratio, Math.min(1400, Math.max(canvas.width, canvas.height)));
    const small = downsample(ratioCanvas, w, h);
    const data = small.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const grid = new Uint8Array(w * h);
    const counts = new Int32Array(51);
    const t0 = performance.now();
    let lumSum = 0, lumCount = 0;
    for (let i = 0; i < data.length; i += 16) {
      lumSum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      lumCount++;
    }

    if (!opts.dither) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const c = nearest({ r: data[i], g: data[i + 1], b: data[i + 2] }, colors);
          grid[y * w + x] = c.id;
          counts[c.id]++;
        }
      }
    } else {
      const errR = new Float32Array((w + 2) * (h + 1));
      const errG = new Float32Array((w + 2) * (h + 1));
      const errB = new Float32Array((w + 2) * (h + 1));
      const stride = w + 2;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const ei = y * stride + x + 1;
          const r = clamp(data[i] + errR[ei]);
          const g = clamp(data[i + 1] + errG[ei]);
          const b = clamp(data[i + 2] + errB[ei]);
          const c = nearest({ r, g, b }, colors);
          grid[y * w + x] = c.id;
          counts[c.id]++;
          const dr = r - c.rgb.r, dg = g - c.rgb.g, db = b - c.rgb.b;
          errR[ei + 1] += dr * 7 / 16; errG[ei + 1] += dg * 7 / 16; errB[ei + 1] += db * 7 / 16;
          errR[ei + stride - 1] += dr * 3 / 16; errG[ei + stride - 1] += dg * 3 / 16; errB[ei + stride - 1] += db * 3 / 16;
          errR[ei + stride] += dr * 5 / 16; errG[ei + stride] += dg * 5 / 16; errB[ei + stride] += db * 5 / 16;
          errR[ei + stride + 1] += dr / 16; errG[ei + stride + 1] += dg / 16; errB[ei + stride + 1] += db / 16;
        }
      }
    }

    const colorStats = [];
    for (let id = 1; id <= 50; id++) {
      if (counts[id] > 0) colorStats.push({ id, count: counts[id], color: P.colorById(id) });
    }
    colorStats.sort((a, b) => b.count - a.count || a.id - b.id);
    return {
      grid, counts, w, h,
      colorsUsed: colorStats.length,
      colorStats,
      total: w * h,
      avgLum: lumCount ? lumSum / lumCount : 1,
      duration: performance.now() - t0,
      paletteId: palette.id
    };
  }

  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * 渲染成品/预览豆图
   * opts: {grid,w,h,paletteId,fused,edge,size,pad,bg,rounded}
   */
  function renderArt(canvas, opts) {
    const w = opts.w, h = opts.h;
    const colors = P.getPalette(opts.paletteId).colors;
    const map = new Map(colors.map(c => [c.id, c]));
    const size = opts.size || 900;
    const edge = !!opts.edge;
    const fused = !!opts.fused;
    const pad = opts.pad != null ? opts.pad : edge ? Math.round(size * 0.055) : Math.round(size * 0.02);
    const cell = (size - pad * 2) / w;
    const outH = Math.round(pad * 2 + cell * h);
    canvas.width = size;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, outH);

    if (opts.bg) {
      ctx.fillStyle = opts.bg;
      ctx.fillRect(0, 0, size, outH);
    }

    if (edge) {
      ctx.save();
      roundRect(ctx, pad * 0.32, pad * 0.32, size - pad * 0.64, outH - pad * 0.64, Math.max(10, cell * 0.75));
      const bgGrad = ctx.createLinearGradient(0, 0, 0, outH);
      bgGrad.addColorStop(0, "#fdf8ef");
      bgGrad.addColorStop(1, "#f0e3d1");
      ctx.fillStyle = bgGrad;
      ctx.fill();
      ctx.lineWidth = Math.max(2, size * 0.003);
      ctx.strokeStyle = "rgba(160, 128, 92, .35)";
      ctx.stroke();
      ctx.restore();
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = opts.grid[y * w + x];
        if (!id) continue;
        if (opts.filled && !opts.filled[y * w + x]) continue;
        const c = map.get(id) || P.byIdFallback;
        if (!c) continue;
        const cx = pad + (x + 0.5) * cell;
        const cy = pad + (y + 0.5) * cell;
        if (fused) {
          const s = cell * 1.02;
          ctx.fillStyle = c.hex;
          roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.34);
          ctx.fill();
          // 融合后的高光
          const hg = ctx.createLinearGradient(cx - cell * 0.5, cy - cell * 0.5, cx + cell * 0.2, cy + cell * 0.45);
          hg.addColorStop(0, "rgba(255,255,255,.24)");
          hg.addColorStop(0.45, "rgba(255,255,255,.02)");
          hg.addColorStop(1, "rgba(0,0,0,.08)");
          ctx.fillStyle = hg;
          roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.34);
          ctx.fill();
          if (cell > 12) {
            ctx.fillStyle = "rgba(255,255,255,.32)";
            ctx.beginPath();
            ctx.ellipse(cx - cell * 0.16, cy - cell * 0.2, cell * 0.14, cell * 0.075, -0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          const r = cell * 0.445;
          ctx.save();
          ctx.shadowColor = "rgba(80, 52, 28, .28)";
          ctx.shadowBlur = cell * 0.18;
          ctx.shadowOffsetY = cell * 0.09;
          ctx.fillStyle = c.hex;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          // 圆柱侧面
          ctx.strokeStyle = "rgba(0,0,0,.13)";
          ctx.lineWidth = Math.max(0.6, cell * 0.045);
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
          ctx.stroke();
          // 顶部高光
          ctx.strokeStyle = "rgba(255,255,255,.34)";
          ctx.lineWidth = Math.max(0.6, cell * 0.08);
          ctx.beginPath();
          ctx.arc(cx, cy, r * 0.62, Math.PI * 1.08, Math.PI * 1.62);
          ctx.stroke();
          if (cell > 14) {
            ctx.fillStyle = "rgba(0,0,0,.07)";
            ctx.beginPath();
            ctx.arc(cx, cy, r * 0.17, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    return { cell, pad, outH };
  }

  function renderThumb(canvas, grid, w, h, paletteId, size) {
    renderArt(canvas, { grid, w, h, paletteId, fused: true, edge: false, pad: Math.round(size * 0.02), size: size || 200 });
    return canvas.toDataURL("image/jpeg", 0.8);
  }

  window.BeadImage = {
    makeCanvas, fileToCanvas, loadUrl, centerCrop, cropRect, rotateCanvas,
    downsample, convert, renderArt, renderThumb, roundRect
  };
})();
