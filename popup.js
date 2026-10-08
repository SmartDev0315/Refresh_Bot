const intervalEl = document.getElementById("interval");
const refreshFromEl = document.getElementById("refreshFrom");
const refreshToEl = document.getElementById("refreshTo");
const refreshUpdateBtn = document.getElementById("refreshUpdateBtn");
const refreshUpdateHint = document.getElementById("refreshUpdateHint");
const newTitleEl = document.getElementById("newTitle");
const titleListEl = document.getElementById("titleList");
const soundEl = document.getElementById("sound");
const notifyEl = document.getElementById("notify");
const emailAlertEl = document.getElementById("emailAlert");
const alertEmailEl = document.getElementById("alertEmail");
const emailAddBtn = document.getElementById("emailAddBtn");
const emailUpdateBtn = document.getElementById("emailUpdateBtn");
const web3formsKeyEl = document.getElementById("web3formsKey");
const keyUpdateBtn = document.getElementById("keyUpdateBtn");
const keyForm = document.getElementById("keyForm");
const testAlertBtn = document.getElementById("testAlertBtn");
const alertResultEl = document.getElementById("alertResult");
const statusTextEl = document.getElementById("statusText");
const addForm = document.getElementById("addForm");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

function normalizeTitles(titles) {
  const list = Array.isArray(titles) ? titles : [];
  return list
    .map((item, index) => {
      if (item && typeof item === "object") {
        return {
          name: String(item.name || item.title || "").trim(),
          priority: Math.max(1, Number(item.priority) || index + 1)
        };
      }
      return {
        name: String(item || "").trim(),
        priority: index + 1
      };
    })
    .filter((item) => item.name)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

let savedAlertEmail = "";
let emailEditing = false;
let savedWeb3Key = "";
let keyEditing = false;

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function syncEmailUi() {
  const alertOn = emailAlertEl.checked;
  const hasEmail = Boolean(savedAlertEmail);
  const hasKey = Boolean(savedWeb3Key);

  if (!alertOn) {
    alertEmailEl.disabled = true;
    emailAddBtn.disabled = true;
    emailUpdateBtn.disabled = true;
    web3formsKeyEl.disabled = true;
    keyUpdateBtn.disabled = true;
    return;
  }

  if (!hasEmail) {
    emailEditing = false;
    alertEmailEl.disabled = false;
    emailAddBtn.disabled = false;
    emailUpdateBtn.disabled = true;
  } else {
    alertEmailEl.disabled = !emailEditing;
    emailAddBtn.disabled = true;
    emailUpdateBtn.disabled = false;
  }

  if (!hasKey) {
    keyEditing = true;
    web3formsKeyEl.disabled = false;
    keyUpdateBtn.disabled = false;
  } else {
    web3formsKeyEl.disabled = !keyEditing;
    keyUpdateBtn.disabled = false;
  }
}

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

async function load() {
  const data = await chrome.storage.local.get([
    "enabled",
    "titles",
    "sound",
    "notify",
    "emailAlert",
    "alertEmail",
    "web3formsKey",
    "lastStatus",
    "lastAlertResult",
    "nextRefreshSeconds",
    "refreshFrom",
    "refreshTo"
  ]);
  const running = data.enabled === true;
  setRunning(running);
  refreshFromEl.value = data.refreshFrom ?? 3;
  refreshToEl.value = data.refreshTo ?? 8;
  intervalEl.value =
    data.nextRefreshSeconds != null ? data.nextRefreshSeconds : "";
  soundEl.checked = data.sound !== false;
  notifyEl.checked = data.notify !== false;
  emailAlertEl.checked = data.emailAlert !== false;
  savedAlertEmail = String(data.alertEmail || "").trim();
  emailEditing = false;
  alertEmailEl.value = savedAlertEmail;
  savedWeb3Key = String(data.web3formsKey || "").trim();
  keyEditing = !savedWeb3Key;
  web3formsKeyEl.value = savedWeb3Key;
  syncEmailUi();
  if (alertResultEl) {
    alertResultEl.textContent = data.lastAlertResult || "";
  }
  statusTextEl.textContent = data.lastStatus || (running ? "Watching Projects tab…" : "Stopped");
  let titles = normalizeTitles(
    data.titles || [
      { name: "Triton", priority: 1 },
      { name: "Ummon", priority: 2 },
      { name: "Boxing", priority: 3 }
    ]
  );
  const cleaned = titles.filter((t) => {
    const n = t.name.toLowerCase().replace(/\s+/g, " ");
    return n !== "review_ ummon" && n !== "review_ummon";
  });
  if (cleaned.length !== titles.length) {
    titles = cleaned;
    chrome.storage.local.set({ titles });
  }
  renderTitles(titles);
}

function renderTitles(titles) {
  titleListEl.innerHTML = "";
  titles.forEach((item, index) => {
    const li = document.createElement("li");

    const row = document.createElement("div");
    row.className = "priority-row";

    const priority = document.createElement("input");
    priority.type = "number";
    priority.min = "1";
    priority.max = "99";
    priority.value = String(item.priority);
    priority.title = "Priority (1 is first)";
    priority.addEventListener("change", async () => {
      const next = titles.map((t, i) =>
        i === index
          ? { ...t, priority: Math.max(1, Number(priority.value) || 1) }
          : t
      );
      const sorted = normalizeTitles(next);
      await chrome.storage.local.set({ titles: sorted });
      renderTitles(sorted);
    });

    const name = document.createElement("span");
    name.textContent = item.name;

    row.append(priority, name);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      const next = titles.filter((_, i) => i !== index);
      await chrome.storage.local.set({ titles: next });
      renderTitles(next);
    });

    li.append(row, remove);
    titleListEl.append(li);
  });
}

