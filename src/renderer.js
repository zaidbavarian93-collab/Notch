/* Notch for Windows — renderer */
const N = window.notch;
const $ = (id) => document.getElementById(id);
const island = $('island');
const LOC = 'ar-IQ-u-nu-latn';

let S = { widgets: ['music', 'weather', 'date', 'timer', 'system'], hidden: [], timerMinutes: 25, showLyrics: true };

// ======================================================== state machine
const ui = { hovering: false, settings: false, asks: [], done: null, peek: null, peekQ: [], notif: null, inbox: false };
let curState = 'idle';

const WIDTHS = { music: 236, weather: 162, date: 152, timer: 96, system: 132 };
function openWidth() {
  const ws = visibleWidgets().map(w => WIDTHS[w]);
  return Math.max(440, ws.reduce((a, b) => a + b, 0) + 8 * Math.max(0, ws.length - 1) + 24);
}
function computeState() {
  if (ui.settings) return 'settings';
  if (ui.asks.length) return 'ask';
  if (ui.notif) return 'notif';
  if (ui.done) return 'done';
  if (ui.inbox && ui.hovering) return 'inbox';
  if (ui.hovering) return 'open';
  if (ui.peek) return 'peek';
  return 'idle';
}
function measure(view, w) {
  view.style.width = w + 'px';
  return Math.ceil(view.scrollHeight);
}
function render() {
  const st = computeState();
  curState = st;
  island.className = 's-' + st;
  let w = 200, h = 32;
  if (st === 'peek') {
    w = Math.min(420, Math.max(230, $('peekText').offsetWidth + $('peekSub').offsetWidth + 16 + 16 + 44));
    h = 38;
  } else if (st === 'open') { w = openWidth(); h = measure($('viewOpen'), w); }
  else if (st === 'ask') { w = 600; h = measure($('viewAsk'), w); }
  else if (st === 'done') { w = 420; h = measure($('viewDone'), w); }
  else if (st === 'notif') { w = 520; h = measure($('viewNotif'), w); }
  else if (st === 'inbox') { w = 560; h = Math.min(430, measure($('viewInbox'), w)); }
  else if (st === 'settings') { w = 740; h = measure($('viewSettings'), w); }
  island.style.width = w + 'px';
  island.style.height = h + 'px';
}

// ======================================================== mouse / hover
let inside = false, enterT = null, leaveT = null;
function setInside(v) {
  if (v === inside) return;
  inside = v;
  N.mouse(v);
  clearTimeout(enterT); clearTimeout(leaveT);
  if (v) enterT = setTimeout(() => { ui.hovering = true; render(); }, 70);
  else leaveT = setTimeout(() => { ui.hovering = false; ui.inbox = false; render(); }, 380);
}
document.addEventListener('mousemove', (e) => setInside(!!e.target.closest('#island')));
document.addEventListener('mouseleave', () => setInside(false));
N.on('mouse-out', () => setInside(false));

// ======================================================== peeks
function peek(p) {
  ui.peekQ.push(p);
  if (!ui.peek) nextPeek();
}
function nextPeek() {
  const p = ui.peekQ.shift();
  if (!p) { ui.peek = null; render(); return; }
  ui.peek = p;
  const icons = { app: ['app', ''], charge: ['bolt', 'green'], battery: ['battery', 'yellow'], low: ['battery', 'red'], timer: ['timer', 'orange'], claude: ['spark', 'orange'], music: ['music', 'purple'], focus: ['moon', 'purple'], boost: ['rocket', 'green'], update: ['download', 'purple'] };
  const [ic, color] = icons[p.kind] || ['spark', ''];
  $('peekIcon').innerHTML = ICON[ic]; $('peekIcon').className = 'peek-icon ' + color;
  $('peekText').textContent = p.text || '';
  $('peekSub').textContent = p.sub || '';
  render();
  setTimeout(() => { ui.peek = null; render(); setTimeout(nextPeek, 450); }, p.ms || 2600);
}
N.on('peek', peek);

// ======================================================== widgets
const cards = {};
function visibleWidgets() { return S.widgets.filter(w => !S.hidden.includes(w)); }
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

function buildCards() {
  const box = $('cards'); box.innerHTML = '';
  for (const w of visibleWidgets()) {
    if (!cards[w]) cards[w] = makeCard[w]();
    box.appendChild(cards[w]);
  }
  box.style.display = visibleWidgets().length ? '' : 'none';
}

