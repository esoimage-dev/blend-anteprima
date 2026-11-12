/* Foto del back office: ogni immagine caricata viene ritagliata sul formato del posto in cui va, centrata sul punto di fuoco,
   ridotta e compressa in WebP. Così una foto storta, enorme o del formato sbagliato non rompe mai il sito. */
(function (root) {
  "use strict";
  /* formati: rapporto larghezza/altezza, lato lungo massimo, lato corto minimo consigliato */
  const FORMATI = {
    locandina: { r: 3 / 4, max: 1200, min: 700, nome: "locandina 3:4" },
    drink: { r: 4 / 5, max: 1400, min: 800, nome: "foto 4:5" },
    piatto: { r: 1, max: 1600, min: 900, nome: "foto quadrata" },
    post: { r: 4 / 5, max: 1440, min: 1080, nome: "post 4:5" },
    storia: { r: 9 / 16, max: 1920, min: 1080, nome: "verticale 9:16" }
  };
  const leggi = (file) => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = ko; r.readAsDataURL(file); });
  const carica = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
  /* ritaglio attorno al punto di fuoco (fx, fy in 0..1): il punto resta in vista anche se la foto è di un altro formato */
  function taglio(w, h, r, fx = 0.5, fy = 0.5) {
    let cw = w, ch = w / r; if (ch > h) { ch = h; cw = h * r; }
    const x = Math.min(Math.max(fx * w - cw / 2, 0), w - cw), y = Math.min(Math.max(fy * h - ch / 2, 0), h - ch);
    return { x, y, w: cw, h: ch };
  }
  async function prepara(file, formato, fuoco = "50% 50%") {
    if (!file || !/^image\//.test(file.type)) throw new Error("Serve una foto (JPG, PNG, HEIC convertita, WebP).");
    if (file.size > 25 * 1024 * 1024) throw new Error("La foto pesa più di 25 MB: scattala o esportala più leggera.");
    const f = FORMATI[formato] || FORMATI.drink, img = await carica(await leggi(file));
    const [fx, fy] = fuoco.split(" ").map((v) => parseFloat(v) / 100);
    const t = taglio(img.naturalWidth, img.naturalHeight, f.r, fx, fy);
    const scala = Math.min(1, f.max / Math.max(t.w, t.h)), W = Math.round(t.w * scala), H = Math.round(t.h * scala);
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(img, t.x, t.y, t.w, t.h, 0, 0, W, H);
    const dati = c.toDataURL("image/webp", 0.82);
    const avvisi = [];
    if (Math.min(t.w, t.h) < f.min) avvisi.push(`La foto è piccola (${Math.round(Math.min(t.w, t.h))} px sul lato corto): sul sito può sembrare sgranata. Meglio almeno ${f.min} px.`);
    if (Math.abs(img.naturalWidth / img.naturalHeight - f.r) > 0.25) avvisi.push(`Era di un altro formato: l'abbiamo ritagliata in ${f.nome}. Tocca la foto per scegliere cosa resta al centro.`);
    return { dati, larghezza: W, altezza: H, kb: Math.round(dati.length * 0.75 / 1024), avvisi, originale: img.src };
  }
  root.Media = { FORMATI, prepara, taglio };
})(window);
