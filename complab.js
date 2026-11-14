// ===================== COMPOSITION LAB =====================
// Live full-frame composition playground over the FadiFiles shoot clips.
// Pick a clip (+ optional alpha matte), flip through symmetry / duplicate /
// matte-state presets, tweak params, and copy the deliverable — an exact
// ffmpeg filtergraph (geometric) or a render_song.py `states` entry (matte).
window.CompLab = (function () {
  const FADI = [
    "#ff0060",
    "#ffa405",
    "#ffe400",
    "#11ff05",
    "#05d3ff",
    "#6f05ff",
    "#f605ff",
  ];
  const FADI_NAMES = [
    "pink",
    "orange",
    "yellow",
    "green",
    "cyan",
    "purple",
    "magenta",
  ];
  const ASPECTS = {
    "16:9": [1280, 720],
    "9:16": [405, 720],
    "4:5": [576, 720],
    "1:1": [720, 720],
    "3:4": [540, 720],
  };

  // ---- shared state ----
  const S = {
    vid: null,
    mat: null,
    vw: 0,
    vh: 0,
    mw: 0,
    mh: 0,
    hasMatte: false,
    ready: false,
  };
  const P = {
    // every control writes into one flat param bag
    aspect: "16:9",
    fit: "cover",
    bg: "#000000",
    zoom: 1,
    ox: 0,
    oy: 0,
    rate: 1,
    // preset-specific (re-seeded on preset change from preset.defaults)
  };
  let active = null; // current preset object
  let raf = 0,
    visible = false,
    recorder = null,
    recChunks = [];
  const offA = document.createElement("canvas"); // subject build
  const offB = document.createElement("canvas"); // matte sample
  const offC = document.createElement("canvas"); // echo / box scratch

  // ---------- draw helpers ----------
  function fitDims(sw, sh, dw, dh, fit) {
    if (fit === "fill") return { w: dw, h: dh };
    const s =
      fit === "contain"
        ? Math.min(dw / sw, dh / sh)
        : Math.max(dw / sw, dh / sh);
    return { w: sw * s, h: sh * s };
  }
  // draw a video element into rect (x,y,w,h) with clip + flip/rot/zoom/offset
  function cell(ctx, elv, sw, sh, x, y, w, h, o) {
    o = o || {};
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.translate(x + w / 2, y + h / 2);
    if (o.rot) ctx.rotate(o.rot);
    const z = (o.zoom || 1) * (o.useGlobalZoom === false ? 1 : P.zoom);
    ctx.scale((o.flipX ? -1 : 1) * z, (o.flipY ? -1 : 1) * z);
    const fit = o.fit || P.fit;
    const d = fitDims(sw, sh, w, h, fit);
    const ox = (o.ox != null ? o.ox : P.ox) * w;
    const oy = (o.oy != null ? o.oy : P.oy) * h;
    ctx.drawImage(elv, -d.w / 2 + ox, -d.h / 2 + oy, d.w, d.h);
    ctx.restore();
  }
  const full = (ctx, W, H, o) => cell(ctx, S.vid, S.vw, S.vh, 0, 0, W, H, o);
  function fillBg(ctx, W, H, col) {
    ctx.fillStyle = col || P.bg;
    ctx.fillRect(0, 0, W, H);
  }

  // current Fadi cycle color index — held, or strobing over time (matches render_song scol)
  function cyc() {
    const h = parseInt(P.holdColor);
    if (!isNaN(h) && h >= 0) return h % 7;
    const f = Math.floor(
      ((S.vid ? S.vid.currentTime : 0) * 30) / (P.cycleFrames || 4),
    );
    return ((f % 7) + 7) % 7;
  }
  const fadiCol = () => FADI[cyc()];

  // build an alpha-keyed subject canvas (matte if loaded, else corner chroma-key).
  // fill: 'footage' (default) | 'white' | 'black' | 'fadi'; colIdx for fadi.
  // NOTE: reuses offA — copy/consume the result before the next subject() call.
  function subject(W, H, fill, colIdx) {
    fill = fill || P.subjFill || "footage";
    offA.width = W;
    offA.height = H;
    const x = offA.getContext("2d");
    x.clearRect(0, 0, W, H);
    cell(x, S.vid, S.vw, S.vh, 0, 0, W, H, { fit: P.fit });
    const img = x.getImageData(0, 0, W, H),
      d = img.data;
    if (S.hasMatte) {
      offB.width = W;
      offB.height = H;
      const mx = offB.getContext("2d");
      cell(mx, S.mat, S.mw, S.mh, 0, 0, W, H, { fit: P.fit });
      const md = mx.getImageData(0, 0, W, H).data;
      for (let i = 0; i < d.length; i += 4) d[i + 3] = md[i]; // gray(R) -> alpha
    } else {
      const br = d[0],
        bg = d[1],
        bb = d[2],
        tol = P.keyTol != null ? P.keyTol : 60;
      for (let i = 0; i < d.length; i += 4) {
        const dist =
          Math.abs(d[i] - br) +
          Math.abs(d[i + 1] - bg) +
          Math.abs(d[i + 2] - bb);
        d[i + 3] = Math.max(0, Math.min(255, (dist - tol) * 3));
      }
    }
    x.putImageData(img, 0, 0);
    if (fill !== "footage") {
      x.globalCompositeOperation = "source-in";
      x.fillStyle =
        fill === "white"
          ? "#fff"
          : fill === "black"
            ? "#000"
            : FADI[colIdx != null ? colIdx : cyc()];
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = "source-over";
    }
    return offA;
  }
  // snapshot the current subject() result into a standalone canvas so it survives later subject() calls
  function snap(W, H) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.getContext("2d").drawImage(offA, 0, 0);
    return c;
  }

  // ---------- recipe builders ----------
  const R_PRORES = "-c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le";
  function ffcmd(filter, matte) {
    const inp = matte ? "-i IN.mov -i MATTE.mov" : "-i IN.mov";
    return `ffmpeg ${inp} -filter_complex "${filter}" -map "[v]" ${R_PRORES} OUT.mov`;
  }
  // matte states are spec-driven, not ffmpeg — emit the render_song.py spec entry
  function stateSpec(type, hasColor) {
    const h = parseInt(P.holdColor);
    const colLine =
      hasColor && !isNaN(h) && h >= 0 ? `, "color_index": ${h}` : "";
    return {
      spec: `// render_song.py — add to the song spec's "states":\n{ "song_time": <beat>, "beats": 2.0, "type": "${type}"${colLine} }`,
      matte: true,
      note:
        `Matte-driven state (needs matte.mov via make_matte.py). ` +
        (hasColor
          ? `color_index omitted = auto Fadi cycle; set 0–6 to hold ${FADI_NAMES.join("/")}.`
          : `Place it on the sung word / beat.`),
    };
  }

  const rng = (key, label, min, max, step, def) => ({
    type: "range",
    key,
    label,
    min,
    max,
    step,
    def,
  });
  const tog = (key, label, def) => ({ type: "toggle", key, label, def });
  const sel = (key, label, options, def) => ({
    type: "select",
    key,
    label,
    options,
    def,
  });

  // shared controls for the matte-state presets
  const HOLD = sel(
    "holdColor",
    "fadi color",
    [["-1", "auto-cycle"], ...FADI.map((_, i) => [String(i), FADI_NAMES[i]])],
    "-1",
  );
  const STATE_PARAMS = [
    HOLD,
    rng("cycleFrames", "cycle speed (frames/color)", 2, 15, 1, 4),
    rng("keyTol", "auto-key tol", 10, 160, 2, 60),
  ];

  // background painters used by the state presets
  function paintBase(ctx, W, H, mode) {
    if (mode === "footage") full(ctx, W, H, {});
    else if (mode === "white") fillBg(ctx, W, H, "#ffffff");
    else if (mode === "fadi") fillBg(ctx, W, H, fadiCol());
    else if (mode === "split") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W / 2, H);
      ctx.fillStyle = fadiCol();
      ctx.fillRect(W / 2, 0, W / 2, H);
    } else fillBg(ctx, W, H, "#000000");
  }
  // base + alpha-keyed subject on top
  function recolor(ctx, W, H, baseMode, subjFill) {
    paintBase(ctx, W, H, baseMode);
    ctx.drawImage(subject(W, H, subjFill, cyc()), 0, 0);
  }

  const PRESETS = [
    // ---------------- Symmetry ----------------
    {
      id: "mirror-x",
      label: "Mirror X",
      group: "Symmetry",
      blurb: "left half reflected →",
      defaults: { fit: "cover" },
      params: [tog("flipSide", "flip side", false)],
      draw(ctx, W, H) {
        fillBg(ctx, W, H);
        const a = P.flipSide ? 1 : 0;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W / 2, H);
        ctx.clip();
        if (a) {
          ctx.translate(W, 0);
          ctx.scale(-1, 1);
        }
        full(ctx, W, H, {});
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(W / 2, 0, W / 2, H);
        ctx.clip();
        if (!a) {
          ctx.translate(W, 0);
          ctx.scale(-1, 1);
        }
        full(ctx, W, H, {});
        ctx.restore();
      },
      recipe() {
        return {
          filter:
            "[0:v]crop=iw/2:ih:0:0,split[l][r];[r]hflip[rf];[l][rf]hstack[v]",
          note: "Vertical-seam mirror: keeps the left half, mirrors it right. Pure ffmpeg → drop on the cut/fx layer.",
        };
      },
    },

    {
      id: "kaleido",
      label: "Kaleidoscope",
      group: "Symmetry",
      blurb: "radial wedges",
      defaults: { fit: "cover" },
      params: [
        rng("slices", "wedges", 4, 16, 2, 8),
        tog("mirror", "mirror wedges", true),
        tog("spin", "auto-spin", false),
        rng("rotDeg", "rotate °", 0, 360, 1, 0),
      ],
      draw(ctx, W, H) {
        fillBg(ctx, W, H);
        const n = P.slices || 8,
          cx = W / 2,
          cy = H / 2,
          Rr = Math.hypot(W, H),
          ang = (Math.PI * 2) / n;
        const base =
          ((P.rotDeg || 0) * Math.PI) / 180 +
          (P.spin ? (performance.now() / 1000) * 0.4 : 0);
        const d = fitDims(S.vw, S.vh, Rr * 2, Rr * 2, "cover");
        for (let i = 0; i < n; i++) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(base + i * ang);
          if (P.mirror && i % 2) ctx.scale(1, -1);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, Rr, -ang / 2, ang / 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(
            S.vid,
            -d.w / 2 + (P.ox || 0) * Rr,
            -d.h / 2 + (P.oy || 0) * Rr,
            d.w,
            d.h,
          );
          ctx.restore();
        }
      },
      recipe() {
        return {
          filter: "",
          note: "Kaleidoscope has no clean native ffmpeg filter. Bake it here with ● REC (canvas → webm), or replicate downstream with a GLSL pass. The mirror/dup/flip presets export exact ffmpeg.",
        };
      },
    },

    // ---------------- Duplicate ----------------
    {
      id: "dup2",
      label: "Squeeze ×2",
      group: "Duplicate",
      blurb: "anamorphic half-width pair",
      defaults: { fit: "fill" },
      params: [tog("mirrorRight", "mirror right copy", false)],
      draw(ctx, W, H) {
        fillBg(ctx, W, H);
        cell(ctx, S.vid, S.vw, S.vh, 0, 0, W / 2, H, { fit: "fill" });
        cell(ctx, S.vid, S.vw, S.vh, W / 2, 0, W / 2, H, {
          fit: "fill",
          flipX: P.mirrorRight,
        });
      },
      recipe() {
        const m = P.mirrorRight;
        return {
          filter: m
            ? "[0:v]scale=iw/2:ih,split[a][b];[b]hflip[b2];[a][b2]hstack[v]"
            : "[0:v]scale=iw/2:ih,split[a][b];[a][b]hstack[v]",
          note:
            "Whole frame squeezed to half width, duplicated side-by-side" +
            (m ? " (right copy mirrored = book-fold)." : "."),
        };
      },
    },

    {
      id: "flip180",
      label: "180° Pair",
      group: "Duplicate",
      blurb: "right copy upside-down",
      defaults: { fit: "fill" },
      params: [
        sel(
          "orient",
          "split",
          [
            ["h", "side-by-side"],
            ["v", "stacked"],
          ],
          "h",
        ),
      ],
      draw(ctx, W, H) {
        fillBg(ctx, W, H);
        if (P.orient === "v") {
          cell(ctx, S.vid, S.vw, S.vh, 0, 0, W, H / 2, { fit: "fill" });
          cell(ctx, S.vid, S.vw, S.vh, 0, H / 2, W, H / 2, {
            fit: "fill",
            flipX: true,
            flipY: true,
          });
        } else {
          cell(ctx, S.vid, S.vw, S.vh, 0, 0, W / 2, H, { fit: "fill" });
          cell(ctx, S.vid, S.vw, S.vh, W / 2, 0, W / 2, H, {
            fit: "fill",
            flipX: true,
            flipY: true,
          });
        }
      },
      recipe() {
        return P.orient === "v"
          ? {
              filter:
                "[0:v]scale=iw:ih/2,split[a][b];[b]hflip,vflip[b2];[a][b2]vstack[v]",
              note: "You upright on top, a 180°-rotated copy below.",
            }
          : {
              filter:
                "[0:v]scale=iw/2:ih,split[a][b];[b]hflip,vflip[b2];[a][b2]hstack[v]",
              note: "You upright on the left, a 180°-rotated copy on the right (hflip+vflip = rotate 180°).",
            };
      },
    },

    {
      id: "reflect-v",
      label: "Water Reflect",
      group: "Duplicate",
      blurb: "bottom = flipped reflection",
      defaults: { fit: "fill" },
      params: [],
      draw(ctx, W, H) {
        fillBg(ctx, W, H);
        cell(ctx, S.vid, S.vw, S.vh, 0, 0, W, H / 2, { fit: "fill" });
        cell(ctx, S.vid, S.vw, S.vh, 0, H / 2, W, H / 2, {
          fit: "fill",
          flipY: true,
        });
      },
      recipe() {
        return {
          filter:
            "[0:v]scale=iw:ih/2,split[a][b];[b]vflip[b2];[a][b2]vstack[v]",
          note: "Top half upright, mirrored straight down — pool/water reflection.",
        };
      },
    },

    {
      id: "triptych",
      label: "Triptych",
      group: "Duplicate",
      blurb: "3 squeezed columns",
      defaults: { fit: "fill" },
      params: [tog("altFlip", "mirror middle", true)],
      draw(ctx, W, H) {
        fillBg(ctx, W, H);
        const c = W / 3;
        cell(ctx, S.vid, S.vw, S.vh, 0, 0, c, H, { fit: "fill" });
        cell(ctx, S.vid, S.vw, S.vh, c, 0, c, H, {
          fit: "fill",
          flipX: P.altFlip,
        });
        cell(ctx, S.vid, S.vw, S.vh, 2 * c, 0, c, H, { fit: "fill" });
      },
      recipe() {
        return {
          filter: P.altFlip
            ? "[0:v]scale=iw/3:ih,split=3[a][b][c];[b]hflip[b2];[a][b2][c]hstack=3[v]"
            : "[0:v]scale=iw/3:ih,split=3[a][b][c];[a][b][c]hstack=3[v]",
          note:
            "Three thirds-width copies" +
            (P.altFlip ? ", middle mirrored." : "."),
        };
      },
    },

    {
      id: "quad-grid",
      label: "Quad Grid",
      group: "Duplicate",
      blurb: "2×2 — four repeats",
      defaults: { fit: "fill", mirrorPattern: false },
      params: [tog("mirrorPattern", "mirror tiles", false)],
      draw(ctx, W, H) {
        fillBg(ctx, W, H);
        const hw = W / 2,
          hh = H / 2,
          m = P.mirrorPattern;
        cell(ctx, S.vid, S.vw, S.vh, 0, 0, hw, hh, { fit: "fill" });
        cell(ctx, S.vid, S.vw, S.vh, hw, 0, hw, hh, { fit: "fill", flipX: m });
        cell(ctx, S.vid, S.vw, S.vh, 0, hh, hw, hh, { fit: "fill", flipY: m });
        cell(ctx, S.vid, S.vw, S.vh, hw, hh, hw, hh, {
          fit: "fill",
          flipX: m,
          flipY: m,
        });
      },
      recipe() {
        return {
          filter: P.mirrorPattern
            ? "[0:v]scale=iw/2:ih/2,split=4[a][b][c][d];[b]hflip[b2];[c]vflip[c2];[d]hflip,vflip[d2];[a][b2]hstack[t];[c2][d2]hstack[btm];[t][btm]vstack[v]"
            : "[0:v]scale=iw/2:ih/2,split=4[a][b][c][d];[a][b]hstack[t];[c][d]hstack[btm];[t][btm]vstack[v]",
          note:
            "Full frame squeezed into a 2×2 grid" +
            (P.mirrorPattern ? ", tiles mirror outward." : "."),
        };
      },
    },

    // ---------------- Matte states (from render_song.py) ----------------
    {
      id: "rainbow_me_white",
      label: "Rainbow Me / White",
      group: "Matte States",
      blurb: "you = fadi, bg white",
      defaults: { fit: "cover", holdColor: "-1", cycleFrames: 4, keyTol: 60 },
      params: STATE_PARAMS,
      draw(ctx, W, H) {
        recolor(ctx, W, H, "white", "fadi");
      },
      recipe() {
        return stateSpec("white_bg_rainbow_me", true);
      },
    },

    {
      id: "white_me_fadi",
      label: "White Me / Fadi BG",
      group: "Matte States",
      blurb: "you = white, bg fadi cycle",
      defaults: { fit: "cover", holdColor: "-1", cycleFrames: 4, keyTol: 60 },
      params: STATE_PARAMS,
      draw(ctx, W, H) {
        recolor(ctx, W, H, "fadi", "white");
      },
      recipe() {
        return stateSpec("white_me_rainbow_bg", true);
      },
    },

    {
      id: "rainbow_me_footage",
      label: "Rainbow Me / Footage",
      group: "Matte States",
      blurb: "you = fadi over scene",
      defaults: { fit: "cover", holdColor: "-1", cycleFrames: 4, keyTol: 60 },
      params: STATE_PARAMS,
      draw(ctx, W, H) {
        recolor(ctx, W, H, "footage", "fadi");
      },
      recipe() {
        return stateSpec("rainbow_me_normal_bg", true);
      },
    },

    {
      id: "me_on_white",
      label: "Me on White",
      group: "Matte States",
      blurb: "normal you, white bg",
      defaults: { fit: "cover", keyTol: 60 },
      params: STATE_PARAMS,
      draw(ctx, W, H) {
        recolor(ctx, W, H, "white", "footage");
      },
      recipe() {
        return stateSpec("me_on_white", false);
      },
    },

    {
      id: "me_on_fadi",
      label: "Me on Fadi",
      group: "Matte States",
      blurb: "normal you, fadi bg",
      defaults: { fit: "cover", holdColor: "-1", cycleFrames: 4, keyTol: 60 },
      params: STATE_PARAMS,
      draw(ctx, W, H) {
        recolor(ctx, W, H, "fadi", "footage");
      },
      recipe() {
        return stateSpec("rainbow_bg_me", true);
      },
    },

    {
      id: "split",
      label: "Split White|Fadi",
      group: "Matte States",
      blurb: "½ white · ½ fadi, you on top",
      defaults: { fit: "cover", holdColor: "-1", cycleFrames: 4, keyTol: 60 },
      params: STATE_PARAMS,
      draw(ctx, W, H) {
        recolor(ctx, W, H, "split", "footage");
      },
      recipe() {
        return stateSpec("box_side_lyric", true);
      },
    },

    {
      id: "twin180",
      label: "180° Twins (matte)",
      group: "Matte States",
      blurb: "two roto yous, one flipped",
      defaults: {
        fit: "cover",
        baseMode: "footage",
        subjFill: "footage",
        subjScale: 1.0,
        gap: 0.0,
        uprightFront: true,
        holdColor: "-1",
        cycleFrames: 4,
        keyTol: 60,
      },
      params: [
        sel(
          "baseMode",
          "background",
          [
            ["footage", "footage"],
            ["white", "white"],
            ["black", "black"],
            ["fadi", "fadi color"],
          ],
          "footage",
        ),
        sel(
          "subjFill",
          "you =",
          [
            ["footage", "footage"],
            ["white", "white"],
            ["fadi", "fadi fill"],
          ],
          "footage",
        ),
        rng("subjScale", "copy size", 0.5, 1.1, 0.02, 0.85),
        rng("gap", "overlap gap", 0, 0.4, 0.01, 0.16),
        tog("uprightFront", "upright in front", true),
        HOLD,
        rng("cycleFrames", "cycle speed (frames/color)", 2, 15, 1, 4),
        rng("keyTol", "auto-key tol", 10, 160, 2, 60),
      ],
      draw(ctx, W, H) {
        paintBase(ctx, W, H, P.baseMode);
        subject(W, H, P.subjFill, cyc());
        const sub = snap(W, H); // roto'd you, snapshot so we can stamp it twice
        const sc = P.subjScale || 0.85;
        const dw = W * sc,
          dh = H * sc,
          dx = (W - dw) / 2;
        const voff = (P.gap != null ? P.gap : 0.16) * H;
        const drawUpright = () =>
          ctx.drawImage(sub, 0, 0, W, H, dx, (H - dh) / 2 + voff, dw, dh);
        const drawFlipped = () => {
          ctx.save();
          ctx.translate(W / 2, (H - dh) / 2 + dh / 2 - voff);
          ctx.rotate(Math.PI);
          ctx.drawImage(sub, 0, 0, W, H, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
        };
        // upside-down copy behind/up top, right-side-up copy in front/lower
        if (P.uprightFront !== false) {
          drawFlipped();
          drawUpright();
        } else {
          drawUpright();
          drawFlipped();
        }
      },
      recipe() {
        const hasColor = P.baseMode === "fadi" || P.subjFill === "fadi";
        const h = parseInt(P.holdColor);
        const col =
          hasColor && !isNaN(h) && h >= 0 ? `, "color_index": ${h}` : "";
        return {
          spec:
            `// NEW matte state for render_song.py (states.py): roto you (matte), stamp 2 copies over the base —\n` +
            `//   upside-down copy behind/top, right-side-up copy in front/bottom; size≈${(P.subjScale || 0.85).toFixed(2)}, overlap gap≈${(P.gap ?? 0.16).toFixed(2)}H.\n` +
            `{ "song_time": <beat>, "beats": 2.0, "type": "twin_flip_180"${col} }`,
          matte: true,
          note: `Two roto copies of you over a ${P.baseMode} base; the upright (lower) one is in front. New state — I'll wire "twin_flip_180" into states.py once you lock the look. Needs matte.mov.`,
        };
      },
    },

    {
      id: "flash_full",
      label: "Flash Full",
      group: "Matte States",
      blurb: "whole frame fadi",
      defaults: { holdColor: "-1", cycleFrames: 3 },
      params: [
        HOLD,
        rng("cycleFrames", "cycle speed (frames/color)", 2, 15, 1, 3),
      ],
      draw(ctx, W, H) {
        fillBg(ctx, W, H, fadiCol());
      },
      recipe() {
        return stateSpec("flash_full", true);
      },
    },

    {
      id: "flash_half",
      label: "Flash Half",
      group: "Matte States",
      blurb: "left half fadi, rest scene",
      defaults: { fit: "cover", holdColor: "-1", cycleFrames: 3 },
      params: [
        HOLD,
        rng("cycleFrames", "cycle speed (frames/color)", 2, 15, 1, 3),
      ],
      draw(ctx, W, H) {
        full(ctx, W, H, {});
        ctx.fillStyle = fadiCol();
        ctx.fillRect(0, 0, W / 2, H);
      },
      recipe() {
        return stateSpec("flash_half", true);
      },
    },

    {
      id: "echo_offset",
      label: "Echo (1 ghost)",
      group: "Matte States",
      blurb: "single fadi edge",
      defaults: {
        fit: "cover",
        holdColor: "-1",
        cycleFrames: 4,
        keyTol: 60,
        echoOff: 0.028,
      },
      params: [
        HOLD,
        rng("cycleFrames", "cycle speed (frames/color)", 2, 15, 1, 4),
        rng("echoOff", "echo gap", 0.005, 0.12, 0.002, 0.028),
        rng("keyTol", "auto-key tol", 10, 160, 2, 60),
      ],
      draw(ctx, W, H) {
        drawEcho(ctx, W, H, [P.echoOff || 0.028]);
      },
      recipe() {
        return stateSpec("echo_offset", true);
      },
    },

    {
      id: "echo_trail",
      label: "Echo Trail (5)",
      group: "Matte States",
      blurb: "staggered fadi ghosts",
      defaults: { fit: "cover", keyTol: 60 },
      params: [rng("keyTol", "auto-key tol", 10, 160, 2, 60)],
      draw(ctx, W, H) {
        drawEcho(ctx, W, H, [0.018, 0.036, 0.054, 0.072, 0.09], true);
      },
      recipe() {
        return stateSpec("echo_trail", false);
      },
    },

    {
      id: "box",
      label: "Box (you in frame)",
      group: "Matte States",
      blurb: "you-on-white inside fadi",
      defaults: { fit: "cover", holdColor: "-1", cycleFrames: 4, keyTol: 60 },
      params: STATE_PARAMS,
      draw(ctx, W, H) {
        fillBg(ctx, W, H, fadiCol());
        offC.width = W;
        offC.height = H;
        const t = offC.getContext("2d");
        t.fillStyle = "#fff";
        t.fillRect(0, 0, W, H);
        t.drawImage(subject(W, H, "footage"), 0, 0);
        const s = 0.6,
          bw = W * s,
          bh = H * s;
        ctx.drawImage(offC, (W - bw) / 2, (H - bh) / 2, bw, bh);
      },
      recipe() {
        return stateSpec("box", true);
      },
    },
  ];

  // colored echo edges behind the real subject (mirrors render_song's roll(a)-a math)
  function drawEcho(ctx, W, H, offs, multiColor) {
    full(ctx, W, H, {}); // footage background
    subject(W, H, "white");
    const base = snap(W, H); // original alpha mask (white fill) — snapshot before reuse
    for (let j = offs.length - 1; j >= 0; j--) {
      // farthest first, nearest stays on top
      const ci = multiColor ? (cyc() + j + 1) % 7 : cyc();
      subject(W, H, "fadi", ci);
      const colored = snap(W, H); // solid-color silhouette
      offC.width = W;
      offC.height = H;
      const e = offC.getContext("2d");
      e.clearRect(0, 0, W, H);
      e.drawImage(colored, Math.round(offs[j] * W), 0); // shift the colored silhouette
      e.globalCompositeOperation = "destination-out";
      e.drawImage(base, 0, 0); // erase original-subject area → protruding edge
      e.globalCompositeOperation = "source-over";
      ctx.drawImage(offC, 0, 0);
    }
    ctx.drawImage(subject(W, H, "footage"), 0, 0); // real subject on top
  }

  // ---------- UI build ----------
  let DOM = {};
  function buildPresetRail() {
    const wrap = DOM.presets;
    wrap.replaceChildren();
    const groups = {};
    PRESETS.forEach((p) => (groups[p.group] = groups[p.group] || []).push(p));
    Object.keys(groups).forEach((g) => {
      const h = document.createElement("div");
      h.className = "grouphead";
      h.textContent = g;
      wrap.appendChild(h);
      groups[g].forEach((p) => {
        const b = document.createElement("button");
        b.dataset.id = p.id;
        b.appendChild(document.createTextNode(p.label));
        const sm = document.createElement("small");
        sm.textContent = p.blurb;
        b.appendChild(sm);
        b.onclick = () => selectPreset(p.id);
        wrap.appendChild(b);
      });
    });
  }
  function selectPreset(id) {
    active = PRESETS.find((p) => p.id === id) || PRESETS[0];
    presetIdx = PRESETS.indexOf(active);
    Object.assign(P, active.defaults || {});
    [...DOM.presets.querySelectorAll("button")].forEach((b) =>
      b.classList.toggle("active", b.dataset.id === id),
    );
    buildParams();
    updateRecipe();
    updateFeed();
    drawOnce();
  }
  // ---- mobile feed navigation ----
  let presetIdx = 0;
  function updateFeed() {
    if (!DOM.feedLabel) return;
    DOM.feedLabel.textContent = active ? active.label : "—";
    DOM.feedCount.textContent = `${presetIdx + 1}/${PRESETS.length}`;
  }
  function feedNav(delta) {
    const n = (presetIdx + delta + PRESETS.length) % PRESETS.length;
    selectPreset(PRESETS[n].id);
    if (DOM.feedHint) DOM.feedHint.classList.add("hide");
  }
  function flashVerdict(txt) {
    const v = DOM.feedVerdict;
    if (!v) return;
    v.textContent = txt;
    v.classList.add("show");
    setTimeout(() => v.classList.remove("show"), 450);
  }
  function quickVerdict(verdict) {
    if (active) {
      const rec = active.recipe();
      looks.unshift({
        preset: active.id,
        label: active.label,
        verdict, // 'like' | 'nope'
        stars: verdict === "like" ? 5 : 1,
        note: "",
        params: { ...P },
        summary: lookSummary(),
        recipe: rec.spec || (rec.filter ? ffcmd(rec.filter, rec.matte) : ""),
        t: Math.round((S.vid ? S.vid.currentTime : 0) * 100) / 100,
      });
      persistLooks();
      renderLooks();
    }
    flashVerdict(verdict === "like" ? "♥" : "✕");
    if (verdict === "like" && DOM.feedLike) {
      DOM.feedLike.classList.add("liked");
      setTimeout(() => DOM.feedLike.classList.remove("liked"), 320);
    }
    setTimeout(() => feedNav(1), 230);
  }
  function ctl(row) {
    const d = document.createElement("div");
    d.className = "cl-row";
    d.appendChild(row);
    return d;
  }
  function rangeRow(c) {
    const r = document.createElement("div");
    r.className = "cl-row";
    const lab = document.createElement("label");
    const val = document.createElement("b");
    val.textContent = P[c.key] ?? c.def;
    lab.append(c.label + " ", val);
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = c.min;
    inp.max = c.max;
    inp.step = c.step;
    inp.value = P[c.key] ?? c.def;
    inp.oninput = () => {
      P[c.key] = parseFloat(inp.value);
      val.textContent = inp.value;
      updateRecipe();
      drawOnce();
    };
    r.append(lab, inp);
    return r;
  }
  function selectRow(c) {
    const r = document.createElement("div");
    r.className = "cl-row";
    const lab = document.createElement("label");
    lab.textContent = c.label;
    r.appendChild(lab);
    const s = document.createElement("select");
    (c.options || []).forEach((o) => {
      const op = document.createElement("option");
      const [v, t] = Array.isArray(o) ? o : [o, o];
      op.value = v;
      op.textContent = t;
      s.appendChild(op);
    });
    s.value = P[c.key] ?? c.def;
    s.onchange = () => {
      P[c.key] = s.value;
      buildParams();
      updateRecipe();
      drawOnce();
    };
    r.appendChild(s);
    return r;
  }
  function toggleRow(c) {
    const t = document.createElement("div");
    t.className = "cl-toggle" + ((P[c.key] ?? c.def) ? " on" : "");
    const lab = document.createElement("span");
    lab.textContent = c.label;
    const st = document.createElement("span");
    st.textContent = (P[c.key] ?? c.def) ? "on" : "off";
    t.append(lab, st);
    t.onclick = () => {
      P[c.key] = !P[c.key];
      t.classList.toggle("on", P[c.key]);
      st.textContent = P[c.key] ? "on" : "off";
      updateRecipe();
      drawOnce();
    };
    return t;
  }
  function buildParams() {
    const wrap = DOM.params;
    wrap.replaceChildren();
    const head = (t) => {
      const h = document.createElement("div");
      h.className = "cl-section-h";
      h.textContent = t;
      wrap.appendChild(h);
    };
    head("Frame");
    wrap.appendChild(
      selectRow({
        key: "aspect",
        label: "aspect",
        options: Object.keys(ASPECTS),
        def: "16:9",
      }),
    );
    wrap.appendChild(
      selectRow({
        key: "fit",
        label: "fit",
        options: [
          ["cover", "cover"],
          ["contain", "contain"],
          ["fill", "fill / squeeze"],
        ],
        def: "cover",
      }),
    );
    const bgRow = document.createElement("div");
    bgRow.className = "cl-row";
    const bgLab = document.createElement("label");
    bgLab.textContent = "background";
    bgRow.appendChild(bgLab);
    const bgSel = document.createElement("select");
    [
      ["#000000", "black"],
      ["#ffffff", "white"],
      ...FADI.map((c, i) => [c, "fadi " + FADI_NAMES[i]]),
    ].forEach((o) => {
      const op = document.createElement("option");
      op.value = o[0];
      op.textContent = o[1];
      bgSel.appendChild(op);
    });
    bgSel.value = P.bg;
    bgSel.onchange = () => {
      P.bg = bgSel.value;
      drawOnce();
    };
    bgRow.appendChild(bgSel);
    wrap.appendChild(bgRow);
    wrap.appendChild(
      rangeRow({
        key: "zoom",
        label: "source zoom",
        min: 0.5,
        max: 2,
        step: 0.02,
        def: 1,
      }),
    );
    wrap.appendChild(
      rangeRow({
        key: "ox",
        label: "source shift-x",
        min: -0.5,
        max: 0.5,
        step: 0.01,
        def: 0,
      }),
    );
    wrap.appendChild(
      rangeRow({
        key: "oy",
        label: "source shift-y",
        min: -0.5,
        max: 0.5,
        step: 0.01,
        def: 0,
      }),
    );
    if (active && active.params.length) {
      head(active.label);
      active.params.forEach((c) => {
        if (c.type === "range") wrap.appendChild(rangeRow(c));
        else if (c.type === "select") wrap.appendChild(selectRow(c));
        else if (c.type === "toggle") wrap.appendChild(ctl(toggleRow(c)));
      });
    }
  }

  // ---------- canvas sizing + render loop ----------
  function resize() {
    const [w, h] = ASPECTS[P.aspect] || ASPECTS["16:9"];
    DOM.canvas.width = w;
    DOM.canvas.height = h;
  }
  function drawOnce() {
    resize();
    const ctx = DOM.canvas.getContext("2d"),
      W = DOM.canvas.width,
      H = DOM.canvas.height;
    ctx.clearRect(0, 0, W, H);
    fillBg(ctx, W, H);
    if (S.ready && active) {
      ctx.save();
      try {
        active.draw(ctx, W, H);
      } catch (e) {}
      ctx.restore();
    }
  }
  function loop() {
    if (!visible) {
      raf = 0;
      return;
    }
    drawOnce();
    if (S.vid) {
      const d = S.vid.duration || 0,
        t = S.vid.currentTime || 0;
      DOM.seek.value = d ? Math.round((t / d) * 1000) : 0;
      DOM.time.textContent = `${fmt(t)} / ${fmt(d)}`;
    }
    raf = requestAnimationFrame(loop);
  }
  const fmt = (s) => {
    s = s || 0;
    const m = Math.floor(s / 60),
      ss = Math.floor(s % 60);
    return `${m}:${String(ss).padStart(2, "0")}`;
  };

  // ---------- recipe ----------
  function updateRecipe() {
    if (!active) return;
    const r = active.recipe();
    if (r.spec) DOM.recipe.textContent = r.spec;
    else if (r.filter) DOM.recipe.textContent = ffcmd(r.filter, r.matte);
    else DOM.recipe.textContent = "— (canvas-only preset; use ● REC to export)";
    DOM.note.textContent = r.note || "";
  }

  // ---------- sources ----------
  const SAMPLE_CLIP = "clips/_sample-meandu.mp4"; // bundled 3s me&u loop
  const SAMPLE_MATTE = "clips/_sample-meandu-matte.mp4"; // its RVM alpha matte
  function loadInto(videoEl, src, onMeta) {
    videoEl.src = typeof src === "string" ? src : URL.createObjectURL(src);
    videoEl.loop = true;
    videoEl.load();
    videoEl.onloadedmetadata = () => {
      onMeta();
      videoEl.play().catch(() => {});
    };
  }
  function setClip(src) {
    loadInto(S.vid, src, () => {
      S.vw = S.vid.videoWidth;
      S.vh = S.vid.videoHeight;
      S.ready = true;
      DOM.empty.style.display = "none";
      DOM.clipLbl.classList.add("has");
      DOM.clipLbl.firstChild.nodeValue = "✓ Clip";
      S.vid.playbackRate = P.rate;
      if (!active) selectPreset("mirror-x");
      drawOnce();
    });
  }
  function setMatte(file) {
    loadInto(S.mat, file, () => {
      S.mw = S.mat.videoWidth;
      S.mh = S.mat.videoHeight;
      S.hasMatte = true;
      DOM.matteLbl.classList.add("has");
      DOM.matteLbl.firstChild.nodeValue = "✓ Matte";
      const sync = () => {
        if (
          Math.abs((S.mat.currentTime || 0) - (S.vid.currentTime || 0)) > 0.08
        )
          S.mat.currentTime = S.vid.currentTime;
      };
      S.vid.addEventListener("timeupdate", sync);
    });
  }

  // ---------- wiring ----------
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    DOM = {
      presets: document.getElementById("clPresets"),
      params: document.getElementById("clParams"),
      canvas: document.getElementById("clCanvas"),
      empty: document.getElementById("clEmpty"),
      seek: document.getElementById("clSeek"),
      time: document.getElementById("clTime"),
      play: document.getElementById("clPlay"),
      recipe: document.getElementById("clRecipe"),
      note: document.getElementById("clNote"),
      stage: document.getElementById("clStage"),
      clip: document.getElementById("clClip"),
      matte: document.getElementById("clMatte"),
      clipLbl: document.getElementById("clClipLbl"),
      matteLbl: document.getElementById("clMatteLbl"),
      snap: document.getElementById("clSnap"),
      rec: document.getElementById("clRec"),
      stars: document.getElementById("clStars"),
      fbNote: document.getElementById("clFbNote"),
      saveLook: document.getElementById("clSaveLook"),
      looks: document.getElementById("clLooks"),
      looksCount: document.getElementById("clLooksCount"),
      copyFb: document.getElementById("clCopyFb"),
      clearFb: document.getElementById("clClearFb"),
      // mobile feed
      canvasWrap: document.getElementById("clCanvasWrap"),
      feedLabel: document.getElementById("feedLabel"),
      feedCount: document.getElementById("feedCount"),
      feedHint: document.getElementById("feedHint"),
      feedVerdict: document.getElementById("feedVerdict"),
      feedPrev: document.getElementById("feedPrev"),
      feedNext: document.getElementById("feedNext"),
      feedNope: document.getElementById("feedNope"),
      feedLike: document.getElementById("feedLike"),
      feedMore: document.getElementById("feedMore"),
      sheet: document.getElementById("clParamsPanel"),
      sheetClose: document.getElementById("sheetClose"),
    };
    S.vid = document.getElementById("clVid");
    S.mat = document.getElementById("clMat");

    buildPresetRail();
    buildParams();
    buildStars();
    renderLooks();

    DOM.clip.onchange = (e) => {
      const f = e.target.files[0];
      if (f) setClip(f);
    };
    DOM.matte.onchange = (e) => {
      const f = e.target.files[0];
      if (f) setMatte(f);
    };
    DOM.play.onclick = () => {
      if (!S.vid.src) return;
      if (S.vid.paused) {
        S.vid.play();
        DOM.play.textContent = "⏸";
      } else {
        S.vid.pause();
        DOM.play.textContent = "▶";
      }
    };
    DOM.seek.oninput = () => {
      if (S.vid.duration) {
        S.vid.currentTime = (DOM.seek.value / 1000) * S.vid.duration;
        drawOnce();
      }
    };
    DOM.snap.onclick = () => {
      DOM.canvas.toBlob((b) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = (active ? active.id : "comp") + ".png";
        a.click();
      });
    };
    DOM.rec.onclick = toggleRec;

    const st = DOM.stage;
    ["dragenter", "dragover"].forEach((ev) =>
      st.addEventListener(ev, (e) => {
        e.preventDefault();
        st.classList.add("dragover");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      st.addEventListener(ev, (e) => {
        e.preventDefault();
        st.classList.remove("dragover");
      }),
    );
    st.addEventListener("drop", (e) => {
      const f = [...e.dataTransfer.files].find((f) =>
        f.type.startsWith("video"),
      );
      if (f) (S.ready ? setMatte : setClip)(f);
    });

    DOM.saveLook.onclick = saveLook;
    DOM.copyFb.onclick = copyFeedback;
    DOM.clearFb.onclick = () => {
      if (looks.length && confirm("Clear all saved looks?")) {
        looks = [];
        persistLooks();
        renderLooks();
      }
    };

    // ---- mobile feed controls ----
    DOM.feedPrev.onclick = () => feedNav(-1);
    DOM.feedNext.onclick = () => feedNav(1);
    DOM.feedLike.onclick = () => quickVerdict("like");
    DOM.feedNope.onclick = () => quickVerdict("nope");
    DOM.feedMore.onclick = () => DOM.sheet.classList.add("open");
    DOM.sheetClose.onclick = () => DOM.sheet.classList.remove("open");

    // swipe ↑ next / ↓ prev on the preview (and tap hint to dismiss)
    let tY = 0,
      tX = 0,
      tT = 0;
    DOM.canvasWrap.addEventListener(
      "touchstart",
      (e) => {
        const t = e.changedTouches[0];
        tY = t.clientY;
        tX = t.clientX;
        tT = Date.now();
      },
      { passive: true },
    );
    DOM.canvasWrap.addEventListener(
      "touchend",
      (e) => {
        const t = e.changedTouches[0];
        const dy = t.clientY - tY,
          dx = t.clientX - tX;
        if (
          Math.abs(dy) > 45 &&
          Math.abs(dy) > Math.abs(dx) &&
          Date.now() - tT < 700
        ) {
          feedNav(dy < 0 ? 1 : -1); // swipe up = next
        }
      },
      { passive: true },
    );

    // iOS fallback: resume muted playback on first user interaction (Low Power Mode etc.)
    const kick = () => {
      [S.vid, S.mat].forEach((v) => {
        if (v && v.src && v.paused) v.play().catch(() => {});
      });
    };
    document.addEventListener("touchstart", kick, { passive: true });
    document.addEventListener("click", kick, { passive: true });

    selectPreset("mirror-x");
  }

  // ---------- feedback / saved looks ----------
  const LOOKS_KEY = "fadi-complab-looks-v1";
  let looks = [];
  let curStars = 0;
  try {
    looks = JSON.parse(localStorage.getItem(LOOKS_KEY) || "[]");
  } catch (e) {
    looks = [];
  }
  function persistLooks() {
    localStorage.setItem(LOOKS_KEY, JSON.stringify(looks));
  }
  function buildStars() {
    DOM.stars.replaceChildren();
    for (let s = 1; s <= 5; s++) {
      const sp = document.createElement("span");
      sp.textContent = "★";
      sp.dataset.s = s;
      if (s <= curStars) sp.classList.add("on");
      DOM.stars.appendChild(sp);
    }
  }
  DOM_DELEGATE: {
    // star clicks (delegated so it survives rebuilds)
    document.addEventListener("click", (e) => {
      const sp = e.target.closest && e.target.closest("#clStars span");
      if (!sp) return;
      const v = +sp.dataset.s;
      curStars = curStars === v ? 0 : v;
      buildStars();
    });
  }
  // a short human label for the current look's key params
  function lookSummary() {
    const keys = (active.params || []).map((p) => p.key);
    const bits = ["aspect", "fit", ...keys]
      .filter((k, i, a) => a.indexOf(k) === i)
      .map((k) => (P[k] !== undefined ? `${k}=${P[k]}` : null))
      .filter(Boolean);
    return bits.join(" · ");
  }
  function saveLook() {
    if (!active) return;
    const rec = active.recipe();
    looks.unshift({
      preset: active.id,
      label: active.label,
      stars: curStars,
      note: (DOM.fbNote.value || "").trim(),
      params: { ...P },
      summary: lookSummary(),
      recipe: rec.spec || (rec.filter ? ffcmd(rec.filter, rec.matte) : ""),
      t: Math.round((S.vid ? S.vid.currentTime : 0) * 100) / 100,
    });
    persistLooks();
    DOM.fbNote.value = "";
    curStars = 0;
    buildStars();
    renderLooks();
    DOM.saveLook.textContent = "✓ saved";
    setTimeout(() => (DOM.saveLook.textContent = "★ Save look"), 900);
  }
  function applyLook(lk) {
    selectPreset(lk.preset);
    Object.assign(P, lk.params || {});
    buildParams();
    updateRecipe();
    drawOnce();
  }
  function renderLooks() {
    DOM.looksCount.textContent = `Saved looks (${looks.length})`;
    DOM.looks.replaceChildren(
      ...looks.map((lk, i) => {
        const row = document.createElement("div");
        row.className = "cl-look";
        const main = document.createElement("div");
        main.className = "lk-main";
        const nm = document.createElement("span");
        nm.className = "lk-name";
        nm.textContent = lk.label;
        const st = document.createElement("span");
        st.className = "lk-stars";
        st.textContent =
          " " +
          (lk.verdict === "like"
            ? "♥"
            : lk.verdict === "nope"
              ? "✕"
              : "★".repeat(lk.stars || 0));
        const nt = document.createElement("div");
        nt.className = "lk-note";
        nt.textContent = lk.note || lk.summary || "";
        main.append(nm, st, nt);
        main.onclick = () => applyLook(lk);
        const del = document.createElement("button");
        del.className = "lk-del";
        del.textContent = "✕";
        del.onclick = () => {
          looks.splice(i, 1);
          persistLooks();
          renderLooks();
        };
        row.append(main, del);
        return row;
      }),
    );
  }
  function copyFeedback() {
    if (!looks.length) {
      DOM.copyFb.textContent = "no looks yet";
      setTimeout(() => (DOM.copyFb.textContent = "📋 Copy for Claude"), 1200);
      return;
    }
    const lines = ["# Composition Lab feedback", ""];
    looks.forEach((lk, i) => {
      const verdict =
        lk.verdict === "like"
          ? "👍 LIKE"
          : lk.verdict === "nope"
            ? "👎 PASS"
            : "★".repeat(lk.stars || 0) || "(no rating)";
      lines.push(`${i + 1}. **${lk.label}** — ${verdict}`);
      if (lk.note) lines.push(`   note: ${lk.note}`);
      lines.push(`   params: ${lk.summary}`);
      if (lk.recipe) lines.push("   recipe: " + lk.recipe.replace(/\n/g, " "));
      lines.push("");
    });
    const txt = lines.join("\n");
    navigator.clipboard?.writeText(txt);
    DOM.copyFb.textContent = "✓ copied — paste to Claude";
    setTimeout(() => (DOM.copyFb.textContent = "📋 Copy for Claude"), 1600);
  }
  function toggleRec() {
    if (recorder && recorder.state === "recording") {
      recorder.stop();
      return;
    }
    const stream = DOM.canvas.captureStream(30);
    recChunks = [];
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp9",
      });
    } catch (e) {
      recorder = new MediaRecorder(stream);
    }
    recorder.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(recChunks, { type: "video/webm" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (active ? active.id : "comp") + ".webm";
      a.click();
      DOM.rec.classList.remove("on");
      DOM.rec.textContent = "● REC";
    };
    recorder.start();
    DOM.rec.classList.add("on");
    DOM.rec.textContent = "■ STOP";
  }

  // copy / save recipe
  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "clCopy") {
      navigator.clipboard?.writeText(DOM.recipe.textContent);
      e.target.textContent = "copied";
      setTimeout(() => (e.target.textContent = "copy"), 900);
    }
    if (e.target && e.target.id === "clSaveRecipe" && active) {
      const r = active.recipe();
      const out = {
        preset: active.id,
        label: active.label,
        params: { ...P },
        recipe: DOM.recipe.textContent,
        note: r.note,
      };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }),
      );
      a.download = active.id + "-recipe.json";
      a.click();
    }
  });

  return {
    onShow() {
      wire();
      visible = true;
      if (!S.ready && !S.vid.src) {
        setClip(SAMPLE_CLIP); // auto-load bundled 3s me&u loop
        setMatte(SAMPLE_MATTE); // + its RVM matte so silhouette states preview clean
      } else if (S.vid && S.vid.src && S.vid.paused)
        S.vid.play().catch(() => {});
      if (!raf) loop();
      else drawOnce();
    },
    onHide() {
      visible = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
})();