const makeCard = {
  system() {
    const c = el(`<div class="card c-system">
      <div class="rings">
        <div class="ring2" id="sCpu" style="--p:0"><b>0%</b><span>CPU</span></div>
        <div class="ring2" id="sRam" style="--p:0"><b>0%</b><span>RAM</span></div>
      </div>
      <div class="sbtns"><button id="sBoost" title="تسريع: تحرير الذاكرة وحذف المؤقت">${ICON.rocket}<span>تسريع</span></button><button id="sCare" class="sm" title="العناية بالحاسوب">${ICON.gear}</button></div></div>`);
    c.querySelector('#sBoost').onclick = async (e) => {
      const b = e.currentTarget; if (b.disabled) return; b.disabled = true; b.classList.add('busy'); b.querySelector('span').textContent = '…';
      try { await N.care('boost'); } finally { b.disabled = false; b.classList.remove('busy'); b.querySelector('span').textContent = 'تسريع'; tickStats(); }
    };
    c.querySelector('#sCare').onclick = () => N.openCare('home');
    return c;
  },
  music() {
    const c = el(`<div class="card c-music">
      <div class="art" id="mArt">${ICON.music}</div>
      <div class="meta">
        <div class="t" id="mTitle" dir="auto">لا يوجد تشغيل</div>
        <div class="a" id="mArtist" dir="auto">شغّل أغنية من Spotify أو YouTube</div>
        <div class="ctl">
          <button id="mPrev" title="السابق">${ICON.prev}</button>
          <button id="mPlay" class="big" title="تشغيل/إيقاف">${ICON.play}</button>
          <button id="mNext" title="التالي">${ICON.next}</button>
        </div>
        <div class="prog"><i id="mProg"></i></div>
      </div></div>`);
    c.querySelector('#mPrev').onclick = () => N.media('prev');
    c.querySelector('#mNext').onclick = () => N.media('next');
    c.querySelector('#mPlay').onclick = () => { N.media('toggle'); media.playing = !media.playing; paintMedia(); };
    return c;
  },
  weather() {
    return el(`<div class="card c-weather">
      <div class="ico" id="wIco">${ICON.cloudSun}</div>
      <div class="temp" id="wTemp">--°</div>
      <div class="city" id="wCity">…</div>
      <div class="hl" id="wHL"></div></div>`);
  },
  date() {
    return el(`<div class="card c-date">
      <div class="day"><div class="dname" id="dName"></div><div class="dnum" id="dNum"></div></div>
      <div class="info"><div class="time" id="dTime"></div><div class="month" id="dMonth"></div><div class="hijri" id="dHijri"></div></div></div>`);
  },
  timer() {
    const c = el(`<div class="card c-timer">
      <div class="lbl">مؤقّت</div>
      <div class="tv" id="tVal">25:00</div>
      <div class="ring"><i id="tRing"></i></div>
      <div class="tbtns"><button id="tReset" class="sm" title="إعادة">${ICON.reset}</button><button id="tPlay" title="ابدأ / أوقف">${ICON.play}</button></div></div>`);
    c.querySelector('#tPlay').onclick = toggleTimer;
    c.querySelector('#tReset').onclick = resetTimer;
    return c;
  },
};

// ======================================================== music + lyrics
const media = { title: '', artist: '', playing: false, position: 0, duration: 0, key: '', at: 0, art: null };
let lyrics = { key: '', lines: [], status: 'none' };

N.on('media', (m) => {
  const was = media.key;
  Object.assign(media, m, { at: performance.now() });
  if (!m.title) { media.key = ''; media.art = null; }
  if (was !== media.key) { lyIdx = -2; }
  paintMedia();
});
N.on('art', (a) => { if (a.key === media.key || !media.key) { media.art = a.art; paintMedia(); } });
N.on('lyrics', (l) => { lyrics = l; lyIdx = -2; });

function pos() { return media.playing ? media.position + (performance.now() - media.at) / 1000 : media.position; }

