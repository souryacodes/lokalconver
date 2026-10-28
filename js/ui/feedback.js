// Small "it worked" feelings: a 30 ms buzz on phones, and an optional chime.
// The chime is OFF until the person turns it on. It is made with the Web Audio
// API, so there is no sound file to download.

let lastBuzz = 0;

export function haptic(ms = 30) {
  const now = Date.now();
  if (now - lastBuzz < 400) return false; // ten files finishing should not buzz ten times
  lastBuzz = now;
  try {
    return Boolean(navigator.vibrate?.(ms));
  } catch {
    return false;
  }
}

const KEY = 'lokalconver.sound';

function readPref() {
  try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
}
function writePref(on) {
  try { window.localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode: fine */ }
}

export function createSound() {
  let enabled = readPref();
  let ctx = null;
  let last = 0;

  function play(force = false) {
    if (!enabled && !force) return;
    const now = Date.now();
    if (now - last < 250) return;
    last = now;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ctx ??= new Ctx();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      [[659.25, 0], [880, 0.09]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t + delay);
        gain.gain.exponentialRampToValueAtTime(0.06, t + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t + delay);
        osc.stop(t + delay + 0.25);
      });
    } catch { /* no audio: fine */ }
  }

  return {
    get enabled() { return enabled; },
    set(on) { enabled = Boolean(on); writePref(enabled); if (enabled) play(true); },
    play,
    refresh() { enabled = readPref(); }, // Settings can change the choice
  };
}
