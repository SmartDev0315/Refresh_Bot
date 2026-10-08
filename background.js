const EMAIL_BODY = "Task is Available";

const DEFAULTS = {
  enabled: true,
  refreshFrom: 3,
  refreshTo: 8,
  titles: [
    { name: "Triton", priority: 1 },
    { name: "Ummon", priority: 2 },
    { name: "Boxing", priority: 3 }
  ],
  sound: true,
  notify: true,
  emailAlert: true,
  alertEmail: "",
  web3formsKey: "9af3a915-0f20-432d-abf4-efe47fdb1f0e",
  lastStatus: "Idle",
  stoppedAfterClick: false,
  lastAlertResult: ""
};

function stripReviewUmmon(titles) {
  if (!Array.isArray(titles)) return titles;
  return titles.filter((t) => {
    const name = String((t && t.name) || t || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    return name !== "review_ ummon" && name !== "review_ummon";
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(null);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (stored[key] === undefined) patch[key] = value;
  }
  if (stored.refreshFrom === undefined) {
    patch.refreshFrom = DEFAULTS.refreshFrom;
  }
  if (stored.refreshTo === undefined) {
    patch.refreshTo = DEFAULTS.refreshTo;
  }
  if (!stored.web3formsKey) {
    patch.web3formsKey = DEFAULTS.web3formsKey;
  }
  if (Array.isArray(stored.titles)) {
    const cleaned = stripReviewUmmon(stored.titles);
    if (cleaned.length !== stored.titles.length) {
      patch.titles = cleaned.length
        ? cleaned
        : DEFAULTS.titles;
    }
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});

function setAlertResult(text) {
  return chrome.storage.local.set({ lastAlertResult: text });
}

function showDesktopNotification(title, message) {
  return new Promise((resolve) => {
    chrome.notifications.create(
      {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: title || EMAIL_BODY,
        message: message || EMAIL_BODY,
        priority: 2,
        requireInteraction: true
      },
      (id) => {
        const err = chrome.runtime.lastError;
        resolve(err ? { ok: false, error: err.message } : { ok: true, id });
      }
    );
  });
}

async function sendTaskAvailableEmail(to, accessKey) {
  const response = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      access_key: accessKey,
      subject: EMAIL_BODY,
      name: "DA Refresh Bot",
      from_name: "DA Refresh Bot",
      email: to,
      message: EMAIL_BODY,
      cc: to,
      botcheck: false
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Email send failed (${response.status})`);
  }
  return data;
}

async function ensureOffscreen() {
  if (chrome.offscreen?.hasDocument) {
    const has = await chrome.offscreen.hasDocument();
    if (has) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play a loud alarm when a matching task is found"
    });
  } catch (error) {
    if (!String(error.message || error).includes("already")) throw error;
  }
}

async function playAlarm() {
  const { sound } = await chrome.storage.local.get("sound");
  if (sound === false) return;
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ type: "play-alarm" }).catch(() => {});
}

let lastAlertKey = "";

async function handleTaskAlert(message) {
  const alertKey = String(message.at || message.title || "");
  if (alertKey && alertKey === lastAlertKey) return { ok: true, notes: ["already sent"] };
  if (alertKey) lastAlertKey = alertKey;

  const { notify, emailAlert, alertEmail, web3formsKey } = await chrome.storage.local.get([
    "notify",
    "emailAlert",
    "alertEmail",
    "web3formsKey"
  ]);
  const notes = [];
  const preview = message.title ? String(message.title) : EMAIL_BODY;
  playAlarm().catch(() => {});

  if (notify !== false) {
    const result = await showDesktopNotification("Task is Available", preview);
    notes.push(result.ok ? "notification sent" : "notification failed");
  } else {
    notes.push("notification off");
  }

  if (emailAlert !== false) {
    const to = String(alertEmail || "").trim();
    const key = String(web3formsKey || "").trim();
    if (!to) {
      notes.push("no alert email saved");
    } else if (!key) {
      notes.push("add a Web3Forms access key (Gmail login on this PC is not required)");
    } else {
      try {
        await sendTaskAvailableEmail(to, key);
        notes.push(`email sent to ${to}`);
      } catch (error) {
        notes.push(error.message);
      }
    }
  } else {
    notes.push("email alert off");
  }

  await setAlertResult(notes.join(" · "));
  return { ok: true, notes };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.pendingAlert?.newValue) return;
  const value = changes.pendingAlert.newValue;
  if (!value || !value.title) return;
  handleTaskAlert({ type: "notify-match", title: value.title, at: value.at })
    .catch((error) => setAlertResult(`Alert failed: ${error.message}`))
    .finally(() => {
      chrome.storage.local.remove("pendingAlert");
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "notify-match" && message?.type !== "test-alert") {
    return false;
  }
  handleTaskAlert(message)
    .then((result) => sendResponse(result))
    .catch((error) => {
      setAlertResult(`Alert failed: ${error.message}`);
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});