function paintMedia() {
  const has = !!media.title;
  const art = $('mArt');
  if (art) {
    $('mTitle').textContent = has ? media.title : 'لا يوجد تشغيل';
    $('mArtist').textContent = has ? (media.artist || media.album || '') : 'شغّل أغنية من Spotify أو YouTube';
    $('mPlay').innerHTML = media.playing ? ICON.pause : ICON.play;
    art.style.backgroundImage = media.art ? `url("${media.art}")` : '';
    art.classList.toggle('has', !!media.art);
  }
  $('miniArt').style.backgroundImage = media.art ? `url("${media.art}")` : '';
  $('miniArt').classList.toggle('on', has && !!media.art);
  $('miniEq').classList.toggle('on', has);
  $('miniEq').classList.toggle('play', has && media.playing);
  const showLy = S.showLyrics && has;
  const wasHidden = $('lyrics').classList.contains('hide');
  $('lyrics').classList.toggle('hide', !showLy);
  if (wasHidden === showLy && curState === 'open') render();
}

let lyIdx = -2;
function tickLyrics() {
  const prog = $('mProg');
  if (prog) prog.style.width = media.duration > 0 ? Math.min(100, pos() / media.duration * 100) + '%' : '0%';
  if (!S.showLyrics || !media.title) return;
  let cur = '', next = '', idx = -1;
  const synced = lyrics.key === media.key && lyrics.status === 'synced' && lyrics.lines.length;
  if (synced) {
    const p = pos() + 0.25;
    for (let i = 0; i < lyrics.lines.length; i++) { if (lyrics.lines[i].t <= p) idx = i; else break; }
    // skip empty lines (instrumental gaps)
    cur = idx >= 0 ? lyrics.lines[idx].text : '';
    let j = idx + 1; while (j < lyrics.lines.length && !lyrics.lines[j].text) j++;
    next = j < lyrics.lines.length ? lyrics.lines[j].text : '';
    if (!cur) cur = '♪';
  } else {
    idx = -1;
    cur = lyrics.key === media.key && lyrics.status === 'loading' ? '… جاري البحث عن الكلمات' : media.title;
    next = lyrics.key === media.key && lyrics.status === 'loading' ? '' : (media.artist || '');
    if (lyrics.key === media.key && (lyrics.status === 'none' || lyrics.status === 'plain')) next = (media.artist ? media.artist + ' · ' : '') + 'لا توجد كلمات متزامنة';
  }
  const key = idx + '|' + cur + '|' + next;
  if (key === lyIdx) return;
  lyIdx = key;
  const c = $('lyCur');
  c.classList.add('ly-swap');
  setTimeout(() => { c.textContent = cur; $('lyNext').textContent = next; c.classList.remove('ly-swap'); }, 140);
}
setInterval(tickLyrics, 200);

// ======================================================== system stats
async function tickStats() {
  if (!$('sCpu') || !N.stats) return;
  if (curState !== 'open' && !tickStats.first) return;
  tickStats.first = false;
  const st = await N.stats();
  const ram = Math.round((1 - st.ramFree / st.ramTotal) * 100);
  const set = (id, v) => { const e = $(id); e.style.setProperty('--p', v); e.querySelector('b').textContent = v + '%'; e.classList.toggle('hot', v >= 85); };
  set('sCpu', st.cpu); set('sRam', ram);
}
tickStats.first = true;
setInterval(tickStats, 2000);

// ======================================================== weather
const WMAP = (code, day) => {
  if (code === 0) return [day ? 'sun' : 'moon', 'صافٍ'];
  if (code <= 2) return ['cloudSun', 'غائم جزئياً'];
  if (code === 3) return ['cloud', 'غائم'];
  if (code === 45 || code === 48) return ['fog', 'ضباب'];
  if (code >= 51 && code <= 67) return ['rain', 'مطر'];
  if (code >= 71 && code <= 77) return ['snow', 'ثلج'];
  if (code >= 80 && code <= 82) return ['rain', 'زخّات مطر'];
  if (code >= 85 && code <= 86) return ['snow', 'ثلج'];
  if (code >= 95) return ['storm', 'عاصفة رعدية'];
  return ['cloud', ''];
};
let weather = null;
N.on('weather', (w) => { weather = w; paintWeather(); });
function paintWeather() {
  if (!weather || !$('wTemp')) return;
  if (weather.error) { $('wTemp').textContent = '--°'; $('wCity').textContent = weather.city; $('wHL').textContent = 'لا يوجد اتصال'; return; }
  const [ic, desc] = WMAP(weather.code, weather.isDay);
  $('wIco').innerHTML = ICON[ic];
  $('wTemp').textContent = Math.round(weather.temp) + '°';
  $('wCity').textContent = weather.city + (desc ? ' · ' + desc : '');
  $('wHL').textContent = `H ${Math.round(weather.max)}°  L ${Math.round(weather.min)}°`;
}

