(() => {
  const EMAIL_BODY = "Task is Available";

  function findSendButton() {
    const nodes = [...document.querySelectorAll("div[role='button'], button")];
    return (
      nodes.find((el) => {
        const label = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("data-tooltip") || ""}`;
        return /^send\b/i.test(label.trim()) || /\bsend\b.*ctrl/i.test(label);
      }) ||
      nodes.find((el) => /^send$/i.test((el.innerText || "").trim()))
    );
  }

  async function trySend() {
    const stored = await chrome.storage.local.get(["pendingGmailAlert"]);
    const pending = stored.pendingGmailAlert;
    if (!pending || !pending.to) return;
    if (Date.now() - Number(pending.created || 0) > 90000) {
      await chrome.storage.local.remove("pendingGmailAlert");
      return;
    }

    const started = Date.now();
    const timer = setInterval(async () => {
      if (document.querySelector("input[type='email'][name='identifier'], #identifierId")) {
        clearInterval(timer);
        await chrome.storage.local.set({
          lastAlertResult: "Log in to Gmail in Chrome, then click Test notification & email again."
        });
        return;
      }

      const sendBtn = findSendButton();
      if (sendBtn) {
        clearInterval(timer);
        sendBtn.click();
        await chrome.storage.local.remove("pendingGmailAlert");
        await chrome.storage.local.set({
          lastAlertResult: `email sent via Gmail to ${pending.to}`
        });
        chrome.runtime.sendMessage({ type: "gmail-sent", tabId: pending.tabId }).catch(() => {});
        return;
      }

      if (Date.now() - started > 25000) {
        clearInterval(timer);
        await chrome.storage.local.set({
          lastAlertResult:
            "Gmail compose did not open. Open Gmail in Chrome, stay logged in, then Test again."
        });
      }
    }, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => trySend(), { once: true });
  } else {
    trySend();
  }
  window.addEventListener("load", () => trySend());
})();
