/* Assistente del back office: un solo punto da cui passano tutte le richieste a Claude.
   - Modello di tutti i giorni: Haiku (veloce, costa pochissimo). Sonnet solo dove un compito lo prevede.
   - In produzione le richieste vanno al Worker (strumenti/worker-ai), che tiene la chiave: dal browser la chiave non passa mai.
   - Finché il Worker non è collegato (AI.endpoint vuoto) risponde un generatore di prova, così l'interfaccia si usa già. */
(function (root) {
  "use strict";
  const MODELLI = {
    veloce: { id: "claude-haiku-5-5", nome: "Haiku", prezzo: [0.10, 0.50] },   /* dollari per milione di token: ingresso, uscita */
    curato: { id: "claude-sonnet-5-5", nome: "Sonnet", prezzo: [2, 10] }
  };
  /* i compiti: dove serve davvero. sonnet:true = l'interfaccia mostra l'interruttore "Più curato" */
  const COMPITI = {
    didascalia: { nome: "Didascalia per i social", varianti: 3, max: 2200, sonnet: true, toni: ["Diretto", "Ironico", "Elegante"] },
    accorcia: { nome: "Accorcia", varianti: 1, max: 125 },
    hashtag: { nome: "Hashtag", varianti: 1, max: 2200 },
    annuncio: { nome: "Testo dell'annuncio", varianti: 3, max: 125 },
    drink: { nome: "Descrizione del drink", varianti: 3 },
    candidato: { nome: "Risposta al candidato", varianti: 1, max: 900, toni: ["Colloquio", "Più avanti", "No, grazie"] },
    documento: { nome: "Lettura di bolle e fatture", sonnet: true }
  };

  /* ---------- documenti: prima tutto quello che si può fare senza AI ---------- */
  /* Da cosa si parte -> che strada prende. L'AI entra solo quando serve vedere (foto) o quando le regole non bastano. */
  function pianoLettura(doc) {
    const t = doc.tipo || "";
    if (/xml|p7m/.test(t)) return { via: "regole", modello: null, perche: "Fattura elettronica: è già un file di dati, si legge con le regole. Nessun costo." };
    if (/pdf/.test(t) && doc.haTesto) return { via: "testo", modello: null, perche: "PDF con testo dentro: si estrae il testo e si riconoscono le righe con le regole e la memoria del fornitore. Claude entra solo se restano dubbi." };
    return { via: "visione", modello: MODELLI.veloce.id, perche: "Foto o scansione: serve leggerla. La legge Haiku e restituisce righe, quantità e prezzi già in tabella." };
  }
  /* dopo la prima lettura: vale la pena un secondo passaggio col modello più curato? */
  function serveSecondoPasso(righe, doc) {
    if (!righe.length) return { serve: true, motivo: "Nessuna riga riconosciuta" };
    const dubbie = righe.filter((r) => r.stato !== "ok").length;
    if (dubbie / righe.length >= 0.5) return { serve: true, motivo: `${dubbie} righe su ${righe.length} da controllare` };
    if (doc && doc.totale) { const somma = righe.reduce((s, r) => s + (r.riga.prezzo || 0) * (r.riga.quantita || 0), 0); if (somma && Math.abs(somma - doc.totale) / doc.totale > 0.25) return { serve: true, motivo: "La somma delle righe non torna con il totale" }; }
    return { serve: false, motivo: "" };
  }
  /* costo indicativo di una lettura: una pagina fotografata vale circa 1.600 token in ingresso e 500 in uscita */
  function costoLettura(pagine, modello) {
    const m = Object.values(MODELLI).find((x) => x.id === modello); if (!m) return 0;
    return pagine * (1600 * m.prezzo[0] + 500 * m.prezzo[1]) / 1e6 * 0.93; /* in euro, cambio indicativo */
  }
  /* controllo sul telefono, prima di spendere una chiamata: la foto è mossa o buia? (varianza dei bordi e luminosità media) */
  function qualitaFoto(canvas) {
    try {
      const w = 160, h = Math.round(canvas.height / canvas.width * w), c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(canvas, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
      let luce = 0; for (let i = 0; i < w * h; i++) { g[i] = d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114; luce += g[i]; } luce /= w * h;
      let s = 0, s2 = 0, n = 0; for (let y = 1; y < h - 1; y++) for (let k = 1; k < w - 1; k++) { const i = y * w + k, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w]; s += l; s2 += l * l; n++; }
      const nitidezza = s2 / n - (s / n) ** 2;
      return { luce, nitidezza, buia: luce < 55, mossa: nitidezza < 18 };
    } catch (e) { return { luce: 128, nitidezza: 99, buia: false, mossa: false }; }
  }

  /* ---------- testi: generatore di prova (resta finché non c'è il Worker) ---------- */
  const taglia = (s, n) => (!n || s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…");
  const PROVA = {
    didascalia: (d) => {
      const t = d.titolo || "Stasera al Blend", q = d.quando ? d.quando + ". " : "", l = d.dettaglio ? d.dettaglio.replace(/\.?$/, ".") + " " : "";
      const base = { Diretto: [`${t}. ${q}${l}Prenota il tavolo dal link in bio.`, `${q}${t}. ${l}I tavoli vicino al bancone finiscono per primi.`, `${t}: ${l}${q}Ti aspettiamo in Via di Mezzocammino 141.`],
        Ironico: [`${t}. ${l}Il divano di casa può aspettare. ${q}`, `Piano per la serata: ${t}. Piano B: non serve. ${q}`, `${q}${t}. ${l}Poi non dire che non lo sapevi.`],
        Elegante: [`${t}. ${l}${q}Luci basse, bicchieri pieni.`, `${q}${l}${t}, dal tramonto a notte fonda.`, `Una sera come si deve: ${t}. ${q}`] };
      return (base[d.tono] || base.Diretto).map((x) => x.replace(/\s+/g, " ").trim());
    },
    accorcia: (d) => [taglia((d.testo || "").split(/(?<=[.!?])\s/)[0] || d.testo || "", 125)],
    hashtag: (d) => [((d.testo || "").replace(/\s*#\S+/g, "").trim() + "\n\n#blendfoodanddrink #mezzocammino #romasud #cocktailbar" + (/jazz/i.test(d.testo + d.titolo) ? " #jazzroma" : /aperi/i.test(d.testo + d.titolo) ? " #aperitivoroma" : " #roma")).trim()],
    annuncio: (d) => { const t = d.titolo || "Blend Food & Drink"; return [`${t}: prenota il tavolo, i posti buoni finiscono presto.`, `Stasera esci a Mezzocammino. ${t}, dalle 18 alle 2.`, `${t}. Cocktail, cucina e musica a dieci minuti da casa.`].map((x) => taglia(x, 125)); },
    drink: (d) => { const b = (d.base || "").toLowerCase(), c = (d.carattere || "fresco").toLowerCase(); return [`${d.nome}: ${b}, ${c} quanto basta.`, `Parte ${c}, chiude lungo. ${d.base || ""} e pazienza.`.trim(), `Per chi ordina ${b} e vuole essere sorpreso.`].map((x) => taglia(x, d.max)); },
    candidato: (d) => { const n = d.nome || ""; return [{ Colloquio: `Ciao ${n},\ngrazie per esserti candidato al Blend. Ci farebbe piacere conoscerti: riesci a passare giovedì alle 17, prima dell'apertura? Siamo in Via di Mezzocammino 141.\n\nA presto,\nAlberto`, "Più avanti": `Ciao ${n},\ngrazie per la candidatura. In questo momento la squadra è al completo, ma teniamo il tuo curriculum: se si libera un posto ${d.ruolo ? "in " + d.ruolo.toLowerCase() : ""} ti scriviamo noi.\n\nUn saluto,\nAlberto`, "No, grazie": `Ciao ${n},\ngrazie per averci scritto e per il tempo che ci hai dedicato. Per questa posizione abbiamo scelto un altro profilo. Ti auguriamo il meglio.\n\nAlberto` }[d.tono] || ""]; }
  };

  async function chiedi(compito, dati, opt = {}) {
    const c = COMPITI[compito]; if (!c) throw new Error("Compito sconosciuto: " + compito);
    const modello = opt.curato && c.sonnet ? MODELLI.curato : MODELLI.veloce;
    if (AI.endpoint) {
      const r = await fetch(AI.endpoint + "/testo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ compito, dati, modello: modello.id, max: dati.max || c.max, varianti: c.varianti }) });
      if (!r.ok) throw new Error(r.status === 429 ? "Troppe richieste: riprova tra un attimo." : "Claude non risponde: riprova.");
      const j = await r.json(); return { varianti: j.varianti, modello: modello.nome, prova: false };
    }
    await new Promise((ok) => setTimeout(ok, 650 + Math.random() * 500));
    const out = PROVA[compito](dati).filter(Boolean).map((x) => taglia(x, dati.max || c.max));
    if (opt.giro) out.push(out.shift());
    return { varianti: out, modello: modello.nome, prova: true };
  }

  const AI = { endpoint: "", MODELLI, COMPITI, chiedi, pianoLettura, serveSecondoPasso, costoLettura, qualitaFoto };
  root.AI = AI;
})(window);
