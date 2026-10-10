(function () {
  "use strict";

  // --------------------------------------------------------------------
  // Auto table of contents for writeup pages (built from h2/h3 ids that
  // kramdown's auto_ids already generates — no manual {:toc} needed).
  // --------------------------------------------------------------------
  function initToc() {
    var toc = document.getElementById("toc");
    var content = document.getElementById("writeup-content");
    if (!toc || !content) return;

    var headings = content.querySelectorAll("h2, h3");
    if (headings.length < 2) {
      // Not worth a TOC for short writeups — let the content use the full width.
      var layout = document.querySelector(".writeup-layout");
      if (layout) layout.classList.add("no-toc");
      return;
    }

    var list = document.createElement("ol");
    var currentH2Item = null;
    var currentH2List = null;

    headings.forEach(function (h) {
      if (!h.id) return;

      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent;
      li.appendChild(a);

      if (h.tagName === "H2") {
        list.appendChild(li);
        currentH2Item = li;
        currentH2List = null;
      } else if (currentH2Item) {
        if (!currentH2List) {
          currentH2List = document.createElement("ol");
          currentH2Item.appendChild(currentH2List);
        }
        currentH2List.appendChild(li);
      } else {
        list.appendChild(li);
      }
    });

    var details = document.createElement("details");
    details.open = true;
    var summary = document.createElement("summary");
    summary.textContent = "Table of contents";
    details.appendChild(summary);
    details.appendChild(list);
    toc.appendChild(details);
  }

  // --------------------------------------------------------------------
  // Highlight the writeup's closing section (conclusion / lessons learned):
  // wrap the last h2 + everything after it in a visually distinct box.
  // --------------------------------------------------------------------
  function initClosingSection() {
    var content = document.getElementById("writeup-content");
    if (!content) return;

    var headings = content.querySelectorAll("h2");
    if (headings.length < 2) return;

    var last = headings[headings.length - 1];
    var wrapper = document.createElement("div");
    wrapper.className = "writeup-closing";

    var toMove = [];
    var node = last;
    while (node) {
      toMove.push(node);
      node = node.nextSibling;
    }

    content.insertBefore(wrapper, last);
    toMove.forEach(function (n) { wrapper.appendChild(n); });
  }

  // --------------------------------------------------------------------
  // "Copy" button on every Rouge code block.
  // --------------------------------------------------------------------
  function initCopyButtons() {
    var blocks = document.querySelectorAll(".highlighter-rouge, pre.highlight");
    var done = [];

    blocks.forEach(function (block) {
      var container = block.classList.contains("highlighter-rouge")
        ? block
        : block.closest(".highlighter-rouge") || block;

      if (done.indexOf(container) !== -1) return;
      done.push(container);

      var codeEl = container.querySelector("pre.highlight code") || container.querySelector("code");
      if (!codeEl) return;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn";
      btn.textContent = "Copy";

      btn.addEventListener("click", function () {
        var text = codeEl.innerText;
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Copied";
          btn.classList.add("is-copied");
          setTimeout(function () {
            btn.textContent = "Copy";
            btn.classList.remove("is-copied");
          }, 1500);
        });
      });

      container.appendChild(btn);
    });
  }

  // --------------------------------------------------------------------
  // Home page: search box + difficulty filter + machines/engagements tabs.
  // --------------------------------------------------------------------
  function initHomeFilters() {
    var cards = document.querySelectorAll(".card");
    if (!cards.length) return;

    var searchInput = document.getElementById("search-input");
    var diffFilter = document.getElementById("difficulty-filter");
    var sortSelect = document.getElementById("sort-select");
    var tabs = document.querySelectorAll(".view-tab");
    var machinesSection = document.getElementById("machines");
    var engagementsSection = document.getElementById("engagements");
    var noResults = document.getElementById("no-results");
    var currentView = "all";

    var diffOrder = { easy: 0, medium: 1, hard: 2 };
    function applySort() {
      var mode = sortSelect ? sortSelect.value : "recent";
      [document.getElementById("machines-grid"), document.getElementById("engagements-grid")].forEach(function (grid) {
        if (!grid) return;
        var items = Array.prototype.slice.call(grid.children);
        items.sort(function (a, b) {
          if (mode === "difficulty") {
            var da = diffOrder[a.getAttribute("data-difficulty")];
            var db = diffOrder[b.getAttribute("data-difficulty")];
            if (da === undefined) da = 99;
            if (db === undefined) db = 99;
            return da - db;
          }
          var ta = Date.parse(a.getAttribute("data-date")) || 0;
          var tb = Date.parse(b.getAttribute("data-date")) || 0;
          return tb - ta;
        });
        items.forEach(function (el) { grid.appendChild(el); });
      });
    }

    function applyFilters() {
      var q = ((searchInput && searchInput.value) || "").trim().toLowerCase();
      var diff = diffFilter ? diffFilter.value : "";
      var visible = 0;

      cards.forEach(function (card) {
        var type = card.getAttribute("data-type");
        var name = card.getAttribute("data-name") || "";
        var tags = card.getAttribute("data-tags") || "";
        var cardDiff = card.getAttribute("data-difficulty") || "";

        var ok =
          (currentView === "all" || currentView === type) &&
          (!q || name.indexOf(q) !== -1 || tags.indexOf(q) !== -1) &&
          (!diff || cardDiff === diff);

        card.style.display = ok ? "" : "none";
        if (ok) visible++;
      });

      if (machinesSection) {
        machinesSection.style.display = currentView === "all" || currentView === "machine" ? "" : "none";
      }
      if (engagementsSection) {
        engagementsSection.style.display = currentView === "all" || currentView === "engagement" ? "" : "none";
      }
      if (noResults) noResults.hidden = visible !== 0;
    }

    if (searchInput) searchInput.addEventListener("input", applyFilters);
    if (diffFilter) diffFilter.addEventListener("change", applyFilters);
    if (sortSelect) sortSelect.addEventListener("change", applySort);
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");
        currentView = tab.getAttribute("data-view");
        applyFilters();
      });
    });

    applySort();
    applyFilters();

    // "/" focuses search, unless the user is already typing somewhere.
    document.addEventListener("keydown", function (evt) {
      if (evt.key !== "/" || !searchInput) return;
      var active = document.activeElement;
      var typing = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      if (typing) return;
      evt.preventDefault();
      searchInput.focus();
    });
  }

  // --------------------------------------------------------------------
  // Mobile/tablet nav: hamburger toggle for the horizontal header menu.
  // --------------------------------------------------------------------
  function initNavToggle() {
    var toggle = document.getElementById("nav-toggle");
    var nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    nav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // --------------------------------------------------------------------
  // Live countdown to unlock_date on locked/active machine cards + pages.
  // --------------------------------------------------------------------
  function initCountdowns() {
    var els = document.querySelectorAll("[data-unlock]");
    if (!els.length) return;

    function render() {
      var now = Date.now();
      els.forEach(function (el) {
        var target = Date.parse(el.getAttribute("data-unlock"));
        var out = el.querySelector(".countdown-value");
        if (!out || isNaN(target)) return;
        var diff = target - now;
        if (diff <= 0) {
          out.textContent = "unlocking soon";
          return;
        }
        var d = Math.floor(diff / 86400000);
        var h = Math.floor((diff % 86400000) / 3600000);
        var m = Math.floor((diff % 3600000) / 60000);
        var s = Math.floor((diff % 60000) / 1000);
        out.textContent = d + "d " + h + "h " + m + "m " + s + "s";
      });
    }

    render();
    setInterval(render, 1000);
  }

  // --------------------------------------------------------------------
  // "Volver arriba" button (04 — Connect).
  // --------------------------------------------------------------------
  function initBackToTop() {
    var btn = document.getElementById("back-to-top");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initClosingSection();
    initToc();
    initCopyButtons();
    initHomeFilters();
    initNavToggle();
    initCountdowns();
    initBackToTop();
  });
})();
