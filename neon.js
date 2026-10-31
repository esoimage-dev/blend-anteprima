/* Insegna al neon Blend: i tubi seguono la linea centrale delle lettere del logo originale
   (misurata dal file logo-2024, spazio 1080 x 669). Ogni tubo è vetro con anima bianca,
   alone a più livelli, riflesso e ombra sul muro. */
window.BlendNeon = (function () {
  const LETTERS = {
    b: { d: ["M201 48 L102 48 L53 116 L53 130 L80 196 L52 268 L52 546 L100 619 L201 619 Z", "M80 196 L201 196"] },
    l: { d: ["M309 48 L309 619 L758 619"] },
    e: { d: ["M516 48 L422 48 L475 192 L516 192", "M475 192 L418 193 L418 511 L761 511"] },
    n: { d: ["M628 401 L628 48 L708 48 L764 124 L764 401"] },
    d: { d: ["M872 48 L970 48 L1025 122 L1025 546 L972 619 L872 619 Z"] }
  };
  const ORDER = ["b", "l", "e", "n", "d"];
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };

  function build(svg, uid) {
    svg.setAttribute("viewBox", "-80 -80 1240 829");
    const defs = el("defs", {}, svg);
    const f = (id, sd) => { const fl = el("filter", { id: id + uid, x: "-30%", y: "-30%", width: "160%", height: "160%", "color-interpolation-filters": "sRGB" }, defs); el("feGaussianBlur", { stdDeviation: sd }, fl); };
    f("nbig", 34); f("nmid", 11); f("nsoft", 3.2); f("nshadow", 7);
    const metal = el("linearGradient", { id: "nmetal" + uid, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    el("stop", { offset: 0, "stop-color": "#5d574e" }, metal); el("stop", { offset: .5, "stop-color": "#1b1915" }, metal); el("stop", { offset: 1, "stop-color": "#3a352e" }, metal);

    const root = el("g", { class: "neon-root" }, svg);
    const layers = {
      spill: el("g", { class: "n-spill", filter: `url(#nbig${uid})` }, root),
      shadow: el("g", { class: "n-shadow", filter: `url(#nshadow${uid})`, transform: "translate(9 12)" }, root),
      glass: el("g", { class: "n-glass" }, root),
      halo: el("g", { class: "n-halo", filter: `url(#nmid${uid})` }, root),
      body: el("g", { class: "n-body" }, root),
      core: el("g", { class: "n-core", filter: `url(#nsoft${uid})` }, root),
      spec: el("g", { class: "n-spec", transform: "translate(-6 -7)" }, root),
      hw: el("g", { class: "n-hw" }, root)
    };
    const per = {};
    ORDER.forEach((k) => {
      const L = LETTERS[k]; per[k] = [];
      const add = (layer, attrs) => { const g = el("g", { "data-l": k }, layer); L.d.forEach((d) => el("path", { d, ...attrs }, g)); per[k].push(g); return g; };
      add(layers.spill, { stroke: "#ffb02e", "stroke-width": 90 });
      add(layers.shadow, { stroke: "#000", "stroke-width": 48 });
      add(layers.glass, { stroke: "rgba(255,236,200,.10)", "stroke-width": 48 });
      add(layers.halo, { stroke: "#ffc24a", "stroke-width": 48 });
      const b = el("g", { "data-l": k }, layers.body);
      [[48, "#f2ac2e"], [38, "#fcc650"], [26, "#ffdb85"], [14, "#fff0c8"]].forEach(([w, c]) => L.d.forEach((d) => el("path", { d, stroke: c, "stroke-width": w }, b)));
      per[k].push(b);
      add(layers.core, { stroke: "#fffbf2", "stroke-width": 7 });
      add(layers.spec, { stroke: "rgba(255,255,255,.5)", "stroke-width": 3 });
    });
    root.querySelectorAll("path").forEach((p) => { if (!p.getAttribute("fill")) p.setAttribute("fill", "none"); p.setAttribute("stroke-linecap", p.getAttribute("stroke-linecap") || "round"); p.setAttribute("stroke-linejoin", "round"); });
    return { svg, per, layers };
  }

  /* stato di una lettera: 0 spenta, 0.35 mezza luce, 1 accesa */
  function set(n, k, v) {
    n.per[k].forEach((g) => {
      const cls = g.parentNode.getAttribute("class");
      if (cls === "n-shadow" || cls === "n-glass") return;
      g.style.opacity = cls === "n-spill" ? v * .55 : v;
    });
  }
  function all(n, v) { ORDER.forEach((k) => set(n, k, v)); }

  /* accensione: ogni lettera "batte" un paio di volte prima di restare accesa */
  function ignite(n, opts = {}) {
    const onLit = opts.onLit || (() => {}), done = opts.done || (() => {});
    let lit = 0;
    ORDER.forEach((k, i) => {
      const base = (opts.delay || 200) + i * 170 + Math.random() * 140;
      const seq = [[.35, 0], [0, 50], [.6, 110], [.1, 150], [1, 230], [.55, 280], [1, 360]];
      seq.forEach(([v, t]) => setTimeout(() => set(n, k, v), base + t));
      setTimeout(() => { lit++; onLit(lit / 5); if (lit === 5) done(); }, base + 360);
    });
  }
  function shutdown(n, done) {
    [4, 2, 0, 3, 1].forEach((i, j) => {
      const k = ORDER[i], base = 80 + j * 140;
      [[.4, 0], [1, 60], [.15, 110], [0, 170]].forEach(([v, t]) => setTimeout(() => set(n, k, v), base + t));
      if (j === 4 && done) setTimeout(done, base + 200);
    });
  }
  /* ronzio: ogni tanto una lettera perde un colpo */
  function hum(n, isVisible) {
    return setInterval(() => {
      if (document.hidden || (isVisible && !isVisible())) return;
      const k = ORDER[Math.floor(Math.random() * 5)];
      [[.45, 0], [1, 60], [.7, 120], [1, 190]].forEach(([v, t]) => setTimeout(() => set(n, k, v), t));
    }, 7000 + Math.random() * 4000);
  }
  return { build, set, all, ignite, shutdown, hum, ORDER };
})();
