/* Motore di advertising di Blend.
   Funzioni pure: le stesse andranno nel Worker Cloudflare che parla con Meta. Nel prototipo girano nel browser con dati di prova.
   Unità: euro, giorni. Nessun token qui: le chiamate vere partono solo dal server. */
(function (root) {
  "use strict";
  const LOCALE = { lat: 41.7886, lng: 12.4358, raggioKm: 10 }; /* Via di Mezzocammino 141: coordinate da verificare */
  const VALORE_PRENOTAZIONE = 26; /* euro: valore medio di una prenotazione mandato a Meta (da confermare con Alberto) */

  /* ---------- i pubblici: costo base per prenotazione e quanto "regge" prima di saturare ---------- */
  const PUBBLICI = [
    { id: "vicini", nome: "Vicini", spiega: "Chi vive o passa entro 10 km dal locale. Il pubblico largo da cui Meta impara.", persone: 410000, cpb: 5.4, cap: 34, meta: "Advantage+ audience, raggio 10 km, 23-55 anni" },
    { id: "simili", nome: "Simili ai clienti", spiega: "Persone che somigliano a chi è venuto davvero al Blend.", persone: 120000, cpb: 3.7, cap: 26, meta: "Lookalike 1% Italia dei clienti presentati, dentro il raggio" },
    { id: "sito", nome: "Già passati dal sito", spiega: "Hanno guardato menu o serate negli ultimi 14 giorni ma non hanno prenotato.", persone: 3900, cpb: 2.2, cap: 10, meta: "Custom audience: ViewContent 14 gg, esclusi Schedule 7 gg" },
    { id: "clienti", nome: "Clienti da riportare", spiega: "Sono venuti tra 45 e 180 giorni fa. Ricordiamoci di loro.", persone: 1650, cpb: 1.8, cap: 7, meta: "Custom audience: Purchase tra 45 e 180 gg" }
  ];

  /* costo per prenotazione quando spendi s euro al giorno su un pubblico: sale man mano che lo saturi */
  const cpbA = (p, s) => p.cpb * (1 + Math.pow(Math.max(0, s) / p.cap, 1.35));
  const prenotazioni = (p, s) => s > 0 ? s / cpbA(p, s) : 0;
  const marginale = (p, s, d = 0.5) => d / Math.max(1e-6, prenotazioni(p, s + d) - prenotazioni(p, s)); /* euro per una prenotazione in più */

  /* ---------- distribuisci: mette ogni mezzo euro dove la prossima prenotazione costa meno ---------- */
  function distribuisci(budgetGiorno, pubblici = PUBBLICI, attivi = null) {
    const ps = pubblici.filter((p) => !attivi || attivi.includes(p.id)), alloc = Object.fromEntries(ps.map((p) => [p.id, 0]));
    const passo = 0.5;
    for (let b = 0; b + passo <= budgetGiorno + 1e-9; b += passo) {
      let best = null, bm = Infinity;
      for (const p of ps) { const m = marginale(p, alloc[p.id], passo); if (m < bm) { bm = m; best = p; } }
      alloc[best.id] += passo;
    }
    const righe = ps.map((p) => ({ id: p.id, nome: p.nome, euro: alloc[p.id], pren: prenotazioni(p, alloc[p.id]), cpb: alloc[p.id] ? alloc[p.id] / prenotazioni(p, alloc[p.id]) : 0 }));
    const tot = righe.reduce((a, r) => a + r.pren, 0);
    return { righe, prenGiorno: tot, cpb: tot ? budgetGiorno / tot : 0 };
  }
  /* come andrebbe senza motore: un "boost" largo, tutto sui vicini, senza segnale dal server (+35% di costo) */
  function senzaMotore(budgetGiorno) {
    const p = { ...PUBBLICI[0], cpb: PUBBLICI[0].cpb * 1.35, cap: PUBBLICI[0].cap * 1.6 }, pr = prenotazioni(p, budgetGiorno);
    return { prenGiorno: pr, cpb: pr ? budgetGiorno / pr : 0 };
  }
  function previsione(budgetMese, giorni = 30) {
    const g = budgetMese / giorni, con = distribuisci(g), senza = senzaMotore(g);
    return {
      prenMese: Math.round(con.prenGiorno * giorni), cpb: con.cpb, valore: Math.round(con.prenGiorno * giorni * VALORE_PRENOTAZIONE),
      ritorno: con.cpb ? VALORE_PRENOTAZIONE / con.cpb : 0, senza: { prenMese: Math.round(senza.prenGiorno * giorni), cpb: senza.cpb },
      risparmio: senza.cpb ? 1 - con.cpb / senza.cpb : 0, righe: con.righe
    };
  }

  /* ---------- il pilota: regole leggibili. Ogni azione dice perché ---------- */
  function pilota(stato) {
    const az = [], obiettivo = stato.cpbObiettivo || 4.5;
    for (const a of stato.annunci) {
      if (a.spesa > obiettivo * 2 && a.pren === 0) az.push({ tipo: "pausa", su: a.nome, perche: `Ha speso €${a.spesa.toFixed(0)} senza portare prenotazioni (più del doppio del costo obiettivo di €${obiettivo.toFixed(2)}).`, auto: true });
      else if (a.pren >= 3 && a.spesa / a.pren < obiettivo * 0.7) az.push({ tipo: "aumenta", su: a.nome, delta: +(a.budget * 0.2).toFixed(0), perche: `Porta prenotazioni a €${(a.spesa / a.pren).toFixed(2)}, molto sotto l'obiettivo. +20%: di più Meta rimetterebbe il gruppo in apprendimento.`, auto: true });
      if (a.frequenza > 3.5) az.push({ tipo: "creativita", su: a.nome, perche: `Le stesse persone l'hanno visto ${a.frequenza.toFixed(1)} volte: si stanca. Propongo una creatività nuova dal back office.`, auto: false });
    }
    if (stato.salaStasera >= 0.9) az.push({ tipo: "riduci", su: "Spesa di oggi", delta: -50, perche: `La sala stasera è già piena al ${Math.round(stato.salaStasera * 100)}%: inutile pagare per altre prenotazioni.`, auto: true });
    for (const s of stato.serate || []) if (s.giorniMancanti <= 2 && s.riempimento < 0.4) az.push({ tipo: "spinta", su: s.titolo, perche: `${s.titolo} è al ${Math.round(s.riempimento * 100)}% a ${s.giorniMancanti} giorni: propongo €15 in più sulle storie ai "Simili ai clienti".`, auto: false });
    return az;
  }

  /* ---------- traduzione degli obiettivi in chiamate Meta Marketing API (Graph) ---------- */
  const OBIETTIVI = {
    tavoli: { nome: "Riempi i tavoli", meta: "OUTCOME_LEADS", evento: "SCHEDULE", pubblici: ["vicini", "simili", "sito", "clienti"] },
    serata: { nome: "Fai conoscere una serata", meta: "OUTCOME_AWARENESS", evento: null, pubblici: ["vicini", "simili"] },
    tornare: { nome: "Fai tornare i clienti", meta: "OUTCOME_SALES", evento: "PURCHASE", pubblici: ["clienti"] }
  };
  const cent = (e) => Math.round(e * 100);
  function chiamateMeta({ obiettivo, nome, budgetGiorno, inizio, fine, pixel = "PIXEL_ID", conto = "act_CONTO", audience = {} }) {
    const o = OBIETTIVI[obiettivo], d = distribuisci(budgetGiorno, PUBBLICI, o.pubblici), out = [];
    out.push({ metodo: "POST", path: `/${conto}/campaigns`, body: { name: nome, objective: o.meta, status: "PAUSED", special_ad_categories: [], buying_type: "AUCTION" } });
    for (const r of d.righe) {
      if (!r.euro) continue;
      const targeting = { geo_locations: { custom_locations: [{ latitude: LOCALE.lat, longitude: LOCALE.lng, radius: LOCALE.raggioKm, distance_unit: "kilometer" }] }, age_min: 23, age_max: 55, targeting_automation: { advantage_audience: r.id === "vicini" ? 1 : 0 }, excluded_custom_audiences: [{ id: audience.prenotatiRecenti || "AUD_PRENOTATI_3GG" }] };
      if (r.id !== "vicini") targeting.custom_audiences = [{ id: audience[r.id] || `AUD_${r.id.toUpperCase()}` }];
      out.push({ metodo: "POST", path: `/${conto}/adsets`, body: {
        name: `${nome} · ${r.nome}`, campaign_id: "{campaign_id}", daily_budget: cent(r.euro), start_time: inizio, end_time: fine,
        billing_event: "IMPRESSIONS", bid_strategy: "LOWEST_COST_WITHOUT_CAP", optimization_goal: o.evento ? "OFFSITE_CONVERSIONS" : "REACH",
        ...(o.evento ? { promoted_object: { pixel_id: pixel, custom_event_type: o.evento } } : { frequency_control_specs: [{ event: "IMPRESSIONS", interval_days: 7, max_frequency: 2 }] }),
        targeting, status: "PAUSED" } });
    }
    return out;
  }
  function chiamatePubblici(pixel = "PIXEL_ID", conto = "act_CONTO") {
    const giorni = (n) => n * 86400;
    return [
      { metodo: "POST", path: `/${conto}/customaudiences`, body: { name: "Blend · Già passati dal sito 14 gg", rule: { inclusions: { operator: "or", rules: [{ event_sources: [{ type: "pixel", id: pixel }], retention_seconds: giorni(14), filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "ViewContent" }] } }] }, exclusions: { operator: "or", rules: [{ event_sources: [{ type: "pixel", id: pixel }], retention_seconds: giorni(7), filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "Schedule" }] } }] } } } },
      { metodo: "POST", path: `/${conto}/customaudiences`, body: { name: "Blend · Clienti presentati", subtype: "CUSTOM", customer_file_source: "USER_PROVIDED_ONLY" } },
      { metodo: "POST", path: `/${conto}/customaudiences`, body: { name: "Blend · Simili ai clienti 1%", subtype: "LOOKALIKE", origin_audience_id: "{aud_clienti}", lookalike_spec: { type: "similarity", ratio: 0.01, country: "IT" } } }
    ];
  }

  /* ---------- Conversions API: l'evento della prenotazione, con i dati personali in hash ---------- */
  async function sha256(s) {
    const t = String(s || "").trim().toLowerCase(); if (!t) return undefined;
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  const tel = (s) => { const d = String(s || "").replace(/\D/g, ""); return d ? (d.startsWith("39") ? d : "39" + d) : ""; };
  async function eventoCapi(p, nome = "Schedule") {
    return {
      event_name: nome, event_time: Math.floor((p.quando || Date.now()) / 1000), event_id: `pren-${p.id}`, action_source: "website", event_source_url: "https://blendfoodanddrink.it/prenota",
      user_data: { em: [await sha256(p.email)], ph: [await sha256(tel(p.telefono))], fn: [await sha256((p.nome || "").split(" ")[0])], fbc: p.fbc, fbp: p.fbp, client_user_agent: p.ua },
      custom_data: { currency: "EUR", value: (p.coperti || 2) * (VALORE_PRENOTAZIONE / 2.4), num_people: p.coperti, content_category: p.fonte || "diretta" }
    };
  }
  /* voto alla qualità della corrispondenza, come lo mostra Meta: più campi validi = più persone riconosciute */
  function qualita(prenotazioni) {
    if (!prenotazioni.length) return 0;
    const w = { email: 3, telefono: 3, nome: 1, fbp: 1.5, fbc: 1.5 }, m = Object.values(w).reduce((a, b) => a + b, 0);
    const s = prenotazioni.reduce((a, p) => a + Object.entries(w).reduce((x, [k, v]) => x + (p[k] ? v : 0), 0) / m, 0) / prenotazioni.length;
    return Math.round(s * 100) / 10;
  }

  root.Motore = { LOCALE, VALORE_PRENOTAZIONE, PUBBLICI, OBIETTIVI, cpbA, prenotazioni, distribuisci, senzaMotore, previsione, pilota, chiamateMeta, chiamatePubblici, eventoCapi, qualita, sha256 };
})(typeof window !== "undefined" ? window : globalThis);