// ======================================================== date / clock
function paintDate() {
  const d = new Date();
  const t = d.toLocaleTimeString(LOC, { hour: 'numeric', minute: '2-digit' });
  $('tbClock').textContent = t;
  if (!$('dNum')) return;
  $('dName').textContent = d.toLocaleDateString(LOC, { weekday: 'long' });
  $('dNum').textContent = d.getDate();
  $('dTime').textContent = t;
  $('dMonth').textContent = d.toLocaleDateString(LOC, { month: 'long' });
  try { $('dHijri').textContent = d.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long' }); } catch {}
}
setInterval(paintDate, 5000);

// ======================================================== timer
const timer = { total: 25 * 60, left: 25 * 60, running: false, endAt: 0, iv: null };
function fmt(s) { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
function paintTimer() {
  if (!$('tVal')) return;
  $('tVal').textContent = fmt(timer.left);
  $('tVal').classList.toggle('run', timer.running);
  $('tPlay').innerHTML = timer.running ? ICON.pause : ICON.play;
  $('tRing').style.width = (100 - timer.left / timer.total * 100) + '%';
}
function toggleTimer() {
  if (timer.running) { timer.running = false; timer.left = (timer.endAt - Date.now()) / 1000; clearInterval(timer.iv); }
  else {
    timer.running = true; timer.endAt = Date.now() + timer.left * 1000;
    timer.iv = setInterval(() => {
      timer.left = (timer.endAt - Date.now()) / 1000;
      if (timer.left <= 0) { resetTimer(); beep(); peek({ kind: 'timer', text: 'انتهى المؤقّت', sub: fmt(timer.total) , ms: 4000}); }
      paintTimer();
    }, 250);
  }
  paintTimer();
}
function resetTimer() { clearInterval(timer.iv); timer.running = false; timer.total = timer.left = (S.timerMinutes || 25) * 60; paintTimer(); }
function beep() {
  try {
    const ac = new AudioContext();
    [0, 0.28, 0.56].forEach((t, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = i === 2 ? 1046 : 784; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.24);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.26);
    });
  } catch {}
}

// ======================================================== battery
(async () => {
  if (!navigator.getBattery) return;
  try {
    const b = await navigator.getBattery();
    const pct = () => Math.round(b.level * 100);
    const paint = () => { $('tbBat').innerHTML = (b.charging ? `<span style="width:12px;height:12px;color:#5be08e">${ICON.bolt}</span>` : '') + `${pct()}%`; };
    const isDesktop = b.charging && b.level === 1 && b.chargingTime === 0;
    if (!isDesktop) paint();
    let lastLow = 100;
    b.addEventListener('chargingchange', () => { paint(); peek(b.charging ? { kind: 'charge', text: 'يشحن', sub: pct() + '%' } : { kind: 'battery', text: 'على البطارية', sub: pct() + '%' }); });
    b.addEventListener('levelchange', () => {
      paint();
      const p = pct();
      if (!b.charging && ((p <= 20 && lastLow > 20) || (p <= 10 && lastLow > 10))) peek({ kind: 'low', text: 'البطارية منخفضة', sub: p + '%', ms: 4000 });
      lastLow = p;
    });
  } catch {}
})();

// ======================================================== Claude Code
let claudeWorking = false;
function setWorking(v, project) {
  claudeWorking = v;
  $('miniClaude').classList.toggle('on', v);
  $('tbClaude').classList.toggle('on', v);
  $('tbClaude').innerHTML = v ? `${ICON.spark}<span>Claude يعمل${project ? ' · ' + project : ''}</span>` : '';
}
N.on('claude:working', (d) => setWorking(true, d.project));

