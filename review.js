// ===== Animation Review tab (unchanged behaviour, lifted out of index.html) =====
const KEY = "fadi-anim-review-v1";
let TITLE = "Fadi Animation Review",
  ITEMS = [],
  R = {},
  view = "grid",
  fIdx = 0;
const $ = (s) => document.querySelector(s);
function el(t, p, k) {
  const e = document.createElement(t);
  if (p)
    for (const a in p) {
      if (a === "class") e.className = p[a];
      else if (a === "text") e.textContent = p[a];
      else e.setAttribute(a, p[a]);
    }
  if (k) for (const c of k) e.appendChild(c);
  return e;
}
const isVideo = (it) =>
  (it.type || "").startsWith("video") ||
  /\.(mp4|webm|mov|m4v)$/i.test(it.media || "");
// lazy-load grid videos so we don't kick off 100 downloads at once (mobile-safe)
const vobs =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const v = e.target;
            if (e.isIntersecting) {
              if (!v.src && v.dataset.src) v.src = v.dataset.src;
              v.play && v.play().catch(() => {});
            } else if (v.pause) v.pause();
          }
        },
        { rootMargin: "300px" },
      )
    : null;
function media(it, lazy) {
  if (isVideo(it)) {
    const v = el("video", { loop: "", playsinline: "" });
    v.muted = true;
    if (lazy && vobs) {
      v.preload = "none";
      v.dataset.src = it.media; // src set when scrolled into view
    } else {
      v.autoplay = true;
      v.src = it.media;
    }
    return v;
  }
  const im = el("img");
  im.src = it.media;
  return im;
}
function persist() {
  localStorage.setItem(KEY, JSON.stringify(R));
}

