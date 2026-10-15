(() => {
  const PROJECTS_PATH = "/workers/projects";
  const PROJECTS_URL = "https://app.dataannotation.tech/workers/projects";
  const SKIP_SELECTORS = [
    "header",
    "nav",
    "footer",
    "[role='navigation']",
    "[role='dialog']",
    "[aria-modal='true']",
    ".modal",
    "#da-refresh-bot"
  ].join(",");
  const CLICKABLE = "a, button, [role='button'], [role='link']";
  const NOISE = [
    "qualification",
    "aren't any projects",
    "are no projects available",
    "project families",
    "complete qualification",
    "protect your",
    "aidatatrainer",
    "security steps",
    "gain access to"
  ];

  let settings = {
    enabled: true,
    refreshFrom: 3,
    refreshTo: 8,
    titles: [
      { name: "Triton", priority: 1 },
      { name: "Ummon", priority: 2 },
      { name: "Boxing", priority: 3 }
    ],
    sound: true,
    ongoingTriton: false,
    stoppedAfterClick: false,
    pendingWorkMode: false
  };
  let scanTimer = null;
  let reloadTimer = null;
  let countdownTimer = null;
  let clicked = false;
  let observer = null;
  let switchedToProjects = false;
  let clickingInProgress = false;
  let lastMatch = null;
  let alertSent = false;
  let workModeDone = false;
  let workModeClickPending = false;
  let unavailableHandled = false;

  function pagePath() {
    return location.pathname.replace(/\/+$/, "") || "/";
  }

  function projectIdFromUrl(raw) {
    try {
      return new URL(raw || location.href, location.origin).searchParams.get("project_id") || "";
    } catch (_e) {
      return "";
    }
  }

  function isListPage() {
    return pagePath() === PROJECTS_PATH && !projectIdFromUrl();
  }

  function isTaskPage() {
    if (isListPage()) return false;
    const p = pagePath();
    if (p === "/workers/tasks" || p.startsWith("/workers/tasks/")) return true;
    return Boolean(projectIdFromUrl());
  }

  function isTaskPath(path) {
    if (projectIdFromUrl()) return true;
    const p = (path || pagePath()).replace(/\/+$/, "") || "/";
    if (p === PROJECTS_PATH) return false;
    if (p.startsWith(`${PROJECTS_PATH}/`)) return true;
    if (p === "/workers/tasks" || p.startsWith("/workers/tasks/")) return true;
    if (!p.startsWith("/workers/")) return false;
    if (p === "/workers" || p === "/workers/qualifications" || p === "/workers/dashboard") {
      return false;
    }
    return true;
  }

  function isTaskHref(raw) {
    if (!raw || raw === "#" || /^javascript:/i.test(raw)) return false;
    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return false;
      if (url.searchParams.get("project_id")) return true;
      return isTaskPath(url.pathname);
    } catch (_e) {
      return false;
    }
  }

  function findProjectAnchor(el) {
    if (!el) return null;
    const self = el.tagName === "A" ? el : el.closest("a[href]");
    if (self && isTaskHref(self.getAttribute("href") || self.href)) return self;
    const row = el.closest("tr, article, li, [class*='card' i], [class*='project' i]");
    const scope = row || el;
    const links = scope.querySelectorAll ? scope.querySelectorAll("a[href]") : [];
    for (const a of links) {
      if (isTaskHref(a.getAttribute("href") || a.href)) return a;
    }
    return self;
  }

  function absoluteHref(raw) {
    try {
      return new URL(raw, location.origin).href;
    } catch (_e) {
      return "";
    }
  }

  function normalize(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function ownText(el) {
    return normalize(el.innerText || el.textContent || "");
  }

  function looksLikeQualChrome(text) {
    const t = (text || "").toLowerCase();
    return (
      t.includes("[qualification]") ||
      t.includes("complete qualification") ||
      t.includes("simple security steps") ||
      t.includes("protect your aidatatrainer") ||
      t.includes("towards many project families")
    );
  }

  function hasInnerTaskTabs(el) {
    if (!el || !el.querySelectorAll) return false;
    const labels = [...el.querySelectorAll("a, button, [role='tab'], [role='button']")].map(
      tabLabel
    );
    const hasProjects = labels.some((t) => /^projects\b/i.test(t));
    const hasQuals = labels.some((t) => /^qualifications\b/i.test(t));
    const hasSurveys = labels.some((t) => /^surveys\b/i.test(t));
    return hasProjects && (hasQuals || hasSurveys);
  }

  function isQualChrome(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.id === "da-refresh-bot") return false;
    if (hasInnerTaskTabs(el)) return false;
    const t = ownText(el);
    if (!t || t.length > 1200) return false;
    return looksLikeQualChrome(t);
  }

  function inQualChrome(el) {
    let n = el;
    for (let i = 0; i < 14 && n && n !== document.body; i++) {
      if (isQualChrome(n)) return true;
      n = n.parentElement;
    }
    return false;
  }

  function inSkipRegion(el) {
    return Boolean(el && (el.closest(SKIP_SELECTORS) || inQualChrome(el)));
  }

  function isNoise(text) {
    const hay = text.toLowerCase();
    return NOISE.some((n) => hay.includes(n));
  }

  function titleEntries() {
    const list = Array.isArray(settings.titles) ? settings.titles : [];
    return list
      .map((item, index) => {
        if (item && typeof item === "object") {
          return {
            name: normalize(String(item.name || item.title || "")),
            priority: Math.max(1, Number(item.priority) || index + 1)
          };
        }
        return {
          name: normalize(String(item || "")),
          priority: index + 1
        };
      })
      .filter((item) => item.name)
      .sort((a, b) => a.priority - b.priority);
  }

  function titles() {
    return titleEntries().map((item) => item.name);
  }

  function escapeRe(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function matchesTitle(text) {
    for (const item of titleEntries()) {
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(item.name)}(?:$|[^a-z0-9])`, "i");
      if (re.test(text)) return item;
    }
    return null;
  }

  function isRateAndReviewTitle(title) {
    const t = normalize(title).toLowerCase();
    return (
      /\brate\s*(and|&)?\s*review\b/.test(t) ||
      /\breview\s*[:_]/.test(t) ||
      /\breview_\s*/.test(t)
    );
  }

  function matchRank(title, hit) {
    const t = normalize(title).toLowerCase();
    const name = hit.name.toLowerCase();
    const exact = t === name ? 0 : 1;
    const reviewPenalty =
      !isRateAndReviewTitle(name) && isRateAndReviewTitle(t) ? 1 : 0;
    const extra = Math.max(0, t.length - name.length);
    return { priority: hit.priority, reviewPenalty, exact, extra, len: t.length };
  }

  function isBetterRank(a, b) {
    if (a.priority !== b.priority) return a.priority < b.priority;
    if (a.reviewPenalty !== b.reviewPenalty) return a.reviewPenalty < b.reviewPenalty;
    if (a.exact !== b.exact) return a.exact < b.exact;
    if (a.extra !== b.extra) return a.extra < b.extra;
    return a.len < b.len;
  }

  function titleLabel(el) {
    if (!el) return "";
    const heading = el.querySelector?.(
      "h1, h2, h3, h4, h5, h6, [class*='title' i], [class*='name' i]"
    );
    const text = heading ? ownText(heading) : ownText(el);
    return normalize(text);
  }

  function closeBlockingModal() {
    const dialog = document.querySelector("[role='dialog'], [aria-modal='true']");
    if (!dialog) return;
    const close = dialog.querySelector(
      "button[aria-label*='close' i], button[aria-label*='dismiss' i], [class*='close' i]"
    );
    if (close && close.tagName === "BUTTON") close.click();
  }

  function tabLabel(el) {
    return ownText(el).replace(/\s+/g, " ");
  }

  function isSelectedTab(el) {
    if (!el) return false;
    const aria = (el.getAttribute("aria-selected") || el.getAttribute("aria-current") || "").toLowerCase();
    if (aria === "true" || aria === "page") return true;
    if (el.getAttribute("aria-pressed") === "true") return true;
    const cls = `${el.className || ""} ${el.parentElement ? el.parentElement.className : ""}`;
    return /\b(active|selected|current|Mui-selected)\b/i.test(cls);
  }

  function findInnerTab(name) {
    const re = new RegExp(`^${name}\\b`, "i");
    const nodes = [...document.querySelectorAll("a, button, [role='tab'], [role='button']")];
    const named = nodes.filter((el) => {
      if (el.closest("header, [role='banner']")) return false;
      return re.test(tabLabel(el));
    });
    const quals = nodes.filter((el) => {
      if (el.closest("header, [role='banner']")) return false;
      return /^qualifications\b/i.test(tabLabel(el));
    });
    for (const q of quals) {
      const root = q.parentElement?.parentElement || q.parentElement;
      if (!root) continue;
      const match = [...root.querySelectorAll("a, button, [role='tab'], [role='button']")].find((el) =>
        re.test(tabLabel(el))
      );
      if (match) return match;
    }
    return named[0] || null;
  }

  function activateProjectsTab() {
    const projects = findInnerTab("Projects");
    const qualifications = findInnerTab("Qualifications");
    if (!projects) return false;
    if (switchedToProjects || (isSelectedTab(projects) && !isSelectedTab(qualifications))) {
      return false;
    }
    projects.click();
    switchedToProjects = true;
    setStatus("Opening Projects tab…", "run");
    return true;
  }

  function innerTabStrip() {
    const origin = findInnerTab("Projects") || findInnerTab("Qualifications");
    if (!origin) return null;
    const list = origin.closest("[role='tablist']");
    let el = list || origin.parentElement;
    for (let i = 0; i < 8 && el && el.parentElement; i++) {
      if (el.nextElementSibling && !isQualChrome(el.nextElementSibling)) return el;
      const parent = el.parentElement;
      if (parent === document.body || parent === document.documentElement) break;
      if (isQualChrome(parent)) break;
      el = parent;
    }
    return list || origin.parentElement;
  }

  function projectsListRoots() {
    const projects = findInnerTab("Projects");
    if (!projects) return [];

    const controlled = projects.getAttribute("aria-controls");
    if (controlled) {
      const panel = document.getElementById(controlled);
      if (panel && panel.getClientRects().length && !isQualChrome(panel)) {
        return [panel];
      }
    }

    const strip = innerTabStrip();
    if (!strip) return [];

    const roots = [];
    let sib = strip.nextElementSibling;
    while (sib) {
      if (
        sib.id !== "da-refresh-bot" &&
        sib.getClientRects().length &&
        !isQualChrome(sib)
      ) {
        roots.push(sib);
      }
      sib = sib.nextElementSibling;
    }
    if (roots.length) return roots;

    const scope = strip.parentElement || document.body;
    const panel = [...scope.querySelectorAll("[role='tabpanel']")].find((p) => {
      if (!p.getClientRects().length) return false;
      if (strip.contains(p)) return false;
      if (isQualChrome(p)) return false;
      return true;
    });
    return panel ? [panel] : [];
  }

  function queryInRoots(roots, selector) {
    const nodes = [];
    for (const root of roots) {
      if (root.matches?.(selector)) nodes.push(root);
      if (root.querySelectorAll) nodes.push(...root.querySelectorAll(selector));
    }
    return nodes;
  }

  function headingKind(text) {
    const t = normalize(text);
    if (/^in progress tasks?\b/i.test(t)) return "inprogress";
    if (/^projects\b/i.test(t) && t.length <= 40) return "projects";
    return "";
  }

  function findSectionHeading(kind) {
    const roots = projectsListRoots();
    const nodes = queryInRoots(
      roots,
      "h1, h2, h3, h4, h5, h6, [class*='heading' i], [class*='title' i], [class*='subheader' i]"
    );
    for (const el of nodes) {
      if (!el.getClientRects().length) continue;
      const label = titleLabel(el) || ownText(el);
      if (headingKind(label) === kind) return el;
    }
    for (const root of roots) {
      const walk = root.querySelectorAll("div, span, p, h1, h2, h3, h4, h5, h6");
      for (const el of walk) {
        if (!el.getClientRects().length) continue;
        const label = normalize(ownText(el));
        if (label.length > 40) continue;
        if (headingKind(label) === kind) return el;
      }
    }
    return null;
  }

  function sectionContentRoot(headingEl) {
    if (!headingEl) return null;
    const section = headingEl.closest("section, article, [class*='section' i]");
    if (section && section !== document.body) return section;
    let parent = headingEl.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      if (parent.querySelector("table, tbody, a[href], [class*='row' i]")) return parent;
      parent = parent.parentElement;
    }
    return headingEl.parentElement;
  }

  function nodesUntilNextSection(headingEl) {
    const collected = [];
    if (!headingEl) return collected;
    let el = headingEl.nextElementSibling;
    while (el) {
      const label = titleLabel(el) || ownText(el);
      const kind = headingKind(label.length <= 40 ? label : "");
      if (kind) break;
      const nestedHeading = [...el.querySelectorAll("h1, h2, h3, h4, h5, h6")].find((h) =>
        headingKind(titleLabel(h) || ownText(h))
      );
      if (nestedHeading && nestedHeading !== headingEl) break;
      collected.push(el);
      el = el.nextElementSibling;
    }
    if (collected.length) return collected;
    const root = sectionContentRoot(headingEl);
    return root ? [root] : [];
  }

  function inProgressSectionRoots() {
    const heading = findSectionHeading("inprogress");
    return nodesUntilNextSection(heading);
  }

  function availableProjectsSectionRoots() {
    const heading = findSectionHeading("projects");
    if (heading) {
      const nodes = nodesUntilNextSection(heading);
      if (nodes.length) return nodes;
      const root = sectionContentRoot(heading);
      if (root) return [root];
    }
    // Fallback: whole tab panel minus In Progress section.
    const all = projectsListRoots();
    const inProgress = inProgressSectionRoots();
    if (!inProgress.length) return all;
    return all;
  }

  function inInProgressRegion(el) {
    if (!el) return false;
    return inProgressSectionRoots().some((root) => root.contains(el));
  }

  function normalizeProjectKey(text) {
    return normalize(text)
      .toLowerCase()
      .replace(/[^\w\s.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sameProjectTitle(a, b) {
    const na = normalizeProjectKey(a);
    const nb = normalizeProjectKey(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.startsWith(nb) || nb.startsWith(na)) return true;
    return false;
  }

  function rowTaskTitle(row) {
    if (!row) return "";
    const link = [...row.querySelectorAll("a[href]")].find((a) =>
      isTaskHref(a.getAttribute("href") || a.href)
    );
    if (link) return normalize(ownText(link));
    const cell = row.querySelector("td, [class*='name' i], [class*='title' i]");
    if (cell) {
      const text = normalize(ownText(cell)).split("\n")[0];
      if (text && text.length <= 160) return text;
    }
    const full = normalize(ownText(row)).split("\n")[0];
    return full.length <= 160 ? full : "";
  }

  function listTitlesInRoots(roots) {
    const titles = [];
    const seen = new Set();
    for (const root of roots) {
      const rows = root.querySelectorAll("table tbody tr, tr");
      let usedRows = false;
      for (const row of rows) {
        if (!row.getClientRects().length) continue;
        if (row.querySelector("th") && !row.querySelector("td")) continue;
        const title = rowTaskTitle(row);
        if (!title || isNoise(title) || /^(task|name|pay|started|expires)$/i.test(title)) {
          continue;
        }
        usedRows = true;
        const key = normalizeProjectKey(title);
        if (seen.has(key)) continue;
        seen.add(key);
        titles.push(title);
      }
      if (usedRows) continue;
      for (const a of root.querySelectorAll("a[href]")) {
        if (!isTaskHref(a.getAttribute("href") || a.href)) continue;
        if (!a.getClientRects().length) continue;
        const title = normalize(ownText(a));
        if (!title || title.length > 160 || isNoise(title)) continue;
        const key = normalizeProjectKey(title);
        if (seen.has(key)) continue;
        seen.add(key);
        titles.push(title);
      }
    }
    return titles;
  }

  function getInProgressTitles() {
    return listTitlesInRoots(inProgressSectionRoots());
  }

  function getInProgressGate() {
    const inProgressTitles = getInProgressTitles();
    const count = inProgressTitles.length;
    const ongoing = settings.ongoingTriton === true;

    if (count === 0) {
      return { action: "watch", excludeTitles: [], inProgressTitles };
    }
    if (!ongoing && count >= 1) {
      return {
        action: "stop",
        message: `In Progress (${count}) — stopped (enable Ongoing Projects-Triton to continue)`,
        excludeTitles: inProgressTitles,
        inProgressTitles
      };
    }
    if (ongoing && count >= 2) {
      return {
        action: "stop",
        message: `In Progress (${count}) — stopped (Ongoing Projects-Triton allows only 1)`,
        excludeTitles: inProgressTitles,
        inProgressTitles
      };
    }
    // ongoing && count === 1
    return {
      action: "watch",
      excludeTitles: inProgressTitles,
      inProgressTitles,
      message: `Ongoing mode — skipping In Progress: ${inProgressTitles[0]}`
    };
  }

  function haltBot(message) {
    clearTimers();
    settings.enabled = false;
    settings.stoppedAfterClick = false;
    settings.pendingWorkMode = false;
    setStatus(message, "idle");
    chrome.storage.local.set({
      enabled: false,
      stoppedAfterClick: false,
      pendingWorkMode: false,
      lastStatus: message
    });
  }

  function considerMatch(titleEl, text, hit, best, bestRank, excludeTitles) {
    if (!titleEl || inSkipRegion(titleEl) || !titleEl.getClientRects().length) {
      return { best, bestRank };
    }
    if (inInProgressRegion(titleEl)) return { best, bestRank };
    const label = titleLabel(titleEl) || text;
    if (!label || label.length > 160 || isNoise(label)) return { best, bestRank };
    if ((excludeTitles || []).some((t) => sameProjectTitle(label, t))) {
      return { best, bestRank };
    }
    if (/^(start|complete qualification|continue)$/i.test(label) && !matchesTitle(label)) {
      return { best, bestRank };
    }
    const titleHit = matchesTitle(label) || hit;
    if (!titleHit) return { best, bestRank };
    const rank = matchRank(label, titleHit);
    if (bestRank && !isBetterRank(rank, bestRank)) return { best, bestRank };
    const link = findProjectAnchor(titleEl);
    const raw = link?.getAttribute("href") || link?.href || "";
    return {
      best: {
        el: link || titleEl,
        titleEl: link || titleEl,
        href: isTaskHref(raw) ? absoluteHref(raw) : "",
        text: label,
        hit: titleHit.name,
        priority: titleHit.priority
      },
      bestRank: rank
    };
  }

  function findMatch(excludeTitles = []) {
    const roots = availableProjectsSectionRoots();
    if (!roots.length) return null;

    let best = null;
    let bestRank = null;
    const seen = new Set();

    const primary = queryInRoots(
      roots,
      "a[href], h1, h2, h3, h4, h5, h6, [class*='title' i]"
    );
    for (const el of primary) {
      if (!el || inSkipRegion(el) || !el.getClientRects().length) continue;
      if (inInProgressRegion(el)) continue;
      const text = titleLabel(el);
      if (!text || text.length > 160 || isNoise(text)) continue;
      const hit = matchesTitle(text);
      if (!hit) continue;
      const titleEl = el.tagName === "A" ? el : el.closest("a[href]") || el;
      if (seen.has(titleEl)) continue;
      seen.add(titleEl);
      ({ best, bestRank } = considerMatch(
        titleEl,
        text,
        hit,
        best,
        bestRank,
        excludeTitles
      ));
    }

    if (best) return best;

    const fallback = queryInRoots(
      roots,
      `${CLICKABLE}, td, th, li, [class*='project' i], [class*='card' i]`
    );
    for (const el of fallback) {
      if (!el || inSkipRegion(el) || !el.getClientRects().length) continue;
      if (inInProgressRegion(el)) continue;
      const text = ownText(el);
      if (!text || text.length > 160 || isNoise(text)) continue;
      const hit = matchesTitle(text);
      if (!hit) continue;
      const titleEl = el.closest("a[href]") || el;
      if (seen.has(titleEl)) continue;
      seen.add(titleEl);
      ({ best, bestRank } = considerMatch(
        titleEl,
        text,
        hit,
        best,
        bestRank,
        excludeTitles
      ));
    }
    return best;
  }

  function setStatus(text, tone) {
    const pill = document.getElementById("da-refresh-bot-status");
    if (pill) {
      pill.textContent = text;
      pill.dataset.tone = tone || "idle";
    }
    chrome.storage.local.set({ lastStatus: text });
  }

  function ensureOverlay() {
    if (document.getElementById("da-refresh-bot")) return;
    const root = document.createElement("div");
    root.id = "da-refresh-bot";
    root.innerHTML = `
      <div class="da-refresh-bot-card">
        <span class="da-refresh-bot-dot"></span>
        <span id="da-refresh-bot-status">Starting…</span>
      </div>
    `;
    document.documentElement.appendChild(root);
  }

  function hasClickedLock() {
    return clicked || document.documentElement.dataset.daBotClicked === "1";
  }

  function synthesizeClick(el) {
    if (!el) return;
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      buttons: 1
    };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", opts));
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new PointerEvent("pointerup", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    } catch (_e) {
      /* ignore */
    }
    if (typeof el.click === "function") el.click();
  }

  function openTask(match) {
    const titleEl = match.titleEl || match.el;
    const link = findProjectAnchor(titleEl);
    const raw = link?.getAttribute("href") || link?.href || match.href || "";
    const href = isTaskHref(raw) ? absoluteHref(raw) : match.href || "";
    if (href) {
      location.assign(href);
      return;
    }
    const target = link || titleEl;
    if (!target) return;
    target.classList.add("da-refresh-bot-hit");
    synthesizeClick(target);
  }

  function workModeLabel(el) {
    if (!el) return "";
    return normalize(
      el.getAttribute?.("aria-label") ||
        el.value ||
        ownText(el) ||
        ""
    );
  }

  function isEnterWorkModeLabel(text) {
    const t = normalize(text);
    if (!t || t.length > 60) return false;
    return /^enter\s+work\s+mode$/i.test(t);
  }

  function isVisibleClickable(el) {
    if (!el || el.closest("#da-refresh-bot")) return false;
    if (!el.getClientRects().length) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    return true;
  }

  function clickableWorkModeTarget(el) {
    if (!el) return null;
    const self = el.closest(
      "a, button, [role='button'], input[type='button'], input[type='submit']"
    );
    if (self && isVisibleClickable(self)) return self;
    let n = el;
    for (let i = 0; i < 6 && n; i++) {
      if (isVisibleClickable(n) && (n.onclick || n.getAttribute("tabindex") != null)) {
        return n;
      }
      const cls = String(n.className || "");
      if (
        isVisibleClickable(n) &&
        /\b(btn|button|MuiButton)\b/i.test(`${n.tagName} ${cls}`)
      ) {
        return n;
      }
      n = n.parentElement;
    }
    return self && isVisibleClickable(self) ? self : null;
  }

  function findEnterWorkModeButton() {
    // Opposite of Projects list scanning: on the task page the green button
    // lives inside header / nav / top banner regions that we intentionally skip
    // when matching project titles. Search those first; never use inSkipRegion.
    const clickableSel = [
      "a",
      "button",
      "[role='button']",
      "input[type='button']",
      "input[type='submit']",
      "[class*='button' i]",
      "[class*='Button']"
    ].join(",");

    function matchInRoot(root) {
      if (!root || !root.querySelectorAll) return null;
      for (const el of root.querySelectorAll(clickableSel)) {
        if (!isVisibleClickable(el)) continue;
        if (isEnterWorkModeLabel(workModeLabel(el))) return el;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (isEnterWorkModeLabel(node.textContent || "")) {
          const target = clickableWorkModeTarget(node.parentElement);
          if (target) return target;
        }
        node = walker.nextNode();
      }
      return null;
    }

    const headerRoots = [
      ...document.querySelectorAll(
        "header, nav, [role='banner'], [role='navigation'], [class*='header' i], [class*='banner' i], [class*='toolbar' i]"
      )
    ];

    const previewRoots = [...document.querySelectorAll("div, section, aside, header, nav")].filter(
      (el) => {
        const t = ownText(el).toLowerCase();
        return (
          t.includes("ready to start working") &&
          t.includes("enter work mode") &&
          t.length < 600
        );
      }
    );

    // Prefer the smallest "Ready to start working?" banner, then header/nav, then whole page.
    const rankedPreview = previewRoots.sort(
      (a, b) => ownText(a).length - ownText(b).length
    );
    for (const root of [...rankedPreview, ...headerRoots, document.body]) {
      const hit = matchInRoot(root);
      if (hit) return hit;
    }

    // Last resort inside the preview banner: any visible control mentioning Enter Work.
    for (const root of rankedPreview) {
      for (const el of root.querySelectorAll(clickableSel)) {
        if (!isVisibleClickable(el)) continue;
        const label = workModeLabel(el).toLowerCase();
        if (label.includes("enter") && label.includes("work") && label.includes("mode")) {
          return el;
        }
      }
    }

    return null;
  }

  function finishPendingWorkMode(status, tone) {
    workModeDone = true;
    workModeClickPending = false;
    settings.pendingWorkMode = false;
    settings.enabled = false;
    settings.stoppedAfterClick = true;
    clearTimers();
    setStatus(status, tone || "idle");
    chrome.storage.local.set({
      pendingWorkMode: false,
      enabled: false,
      stoppedAfterClick: true,
      lastStatus: status
    });
  }

  function isTaskUnavailablePage() {
    const body = normalize(document.body?.innerText || "").toLowerCase();
    if (!body) return false;
    const patterns = [
      /no longer available/,
      /task (is|was) unavailable/,
      /project (is|was) unavailable/,
      /this (task|project) (is|has been) (currently )?unavailable/,
      /sorry[,.]? this (task|project).{0,40}unavailable/,
      /not (currently )?available (for you )?to work/,
      /project you (selected|requested).{0,40}(unavailable|no longer)/
    ];
    return patterns.some((re) => re.test(body));
  }

  function resumeProjectsAfterUnavailable() {
    if (unavailableHandled || workModeDone) return;
    unavailableHandled = true;
    workModeDone = true;
    workModeClickPending = false;
    clearTimers();
    settings.pendingWorkMode = false;
    settings.stoppedAfterClick = false;
    settings.enabled = true;
    clicked = false;
    delete document.documentElement.dataset.daBotClicked;
    setStatus("Task unavailable — returning to Projects…", "wait");
    chrome.storage.local.set(
      {
        enabled: true,
        stoppedAfterClick: false,
        pendingWorkMode: false,
        forceProjectsReload: true,
        lastStatus: "Task unavailable — returning to Projects…"
      },
      () => {
        location.assign(PROJECTS_URL);
      }
    );
  }

  function attemptEnterWorkMode(deadline) {
    if (workModeDone) return true;
    closeBlockingModal();

    if (isTaskUnavailablePage()) {
      resumeProjectsAfterUnavailable();
      return true;
    }

    const btn = findEnterWorkModeButton();
    if (btn) {
      if (!workModeClickPending) {
        workModeClickPending = true;
        setStatus("Clicking Enter Work Mode…", "hit");
        try {
          btn.scrollIntoView({ block: "center", inline: "nearest" });
        } catch (_e) {
          /* ignore */
        }
        btn.classList.add("da-refresh-bot-hit");
        synthesizeClick(btn);
        setTimeout(() => {
          if (workModeDone) return;
          workModeClickPending = false;
          if (isTaskUnavailablePage()) {
            resumeProjectsAfterUnavailable();
            return;
          }
          if (!findEnterWorkModeButton()) {
            finishPendingWorkMode("Entered Work Mode — stopped", "idle");
          }
        }, 900);
      }
      if (Date.now() >= deadline) {
        synthesizeClick(btn);
        finishPendingWorkMode("Entered Work Mode — stopped", "idle");
        return true;
      }
      return false;
    }

    if (Date.now() >= deadline) {
      if (isTaskUnavailablePage()) {
        resumeProjectsAfterUnavailable();
        return true;
      }
      finishPendingWorkMode("Opened project — no Enter Work Mode button", "idle");
      return true;
    }
    return false;
  }

  function startWorkModeWatch() {
    if (workModeDone) return;
    ensureOverlay();
    unavailableHandled = false;
    workModeClickPending = false;
    setStatus("Waiting for task page…", "run");

    const deadline = Date.now() + 45000;
    const begin = () => {
      if (workModeDone) return;
      setStatus("Looking for Enter Work Mode…", "run");
      setTimeout(() => {
        if (workModeDone) return;
        if (attemptEnterWorkMode(deadline)) return;

        scanTimer = setInterval(() => {
          if (attemptEnterWorkMode(deadline)) clearTimers();
        }, 250);

        observer = new MutationObserver(() => {
          attemptEnterWorkMode(deadline);
        });
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true
        });
      }, 400);
    };

    if (document.readyState === "complete") {
      begin();
    } else {
      window.addEventListener("load", begin, { once: true });
    }
  }

  async function clickMatch(match) {
    if (hasClickedLock()) return;
    clickingInProgress = true;
    clicked = true;
    document.documentElement.dataset.daBotClicked = "1";
    settings.enabled = false;
    settings.stoppedAfterClick = true;
    settings.pendingWorkMode = true;
    clearTimers();

    const status = `Found ${match.hit} (P${match.priority || 1}) — opening project…`;
    setStatus(status, "hit");
    const payload = {
      title: `${match.hit}: ${match.text}`,
      at: Date.now()
    };
    const base = {
      enabled: false,
      stoppedAfterClick: true,
      pendingWorkMode: true,
      lastStatus: status
    };
    if (!alertSent) {
      alertSent = true;
      await chrome.storage.local.set({ ...base, pendingAlert: payload });
      chrome.runtime.sendMessage({ type: "notify-match", ...payload }).catch(() => {});
    } else {
      await chrome.storage.local.set(base);
    }
    openTask(match);
  }

  function clearTimers() {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function scanOnce() {
    if (!isListPage()) return false;
    if (!settings.enabled || hasClickedLock()) return false;
    closeBlockingModal();
    if (activateProjectsTab()) return false;

    const gate = getInProgressGate();
    if (gate.action === "stop") {
      haltBot(gate.message);
      return true;
    }

    const match = findMatch(gate.excludeTitles || []);
    if (match) {
      clickMatch(match);
      return true;
    }
    return false;
  }

  function randomRefreshSeconds() {
    let from = Math.max(1, Number(settings.refreshFrom) || 3);
    let to = Math.max(1, Number(settings.refreshTo) || 8);
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    return Math.floor(Math.random() * (to - from + 1)) + from;
  }

  function setRefreshSecondsDisplay(seconds) {
    chrome.storage.local.set({ nextRefreshSeconds: seconds });
  }

  function scheduleReload(statusPrefix) {
    let remaining = randomRefreshSeconds();
    setRefreshSecondsDisplay(remaining);
    const prefix = statusPrefix || "Projects empty";
    setStatus(`${prefix} — refresh in ${remaining}s`, "wait");

    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownTimer = setInterval(() => {
      if (!settings.enabled || hasClickedLock()) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        return;
      }
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        return;
      }
      setRefreshSecondsDisplay(remaining);
      setStatus(`${prefix} — refresh in ${remaining}s`, "wait");
    }, 1000);

    reloadTimer = setTimeout(() => {
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      if (!settings.enabled || hasClickedLock()) return;
      setRefreshSecondsDisplay(0);
      setStatus("Refreshing…", "wait");
      location.reload();
    }, remaining * 1000);
  }

  function start() {
    if (clickingInProgress) return;
    clearTimers();

    if (settings.pendingWorkMode && isTaskPage()) {
      startWorkModeWatch();
      return;
    }

    if (isTaskPage() && !settings.pendingWorkMode && !settings.stoppedAfterClick) {
      if (isTaskUnavailablePage()) {
        resumeProjectsAfterUnavailable();
        return;
      }
    }

    if (settings.pendingWorkMode && !isListPage()) {
      if (isTaskPage() && isTaskUnavailablePage()) {
        resumeProjectsAfterUnavailable();
        return;
      }
      finishPendingWorkMode("Opened project — stopped", "idle");
      ensureOverlay();
      return;
    }

    if (!isListPage()) {
      if (workModeDone || settings.stoppedAfterClick) {
        ensureOverlay();
        if (!workModeDone) setStatus("Stopped after opening a project", "idle");
        return;
      }
      document.getElementById("da-refresh-bot")?.remove();
      return;
    }

    ensureOverlay();

    if (settings.forceProjectsReload) {
      settings.forceProjectsReload = false;
      setStatus("Reloading Projects…", "wait");
      chrome.storage.local.remove("forceProjectsReload", () => {
        location.reload();
      });
      return;
    }

    if (hasClickedLock() || settings.stoppedAfterClick) {
      clicked = true;
      document.documentElement.dataset.daBotClicked = "1";
      setStatus("Stopped after opening a project", "idle");
      return;
    }

    if (!settings.enabled) {
      setStatus("Stopped", "idle");
      return;
    }

    if (!titles().length) {
      setStatus("Add a search title in the extension popup", "idle");
      return;
    }

    setStatus("Watching Projects tab…", "run");
    switchedToProjects = false;
    workModeDone = false;
    unavailableHandled = false;
    alertSent = false;

    if (scanOnce()) return;

    const gate = getInProgressGate();
    const waitPrefix =
      gate.action === "watch" && gate.excludeTitles?.length
        ? "Waiting for other Projects"
        : "Projects empty";

    scanTimer = setInterval(() => {
      if (scanOnce()) clearTimers();
    }, 400);

    observer = new MutationObserver(() => {
      if (hasClickedLock()) {
        clearTimers();
        return;
      }
      scanOnce();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    scheduleReload(waitPrefix);
  }

  async function loadAndStart() {
    const stored = await chrome.storage.local.get([
      "enabled",
      "refreshFrom",
      "refreshTo",
      "titles",
      "sound",
      "ongoingTriton",
      "stoppedAfterClick",
      "pendingWorkMode",
      "forceProjectsReload"
    ]);
    const titles = Array.isArray(stored.titles)
      ? stored.titles.filter((t) => {
          const name = String((t && t.name) || t || "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
          return name !== "review_ ummon" && name !== "review_ummon";
        })
      : [
          { name: "Triton", priority: 1 },
          { name: "Ummon", priority: 2 },
          { name: "Boxing", priority: 3 }
        ];
    settings = {
      enabled: stored.enabled !== false,
      refreshFrom: stored.refreshFrom ?? 3,
      refreshTo: stored.refreshTo ?? 8,
      titles,
      sound: stored.sound !== false,
      ongoingTriton: stored.ongoingTriton === true,
      stoppedAfterClick: stored.stoppedAfterClick === true,
      pendingWorkMode: stored.pendingWorkMode === true,
      forceProjectsReload: stored.forceProjectsReload === true
    };
    if (settings.stoppedAfterClick) {
      clicked = true;
      document.documentElement.dataset.daBotClicked = "1";
    } else if (stored.enabled === true && stored.stoppedAfterClick !== true) {
      clicked = false;
      workModeDone = false;
      unavailableHandled = false;
      delete document.documentElement.dataset.daBotClicked;
    }
    start();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (clickingInProgress) return;
    if (
      changes.enabled ||
      changes.titles ||
      changes.sound ||
      changes.ongoingTriton ||
      changes.stoppedAfterClick ||
      changes.refreshFrom ||
      changes.refreshTo ||
      changes.pendingWorkMode
    ) {
      loadAndStart();
    }
  });

  window.addEventListener("pageshow", () => loadAndStart());
  loadAndStart();
})();
