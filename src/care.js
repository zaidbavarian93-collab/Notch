/* Notch — PC Care window */
const N = window.notch;
const $ = (id) => document.getElementById(id);
const fmt = (b) => { b = Math.max(0, +b || 0); const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return (i ? b.toFixed(b < 10 ? 1 : 0) : b) + ' ' + u[i]; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function icons(root = document) { root.querySelectorAll('i[data-i]').forEach(i => { if (!i.innerHTML) i.innerHTML = ICON[i.dataset.i] || ''; }); }
async function busy(btn, fn) {
  if (btn.disabled) return; btn.disabled = true; btn.classList.add('busy');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('busy'); }
}

// ---------- theme + nav
(async () => { try { document.documentElement.dataset.theme = await N.careTheme(); } catch {} })();
N.on('theme', t => document.documentElement.dataset.theme = t);
$('logo').innerHTML = ICON.spark;
N.version().then(v => { $('ver').textContent = 'العناية بالحاسوب · v' + v; $('appVer').textContent = `الإصدار الحالي v${v}. التحديثات تُنزَّل وتُثبَّت تلقائياً.`; }).catch(() => {});

const loaded = {};
function show(tab) {
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('on', s.id === 't-' + tab));
  if (!loaded[tab]) { loaded[tab] = true; ({ home: health, proc: loadProc, startup: loadStartup, protect: health, clean: scan }[tab] || (() => {}))(); }
}
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => show(b.dataset.tab));
N.on('care:tab', show);
document.addEventListener('click', e => { const u = e.target.closest('[data-url]'); if (u) N.openUrl(u.dataset.url); });

// ---------- live meters
async function meters() {
  try {
    const s = await N.stats();
    const ram = Math.round((1 - s.ramFree / s.ramTotal) * 100);
    setBar('Cpu', s.cpu, s.cpu + '%');
    setBar('Ram', ram, ram + '%'); $('sRam').textContent = `${fmt(s.ramTotal - s.ramFree)} من ${fmt(s.ramTotal)}`;
    if (s.disk) { const d = Math.round((1 - s.disk.free / s.disk.total) * 100); setBar('Disk', d, d + '%'); $('sDisk').textContent = `متاح ${fmt(s.disk.free)} من ${fmt(s.disk.total)}`; }
    const h = s.uptime / 3600; $('mUp').textContent = h < 24 ? Math.round(h) + ' س' : Math.round(h / 24) + ' يوم';
  } catch {}
}
function setBar(k, v, label) { $('m' + k).textContent = label; const b = $('b' + k); b.style.width = v + '%'; b.className = v >= 90 ? 'hot' : v >= 75 ? 'warm' : ''; }
meters(); setInterval(meters, 2000);

