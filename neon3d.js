/* Insegna Blend in 3D: tubi di vetro piegato lungo la linea centrale del logo (spazio 1080 x 669),
   gas luminoso all'interno, bloom in post-produzione e tone mapping cinematografico.
   Il canvas ha fondo nero e si fonde sul video con mix-blend-mode: screen.
   API: BlendNeon3D.create(el) -> { set(lettera, 0..1), all(v), ignite(opts), hum(), dispose() } oppure null se WebGL non c'è. */
window.BlendNeon3D = (function () {
  const T = window.THREE;
  const LETTERS = {
    b: [["M", 201, 48, 102, 48, 53, 116, 53, 130, 80, 196, 52, 268, 52, 546, 100, 619, 201, 619, "Z"], ["M", 80, 196, 201, 196]],
    l: [["M", 309, 48, 309, 619, 758, 619]],
    e: [["M", 516, 48, 422, 48, 475, 192, 516, 192], ["M", 475, 192, 418, 193, 418, 511, 761, 511]],
    n: [["M", 628, 401, 628, 48, 708, 48, 764, 124, 764, 401]],
    d: [["M", 872, 48, 970, 48, 1025, 122, 1025, 546, 972, 619, 872, 619, "Z"]]
  };
  const ORDER = ["b", "l", "e", "n", "d"];
  const PAD = 1.5;

  /* polilinea con angoli arrotondati, come il vetro piegato a caldo */
  function curveFrom(def, z) {
    const closed = def[def.length - 1] === "Z";
    const nums = def.filter((x) => typeof x === "number");
    let P = []; for (let i = 0; i < nums.length; i += 2) P.push(new T.Vector3(nums[i] - 540, 334 - nums[i + 1], z));
    if (closed && P[0].distanceTo(P[P.length - 1]) < 1) P.pop();
    const path = new T.CurvePath(), R = 16, n = P.length;
    const corner = (i) => {
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
      const r = Math.min(R, a.distanceTo(b) / 2.2, b.distanceTo(c) / 2.2);
      return [b.clone().add(a.clone().sub(b).normalize().multiplyScalar(r)), b, b.clone().add(c.clone().sub(b).normalize().multiplyScalar(r))];
    };
    if (closed) {
      const cs = P.map((_, i) => corner(i));
      for (let i = 0; i < n; i++) { const [s0, b, s1] = cs[i]; path.add(new T.QuadraticBezierCurve3(s0, b, s1)); path.add(new T.LineCurve3(s1, cs[(i + 1) % n][0])); }
    } else {
      let prev = P[0];
      for (let i = 1; i < n - 1; i++) { const [s0, b, s1] = corner(i); path.add(new T.LineCurve3(prev, s0)); path.add(new T.QuadraticBezierCurve3(s0, b, s1)); prev = s1; }
      path.add(new T.LineCurve3(prev, P[n - 1]));
    }
    return { path, closed };
  }

  function create(el) {
    if (!T || !T.EffectComposer || !T.UnrealBloomPass) return null;
    let renderer;
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" }); } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 1);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    el.appendChild(renderer.domElement);

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(24, 1, 10, 6000);
    camera.position.set(0, 0, 2950);
    const group = new T.Group(); scene.add(group);

    /* luce radente: fa leggere il vetro anche quando il tubo è spento */
    scene.add(new T.AmbientLight(0xffffff, 0.08));
    const key = new T.DirectionalLight(0xfff1dc, 0.9); key.position.set(-600, 900, 1200); scene.add(key);

    const mats = {}, cores = {};
    ORDER.forEach((k) => {
      const glass = new T.MeshStandardMaterial({ color: new T.Color(0x26221c), roughness: 0.2, metalness: 0.0, emissive: new T.Color(0xff6c00), emissiveIntensity: 0, transparent: true, opacity: 0.85, depthWrite: false, side: T.DoubleSide });
      const core = new T.MeshBasicMaterial({ color: new T.Color(0x000000), side: T.DoubleSide });
      mats[k] = glass; cores[k] = core;
      LETTERS[k].forEach((def) => {
        const { path, closed } = curveFrom(def, 0);
        const segs = Math.max(40, Math.round(path.getLength() / 4));
        const gm = new T.Mesh(new T.TubeGeometry(path, segs, 15, 22, closed), glass); gm.renderOrder = 2; group.add(gm);
        group.add(new T.Mesh(new T.TubeGeometry(path, segs, 5.2, 12, closed), core));
        if (!closed) {
          /* estremità del tubo: vetro arrotondato */
          const ends = [path.getPoint(0), path.getPoint(1)];
          ends.forEach((p) => { const s = new T.Mesh(new T.SphereGeometry(15, 20, 16), glass); s.position.copy(p); group.add(s); const c = new T.Mesh(new T.SphereGeometry(5.2, 12, 10), core); c.position.copy(p); group.add(c); });
        }
      });
    });
    /* ombra morbida dei tubi sul muro, appena dietro */
    const composer = new T.EffectComposer(renderer);
    composer.addPass(new T.RenderPass(scene, camera));
    const bloom = new T.UnrealBloomPass(new T.Vector2(512, 512), 0.95, 0.5, 0.12);
    composer.addPass(bloom);

    const hot = new T.Color(0xffb84a), off = new T.Color(0x1a1712), gOff = new T.Color(0x26221c), gOn = new T.Color(0xff8a00);
    function set(k, v) {
      mats[k].emissiveIntensity = v * 0.95;
      mats[k].color.copy(gOff).lerp(gOn, v);
      mats[k].opacity = 0.6 + v * 0.3;
      cores[k].color.copy(off).lerp(hot, v);
      dirty = true;
    }
    const all = (v) => ORDER.forEach((k) => set(k, v));

    let W = 0, H = 0, dirty = true, visible = true, raf = 0, tx = 0, ty = 0, rx = 0, ry = 0;
    function size() {
      /* la tela è più grande dell'insegna: il bagliore ha spazio per sfumare */
      const r = el.getBoundingClientRect(); W = Math.max(1, Math.round(r.width * PAD)); H = Math.max(1, Math.round(r.height * PAD));
      renderer.setSize(W, H, false); composer.setSize(W, H); bloom.setSize(W, H);
      camera.aspect = W / H;
      /* inquadra tutta l'insegna con un margine per l'alone */
      const fitW = 1240 * PAD / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * camera.aspect), fitH = 829 * PAD / (2 * Math.tan(T.MathUtils.degToRad(camera.fov / 2)));
      camera.position.z = Math.max(fitW, fitH);
      camera.updateProjectionMatrix(); dirty = true;
    }
    function frame() {
      raf = requestAnimationFrame(frame);
      rx += (tx - rx) * 0.06; ry += (ty - ry) * 0.06;
      if (Math.abs(tx - rx) > 1e-4 || Math.abs(ty - ry) > 1e-4) dirty = true;
      if (!dirty || !visible) return;
      group.rotation.y = rx; group.rotation.x = ry;
      composer.render(); dirty = false;
    }
    size(); frame();
    const ro = new ResizeObserver(size); ro.observe(el);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) dirty = true; }); io.observe(el);
    function look(x, y) { tx = x * 0.22; ty = -y * 0.14; }

    function ignite(opts = {}) {
      const onLit = opts.onLit || (() => {}), done = opts.done || (() => {});
      let lit = 0;
      ORDER.forEach((k, i) => {
        const base = (opts.delay || 200) + i * 180 + Math.random() * 150;
        [[.25, 0], [0, 45], [.55, 100], [.08, 140], [1, 220], [.5, 270], [1, 350]].forEach(([v, t]) => setTimeout(() => set(k, v), base + t));
        setTimeout(() => { lit++; onLit(lit / 5); if (lit === 5) done(); }, base + 350);
      });
    }
    function hum() {
      return setInterval(() => {
        if (document.hidden || !visible) return;
        const k = ORDER[Math.floor(Math.random() * 5)];
        [[.4, 0], [1, 55], [.7, 110], [1, 180]].forEach(([v, t]) => setTimeout(() => set(k, v), t));
      }, 7000 + Math.random() * 4000);
    }
    function dispose() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); }
    return { set, all, ignite, hum, look, dispose, canvas: renderer.domElement, ORDER };
  }
  return { create };
})();
