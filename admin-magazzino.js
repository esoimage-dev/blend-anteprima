/* Magazzino di Blend: scorte, ricette, fornitori, arrivi.
   Funzioni pure: le stesse andranno nel Worker che riceve le vendite da iPratico. Nel prototipo girano nel browser.
   Unità interne: grammi (g), millilitri (ml), pezzi (pz). Si converte solo in entrata (fatture) e in uscita (schermo). */
(function (root) {
  "use strict";
  const UNITA = { g: "g", ml: "ml", pz: "pz" };
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const fmtQ = (q, u) => u === "g" ? (Math.abs(q) >= 1000 ? (q / 1000).toFixed(q % 1000 ? 1 : 0).replace(".", ",") + " kg" : Math.round(q) + " g")
    : u === "ml" ? (Math.abs(q) >= 1000 ? (q / 1000).toFixed(q % 1000 ? 1 : 0).replace(".", ",") + " l" : Math.round(q) + " ml") : (Math.round(q * 10) / 10).toString().replace(".", ",") + " pz";

  /* ---------- scarico: una vendita diventa movimenti di magazzino, per eccesso ---------- */
  function scarica(vendita, prodotti, margine = 0.05) {
    const p = prodotti.find((x) => x.id === vendita.prodotto || (x.ipratico && x.ipratico === vendita.codice));
    if (!p) return { movimenti: [], sconosciuto: vendita.codice || vendita.prodotto };
    return { prodotto: p, movimenti: (p.ricetta || []).filter((r) => r.articolo && r.qta > 0).map((r) => ({ tipo: "vendita", articolo: r.articolo, delta: -r.qta * (vendita.quantita || 1) * (1 + margine), rif: p.nome, quando: vendita.quando || Date.now() })) };
  }
  function applica(articoli, movimenti) {
    for (const m of movimenti) { const a = articoli.find((x) => x.id === m.articolo); if (a) a.giacenza = Math.max(0, a.giacenza + m.delta); }
    return articoli;
  }

  /* ---------- quanto dura e quando ordinare ---------- */
  const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
  function prossimaConsegna(f, oggi = new Date()) {
    if (!f || !f.consegna || !f.consegna.length) return 2;
    for (let d = 1; d <= 14; d++) { const g = new Date(oggi); g.setDate(g.getDate() + d); if (f.consegna.includes(GIORNI[g.getDay()]) && d >= (f.anticipo || 1)) return d; }
    return 7;
  }
  function stato(a, f, oggi, copertura = 7) {
    const giorni = a.consumoGiorno > 0 ? a.giacenza / a.consumoGiorno : Infinity;
    const attesa = prossimaConsegna(f, oggi);
    const sotto = a.giacenza <= a.minimo;
    const finisce = giorni < attesa + 1; /* finisce prima che arrivi la prossima consegna, con un giorno di margine */
    let qta = 0;
    if (sotto || finisce) {
      const serve = Math.max(a.minimo * 1.5, a.consumoGiorno * (attesa + copertura)) - a.giacenza; /* copre fino a «copertura» giorni dopo l'arrivo */
      qta = Math.max(a.lotto, Math.ceil(serve / a.lotto) * a.lotto);
      /* tetto: non si ordina oltre quello che ci sta (resta almeno una confezione se serve davvero) */
      if (a.massimo > 0) qta = Math.max(a.giacenza < a.massimo ? a.lotto : 0, Math.floor((a.massimo - a.giacenza) / a.lotto) * a.lotto);
    }
    /* "riordina comunque": quando lo decide una persona vale più dei calcoli */
    if (a.forza && !qta) qta = Math.max(a.lotto, Math.ceil((a.consumoGiorno * (prossimaConsegna(f, oggi) + copertura) - a.giacenza) / a.lotto) * a.lotto);
    return { giorni, attesa, sotto, finisce, ordina: qta > 0, qta, livello: a.minimo ? Math.min(1, a.giacenza / (a.minimo * 3)) : 1 };
  }
  function riordino(articoli, fornitori, oggi = new Date(), coperture = {}) {
    const per = {};
    for (const a of articoli) {
      const f = fornitori.find((x) => x.id === a.fornitore), s = stato(a, f, oggi, coperture[a.categoria] || 7);
      if (!s.ordina || a.ordinato) continue;
      (per[a.fornitore] = per[a.fornitore] || { fornitore: f, righe: [], urgente: false }).righe.push({ articolo: a, ...s });
      if (s.giorni < 1.5 || a.giacenza === 0) per[a.fornitore].urgente = true;
    }
    return Object.values(per).map((o) => ({ ...o, totale: o.righe.reduce((t, r) => t + (r.qta / r.articolo.lotto) * (r.articolo.costoLotto || 0), 0) })).sort((x, y) => (y.urgente - x.urgente) || (x.righe[0].giorni - y.righe[0].giorni));
  }
  function messaggioOrdine(o) {
    const r = o.righe.map((x) => `· ${Math.round(x.qta / x.articolo.lotto)} × ${x.articolo.formato || x.articolo.nome}`).join("\n");
    return `Ciao ${o.fornitore.referente || ""}, sono Alberto del Blend (Via di Mezzocammino 141).\nPer la prossima consegna ci servono:\n${r}\nGrazie!`;
  }

  /* ---------- costo delle ricette ---------- */
  function costoRicetta(p, articoli, margine = 0.05) {
    let c = 0, manca = 0;
    for (const r of p.ricetta || []) { const a = articoli.find((x) => x.id === r.articolo); if (!a || !a.costoLotto) { manca++; continue; } c += r.qta * (1 + margine) * a.costoLotto / a.lotto; }
    return { costo: c, foodCost: p.prezzo ? c / p.prezzo : 0, manca };
  }

  /* ---------- fattura elettronica (FatturaPA, XML dallo SdI): lettura esatta e gratuita ---------- */
  function leggiFatturaPA(xml) {
    const d = new DOMParser().parseFromString(xml, "application/xml");
    if (d.querySelector("parsererror")) throw new Error("Il file non è una fattura elettronica leggibile.");
    const t = (el, sel) => { const n = [...(el || d).getElementsByTagName("*")].find((x) => x.localName === sel); return n ? n.textContent.trim() : ""; };
    const all = (sel) => [...d.getElementsByTagName("*")].filter((x) => x.localName === sel);
    const ced = all("CedentePrestatore")[0];
    return {
      fornitore: t(ced, "Denominazione") || [t(ced, "Nome"), t(ced, "Cognome")].join(" ").trim(), piva: t(ced, "IdCodice"),
      numero: t(null, "Numero"), data: t(null, "Data"), totale: parseFloat(t(null, "ImportoTotaleDocumento")) || 0,
      righe: all("DettaglioLinee").map((l) => ({ descrizione: t(l, "Descrizione"), quantita: parseFloat(t(l, "Quantita")) || 1, unita: t(l, "UnitaMisura"), prezzo: parseFloat(t(l, "PrezzoUnitario")) || 0, codice: t(l, "CodiceValore") }))
    };
  }

  /* ---------- da riga di fattura ad articolo: abbinamento e conversione di unità ---------- */
  function quantitaInterna(riga, a) {
    const s = norm(riga.descrizione + " " + (riga.unita || "")), q = riga.quantita || 1;
    /* formati scritti nella descrizione: "fusto 20l", "cartone 24 x 33cl", "kg 5" */
    const conf = s.match(/(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(cl|ml|l|g|kg)\b/);
    const lit = s.match(/(\d+(?:[.,]\d+)?)\s*(lt|l|cl|ml)\b/), kg = s.match(/(\d+(?:[.,]\d+)?)\s*(kg|gr|g)\b/);
    const n = (x) => parseFloat(String(x).replace(",", "."));
    const toMl = (v, u) => u === "cl" ? v * 10 : u === "ml" ? v : v * 1000, toG = (v, u) => u === "kg" ? v * 1000 : v;
    if (a.unita === "pz") {
      /* "conf.10", "cartone 24", "24 x 20cl", oppure unità di misura CF/CT: sono confezioni, non pezzi */
      const pz = s.match(/(?:conf|cf|cartone|cart|ct|collo|cassetta|pack)\s*(?:da\s*)?(\d+)/);
      if (conf) return q * n(conf[1]);
      if (pz) return q * n(pz[1]);
      if (/^(cf|ct|crt|cart|conf|collo|cs)$/.test(norm(riga.unita))) return q * (a.lotto || 1);
      return q;
    }
    if (a.unita === "ml") { if (conf) return q * n(conf[1]) * toMl(n(conf[2]), conf[3]); if (lit) return q * toMl(n(lit[1]), lit[2] === "lt" ? "l" : lit[2]); return q * (a.lotto || 1); }
    if (a.unita === "g") { if (/\bkg\b/.test(norm(riga.unita))) return q * 1000; if (kg) return q * toG(n(kg[1]), kg[2]); return q * (a.lotto || 1000); }
    return q;
  }
  const GENERICHE = new Set("maiale suino suina manzo bovino vitello pollo agnello fresco fresca freschi fresche nero nera bianco bianca rosso rossa conf confezione pezzi cartone cassetta busta vaschetta sacco kg100 grammi litri bottiglia bott latta extra qualita italia italiano italiana per con senza".split(" "));
  function abbina(riga, articoli) {
    const s = norm(riga.descrizione); let best = null, bs = 0;
    for (const a of articoli) {
      if (a.alias && a.alias.some((x) => norm(x) === s)) return { articolo: a, fiducia: 1 };
      const tok = new Set(norm(a.nome + " " + (a.formato || "") + " " + (a.alias || []).join(" ")).split(" ").filter((w) => w.length > 2));
      const w = s.split(" ").filter((x) => x.length > 2), hit = w.filter((x) => tok.has(x)).length;
      /* parole generiche (maiale, fresco, conf...) da sole non bastano: serve almeno una parola che distingue il prodotto */
      const forte = w.filter((x) => tok.has(x) && !GENERICHE.has(x)).length;
      const sc = !forte ? 0 : w.length ? hit / Math.max(2, Math.min(w.length, tok.size)) : 0;
      if (sc > bs) { bs = sc; best = a; }
    }
    return { articolo: bs >= 0.34 ? best : null, fiducia: Math.min(1, bs) };
  }
  function prepareCarico(doc, articoli) {
    return doc.righe.map((r) => {
      const m = abbina(r, articoli), a = m.articolo, qi = a ? quantitaInterna(r, a) : 0;
      const prezzoUnit = a && qi ? (r.prezzo * r.quantita) / qi * a.lotto : 0;
      const varPrezzo = a && a.costoLotto && prezzoUnit ? prezzoUnit / a.costoLotto - 1 : 0;
      /* un prezzo che cambia troppo di solito è un errore di lettura o di unità: si controlla, non si aggiorna da solo */
      const strano = Math.abs(varPrezzo) > 0.6;
      return { riga: r, articolo: a, fiducia: m.fiducia, qta: qi, stato: !a ? "nuovo" : m.fiducia >= 0.75 && !strano ? "ok" : "controlla", varPrezzo, nuovoCosto: strano ? 0 : prezzoUnit };
    });
  }
  function caricaMerce(articoli, righe) {
    const mov = [];
    for (const r of righe) {
      if (!r.articolo || !(r.qta > 0)) continue;
      const a = articoli.find((x) => x.id === r.articolo.id); if (!a) continue;
      a.giacenza += r.qta; a.ordinato = false; if (r.nuovoCosto) a.costoLotto = Math.round(r.nuovoCosto * 100) / 100;
      a.alias = [...new Set([...(a.alias || []), r.riga.descrizione])].slice(-6); /* impara come lo scrive il fornitore */
      mov.push({ tipo: "carico", articolo: a.id, delta: r.qta, rif: r.riga.descrizione, quando: Date.now() });
    }
    return mov;
  }

  /* ---------- conta: teorico contro reale ---------- */
  function differenze(articoli, conta) {
    return articoli.filter((a) => conta[a.id] !== undefined && conta[a.id] !== "").map((a) => {
      const reale = +conta[a.id], diff = reale - a.giacenza;
      return { articolo: a, teorico: a.giacenza, reale, diff, perc: a.giacenza ? diff / a.giacenza : 0, euro: diff * (a.costoLotto || 0) / a.lotto };
    }).filter((x) => Math.abs(x.diff) > 0.0001);
  }

  /* ---------- vendite esportate da iPratico (CSV del venduto per articolo) ---------- */
  function leggiCsvVendite(testo) {
    const righe = testo.trim().split(/\r?\n/), sep = (righe[0].match(/;/g) || []).length >= (righe[0].match(/,/g) || []).length ? ";" : ",";
    const h = righe[0].split(sep).map(norm), iC = h.findIndex((x) => /codice|sku|plu/.test(x)), iN = h.findIndex((x) => /descr|articolo|prodotto|nome/.test(x)), iQ = h.findIndex((x) => /quant|qta|pezzi/.test(x));
    return righe.slice(1).map((r) => r.split(sep)).filter((c) => c.length > 1).map((c) => ({ codice: iC >= 0 ? c[iC].trim() : "", nome: iN >= 0 ? c[iN].trim() : "", quantita: parseFloat((c[iQ] || "1").replace(",", ".")) || 1 }));
  }

  root.Magazzino = { UNITA, norm, fmtQ, scarica, applica, prossimaConsegna, stato, riordino, messaggioOrdine, costoRicetta, leggiFatturaPA, quantitaInterna, abbina, prepareCarico, caricaMerce, differenze, leggiCsvVendite };
})(typeof window !== "undefined" ? window : globalThis);
