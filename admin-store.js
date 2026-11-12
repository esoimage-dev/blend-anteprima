/* Bozze del back office: restano sul dispositivo (anche chiudendo la pagina) finché non si pubblica, con annulla.
   In produzione la bozza vive nel database (D1) e "Pubblica" la manda al sito; qui resta nel browser. */
(function (root) {
  "use strict";
  const KEY = "blend-bozza-v1", MAX_STORIA = 30;
  const storia = [];
  const leggi = () => { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  function salva(dati) {
    try { localStorage.setItem(KEY, JSON.stringify({ quando: Date.now(), dati })); return true; }
    catch (e) { return false; } /* spazio finito: le foto pesano. In produzione vanno sul server, non qui */
  }
  function ricorda(dati) { storia.push(JSON.stringify(dati)); if (storia.length > MAX_STORIA) storia.shift(); }
  const annulla = () => (storia.length > 1 ? (storia.pop(), JSON.parse(storia[storia.length - 1])) : null);
  const scarta = () => { try { localStorage.removeItem(KEY); } catch (e) {} storia.length = 0; };
  root.Bozza = { leggi, salva, ricorda, annulla, scarta, puoAnnullare: () => storia.length > 1 };
})(window);