function dotsGrid(box, kind) {
  box.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const d = document.createElement('i');
    if (kind === 'ask' && Math.random() < 0.35) { d.className = 'on'; d.style.animationDelay = (Math.random() * 1.4).toFixed(2) + 's'; }
    if (kind === 'done' && Math.random() < 0.18) d.className = 'dim';
    box.appendChild(d);
  }
}
function paintAsk() {
  const a = ui.asks[0]; if (!a) return;
  $('askCmd').textContent = a.detail || a.tool;
  $('askProj').textContent = a.project || '';
  $('askMore').textContent = ui.asks.length > 1 ? `+${ui.asks.length - 1} طلبات أخرى بالانتظار` : '';
  dotsGrid($('askDots'), 'ask');
}
N.on('claude:ask', (a) => { ui.asks.push(a); paintAsk(); render(); });
N.on('claude:resolved', ({ id }) => { ui.asks = ui.asks.filter(a => a.id !== id); paintAsk(); render(); });
$('btnAllow').onclick = () => { const a = ui.asks[0]; if (a) N.decide(a.id, 'allow'); };
$('btnDeny').onclick = () => { const a = ui.asks[0]; if (a) N.decide(a.id, 'deny'); };

function filesText(n) {
  if (!n) return 'بدون تعديل ملفات';
  if (n === 1) return 'تغيّر ملف واحد';
  if (n === 2) return 'تغيّر ملفان';
  if (n <= 10) return `تغيّرت ${n} ملفات`;
  return `تغيّر ${n} ملفاً`;
}
let doneT = null;
N.on('claude:done', (d) => {
  setWorking(false);
  const s = d.secs;
  $('doneTitle').textContent = 'انتهى خلال ' + (s < 60 ? `${s} ث` : `${Math.floor(s / 60)} د ${String(s % 60).padStart(2, '0')} ث`);
  $('doneSub').textContent = filesText(d.files);
  $('doneProj').textContent = d.project || '';
  dotsGrid($('doneDots'), 'done');
  ui.done = d; render();
  clearTimeout(doneT); doneT = setTimeout(() => { ui.done = null; render(); }, 6000);
});
$('viewDone').onclick = () => { clearTimeout(doneT); ui.done = null; render(); };

// ======================================================== theme
function applyTheme(t) { document.documentElement.dataset.theme = t; $('btnTheme').innerHTML = t === 'dark' ? ICON.sun : ICON.moon; }
N.on('theme', applyTheme);
$('btnTheme').onclick = () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; S.theme = next; N.setSettings({ theme: next }); applyTheme(next); };

// ======================================================== settings view
const WNAMES = { music: ['الموسيقى', 'music'], weather: ['الطقس', 'cloudSun'], date: ['التاريخ', 'calendar'], timer: ['المؤقّت', 'timer'], system: ['النظام والتسريع', 'rocket'] };
$('btnSettings').innerHTML = ICON.gear;
$('btnCare').innerHTML = ICON.rocket; $('btnCare').onclick = () => N.openCare('home');
$('btnSettings').onclick = openSettings;
N.on('open-settings', openSettings);

async function openSettings() {
  const s = await N.getSettings();
  Object.assign(S, s);
  paintSettings(s);
  ui.settings = true; N.mouse(true); render();
}
function closeSettings() { ui.settings = false; render(); }
$('btnSetDone').onclick = closeSettings;

