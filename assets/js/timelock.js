/* timelock.js — visor de writeups con time-lock drand.
 * Cuenta atrás hasta unlock_date; al llegar (o si ya pasó) pide la firma de la
 * ronda a drand vía window.TLock, descifra el payload cifrado en #tl-cipher,
 * y renderiza el markdown + imágenes con marked. Si drand no responde, reintenta.
 */
(function () {
  "use strict";
  var box = document.querySelector(".locked-notice.timelock");
  if (!box || !window.TLock) return;

  var unlockMs = Date.parse(box.getAttribute("data-unlock"));
  var cv = document.getElementById("tl-countdown");
  var st = document.getElementById("tl-status");
  var cipherEl = document.getElementById("tl-cipher");
  var writeup = document.getElementById("tl-writeup");
  var content = document.getElementById("writeup-content");
  var toc = document.getElementById("toc");
  var cipherB64 = (cipherEl ? cipherEl.textContent : "").trim();
  var decrypting = false, done = false;

  function two(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    return (d > 0 ? d + "d " : "") + two(h) + ":" + two(m) + ":" + two(s);
  }
  function b64decodeUtf8(b64) { return decodeURIComponent(escape(atob(b64))); }

  function slug(t) {
    return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function buildTOC() {
    if (!toc) return;
    var hs = content.querySelectorAll("h2, h3");
    if (!hs.length) { toc.hidden = true; return; }
    var wrap = document.createElement("div");
    var title = document.createElement("p");
    title.className = "toc-title"; title.textContent = "Table of contents";
    wrap.appendChild(title);
    var ul = document.createElement("ul");
    hs.forEach(function (h) {
      if (!h.id) h.id = slug(h.textContent);
      var li = document.createElement("li");
      if (h.tagName === "H3") li.style.marginLeft = "14px";
      var a = document.createElement("a");
      a.href = "#" + h.id; a.textContent = h.textContent;
      li.appendChild(a); ul.appendChild(li);
    });
    wrap.appendChild(ul);
    toc.innerHTML = ""; toc.appendChild(wrap);
  }

  function render(payload) {
    var md = payload.markdown || "";
    (payload.images || []).forEach(function (img) {
      var re = new RegExp("\\]\\(\\s*" + img.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\)", "g");
      md = md.replace(re, "](" + img.dataUrl + ")");
    });
    content.innerHTML = window.marked.parse(md);
    // Reinyecta tags/summary (que iban cifrados) en la cabecera, si los hay.
    if (payload.tags && payload.tags.length) {
      var header = document.querySelector(".writeup-header");
      if (header && !header.querySelector(".tag-list")) {
        var tl = document.createElement("div");
        tl.className = "tag-list";
        payload.tags.forEach(function (t) {
          var s = document.createElement("span"); s.className = "tag"; s.textContent = t; tl.appendChild(s);
        });
        header.appendChild(tl);
      }
    }
    buildTOC();
    box.style.display = "none";
    writeup.hidden = false;
  }

  function attempt() {
    if (decrypting || done) return;
    decrypting = true;
    st.textContent = "Pidiendo la clave a drand y descifrando…";
    window.TLock.decryptText(b64decodeUtf8(cipherB64)).then(function (json) {
      done = true;
      try { render(JSON.parse(json)); }
      catch (e) { st.textContent = "El contenido descifrado no es válido: " + e.message; }
    }).catch(function (e) {
      st.textContent = "Aún no disponible en drand, reintentando… (" + e.message + ")";
    }).then(function () { decrypting = false; });
  }

  function tick() {
    var rem = unlockMs - Date.now();
    if (rem > 0) {
      cv.textContent = fmt(rem);
      setTimeout(tick, 1000);
    } else {
      cv.textContent = "00:00:00";
      attempt();
      if (!done) setTimeout(tick, 8000); // reintenta hasta que drand tenga la ronda
    }
  }

  if (isNaN(unlockMs)) { st.textContent = "Fecha de desbloqueo inválida."; return; }
  tick();
})();
