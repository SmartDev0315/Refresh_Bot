# DA Refresh Bot (Chrome extension)

Chrome extension that watches the DataAnnotation **Projects** page, refreshes it until a matching task appears, then clicks **one** task and stops.

It runs on:

`https://app.dataannotation.tech/workers/projects`

On the Chrome **Manage extensions** page it is named **Blur. The Image and Video blur extension**.

---

## What it does

1. **Start / Stop** from the extension popup.
2. **Refreshes** the Projects page on a **random** timer between the **From** and **To** seconds you set (default 3–8).
3. After each refresh, it **opens the Projects tab** (not Qualifications).
4. It **searches** the Projects list for your keywords (for example Triton, Ummon, Boxing). A task matches if its name **contains** that word. It does not have to be the full task name.
5. If several matching tasks are visible, it clicks **only the highest priority** one (priority **1** first).
6. If several tasks contain the **same search word** (for example two names that both include Boxing), it still clicks **only one** of them.
7. After that click, the bot **stops automatically** until you press Start again.
8. On the opened task page, if a green **Enter Work Mode** button appears, it clicks that button.
9. You can save **one alert email**. After Add, use Update to change it. When a task is available, it sends **Task is Available** to that address.
10. Qualification banners, passkey popups, and similar cards are ignored.

---

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `C:\Users\root\Documents\Refresh_Bot`
5. Pin the extension if you want quick access to Start / Stop
6. Log in to DataAnnotation and leave this page open:

`https://app.dataannotation.tech/workers/projects`

Reload the extension on `chrome://extensions` after you change its files.

---

## How to use

1. Open the Projects page and stay logged in.
2. Click the extension icon.
3. Add search titles (keywords such as Triton, Ummon, Boxing). These do not need to be the full task name.
4. Set a **priority number** next to each title (`1` is first).
5. Add **one alert email**, then use **Update** if you need to change it.
6. Press **Start**.
7. When a matching task appears, the extension clicks it once and **stops**.
8. Press **Start** again when you want to watch for the next task.

Keep Chrome open with that tab visible. A small status pill in the bottom-right of the page shows whether it is watching, refreshing, or stopped.

---

## Popup controls

| Control | Function |
| --- | --- |
| **Start** | Begin watching and refreshing |
| **Stop** | Stop immediately |
| **From / To** | Random refresh range in seconds. Click **Update** to save |
| **Current wait** | Disabled. Shows the countdown seconds for the current refresh |
| **Search titles** | Keywords to find in a task name (Triton, Ummon, Boxing, …). Not the full title. |
| **Priority** | Number next to each title. `1` is clicked before `2`, `3`, … |
| **Add / Remove** | Add or delete a search title |
| **Play sound** | Beep when a task is opened |
| **Desktop notification** | Windows notification when a task is opened |
| **Email Add** | Save one alert email. Then the field is locked and Add is disabled. |
| **Email Update** | Unlocks the field to edit. Click Update again to save. |
| **Send email** | If this is off, the email field, Add, and Update are disabled. If on, emails **Task is Available** to the saved address. |
| **Test notification & email** | Sends a test desktop notification and email using your current settings |

---

## Priority examples

- Triton = `1`, Boxing = `2`  
  If one task name contains Triton and another contains Boxing, **Triton** is clicked.

- Two tasks whose names both contain **Boxing** (different full titles, Boxing = `2`)  
  **One** of those tasks is clicked. The other Boxing match is not clicked.

- **Ummon** and **Rate And Review: Ummon** both on the page, search keyword Ummon  
  The plain **Ummon** task is opened. Rate And Review is skipped.

After that single click, refresh stops.

---

## Status messages

| Status | Meaning |
| --- | --- |
| Watching Projects tab… | Bot is running |
| Opening Projects tab… | Switching away from Qualifications |
| Projects empty — refresh in Ns | No matching task yet |
| Refreshing… | Reloading the page |
| Found … — stopped | A task was clicked; bot is off |
| Stopped | You pressed Stop, or the bot is idle |

---

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Extension config, name, permissions |
| `popup.html` / `popup.js` / `popup.css` | Start/Stop popup and title priorities |
| `content.js` | Refresh, Projects tab, match, single click |
| `overlay.css` | On-page status pill |
| `background.js` | Defaults, desktop notifications, and email alert |
| `icons/` | Toolbar icon |

---

## Notes

- Email does **not** need Gmail logged in on this PC. Create a free [Web3Forms](https://web3forms.com/) access key (you can do this on the other laptop) with the same alert email, then paste the key in the extension.
- Use this extension **or** a separate auto-refresh tool on the same tab, not both.
- The bot only acts on the DataAnnotation Projects list. It does not click Qualifications.
- To watch again after a task is opened, press **Start**.