async function load() {
  const cat = await (await fetch("catalog.json")).json();
  TITLE = cat.title || TITLE;
  ITEMS = cat.items || cat;
  ITEMS.forEach((it, i) => (it._i = i));
  try {
    R = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch (e) {
    R = {};
  }
  const cats = [
    ...new Set(ITEMS.map((c) => c.category).filter(Boolean)),
  ].sort();
  const cf = $("#catf");
  cf.appendChild(el("option", { value: "all", text: "All categories" }));
  cats.forEach((c) => cf.appendChild(el("option", { value: c, text: c })));
  render();
  updateStat();
}
function save(id, patch) {
  R[id] = Object.assign(
    { stars: 0, comment: "", trashed: false },
    R[id],
    patch,
  );
  persist();
  updateStat();
}
function reviewed(it) {
  const r = R[it.id] || {};
  return (r.stars || 0) > 0 || r.trashed;
}
function updateStat() {
  const rev = ITEMS.filter(reviewed).length,
    tr = ITEMS.filter((c) => R[c.id]?.trashed).length,
    com = ITEMS.filter((c) => (R[c.id]?.comment || "").trim()).length;
  $("#stat").textContent =
    `${TITLE} — ${rev}/${ITEMS.length} reviewed · ${tr} trashed · ${com} comments`;
}
function passes(it) {
  const r = R[it.id] || {},
    f = $("#filter").value;
  if ($("#catf").value !== "all" && it.category !== $("#catf").value)
    return false;
  const q = $("#search").value.trim().toLowerCase();
  if (
    q &&
    !((it.label || "").toLowerCase().includes(q) || (it.id || "").includes(q))
  )
    return false;
  const s = r.stars || 0;
  if (f === "todo") return !reviewed(it);
  if (f === "rated") return s > 0;
  if (f === "trashed") return !!r.trashed;
  if (f === "commented") return (r.comment || "").trim().length > 0;
  if (f === "all") return true;
  if (f === "5") return s === 5;
  if (f === "4") return s >= 4;
  if (f === "3") return s >= 3;
  if (f === "lt3") return s > 0 && s < 3;
  return true;
}
function listed() {
  let l = ITEMS.filter(passes);
  const s = $("#sort").value;
  if (s === "rating")
    l = [...l].sort((a, b) => (R[b.id]?.stars || 0) - (R[a.id]?.stars || 0));
  if (s === "category")
    l = [...l].sort((a, b) =>
      (a.category || "").localeCompare(b.category || ""),
    );
  return l;
}
function starsEl(id) {
  const r = R[id] || {};
  const w = el("div", { class: "stars", "data-id": id });
  for (let s = 1; s <= 5; s++) {
    const sp = el("span", { "data-s": s, text: "★" });
    if (s <= (r.stars || 0)) sp.classList.add("on");
    w.appendChild(sp);
  }
  return w;
}
function setStars(w, n) {
  [...w.children].forEach((s, k) => s.classList.toggle("on", k < n));
}
function render() {
  if (view === "focus") {
    renderFocus();
    return;
  }
  $("#grid").replaceChildren(
    ...listed().map((it) => {
      const r = R[it.id] || { stars: 0, comment: "" };
      const m = el("div", { class: "media" }, [
        media(it, true),
        el("span", { class: "num", text: String(it._i + 1).padStart(3, "0") }),
      ]);
      const tb = el("button", { class: "trash", title: "trash" });
      tb.textContent = r.trashed ? "♻" : "🗑";
      tb.dataset.id = it.id;
      tb.dataset.act = "trash";
      m.appendChild(tb);
      const ta = el("textarea", {
        placeholder: "comment / what to change…",
        "data-id": it.id,
      });
      ta.value = r.comment || "";
      const body = el("div", { class: "body" }, [
        el("div", { class: "name" }, [
          el("span", { text: it.label || it.id }),
          el("span", { class: "cat", text: it.category || "" }),
        ]),
        starsEl(it.id),
        ta,
        el("div", { class: "meta", text: it.meta || "" }),
        el("div", { class: "saved", text: "saved ✓" }),
      ]);
      return el(
        "div",
        {
          class:
            "card" + (r.stars ? " rated" : "") + (r.trashed ? " trashed" : ""),
        },
        [m, body],
      );
    }),
  );
  if (vobs)
    $("#grid")
      .querySelectorAll("video")
      .forEach((v) => vobs.observe(v));
}
function flash(n) {
  const s = n && n.querySelector ? n.querySelector(".saved") : null;
  if (s) {
    s.classList.add("show");
    setTimeout(() => s.classList.remove("show"), 800);
  }
}
$("#grid").addEventListener("click", (e) => {
  const sp = e.target.closest(".stars span");
  if (sp) {
    const w = sp.closest(".stars"),
      id = w.dataset.id,
      v = +sp.dataset.s,
      cur = R[id]?.stars || 0,
      nv = cur === v ? 0 : v;
    save(id, { stars: nv });
    setStars(w, nv);
    const c = w.closest(".card");
    c.classList.toggle("rated", nv > 0);
    flash(c.querySelector(".body"));
    if ($("#filter").value === "todo") setTimeout(render, 250);
    return;
  }
  const tb = e.target.closest("[data-act=trash]");
  if (tb) {
    const id = tb.dataset.id,
      t = !R[id]?.trashed;
    save(id, { trashed: t });
    const f = $("#filter").value;
    if (f === "todo" || f === "trashed") setTimeout(render, 150);
    else {
      tb.textContent = t ? "♻" : "🗑";
      tb.closest(".card").classList.toggle("trashed", t);
    }
    return;
  }
});
let timers = {};
$("#grid").addEventListener("input", (e) => {
  const ta = e.target.closest("textarea");
  if (!ta) return;
  const id = ta.dataset.id;
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => {
    save(id, { comment: ta.value });
    flash(ta.closest(".body"));
  }, 500);
});
// focus
function focusList() {
  return ITEMS.filter(passes);
}
function renderFocus() {
  const l = focusList();
  if (!l.length) {
    $("#fmedia").replaceChildren(
      el("div", { class: "hint", text: "Nothing here — change the filter." }),
    );
    $("#fname").textContent = "";
    $("#fstars").replaceChildren();
    $("#fcomment").value = "";
    $("#fmeta").textContent = "";
    return;
  }
  if (fIdx >= l.length) fIdx = l.length - 1;
  if (fIdx < 0) fIdx = 0;
  const it = l[fIdx],
    r = R[it.id] || {};
  $("#fmedia").replaceChildren(media(it));
  $("#fname").textContent =
    `${String(it._i + 1).padStart(3, "0")} · ${it.label || it.id}`;
  $("#fcat").textContent = it.category || "";
  const fs = starsEl(it.id);
  fs.id = "fstars";
  $("#fstars").replaceWith(fs);
  $("#fcomment").value = r.comment || "";
  $("#fcomment").dataset.id = it.id;
  $("#fmeta").textContent = it.meta || "";
  $("#fTrash").textContent = r.trashed ? "♻ Restore" : "🗑 Trash";
}
function curFocus() {
  const l = focusList();
  return l[Math.min(fIdx, l.length - 1)];
}
function advance() {
  renderFocus();
}
$("#focus").addEventListener("click", (e) => {
  const sp = e.target.closest("#fstars span");
  if (!sp) return;
  const it = curFocus();
  if (!it) return;
  const v = +sp.dataset.s,
    cur = R[it.id]?.stars || 0,
    nv = cur === v ? 0 : v;
  save(it.id, { stars: nv });
  advance();
});
$("#fTrash").addEventListener("click", () => {
  const it = curFocus();
  if (!it) return;
  save(it.id, { trashed: !R[it.id]?.trashed });
  advance();
});
$("#fPrev").addEventListener("click", () => {
  fIdx--;
  renderFocus();
});
$("#fNext").addEventListener("click", () => {
  fIdx++;
  renderFocus();
});
$("#fcomment").addEventListener("input", (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  clearTimeout(timers[id]);
  timers[id] = setTimeout(() => save(id, { comment: e.target.value }), 500);
});
document.addEventListener("keydown", (e) => {
  if (view !== "focus") return;
  if (!document.getElementById("tab-review").classList.contains("active"))
    return;
  const tag = document.activeElement.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT") return;
  const it = curFocus();
  if (!it) return;
  if (e.key >= "0" && e.key <= "5") {
    const v = +e.key;
    save(it.id, { stars: v });
    if (v > 0) advance();
    else renderFocus();
  } else if (e.key === "t" || e.key === "T") {
    save(it.id, { trashed: !R[it.id]?.trashed });
    advance();
  } else if (e.key === "ArrowRight") {
    fIdx++;
    renderFocus();
  } else if (e.key === "ArrowLeft") {
    fIdx--;
    renderFocus();
  }
});
function setView(v) {
  view = v;
  $("#vGrid").classList.toggle("active", v === "grid");
  $("#vFocus").classList.toggle("active", v === "focus");
  $("#grid").style.display = v === "grid" ? "" : "none";
  $("#focus").classList.toggle("on", v === "focus");
  render();
}
$("#vGrid").onclick = () => setView("grid");
$("#vFocus").onclick = () => {
  fIdx = 0;
  setView("focus");
};
["#filter", "#catf", "#sort", "#search"].forEach((s) =>
  $(s).addEventListener("input", () => {
    fIdx = 0;
    render();
  }),
);
// export / import
$("#export").onclick = () => {
  const blob = new Blob([JSON.stringify(R, null, 2)], {
    type: "application/json",
  });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ratings.json";
  a.click();
};
$("#import").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    R = JSON.parse(await f.text());
    persist();
    render();
    updateStat();
  } catch (err) {
    alert("bad json");
  }
};
load();
