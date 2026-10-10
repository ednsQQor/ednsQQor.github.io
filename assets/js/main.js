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
    var tabs = document.querySelectorAll(".view-tab");
    var machinesSection = document.getElementById("machines");
    var engagementsSection = document.getElementById("engagements");
    var noResults = document.getElementById("no-results");
    var currentView = "all";

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
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("is-active"); });
        tab.classList.add("is-active");
        currentView = tab.getAttribute("data-view");
        applyFilters();
      });
    });

    applyFilters();
  }

  document.addEventListener("DOMContentLoaded", function () {
    initToc();
    initCopyButtons();
    initHomeFilters();
  });
})();
