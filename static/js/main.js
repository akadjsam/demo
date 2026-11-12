/* Video-only project page: sections, synced video rows, method switches and sample pickers from
   data/videos.js (written by build_page.py). No libraries. */
(() => {
  "use strict";

  const DATA = window.PAGE_DATA;
  const SYNC_TOLERANCE = 0.12; // s: a video further than this from the first video of its row jumps to it
  const SYNC_NUDGE = 0.025;    // s: smaller drifts are evened out by playing 5% faster or slower
  const SYNC_EVERY = 250;      // ms between sync checks
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect fill="currentColor" x="6" y="5" width="4" height="14" rx="1"/><rect fill="currentColor" x="14" y="5" width="4" height="14" rx="1"/></svg>',
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    shrink: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  };

  const el = (tag, cls, attrs) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (const k of Object.keys(attrs)) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    return e;
  };

  const fmt = (t) => {
    const s = Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const tryPlay = (v) => {
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  };

  const stopVideo = (v) => { // stop playing and downloading
    v.pause();
    v.removeAttribute("src");
    v.load();
  };

  const mutedVideo = (cls, attrs) => {
    const v = el("video", cls, Object.assign({ muted: "", loop: "", playsinline: "", disablepictureinpicture: "" }, attrs));
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    return v;
  };

  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const fsEnabled = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

  /* One row of videos (original, visualization, 3D view, analysis) that play, pause and seek together.
     The first video leads; the others follow it. Several methods: a switch swaps the result videos while
     the original keeps playing. */
  class Player {
    constructor(section) {
      this.section = section;
      this.methods = section.methods || [];
      this.method = this.methods.length ? this.methods[0].id : null;
      this.figs = [];
      this.videos = [];
      this.master = null;
      this.index = -1;
      this.near = false;
      this.visible = false;
      this.userPaused = REDUCED_MOTION;
      this.dragging = false;
      this.resume = false;
      this.raf = 0;
      this.lastSync = 0;
      this.tick = this.tick.bind(this);

      this.root = el("div", "player");
      this.root._player = this;
      this.inner = el("div", "player-inner");
      this.row = el("div", "row");
      const controls = el("div", "controls");
      this.playBtn = el("button", "ctl", { type: "button" });
      this.scrub = el("div", "scrub", {
        role: "slider", tabindex: "0", "aria-label": "Seek",
        "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0",
      });
      const track = el("div", "scrub-track");
      this.fill = el("div", "scrub-fill");
      track.append(this.fill);
      this.scrub.append(track);
      this.time = el("span", "time");
      controls.append(this.playBtn, this.scrub, this.time);
      if (fsEnabled) {
        this.fsBtn = el("button", "ctl", { type: "button", "aria-label": "Full screen" });
        this.fsBtn.innerHTML = ICON.expand;
        this.fsBtn.addEventListener("click", () => this.toggleFullscreen());
        controls.append(this.fsBtn);
      }
      this.inner.append(this.row, controls);
      this.root.append(this.inner);

      this.playBtn.addEventListener("click", () => this.toggle());
      this.row.addEventListener("click", () => this.toggle());
      this.bindScrub();
      this.switchEl = this.methods.length > 1 ? this.buildSwitch() : null;
      this.thumbs = this.buildThumbs();
    }

    result(sample) {
      return sample.results[this.method] || Object.values(sample.results)[0];
    }

    buildSwitch() {
      const box = el("div", "methods", { role: "group", "aria-label": "Method" });
      this.methodBtns = this.methods.map((m) => {
        const b = el("button", "method", { type: "button", "aria-pressed": "false", title: m.title });
        b.textContent = m.short || m.title;
        b.addEventListener("click", () => this.setMethod(m.id));
        box.append(b);
        return b;
      });
      return box;
    }

    buildThumbs() {
      const samples = this.section.samples;
      this.thumbsEl = null;
      if (samples.length < 2) return [];
      this.thumbsEl = el("div", "thumbs", { role: "group", "aria-label": `${this.section.title}: samples` });
      return samples.map((s, k) => {
        const b = el("button", "thumb", { type: "button", "aria-pressed": "false", title: s.title });
        const cap = el("span", "thumb-title");
        cap.textContent = s.title;
        b.append(el("img", "thumb-img", { src: this.result(s).thumb, alt: "", loading: "lazy", decoding: "async" }), cap);
        b.addEventListener("click", () => {
          this.userPaused = false;
          if (k === this.index) this.play();
          else this.select(k);
        });
        this.thumbsEl.append(b);
        return b;
      });
    }

    makeTile(spec, sample) {
      const fig = el("figure", "clip", { "data-slot": spec.slot });
      fig.style.setProperty("--ar", (spec.width / spec.height).toFixed(4));
      const label = el("figcaption", "clip-label");
      const text = el("span");
      text.textContent = spec.label;
      label.append(text);
      const frame = el("div", "frame");
      const v = mutedVideo(null, { preload: "none", poster: spec.poster, "aria-label": `${spec.label}: ${sample.title}` });
      v.dataset.src = spec.src;
      v.addEventListener("loadedmetadata", () => { // a video that joins late starts at the leader's time
        const m = this.master;
        if (m && m !== v && m.readyState > 0 && Math.abs(v.currentTime - m.currentTime) > 0.04) v.currentTime = m.currentTime;
      });
      frame.append(v);
      fig.append(label, frame);
      fig._video = v;
      return fig;
    }

    bindMaster(m) {
      if (m._bound) return;
      m._bound = true;
      const mine = () => m === this.master;
      m.addEventListener("play", () => { if (mine()) { this.updateButton(); this.startLoop(); } });
      m.addEventListener("pause", () => { if (mine()) { this.updateButton(); this.render(); } });
      m.addEventListener("loadedmetadata", () => { if (mine()) this.render(); });
      m.addEventListener("seeked", () => { if (mine()) this.render(); });
    }

    select(i) {
      if (i !== this.index) this.show(i, false);
    }

    setMethod(id) {
      if (id === this.method) return;
      this.method = id;
      if (this.index >= 0) this.show(this.index, true);
    }

    show(i, sameSample) {
      const samples = this.section.samples;
      const sample = samples[i];
      if (!sample.results[this.method]) this.method = Object.keys(sample.results)[0];
      const specs = (sample.original ? [sample.original] : []).concat(sample.results[this.method].videos);
      const keep = sameSample && sample.original && this.figs.length ? this.figs[0] : null; // original keeps playing
      this.index = i;
      for (const f of this.figs) {
        if (f !== keep) {
          stopVideo(f._video);
          f.remove();
        }
      }
      this.figs = keep ? [keep] : [];
      for (let k = this.figs.length; k < specs.length; k++) {
        const fig = this.makeTile(specs[k], sample);
        this.row.append(fig);
        this.figs.push(fig);
      }
      this.videos = this.figs.map((f) => f._video);
      this.master = this.videos[0];
      this.bindMaster(this.master);

      // equal heights in a row; four landscape videos (body) go 2 x 2 so that each stays large
      const ars = specs.map((s) => s.width / s.height);
      const sum = ars.reduce((a, b) => a + b, 0);
      const grid = specs.length === 4 && ars.every((a) => a > 1.3);
      this.root.classList.toggle("is-grid", grid);
      this.root.classList.toggle("is-wide", sum > 2.2);
      this.inner.style.setProperty("--sum-ar", (grid ? sum / 2 : sum).toFixed(4));
      this.inner.style.setProperty("--n", String(grid ? 2 : specs.length));

      this.thumbs.forEach((b, k) => {
        b.classList.toggle("is-active", k === i);
        b.setAttribute("aria-pressed", String(k === i));
        const img = b.firstChild;
        const src = this.result(samples[k]).thumb;
        if (img.getAttribute("src") !== src) img.src = src;
      });
      (this.methodBtns || []).forEach((b, k) => {
        const id = this.methods[k].id;
        b.classList.toggle("is-active", id === this.method);
        b.setAttribute("aria-pressed", String(id === this.method));
        b.disabled = !sample.results[id];
      });
      this.updateButton();
      this.render();
      if (this.near) this.load();
      if (this.visible && !this.userPaused) this.play();
    }

    load() {
      for (const v of this.videos) {
        if (!v.getAttribute("src")) {
          v.preload = "auto";
          v.src = v.dataset.src;
        }
      }
    }

    playing() {
      return !!this.master && !this.master.paused;
    }

    play() {
      if (!this.master) return;
      this.load();
      const t = this.master.currentTime;
      for (const v of this.videos) {
        if (v !== this.master && v.readyState > 0 && Math.abs(v.currentTime - t) > 0.04) v.currentTime = t;
        tryPlay(v);
      }
      this.startLoop();
    }

    pauseAll() {
      for (const v of this.videos) v.pause();
    }

    toggle() {
      if (this.playing()) {
        this.userPaused = true;
        this.pauseAll();
      } else {
        this.userPaused = false;
        this.play();
      }
    }

    seek(f) {
      const m = this.master;
      if (!m) return;
      this.load();
      const d = m.duration;
      if (!(d > 0) || !Number.isFinite(d)) return;
      const t = Math.min(1, Math.max(0, f)) * d;
      for (const v of this.videos) {
        const end = Number.isFinite(v.duration) ? v.duration : d;
        v.currentTime = Math.max(0, Math.min(t, end - 0.04));
      }
      this.render();
    }

    bindScrub() {
      const at = (e) => {
        const r = this.scrub.getBoundingClientRect();
        return (e.clientX - r.left) / r.width;
      };
      this.scrub.addEventListener("pointerdown", (e) => {
        if (!this.master) return;
        e.preventDefault();
        this.dragging = true;
        this.resume = this.playing();
        this.pauseAll();
        this.scrub.setPointerCapture(e.pointerId);
        this.seek(at(e));
      });
      this.scrub.addEventListener("pointermove", (e) => {
        if (this.dragging) this.seek(at(e));
      });
      const end = () => {
        if (!this.dragging) return;
        this.dragging = false;
        if (this.resume) this.play();
      };
      this.scrub.addEventListener("pointerup", end);
      this.scrub.addEventListener("pointercancel", end);
      this.scrub.addEventListener("keydown", (e) => {
        const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
        const d = this.master && this.master.duration;
        if (!step || !(d > 0)) return;
        e.preventDefault();
        this.seek((this.master.currentTime + step) / d);
      });
    }

    startLoop() {
      if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    }

    tick(now) {
      this.raf = 0;
      const m = this.master;
      if (!m) return;
      this.render();
      if (m.paused || this.dragging) return;
      if (now - this.lastSync > SYNC_EVERY) {
        this.lastSync = now;
        this.sync();
      }
      this.raf = requestAnimationFrame(this.tick);
    }

    sync() {
      const m = this.master;
      if (m.seeking || m.readyState < 2) return;
      const t = m.currentTime;
      const d = m.duration;
      for (const v of this.videos) {
        if (v === m) continue;
        if (v.paused) tryPlay(v);
        if (v.seeking || v.readyState < 2) continue;
        let dt = v.currentTime - t;
        if (d > 0) { // both loop: compare across the loop point
          if (dt > d / 2) dt -= d;
          else if (dt < -d / 2) dt += d;
        }
        const rate = Math.abs(dt) <= SYNC_NUDGE ? 1 : dt > 0 ? 0.95 : 1.05;
        if (v.playbackRate !== rate) v.playbackRate = rate;
        if (Math.abs(dt) > SYNC_TOLERANCE) {
          v.currentTime = Number.isFinite(v.duration) ? Math.min(t, v.duration - 0.04) : t;
          v.playbackRate = 1;
        }
      }
    }

    render() {
      const m = this.master;
      if (!m) return;
      const d = m.duration;
      const t = m.currentTime;
      const f = d > 0 && Number.isFinite(d) ? Math.min(1, t / d) : 0;
      this.fill.style.transform = `scaleX(${f})`;
      this.scrub.setAttribute("aria-valuenow", String(Math.round(f * 100)));
      this.time.textContent = `${fmt(t)} / ${fmt(d)}`;
    }

    updateButton() {
      const p = this.playing();
      this.playBtn.innerHTML = p ? ICON.pause : ICON.play;
      this.playBtn.setAttribute("aria-label", p ? "Pause" : "Play");
    }

    setNear() {
      if (this.near) return;
      this.near = true;
      this.load();
    }

    setVisible(visible) {
      this.visible = visible;
      if (!visible) this.pauseAll();
      else if (!this.userPaused) this.play();
    }

    toggleFullscreen() {
      const r = fsElement()
        ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : (this.root.requestFullscreen || this.root.webkitRequestFullscreen).call(this.root);
      if (r && r.catch) r.catch(() => {});
    }
  }

  function buildSection(sec) {
    const node = el("section", "section", { id: sec.id });
    const box = el("div", "container");
    const head = el("header", "section-head");
    const h2 = el("h2");
    h2.textContent = sec.title;
    head.append(h2);
    const player = new Player(sec);
    if (player.switchEl) {
      head.append(player.switchEl);
    } else if (sec.methods && sec.methods.length) {
      const badge = el("span", "badge");
      badge.textContent = sec.methods[0].title;
      head.append(badge);
    }
    box.append(head, player.root);
    if (player.thumbsEl) box.append(player.thumbsEl);
    node.append(box);
    player.select(0);
    return { node, player };
  }

  function buildTeaser(t) {
    const box = document.getElementById("teaser");
    if (!t || !box) return;
    const wrap = el("div", "container");
    const v = mutedVideo("teaser-video", { preload: "auto", poster: t.poster, "aria-label": "Overview of the results" });
    v.style.aspectRatio = `${t.width} / ${t.height}`;
    v.src = t.src;
    v.addEventListener("click", () => (v.paused ? tryPlay(v) : v.pause()));
    wrap.append(v);
    box.append(wrap);
    box.hidden = false;
    if (!REDUCED_MOTION) {
      new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? tryPlay(v) : v.pause()))).observe(v);
    }
  }

  function buildNav(sections) {
    const nav = document.getElementById("nav");
    if (!nav || sections.length < 2) return;
    const inner = el("div", "nav-inner");
    const links = new Map();
    for (const sec of sections) {
      const a = el("a", null, { href: `#${sec.id}` });
      a.textContent = sec.nav || sec.title;
      inner.append(a);
      links.set(sec.id, a);
    }
    nav.append(inner);
    nav.hidden = false;
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (e.isIntersecting) links.forEach((a, id) => a.classList.toggle("is-active", id === e.target.id));
      }
    }, { rootMargin: "-45% 0px -54% 0px" });
    sections.forEach((sec) => io.observe(document.getElementById(sec.id)));
  }

  function buildCredits(sections) {
    const foot = document.getElementById("footer");
    const seen = new Set();
    const items = [];
    for (const sec of sections) {
      for (const s of sec.samples) {
        if (s.source && s.source.url && !seen.has(s.source.url)) {
          seen.add(s.source.url);
          items.push(s);
        }
      }
    }
    if (!foot || !items.length) return;
    const box = el("div", "container");
    const details = el("details");
    const summary = el("summary");
    summary.textContent = "Video credits";
    const ul = el("ul");
    for (const s of items) {
      const li = el("li");
      const a = el("a", null, { href: s.source.url, target: "_blank", rel: "noopener" });
      a.textContent = s.title;
      let host = "";
      try {
        host = new URL(s.source.url).hostname.replace(/^www\./, "");
      } catch (_) { /* keep the title only */ }
      li.append(a, document.createTextNode(host ? ` · ${host}` : ""));
      if (s.source.license) li.title = s.source.license;
      ul.append(li);
    }
    details.append(summary, ul);
    box.append(details);
    foot.append(box);
  }

  function main() {
    const holder = document.getElementById("sections");
    const sections = (DATA && DATA.sections) || [];
    if (!sections.length) {
      const p = el("p", "empty");
      p.innerHTML = "No videos yet: run <code>python3 build_page.py</code> in the demo folder.";
      holder.append(p);
      return;
    }
    buildTeaser(DATA.teaser);
    const players = sections.map((sec) => {
      const { node, player } = buildSection(sec);
      holder.append(node);
      return player;
    });
    buildNav(sections);
    buildCredits(sections);

    // load a row shortly before it scrolls into view; play it only while it is on screen
    const near = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target._player.setNear()),
      { rootMargin: "600px 0px" });
    const onScreen = new IntersectionObserver((es) => es.forEach((e) => e.target._player.setVisible(e.isIntersecting)),
      { rootMargin: "-10% 0px -10% 0px" });
    players.forEach((p) => {
      near.observe(p.root);
      onScreen.observe(p.root);
    });
    const onFullscreen = () => players.forEach((p) => {
      if (p.fsBtn) p.fsBtn.innerHTML = fsElement() === p.root ? ICON.shrink : ICON.expand;
    });
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("webkitfullscreenchange", onFullscreen);
  }

  main();
})();
