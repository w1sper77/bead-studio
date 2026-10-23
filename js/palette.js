/* 色板定义：色号编码 01–50，色值按主流拼豆色卡方向标定，palette v1 */
(function () {
  "use strict";

  const RAW = [
    // 无彩色 10
    ["01", "白色", "#FFFFFF", "无彩色"],
    ["02", "米白", "#F6EFDF", "无彩色"],
    ["03", "浅灰", "#DCDAD3", "无彩色"],
    ["04", "中灰", "#A9A8A2", "无彩色"],
    ["05", "深灰", "#6E6D68", "无彩色"],
    ["06", "炭黑", "#3B3A38", "无彩色"],
    ["07", "纯黑", "#151515", "无彩色"],
    ["08", "银灰", "#C3C7CA", "无彩色"],
    ["09", "雾灰", "#8B9397", "无彩色"],
    ["10", "奶油", "#FFF2CE", "无彩色"],
    // 红色系 7
    ["11", "正红", "#E6403B", "红色系"],
    ["12", "深红", "#A61E2B", "红色系"],
    ["13", "玫红", "#E7507E", "红色系"],
    ["14", "珊瑚红", "#F26A5C", "红色系"],
    ["15", "砖红", "#B74530", "红色系"],
    ["16", "粉红", "#F7A8BB", "红色系"],
    ["17", "酒红", "#7A2233", "红色系"],
    // 橙色系 5
    ["18", "橘色", "#F78B2D", "橙色系"],
    ["19", "亮橙", "#FFA653", "橙色系"],
    ["20", "焦糖", "#C67B3B", "橙色系"],
    ["21", "杏色", "#F7C398", "橙色系"],
    ["22", "南瓜", "#DD6B2B", "橙色系"],
    // 黄色系 6
    ["23", "亮黄", "#FFD84D", "黄色系"],
    ["24", "柠檬黄", "#F2E24C", "黄色系"],
    ["25", "金黄", "#F4B62C", "黄色系"],
    ["26", "土黄", "#C9A24B", "黄色系"],
    ["27", "芥末", "#A88A32", "黄色系"],
    ["28", "香槟", "#EDD9A3", "黄色系"],
    // 绿色系 8
    ["29", "草绿", "#7FBF4D", "绿色系"],
    ["30", "嫩绿", "#A9D86E", "绿色系"],
    ["31", "墨绿", "#2F5D3A", "绿色系"],
    ["32", "森林绿", "#3F7A45", "绿色系"],
    ["33", "青绿", "#3FA98E", "绿色系"],
    ["34", "薄荷", "#A8E0C8", "绿色系"],
    ["35", "橄榄", "#7C8A3A", "绿色系"],
    ["36", "湖绿", "#2E8B78", "绿色系"],
    // 蓝色系 7
    ["37", "天蓝", "#6EC6E8", "蓝色系"],
    ["38", "湖蓝", "#3592C4", "蓝色系"],
    ["39", "宝蓝", "#2B5FB0", "蓝色系"],
    ["40", "藏蓝", "#1C2F55", "蓝色系"],
    ["41", "深蓝", "#17406E", "蓝色系"],
    ["42", "浅蓝", "#B9DDF2", "蓝色系"],
    ["43", "靛蓝", "#4A5FA5", "蓝色系"],
    // 紫色系 4
    ["44", "香芋", "#C9A7D8", "紫色系"],
    ["45", "薰衣草", "#A98FD1", "紫色系"],
    ["46", "紫罗兰", "#7B4FA0", "紫色系"],
    ["47", "茄紫", "#4B2A55", "紫色系"],
    // 肤色 / 棕褐 3
    ["48", "浅肤", "#F3CBA9", "肤色棕褐"],
    ["49", "深肤", "#B87F5C", "肤色棕褐"],
    ["50", "棕褐", "#6B4A36", "肤色棕褐"]
  ];

  const COLORS = RAW.map((c, i) => {
    const rgb = hexToRgb(c[2]);
    return {
      id: i + 1,
      code: c[0],
      name: c[1],
      hex: c[2],
      group: c[3],
      rgb,
      lab: rgbToLab(rgb.r, rgb.g, rgb.b)
    };
  });

  const BY_ID = new Map(COLORS.map(c => [c.id, c]));

  const COMPACT_IDS = [
    1, 3, 5, 6, 7, 10, 11, 12, 13, 14, 16, 17, 18, 20, 21, 23, 25, 26,
    29, 31, 32, 33, 37, 38, 40, 42, 44, 46, 48, 50
  ];

  const PALETTES = {
    std50: {
      id: "std50",
      name: "50 色标准板",
      shortName: "标准 50 色",
      version: "palette v1",
      colors: COLORS
    },
    std30: {
      id: "std30",
      name: "30 色精简板",
      shortName: "精简 30 色",
      version: "palette v1 · 30 色子集",
      colors: COMPACT_IDS.map(id => BY_ID.get(id))
    }
  };

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function rgbToLab(r, g, b) {
    let R = r / 255, G = g / 255, B = b / 255;
    R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
    G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
    B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;
    let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    X = f(X); Y = f(Y); Z = f(Z);
    return { L: 116 * Y - 16, a: 500 * (X - Y), b: 200 * (Y - Z) };
  }

  function rgbToHex(r, g, b) {
    const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return "#" + c(r) + c(g) + c(b);
  }

  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  function getPalette(id) {
    return PALETTES[id] || PALETTES.std50;
  }

  function colorById(id) {
    return BY_ID.get(id) || null;
  }

  function deltaE(a, b) {
    const dL = a.L - b.L, da = a.a - b.a, db = a.b - b.b;
    return dL * dL + da * da + db * db;
  }

  window.BeadPalette = {
    COLORS, BY_ID, PALETTES, COMPACT_IDS,
    hexToRgb, rgbToHex, rgbToLab, getPalette, colorById, deltaE, luminance
  };
})();
