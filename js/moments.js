// Moments (B, 25 Nov: "interactive and fun", Atlas / Book a Day as the reference; picks from the Garage delight kit).
// Small garage-world rewards at real events only, about a second each, never blocking work. All of them are skipped
// when B turns them off (Settings → Look) or the phone asks for reduced motion. Fixed markup only, no user data in HTML.

export const motionOn = () => {
  try { if (localStorage.getItem('smg.motion') === 'off') return false; } catch {}
  return !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
};

const CAR = '<svg viewBox="0 0 64 28" aria-hidden="true"><path d="M4 20 Q4 14 12 13 L20 7 Q24 5 32 5 L42 5 Q48 6 52 12 L58 14 Q62 15 62 20 L62 22 L4 22 Z" fill="currentColor"/><circle cx="16" cy="22" r="5" fill="#1f1d1a"/><circle cx="50" cy="22" r="5" fill="#1f1d1a"/><path d="M22 9 L30 7 L30 12 L18 12 Z M33 7 L42 7 Q46 8 48 12 L33 12 Z" fill="#fff"/></svg>';
const MINIBOX = '<svg viewBox="0 0 100 66" aria-hidden="true"><path d="M8 11 L13 57 H87 L92 11" class="mb-body"/><path d="M2 11 L5 5 H95 L98 11 Z" class="mb-rim"/></svg>';

function layer(cls, html, ms) {
  const el = document.createElement('div');
  el.className = `moment ${cls}`; el.setAttribute('aria-hidden', 'true'); el.innerHTML = html;
  document.body.append(el);
  const done = () => el.remove();
  el.addEventListener('click', done);
  setTimeout(done, ms);
  return el;
}

// Car saved: a car drives into its storage box; the box count rolls up like an odometer.
export function driveIn(count) {
  if (!motionOn()) return;
  const n = Number(count) || 0;
  const el = layer('m-drive', `<div class="md-road"><span class="md-car">${CAR}</span><span class="md-box">${MINIBOX}<b class="md-odo"><span><i></i><i></i></span></b></span></div>`, 1700);
  const is = el.querySelectorAll('.md-odo i'); is[0].textContent = String(Math.max(0, n - 1)); is[1].textContent = String(n);
}

// Box packed: lid closes, tape sweeps across, a label stamps on.
export function packed(label, cars) {
  if (!motionOn()) return;
  const el = layer('m-pack', '<div class="mp-card"><svg class="mp-box" viewBox="0 0 130 90" aria-hidden="true"><g class="mp-lid"><path d="M3 18 L7 10 H123 L127 18 Z"/></g><path class="mp-body" d="M10 18 L16 82 H114 L120 18"/></svg><i class="mp-tape"></i><b class="mp-lbl"></b></div>', 2000);
  el.querySelector('.mp-lbl').textContent = `${String(label).toUpperCase()} ✓ ${cars} car${cars === 1 ? '' : 's'}`;
}

// Milestones: a chequered-flag burst, once per milestone, never for every save.
export const MILESTONES = [25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 3000];
export function nextMilestoneHit(prev, now) { return MILESTONES.filter(m => m > prev && m <= now).pop() || 0; }
export function flag(text) {
  const banner = layer('m-flag', '<b></b>', 2600);
  banner.querySelector('b').textContent = text;
  if (!motionOn()) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#2f6a4f';
  const cols = ['#111', '#fff', '#111', '#fff', accent];
  for (let i = 0; i < 64; i++) {
    const p = document.createElement('i'); p.className = 'm-cf'; p.style.background = cols[i % cols.length];
    p.style.left = `${innerWidth / 2}px`; p.style.top = `${innerHeight * 0.4}px`; document.body.append(p);
    const a = Math.random() * Math.PI * 2, v = 110 + Math.random() * 230;
    const anim = p.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * v}px,${Math.sin(a) * v + 220}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }],
      { duration: 1300 + Math.random() * 600, easing: 'cubic-bezier(.2,.6,.3,1)' });
    anim.onfinish = () => p.remove();
  }
}
// Call after cars are added. The first time, the current count is only remembered (no surprise flag for old cars).
export function checkMilestone(count) {
  let prev = null; try { prev = localStorage.getItem('smg.milestone'); } catch {}
  const set = (v) => { try { localStorage.setItem('smg.milestone', String(v)); } catch {} };
  if (prev === null) { set(count); return 0; }
  const hit = nextMilestoneHit(Number(prev) || 0, count);
  if (count > (Number(prev) || 0)) set(count);
  if (hit) flag(`${hit.toLocaleString('en-IN')} cars catalogued`);
  return hit;
}

// Sync: five start lights fill with progress, all green when done.
export function lightsHtml(frac, state = 'run') {
  const on = state === 'done' ? 5 : Math.max(1, Math.min(5, Math.ceil((frac || 0) * 5)));
  return Array.from({ length: 5 }, (_, i) => `<i class="sl ${state === 'done' ? 'g' : i < on ? 'r' : ''}"></i>`).join('');
}