let refreshUpdateTimer = null;

refreshUpdateBtn.addEventListener("click", () => {
  let from = Math.min(120, Math.max(1, Number(refreshFromEl.value) || 3));
  let to = Math.min(120, Math.max(1, Number(refreshToEl.value) || 8));
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  refreshFromEl.value = from;
  refreshToEl.value = to;
  chrome.storage.local.set({ refreshFrom: from, refreshTo: to });

  if (refreshUpdateTimer) {
    clearTimeout(refreshUpdateTimer);
    refreshUpdateTimer = null;
  }

  refreshUpdateBtn.classList.add("is-updated");
  refreshUpdateBtn.textContent = "Updated!";
  if (refreshUpdateHint) {
    refreshUpdateHint.textContent = `Saved: random ${from}–${to} seconds`;
  }

  refreshUpdateTimer = setTimeout(() => {
    refreshUpdateBtn.classList.remove("is-updated");
    refreshUpdateBtn.textContent = "Update";
    if (refreshUpdateHint) {
      refreshUpdateHint.textContent = "";
    }
    refreshUpdateTimer = null;
  }, 2000);
});

startBtn.addEventListener("click", () => {
  chrome.storage.local.set({
    enabled: true,
    stoppedAfterClick: false,
    pendingWorkMode: false,
    lastStatus: "Watching Projects tab…"
  });
  setRunning(true);
  statusTextEl.textContent = "Watching Projects tab…";
});

stopBtn.addEventListener("click", () => {
  chrome.storage.local.set({
    enabled: false,
    stoppedAfterClick: false,
    pendingWorkMode: false,
    lastStatus: "Stopped"
  });
  setRunning(false);
  statusTextEl.textContent = "Stopped";
});

soundEl.addEventListener("change", () => {
  chrome.storage.local.set({ sound: soundEl.checked });
});

notifyEl.addEventListener("change", () => {
  chrome.storage.local.set({ notify: notifyEl.checked });
});