// ---------- health
let H = null;
async function health() {
  $('scoreTitle').textContent = 'جارِ الفحص…'; $('checks').innerHTML = '';
  H = await N.care('health');
  const st = await N.stats();
  if (!H.ok) { $('scoreTitle').textContent = 'تعذّر الفحص'; return; }
  const items = []; let score = 100;
  const ram = Math.round((1 - st.ramFree / st.ramTotal) * 100);
  const add = (lvl, text, tab, pen) => { items.push({ lvl, text, tab }); score -= pen; };
  const junk = (H.temp || 0) + (H.recycle || 0);
  if (junk > 2 * 1024 ** 3) add('bad', `ملفات غير ضرورية: ${fmt(junk)}`, 'clean', 15); else if (junk > 300 * 1024 ** 2) add('warn', `ملفات غير ضرورية: ${fmt(junk)}`, 'clean', 7); else add('ok', 'الملفات المؤقتة قليلة', null, 0);
  if (ram >= 85) add('bad', `الذاكرة ممتلئة ${ram}%`, 'boost', 15); else if (ram >= 70) add('warn', `استخدام الذاكرة ${ram}%`, 'boost', 6); else add('ok', `الذاكرة جيدة (${ram}%)`, null, 0);
  if (st.disk) { const d = 1 - st.disk.free / st.disk.total; if (d > .9) add('bad', `القرص C شبه ممتلئ (${Math.round(d * 100)}%)`, 'large', 15); else if (d > .8) add('warn', `القرص C ممتلئ ${Math.round(d * 100)}%`, 'large', 6); }
  if (H.startupCount > 10) add('warn', `${H.startupCount} برنامجاً يعمل مع بدء التشغيل`, 'startup', 8); else add('ok', `برامج بدء التشغيل: ${H.startupCount}`, null, 0);
  if (H.uptimeHours > 24 * 7) add('warn', `لم يُعَد تشغيل الجهاز منذ ${Math.round(H.uptimeHours / 24)} أيام`, null, 6);
  if (H.defender) {
    if (!H.defender.rtp) add('bad', 'الحماية في الوقت الحقيقي متوقفة', 'protect', 20);
    else if (H.defender.sigAgeDays > 3) add('warn', 'تعريفات Defender قديمة', 'protect', 5);
    else add('ok', 'Microsoft Defender يعمل', null, 0);
  }
  if (H.lastUpdateDays > 30) add('warn', `آخر تحديث لويندوز قبل ${H.lastUpdateDays} يوماً`, 'protect', 6);
  score = Math.max(5, score);
  const sc = $('score'); sc.style.setProperty('--p', score); sc.style.setProperty('--sc', score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--yellow)' : 'var(--red)');
  $('scoreN').textContent = score;
  $('scoreTitle').textContent = score >= 85 ? 'جهازك بحالة ممتازة' : score >= 65 ? 'جهازك جيد، مع بعض التحسينات' : 'جهازك يحتاج عناية';
  $('homeSub').textContent = `${H.osName || 'Windows'} · الإصدار ${H.build || ''}`;
  $('checks').innerHTML = items.map(i => `<li class="${i.lvl}">${esc(i.text)}${i.tab ? `<button data-go="${i.tab}">${i.tab === 'boost' ? 'تسريع' : 'إصلاح'}</button>` : ''}</li>`).join('');
  // protect tab
  if (H.defender) $('defState').textContent = `${H.defender.rtp ? '✓ الحماية في الوقت الحقيقي مفعّلة' : '✕ الحماية متوقفة'} · عمر التعريفات ${H.defender.sigAgeDays} يوم` + (H.defender.lastQuickScanDays >= 0 ? ` · آخر فحص قبل ${H.defender.lastQuickScanDays} يوم` : '');
  else $('defState').textContent = 'لا يمكن قراءة الحالة (قد يكون برنامج حماية آخر مثبتاً).';
  $('wuState').textContent = H.lastUpdateDays >= 0 ? `آخر تثبيت ناجح قبل ${H.lastUpdateDays} يوم` : 'افتح الإعدادات للتحقق من التحديثات.';
}
$('checks').addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (!g) return; g.dataset.go === 'boost' ? $('btnBoost').click() : show(g.dataset.go); });
$('btnRecheck').onclick = (e) => busy(e.currentTarget, health);
$('btnBoost').onclick = (e) => busy(e.currentTarget, async () => {
  e.currentTarget.querySelector('span').textContent = 'جارِ التسريع…';
  const r = await N.care('boost');
  e.currentTarget.querySelector('span').textContent = 'تسريع الآن';
  const t = $('boostRes');
  t.textContent = r.ok ? `✓ تم تحرير ${fmt(r.ramFree)} من الذاكرة وحذف ${fmt(r.tempFreed)} من الملفات المؤقتة` : 'تعذّر التسريع';
  t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 7000);
  meters();
});

// ---------- cleanup
let cleanItems = [];
async function scan() {
  const btn = $('btnScan');
  await busy(btn, async () => {
    $('cleanList').innerHTML = '<li class="empty">جارِ الفحص… قد يستغرق دقيقة</li>';
    const r = await N.care('scan');
    cleanItems = (r.items || []).filter(i => i.size > 0);
    if (!cleanItems.length) { $('cleanList').innerHTML = '<li class="empty">✓ لا توجد ملفات غير ضرورية</li>'; $('cleanTotal').textContent = 'نظيف'; $('btnClean').disabled = true; return; }
    $('cleanList').innerHTML = cleanItems.map(i => `<li><input type="checkbox" class="chk" data-id="${i.id}" ${i.id === 'recycle' ? '' : 'checked'}><div class="nm"><b>${esc(i.name)}</b></div><span class="sz">${fmt(i.size)}</span></li>`).join('');
    updClean();
  });
}
function updClean() {
  const ids = [...document.querySelectorAll('#cleanList .chk:checked')].map(c => c.dataset.id);
  const sum = cleanItems.filter(i => ids.includes(i.id)).reduce((a, b) => a + b.size, 0);
  $('cleanTotal').textContent = `يمكن تحرير ${fmt(sum)}`; $('btnClean').disabled = !ids.length;
}
$('cleanList').addEventListener('change', updClean);
$('btnScan').onclick = scan;
$('btnClean').onclick = (e) => busy(e.currentTarget, async () => {
  const ids = [...document.querySelectorAll('#cleanList .chk:checked')].map(c => c.dataset.id);
  if (ids.includes('recycle') && !confirm('سيتم إفراغ سلة المحذوفات نهائياً. متابعة؟')) return;
  const r = await N.care('clean', { ids });
  $('cleanTotal').textContent = r.ok ? `✓ تم تحرير ${fmt(r.freed)}` : 'تعذّر التنظيف';
  setTimeout(scan, 1500);
});

