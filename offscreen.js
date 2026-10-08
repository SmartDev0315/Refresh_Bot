chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "play-alarm") return false;
  playAlarm()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function playAlarm() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});

  const duration = 8;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.85, ctx.currentTime);
  master.gain.setValueAtTime(0.85, ctx.currentTime + duration - 0.3);
  master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  master.connect(ctx.destination);

  const pattern = [
    880, 1175, 880, 1175, 988, 1319, 988, 1319,
    1047, 1397, 1047, 1397, 1175, 1568, 1175, 1568
  ];
  const noteLen = duration / pattern.length;

  pattern.forEach((freq, i) => {
    const start = ctx.currentTime + i * noteLen;
    const stop = start + noteLen * 0.92;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const g = ctx.createGain();
    osc1.type = "square";
    osc2.type = "sawtooth";
    osc1.frequency.setValueAtTime(freq, start);
    osc2.frequency.setValueAtTime(freq * 1.01, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(0.7, start + 0.02);
    g.gain.setValueAtTime(0.7, stop - 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, stop);
    osc1.connect(g);
    osc2.connect(g);
    g.connect(master);
    osc1.start(start);
    osc2.start(start);
    osc1.stop(stop);
    osc2.stop(stop);
  });

  await new Promise((resolve) => setTimeout(resolve, duration * 1000 + 50));
  try {
    await ctx.close();
  } catch (_e) {
    /* ignore */
  }
}