emailAlertEl.addEventListener("change", () => {
  chrome.storage.local.set({ emailAlert: emailAlertEl.checked });
  if (!emailAlertEl.checked) {
    emailEditing = false;
    keyEditing = false;
    alertEmailEl.value = savedAlertEmail;
    web3formsKeyEl.value = savedWeb3Key;
  }
  syncEmailUi();
});

emailAddBtn.addEventListener("click", async () => {
  if (!emailAlertEl.checked || savedAlertEmail) return;
  const value = alertEmailEl.value.trim();
  if (!isValidEmail(value)) {
    alertEmailEl.focus();
    return;
  }
  savedAlertEmail = value;
  emailEditing = false;
  await chrome.storage.local.set({ alertEmail: value });
  alertEmailEl.value = value;
  syncEmailUi();
});

emailUpdateBtn.addEventListener("click", async () => {
  if (!emailAlertEl.checked || !savedAlertEmail) return;
  if (!emailEditing) {
    emailEditing = true;
    syncEmailUi();
    alertEmailEl.focus();
    return;
  }
  const value = alertEmailEl.value.trim();
  if (!isValidEmail(value)) {
    alertEmailEl.focus();
    return;
  }
  savedAlertEmail = value;
  emailEditing = false;
  await chrome.storage.local.set({ alertEmail: value });
  alertEmailEl.value = value;
  syncEmailUi();
});

async function saveAccessKey() {
  if (!emailAlertEl.checked) return false;
  const value = web3formsKeyEl.value.trim();
  if (!value) {
    web3formsKeyEl.focus();
    return false;
  }
  savedWeb3Key = value;
  keyEditing = false;
  await chrome.storage.local.set({ web3formsKey: value });
  web3formsKeyEl.value = value;
  syncEmailUi();
  return true;
}

keyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!emailAlertEl.checked) return;
  if (!savedWeb3Key || keyEditing) {
    await saveAccessKey();
  }
});

web3formsKeyEl.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (!emailAlertEl.checked) return;
  if (!savedWeb3Key || keyEditing) {
    await saveAccessKey();
  }
});

keyUpdateBtn.addEventListener("click", async () => {
  if (!emailAlertEl.checked) return;
  if (!keyEditing) {
    keyEditing = true;
    syncEmailUi();
    web3formsKeyEl.focus();
    web3formsKeyEl.select();
    return;
  }
  await saveAccessKey();
});

testAlertBtn.addEventListener("click", async () => {
  testAlertBtn.disabled = true;
  alertResultEl.textContent = "Sending test alert…";
  try {
    const result = await chrome.runtime.sendMessage({
      type: "test-alert",
      title: "Task is Available"
    });
    alertResultEl.textContent = result?.notes?.join(" · ") || "Test finished";
  } catch (error) {
    alertResultEl.textContent = `Test failed: ${error.message}`;
  }
  testAlertBtn.disabled = false;
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = newTitleEl.value.trim();
  if (!value) return;
  const data = await chrome.storage.local.get(["titles"]);
  const titles = normalizeTitles(data.titles);
  if (titles.some((t) => t.name.toLowerCase() === value.toLowerCase())) {
    newTitleEl.value = "";
    return;
  }
  const nextPriority = titles.reduce((max, t) => Math.max(max, t.priority), 0) + 1;
  titles.push({ name: value, priority: nextPriority });
  const sorted = normalizeTitles(titles);
  await chrome.storage.local.set({ titles: sorted });
  newTitleEl.value = "";
  renderTitles(sorted);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lastStatus) {
    statusTextEl.textContent = changes.lastStatus.newValue || "Idle";
  }
  if (changes.lastAlertResult) {
    if (alertResultEl) {
      alertResultEl.textContent = changes.lastAlertResult.newValue || "";
    }
  }
  if (changes.nextRefreshSeconds) {
    intervalEl.value =
      changes.nextRefreshSeconds.newValue != null
        ? changes.nextRefreshSeconds.newValue
        : "";
  }
  if (changes.enabled) {
    setRunning(changes.enabled.newValue === true);
  }
});

load();
