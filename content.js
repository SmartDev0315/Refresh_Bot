(() => {
  const PROJECTS_PATH = "/workers/projects";
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

  function isTaskPath(path) {
    if (projectIdFromUrl()) return true;
    const p = (path || pagePath()).replace(/\/+$/, "") || "/";
    if (p === PROJECTS_PATH) return false;
    if (p.startsWith(`${PROJECTS_PATH}/`)) return true;
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

  function inSkipRegion(el) {
    return Boolean(el && el.closest(SKIP_SELECTORS));
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

  function considerMatch(titleEl, text, hit, best, bestRank) {
    if (!titleEl || inSkipRegion(titleEl) || !titleEl.getClientRects().length) {
      return { best, bestRank };
    }
    const label = titleLabel(titleEl) || text;
    if (!label || label.length > 160 || isNoise(label)) return { best, bestRank };
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

  function findMatch() {
    let best = null;
    let bestRank = null;
    const seen = new Set();

    const primary = document.querySelectorAll(
      "a[href], h1, h2, h3, h4, h5, h6, [class*='title' i]"
    );
    for (const el of primary) {
      if (!el || inSkipRegion(el) || !el.getClientRects().length) continue;
      const text = titleLabel(el);
      if (!text || text.length > 160 || isNoise(text)) continue;
      const hit = matchesTitle(text);
      if (!hit) continue;
      const titleEl = el.tagName === "A" ? el : el.closest("a[href]") || el;
      if (seen.has(titleEl)) continue;
      seen.add(titleEl);
      ({ best, bestRank } = considerMatch(titleEl, text, hit, best, bestRank));
    }

    if (best) return best;

    const fallback = document.querySelectorAll(
      `${CLICKABLE}, td, th, li, [class*='project' i], [class*='card' i]`
    );
    for (const el of fallback) {
      if (!el || inSkipRegion(el) || !el.getClientRects().length) continue;
      const text = ownText(el);
      if (!text || text.length > 160 || isNoise(text)) continue;
      const hit = matchesTitle(text);
      if (!hit) continue;
      const titleEl = el.closest("a[href]") || el;
      if (seen.has(titleEl)) continue;
      seen.add(titleEl);
      ({ best, bestRank } = considerMatch(titleEl, text, hit, best, bestRank));
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

  function clickMatch(match) {
    if (hasClickedLock()) return;
    clickingInProgress = true;
    clicked = true;
    document.documentElement.dataset.daBotClicked = "1";
    settings.enabled = false;
    settings.stoppedAfterClick = true;
    settings.pendingWorkMode = false;
    clearTimers();

    const status = `Found ${match.hit} (P${match.priority || 1}) — opening project…`;
    setStatus(status, "hit");
    const payload = {
      title: `${match.hit}: ${match.text}`,
      at: Date.now()
    };
    if (!alertSent) {
      alertSent = true;
      chrome.storage.local.set({
        enabled: false,
        stoppedAfterClick: true,
        pendingWorkMode: false,
        lastStatus: status,
        pendingAlert: payload
      });
      chrome.runtime.sendMessage({ type: "notify-match", ...payload }).catch(() => {});
    } else {
      chrome.storage.local.set({
        enabled: false,
        stoppedAfterClick: true,
        pendingWorkMode: false,
        lastStatus: status
      });
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
    const match = findMatch();
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

  function scheduleReload() {
    let remaining = randomRefreshSeconds();
    setRefreshSecondsDisplay(remaining);
    setStatus(`Projects empty — refresh in ${remaining}s`, "wait");

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
      setStatus(`Projects empty — refresh in ${remaining}s`, "wait");
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

    if (!isListPage()) {
      document.getElementById("da-refresh-bot")?.remove();
      return;
    }

    ensureOverlay();

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

    if (scanOnce()) return;

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

    scheduleReload();
  }

  async function loadAndStart() {
    const stored = await chrome.storage.local.get([
      "enabled",
      "refreshFrom",
      "refreshTo",
      "titles",
      "sound",
      "stoppedAfterClick",
      "pendingWorkMode"
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
      stoppedAfterClick: stored.stoppedAfterClick === true,
      pendingWorkMode: stored.pendingWorkMode === true
    };
    if (settings.stoppedAfterClick) {
      clicked = true;
      document.documentElement.dataset.daBotClicked = "1";
    } else if (stored.enabled === true && stored.stoppedAfterClick !== true) {
      clicked = false;
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