// ---------- large files
$('btnLarge').onclick = (e) => busy(e.currentTarget, async () => {
  $('largeList').innerHTML = '<li class="empty">جارِ البحث في مجلداتك…</li>';
  const r = await N.care('large', { minMB: +$('minMB').value });
  const items = r.items || [];
  if (!items.length) { $('largeList').innerHTML = '<li class="empty">لا توجد ملفات بهذا الحجم</li>'; return; }
  $('largeList').innerHTML = items.map((f, k) => `<li data-k="${k}"><div class="nm"><b dir="auto">${esc(f.name)}</b><small>${esc(f.path)}</small></div><span class="sz">${fmt(f.size)}</span>
    <div class="act"><button data-a="show">إظهار</button><button data-a="trash" class="danger">نقل للسلة</button></div></li>`).join('');
  $('largeList').onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b) return; const li = b.closest('li'); const f = items[+li.dataset.k];
    if (b.dataset.a === 'show') N.showFile(f.path);
    if (b.dataset.a === 'trash' && confirm(`نقل «${f.name}» إلى سلة المحذوفات؟`)) { const t = await N.trash(f.path); if (t.ok) li.remove(); else alert(t.error); }
  };
});

// ---------- processes
async function loadProc() {
  await busy($('btnProc'), async () => {
    const r = await N.care('processes'); const items = r.items || [];
    const max = Math.max(...items.map(i => i.mem), 1), total = items.reduce((a, b) => a + b.mem, 0);
    $('procSum').textContent = `أعلى ${items.length} برنامج · ${fmt(total)}`;
    $('procList').innerHTML = items.map(p => `<li><div class="nm"><b dir="auto">${esc(p.title)}</b><small>${esc(p.name)}${p.count > 1 ? ' × ' + p.count : ''}</small></div>
      <div class="mbar"><i style="width:${(p.mem / max * 100).toFixed(0)}%"></i></div><span class="sz">${fmt(p.mem)}</span>
      <div class="act"><button class="danger" data-n="${esc(p.name)}">إنهاء</button></div></li>`).join('');
  });
}
$('btnProc').onclick = loadProc;
$('procList').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-n]'); if (!b) return;
  if (!confirm(`إنهاء «${b.dataset.n}»؟ قد تفقد أي عمل غير محفوظ فيه.`)) return;
  await N.care('kill', { name: b.dataset.n }); setTimeout(loadProc, 600);
});

// ---------- startup
async function loadStartup() {
  await busy($('btnStartup'), async () => {
    const r = await N.care('startup'); const items = r.items || [];
    $('stSum').textContent = `${items.filter(i => i.enabled).length} مفعّل من ${items.length}`;
    $('stList').innerHTML = items.length ? items.map((s, k) => `<li><div class="nm"><b dir="auto">${esc(s.name)}</b><small>${esc(s.cmd)}</small></div>
      <span class="tg ${s.enabled ? 'on' : ''} ${s.canEdit ? '' : 'locked'}" data-k="${k}" title="${s.canEdit ? '' : 'يتطلب صلاحيات المدير'}"></span></li>`).join('') : '<li class="empty">لا توجد برامج</li>';
    $('stList').onclick = async (e) => {
      const t = e.target.closest('.tg'); if (!t || t.classList.contains('locked')) return;
      const s = items[+t.dataset.k]; const to = !s.enabled;
      const res = await N.care('startup-set', { name: s.name, scope: s.scope, enabled: to });
      if (res.ok) { s.enabled = to; t.classList.toggle('on', to); $('stSum').textContent = `${items.filter(i => i.enabled).length} مفعّل من ${items.length}`; }
      else alert(res.error || 'تعذّر التغيير');
    };
  });
}
$('btnStartup').onclick = loadStartup;

// ---------- protect
$('btnQuickScan').onclick = (e) => busy(e.currentTarget, async () => {
  const r = await N.care('defender-scan');
  if (r.ok) $('defState').textContent = 'بدأ الفحص السريع في الخلفية… ستصلك نتيجة من أمن ويندوز.';
  else N.openUrl('windowsdefender://threat');
});

// ---------- tools
const TOOLS = [
  ['apps', 'التطبيقات المثبّتة', 'إلغاء تثبيت البرامج', 'ms-settings:appsfeatures'],
  ['folder', 'مستشعر التخزين', 'تنظيف تلقائي من ويندوز', 'ms-settings:storagesense'],
  ['power', 'الطاقة والبطارية', 'أوضاع الأداء والطاقة', 'ms-settings:powersleep'],
  ['shield', 'أمن ويندوز', 'الفيروسات والجدار الناري', 'windowsdefender:'],
  ['download', 'تحديث ويندوز', 'التحديثات والسجل', 'ms-settings:windowsupdate'],
  ['list', 'الإشعارات', 'إدارة الإشعارات المزعجة', 'ms-settings:notifications'],
  ['heart', 'عدم الإزعاج / التركيز', 'جلسات التركيز', 'ms-settings:quiethours'],
  ['apps', 'برامج بدء التشغيل (ويندوز)', 'الإعداد الرسمي', 'ms-settings:startupapps'],
  ['refresh', 'الاسترداد', 'إعادة ضبط أو استعادة النظام', 'ms-settings:recovery'],
];
$('toolsGrid').innerHTML = TOOLS.map(([ic, t, s, u]) => `<button class="card tool" data-url="${u}"><i data-i="${ic}" class="ti"></i><div><b>${t}</b><small>${s}</small></div></button>`).join('');

icons();
show(new URLSearchParams(location.search).get('tab') || 'home');
