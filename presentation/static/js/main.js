// Presentation helpers: zoom a figure, step through the blocks with the keyboard (or a presenter remote),
// and highlight the current section in the top links.
(function () {
  "use strict";

  // ---- zoom: click a figure; click the zoomed image for 1:1 pixels; backdrop / Esc closes -------
  const box = document.getElementById("lightbox");
  const boxImg = box.querySelector("img");
  const boxCap = box.querySelector(".lightbox-cap");

  function openZoom(img) {
    const cap = img.closest("figure")?.querySelector("figcaption");
    const src = cap ? cap.querySelector(".src") : null;
    const text = cap ? Array.from(cap.childNodes).filter((n) => n !== src).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim() : "";
    boxCap.textContent = src ? `${text} (${src.textContent.trim()})` : text;
    boxImg.src = img.dataset.full || img.currentSrc || img.src;
    boxImg.alt = img.alt;
    box.classList.remove("is-zoomed");
    box.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeZoom() {
    box.hidden = true;
    box.classList.remove("is-zoomed");
    boxImg.removeAttribute("src");
    document.body.style.overflow = "";
  }
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".fig img");
    if (img) openZoom(img);
  });
  box.addEventListener("click", closeZoom);
  boxImg.addEventListener("click", (e) => {
    e.stopPropagation();
    if (box.classList.contains("is-zoomed")) {
      box.classList.remove("is-zoomed");
      return;
    }
    if (boxImg.naturalWidth <= boxImg.clientWidth * 1.15) return closeZoom();  // already shown at full size
    const fx = e.offsetX / boxImg.clientWidth, fy = e.offsetY / boxImg.clientHeight;
    box.classList.add("is-zoomed");
    box.scrollLeft = fx * boxImg.naturalWidth - e.clientX;  // keep the clicked point under the cursor
    box.scrollTop = fy * boxImg.naturalHeight - e.clientY;
  });

  // ---- keyboard: ← → / PageUp PageDown = previous / next block, 1–4 = sections, 0 = top --------
  const steps = Array.from(document.querySelectorAll(".step"));
  const navH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 64;
  const topOf = (el) => el.getBoundingClientRect().top + window.scrollY;
  const scrollToY = (y) => window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });

  function step(dir) {
    const off = navH() + 8;
    const here = window.scrollY + off;
    const tops = steps.map(topOf);
    const target = dir > 0 ? tops.find((t) => t > here + 4) : tops.filter((t) => t < here - 4).pop();
    if (target === undefined) return scrollToY(dir > 0 ? document.documentElement.scrollHeight : 0);
    scrollToY(target - off);
  }
  const SECTIONS = { 0: "top", 1: "sam3db", 2: "smirk", 3: "mediapipe", 4: "compare" };

  document.addEventListener("keydown", (e) => {
    if (!box.hidden) {
      const zoomed = box.classList.contains("is-zoomed");  // arrows scroll the 1:1 image, Esc closes
      if (e.key === "Escape" || (!zoomed && ["Enter", " ", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(e.key))) {
        e.preventDefault();
        closeZoom();
      }
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key in SECTIONS) {
      const el = document.getElementById(SECTIONS[e.key]);
      if (el) scrollToY(e.key === "0" ? 0 : topOf(el) - navH() + 1);
    }
  });

  // ---- highlight the section under the top links ----------------------------------------------
  const links = new Map(Array.from(document.querySelectorAll(".topnav [data-nav]")).map((a) => [a.dataset.nav, a]));
  const watched = Array.from(links.keys()).map((id) => document.getElementById(id)).filter(Boolean);

  function markActive() {
    const probe = window.scrollY + navH() + Math.min(window.innerHeight * 0.3, 280);
    let current = null;
    for (const sec of watched) if (topOf(sec) <= probe) current = sec;
    links.forEach((a, id) => a.classList.toggle("is-active", Boolean(current) && id === current.id));
  }
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => {
        markActive();
        ticking = false;
      });
    }
  }, { passive: true });
  window.addEventListener("resize", markActive);
  markActive();
})();