function paintWidgetList() {
  const ul = $('wList'); ul.innerHTML = '';
  S.widgets.forEach((w, i) => {
    const off = S.hidden.includes(w);
    const li = el(`<li class="${off ? 'off' : ''}"><span class="wi">${ICON[WNAMES[w][1]]}</span><span class="nm">${WNAMES[w][0]}</span>
      <button data-a="up" title="لأعلى" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
      <button data-a="down" title="لأسفل" ${i === S.widgets.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
      <button data-a="eye" title="إظهار/إخفاء">${off ? ICON.eye : ICON.check}</button></li>`);
    li.onclick = (e) => {
      const a = e.target.closest('button')?.dataset.a; if (!a) return;
      const arr = [...S.widgets];
      if (a === 'up') [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      if (a === 'down') [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      if (a === 'eye') S.hidden = off ? S.hidden.filter(x => x !== w) : [...S.hidden, w];
      S.widgets = arr;
      N.setSettings({ widgets: S.widgets, hidden: S.hidden });
      paintWidgetList(); buildCards(); refreshAll();
    };
    ul.appendChild(li);
  });
}
function paintSettings(s) {
  paintWidgetList();
  $('cityNow').textContent = 'الحالية: ' + (s.city?.name || '');
  $('cityInput').value = '';
  document.querySelectorAll('#segTheme button').forEach(b => b.classList.toggle('on', b.dataset.v === s.theme));
  $('timerMin').value = s.timerMinutes;
  $('optLyrics').checked = !!s.showLyrics;
  $('optApps').checked = !!s.peekApps;
  $('optNotifs').checked = s.mirrorNotifs !== false;
  $('optLogin').checked = !!s.openAtLogin;
  paintHooks(s.hooksInstalled);
}
function paintHooks(on) {
  $('hookState').innerHTML = on
    ? '✓ مربوط. طلبات الموافقة وإشعار الانتهاء تظهر هنا. (أعد تشغيل Claude Code إذا كان مفتوحاً)'
    : 'غير مربوط. اضغط الزر ليُضاف الربط تلقائياً إلى إعدادات Claude Code.';
  $('btnHooks').textContent = on ? 'إلغاء الربط' : 'ربط Claude Code';
  $('btnHooks').classList.toggle('primary', !on);
  $('btnHooks').dataset.on = on ? '1' : '';
}
$('btnHooks').onclick = async () => {
  const on = !!$('btnHooks').dataset.on;
  const r = on ? await N.removeHooks() : await N.installHooks();
  if (r.ok) paintHooks(!on); else $('hookState').textContent = 'خطأ: ' + r.error;
};
async function searchCity() {
  const q = $('cityInput').value.trim(); if (!q) return;
  $('cityNow').textContent = '… جاري البحث';
  const r = await N.searchCity(q);
  $('cityNow').textContent = r.ok ? `الحالية: ${r.name}${r.country ? '، ' + r.country : ''}` : 'لم يتم العثور على المدينة';
}
$('btnCity').onclick = searchCity;
$('cityInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchCity(); });
document.querySelectorAll('#segTheme button').forEach(b => b.onclick = () => {
  N.setSettings({ theme: b.dataset.v }); S.theme = b.dataset.v;
  document.querySelectorAll('#segTheme button').forEach(x => x.classList.toggle('on', x === b));
});
$('timerMin').onchange = () => { const v = Math.min(180, Math.max(1, +$('timerMin').value || 25)); S.timerMinutes = v; N.setSettings({ timerMinutes: v }); if (!timer.running) resetTimer(); };
$('optLyrics').onchange = (e) => { S.showLyrics = e.target.checked; N.setSettings({ showLyrics: S.showLyrics }); paintMedia(); };
$('optApps').onchange = (e) => N.setSettings({ peekApps: e.target.checked });
$('optNotifs').onchange = (e) => N.setSettings({ mirrorNotifs: e.target.checked });
$('optLogin').onchange = (e) => N.setLogin(e.target.checked);

// ======================================================== boot
function refreshAll() { paintMedia(); paintWeather(); paintDate(); paintTimer(); lyIdx = -2; tickLyrics(); }
(async () => {
  try { Object.assign(S, await N.getSettings()); } catch {}
  if (!S.widgets.includes('system')) { S.widgets = [...S.widgets, 'system']; N.setSettings({ widgets: S.widgets }); }
  applyTheme(S.effectiveTheme || 'dark');
  timer.total = timer.left = (S.timerMinutes || 25) * 60;
  buildCards(); refreshAll(); render();
})();


// ======================================================== mirrored app notifications
const notifQ = [], notifHist = [];
let notifT = null, notifHover = false;
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
function avatar(n, cls) {
  if (n.image) return `<span class="${cls} img" style="background-image:url('${esc(n.image)}')"></span>`;
  return `<span class="${cls}" style="--h:${hue(n.app)}">${esc((n.app || '?').trim().charAt(0).toUpperCase())}</span>`;
}
function timeAgo(t) { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'الآن' : s < 3600 ? `قبل ${Math.round(s / 60)} د` : `قبل ${Math.round(s / 3600)} س`; }

N.on('notif', (n) => {
  n.at = Date.now();
  notifHist.unshift(n); if (notifHist.length > 30) notifHist.pop();
  paintBell();
  if (ui.notif) notifQ.push(n); else showNotif(n);
  if (ui.inbox) paintInbox();
});
function showNotif(n) {
  ui.notif = n;
  const v = $('viewNotif');
  v.innerHTML = `
    <div class="nf">
      ${avatar(n, 'nf-av')}
      <div class="nf-body">
        <div class="nf-app">${esc(n.app)} <span>· الآن</span></div>
        <div class="nf-title" dir="auto">${esc(n.title || n.app)}</div>
        ${n.body ? `<div class="nf-text" dir="auto">${esc(n.body)}</div>` : ''}
      </div>
      <button class="nf-x" data-a="close" title="إغلاق">✕</button>
    </div>
    <div class="nf-acts">
      ${(n.actions || []).map((a, i) => `<button data-a="act" data-i="${i}" dir="auto">${esc(a.label)}</button>`).join('')}
      <button class="primary" data-a="open">فتح</button>
      <button class="ghost" data-a="mute" title="لا تعرض إشعارات هذا التطبيق في النوتش">كتم ${esc(n.app)}</button>
      ${notifQ.length ? `<span class="nf-more">+${notifQ.length}</span>` : ''}
    </div>`;
  render();
  armNotifTimer();
}
function armNotifTimer() { clearTimeout(notifT); notifT = setTimeout(() => { if (!notifHover) nextNotif(); else armNotifTimer(); }, 7000); }
function nextNotif() { clearTimeout(notifT); ui.notif = null; const n = notifQ.shift(); if (n) showNotif(n); else render(); }
$('viewNotif').addEventListener('mouseenter', () => { notifHover = true; });
$('viewNotif').addEventListener('mouseleave', () => { notifHover = false; });
$('viewNotif').addEventListener('click', (e) => {
  const b = e.target.closest('button'); const n = ui.notif; if (!n) return;
  const a = b ? b.dataset.a : 'open';
  if (a === 'open') N.notifOpen({ appId: n.appId, url: n.url });
  if (a === 'act') { const act = n.actions[+b.dataset.i]; N.notifOpen({ appId: n.appId, url: act && act.url }); }
  if (a === 'mute') { N.notifMute(n.appId); notifQ.splice(0, notifQ.length, ...notifQ.filter(x => x.appId !== n.appId)); peek({ kind: 'app', text: `تم كتم ${n.app}`, sub: '' }); }
  nextNotif();
});

// bell + inbox
function paintBell() {
  const b = $('btnBell'); if (!b) return;
  b.innerHTML = ICON.bell + (notifHist.length ? `<i class="badge">${notifHist.length > 9 ? '9+' : notifHist.length}</i>` : '');
}
function paintInbox() {
  const v = $('viewInbox');
  v.innerHTML = `<div class="ib-head"><b>الإشعارات</b><span>${notifHist.length}</span><div style="flex:1"></div>
      ${notifHist.length ? '<button data-a="clear">مسح الكل</button>' : ''}<button data-a="back">رجوع</button></div>
    <div class="ib-list">${notifHist.length ? notifHist.map((n, i) => `
      <div class="ib-item" data-i="${i}">${avatar(n, 'ib-av')}
        <div class="nf-body"><div class="nf-app">${esc(n.app)} <span>· ${timeAgo(n.at)}</span></div>
        <div class="nf-title" dir="auto">${esc(n.title || n.app)}</div>${n.body ? `<div class="nf-text one" dir="auto">${esc(n.body)}</div>` : ''}</div>
        <button class="nf-x" data-a="del" title="حذف">✕</button></div>`).join('') : '<div class="ib-empty">لا توجد إشعارات جديدة</div>'}</div>`;
  if (curState === 'inbox') render();
}
$('viewInbox').addEventListener('click', (e) => {
  const b = e.target.closest('button'); const it = e.target.closest('.ib-item');
  if (b && b.dataset.a === 'back') { ui.inbox = false; render(); return; }
  if (b && b.dataset.a === 'clear') { notifHist.length = 0; paintBell(); paintInbox(); render(); return; }
  if (!it) return;
  const i = +it.dataset.i, n = notifHist[i];
  if (b && b.dataset.a === 'del') { notifHist.splice(i, 1); paintBell(); paintInbox(); render(); return; }
  N.notifOpen({ appId: n.appId, url: n.url }); notifHist.splice(i, 1); paintBell(); paintInbox();
});
$('btnBell').onclick = () => { ui.inbox = true; paintInbox(); render(); };
paintBell();
