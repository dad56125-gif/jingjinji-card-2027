/* ============================================================================
 * app.js —— 交互逻辑（不含任何景区数据）
 *   载入时把 data.js / data-jp.js / data-zx.js 合并成"一个景区一行"的总表，
 *   再做 渲染 / 搜索 / 筛选 / 地图打点 / 一日联玩推荐。
 *
 * 合并规则（想修正误合、漏合，改 data.js 的 merge.alias 即可）：
 *   1. 景区名称归一化（去【新增】、去等级、去括号、去常见后缀）得到"归并键"
 *   2. 同键视为同一景区，把各卡的权益、门票、接待时间挂在同一行上
 *   3. 同一张卡里同名但权益不同的（如 杰嘉花乐园 的免1次 / 优惠1次）另起一行
 * ==========================================================================*/
const D = window.SCENIC || {};
const CAT = window.CATALOG || {};
const CARDS = D.cards || [];
const CARD = {};
CARDS.forEach(c => { CARD[c.id] = c; });
const META = D.meta || {};
const REGION_ORDER = D.regionOrder || [];

/* ============================ 名称归一 ============================ */
const LEVEL_RE = /\s*[2-5]A\s*$/;
/* 归一时去掉的后缀：只保留"地理/场地属性"类，避免把 赵州桥科技馆 / 赵州桥展览馆 这类
   同前缀的不同场馆合并。博物馆、科技馆、纪念馆等词不作剥离。 */
const NORMSUF = ['风景名胜区', '森林公园', '生态旅游区', '旅游景区', '旅游度假区', '主题公园',
  '风景区', '旅游区', '度假区', '景区', '公园', '乐园', '营地', '温泉度假村', '度假酒店'];
function norm(name) {
  let s = String(name || '').replace(/【新增】/g, '');
  s = s.replace(LEVEL_RE, '');
  s = s.replace(/（/g, '(').replace(/）/g, ')');
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/[\s·・:：!！,，。.\-—_/、]+/g, '');
  s = s.replace(/^(北京|天津|河北|中国)/, '');
  s = s.split('国家').join('');
  for (const suf of NORMSUF) if (s.length > suf.length && s.slice(-suf.length) === suf) s = s.slice(0, -suf.length);
  return s;
}
const ALIAS = {};
const rawAlias = (D.merge && D.merge.alias) || {};
Object.keys(rawAlias).forEach(k => { ALIAS[norm(k)] = norm(rawAlias[k]); });
function keyOf(name) {
  let k = norm(name);
  for (let i = 0; i < 5; i++) { const a = ALIAS[k]; if (!a || a === k) break; k = a; }
  return k;
}
const DISP = {};
Object.keys(D.display || {}).forEach(k => { DISP[norm(k)] = D.display[k]; });

/* ============================ 合并成总表 ============================ */
const SPOTS = [], byKey = new Map();
function regionName(r) { return String(r || '').replace(/[（(].*?[)）]/g, '').replace(/[区市]$/, '') || r; }

function slotFor(key, cardId, benefit, region) {
  const cands = byKey.get(key) || [];
  for (const s of cands) {
    const t = s.terms.find(x => x.card === cardId);
    if (!t) return s;
    if (t.benefit === benefit) return s;
  }
  return null;   // 需要另起一行
}

let zxSeq = 0;
CARDS.forEach(card => {
  (CAT[card.id] || []).forEach(g => g.d.forEach(it => {
    const key = keyOf(it.name);
    const ben = it.benefit || '';
    let sp = slotFor(key, card.id, ben, g.r);
    if (!sp) {
      sp = { key: key, name: it.name, region: regionName(g.r), level: it.level || '',
             isNew: it.isNew ? 1 : 0, terms: [], seq: zxSeq++ };
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(sp);
      SPOTS.push(sp);
    }
    sp.terms.push({ card: card.id, n: it.n || null, price: it.price, benefit: ben,
                    dates: it.dates || '', note: it.note || '', p: it.p || 'U', zt: it.zt ? 1 : 0 });
    if (!sp.level && it.level) sp.level = it.level;
    if (it.isNew) sp.isNew = 1;
  }));
});

const KID2 = new Set((D.kid2 || []).map(keyOf));
const KID0 = new Set((D.kid0 || []).map(keyOf));
const PRANK = { A: 0, B: 1, C: 2, D: 3, U: 4, N: 5 };
SPOTS.forEach((sp, i) => {
  sp.i = i;
  sp.cards = [];
  sp.terms.forEach(t => { if (sp.cards.indexOf(t.card) < 0) sp.cards.push(t.card); });
  sp.multi = sp.cards.length > 1;
  const jt = sp.terms.find(t => t.card === 'jp' && t.n);
  sp.ord = jt ? jt.n : 9000 + sp.seq;
  sp.p = sp.terms.reduce((a, t) => (PRANK[t.p] < PRANK[a] ? t.p : a), 'N');
  sp.kid = KID2.has(sp.key) ? 2 : KID0.has(sp.key) ? 0 : 1;
  sp.name = DISP[sp.key] || sp.name;
  sp.levels = sp.terms.map(t => t.price).filter(v => v !== '' && v != null);
  sp.samePrice = sp.levels.length ? sp.levels.every(v => String(v) === String(sp.levels[0])) : true;
});
/* 同地区内按精品版序号（无则排后）排序；regionOrder 里未登记的地区自动补在最后 */
const REGIONS = [], seenR = new Set();
REGION_ORDER.forEach(r => {
  const list = SPOTS.filter(s => s.region === r).sort((a, b) => a.ord - b.ord);
  if (list.length) { REGIONS.push({ r: r, d: list }); seenR.add(r); }
});
SPOTS.forEach(s => {
  if (seenR.has(s.region)) return;
  seenR.add(s.region);
  REGIONS.push({ r: s.region, d: SPOTS.filter(x => x.region === s.region).sort((a, b) => a.ord - b.ord) });
});

/* ============================ 坐标 ============================ */
const CENTER = D.centers || {};
const NO_MAP = D.noMap || [];
const PIN = {};
Object.keys(D.pins || {}).forEach(k => { PIN[norm(k)] = D.pins[k]; });
const GOLD = 2.399963229728653;
REGIONS.forEach(g => {
  const c = CENTER[g.r] || [39.90, 116.40];
  const cnt = g.d.length;
  g.d.forEach((x, i) => {
    const p = PIN[norm(x.name)] || PIN[x.key];
    if (p) { x.lat = p[0]; x.lng = p[1]; return; }
    const r = 0.015 + 0.05 * Math.sqrt((i + 0.6) / cnt);
    const a = i * GOLD;
    x.lat = c[0] + r * Math.sin(a);
    x.lng = c[1] + r * Math.cos(a) / 0.78;
  });
});

/* ============================ 日期 ============================ */
const RAD = Math.PI / 180;
const DRANGE = /(\d{4})\.(\d{1,2})\.(\d{1,2})\s*[-~]\s*(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2})/g;
function parseRanges(s) {
  const out = []; let m; DRANGE.lastIndex = 0;
  while ((m = DRANGE.exec(String(s || ''))) !== null) {
    const y2 = m[4] ? +m[4] : +m[1];
    out.push([Date.UTC(+m[1], +m[2] - 1, +m[3]), Date.UTC(y2, +m[5] - 1, +m[6])]);
  }
  return out;
}
const toUTC = s => { const p = String(s).split('.').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); };
const PWIN = {};
const srcW = META.pwin || { A: ['2026.9.24', '2026.10.7'], B: ['2026.9.24', '2026.9.30'], C: ['2026.10.1', '2026.10.7'] };
Object.keys(srcW).forEach(k => { PWIN[k] = srcW[k].map(toUTC); });
function isect(a, b) {
  const out = [];
  a.forEach(p => b.forEach(q => { const s = Math.max(p[0], q[0]), e = Math.min(p[1], q[1]); if (s <= e) out.push([s, e]); }));
  return out;
}
const fmt = ms => { const d = new Date(ms); return d.getUTCFullYear() + '.' + (d.getUTCMonth() + 1) + '.' + d.getUTCDate(); };
function dist(a, b) {
  const dLat = (a.lat - b.lat) * RAD, dLng = (a.lng - b.lng) * RAD;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
}

/* ============================ 常量 / 文案 ============================ */
const TAG = {
  A: ['t-a', '9.24–10.7 可用'], B: ['t-b', '仅 9.24–9.30 可用'], C: ['t-c', '仅 10.1–10.7 可用'],
  D: ['t-d', '部分日期可用'], N: ['t-n', '该时段不可用'], U: ['t-u', '时间未提及']
};
const KIDTXT = { 2: '🧒 亲子', 1: '👨‍👩‍👧 家庭', 0: '' };
const KIDNAME = { 2: '亲子专属', 1: '家庭友好', 0: '非亲子/成人向' };
function benClass(b) {
  b = b || '';
  if (/不限次/.test(b)) return 'p-unl';
  if (/优惠|特价|限\d+次|折扣/.test(b)) return 'p-disc';
  if (/^免|选1/.test(b)) return 'p-free';
  return 'p-free';
}
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ============================ DOM ============================ */
const tb = document.getElementById('tb');
const qEl = document.getElementById('q');
const cEl = document.getElementById('card');
const rEl = document.getElementById('region');
const bEl = document.getElementById('benefit');
const kEl = document.getElementById('kid');
const shownEl = document.getElementById('shown');
const emptyEl = document.getElementById('empty');
function setTxt(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

let period = '', cardSel = 'all';
let mode = 'W', kidOnly = true;
let selI = null, recI = [], visible = [], visibleN = new Set();

/* 卡种下拉 */
cEl.innerHTML = [['all', '全部卡（合并）']].concat(CARDS.map(c => [c.id, c.name + '（含两卡共有）']))
  .concat([['both', '仅两卡共有']])
  .map(o => `<option value="${o[0]}">${o[1]}</option>`).join('');
/* 地区下拉 */
rEl.innerHTML = '<option value="">全部地区</option>' +
  REGIONS.map(g => `<option value="${esc(g.r)}">${esc(g.r)}（${g.d.length}）</option>`).join('');
/* 权益下拉（由数据汇总） */
const BENS = [];
SPOTS.forEach(s => s.terms.forEach(t => { if (t.benefit && BENS.indexOf(t.benefit) < 0) BENS.push(t.benefit); }));
BENS.sort((a, b) => a.localeCompare(b, 'zh'));
bEl.innerHTML = '<option value="">全部权益</option>' + BENS.map(b => `<option>${esc(b)}</option>`).join('');

/* ============================ 顶部统计 ============================ */
function fillStats() {
  const cnt = k => SPOTS.filter(x => x.p === k).length;
  const k2 = SPOTS.filter(x => x.kid === 2).length, k0 = SPOTS.filter(x => x.kid === 0).length;
  const both = SPOTS.filter(x => x.cards.length > 1).length;
  const jp = SPOTS.filter(x => x.cards.indexOf('jp') >= 0).length;
  const zx = SPOTS.filter(x => x.cards.indexOf('zx') >= 0).length;
  setTxt('st-total', SPOTS.length); setTxt('st-region', REGIONS.length);
  setTxt('st-avail', cnt('A') + cnt('B') + cnt('C') + cnt('D'));
  setTxt('st-a', cnt('A')); setTxt('st-b', cnt('B')); setTxt('st-c', cnt('C'));
  setTxt('st-n', cnt('N')); setTxt('st-u', cnt('U'));
  setTxt('st-kidall', SPOTS.length - k0); setTxt('st-kid2', k2);
  setTxt('st-kid2c', k2); setTxt('st-kid2d', k2); setTxt('st-kid1c', SPOTS.length - k2 - k0); setTxt('st-kid0c', k0);
  setTxt('st-both', both); setTxt('st-jp', jp); setTxt('st-zx', zx);
  setTxt('st-summary', '共 ' + SPOTS.length + ' 个景区（精品版 ' + jp + ' · 臻选版 ' + zx +
    ' · 两卡共有 ' + both + '）· 按 ' + REGIONS.length + ' 个地区分区 · 含门票价格、持卡权益、接待时间及预约要求');
  setTxt('st-title', META.title || '景区目录');
  const cb = document.getElementById('st-cards');
  if (cb) cb.innerHTML = CARDS.map(c => `<i class="ct ct-${c.id}">${c.name}</i>`).join('');
}

/* ============================ 渲染 ============================ */
function cidLabel(cid) { const c = CARD[cid] || { name: cid, abbr: cid }; return c; }
function termLine(sp, t) {
  const [tc, tt] = TAG[t.p] || TAG.U;
  const card = cidLabel(t.card);
  const tag = sp.multi ? `<span class="ctag ct-${t.card}">${card.name}</span>` : '';
  const note = t.note ? `<span class="note">${esc(t.note)}</span>`
    : (/^[ABCD]$/.test(t.p) ? `<span class="note">未注明需预约，持卡可直接前往。</span>` : '');
  return `<div class="tline">${tag}<span class="tag ${tc}">${tt}</span>` +
    `<span class="date">${esc(t.dates || '—')}</span>` + (t.zt ? '<span class="badge b-zt">专属</span>' : '') + note + '</div>';
}
function priceCell(sp) {
  const one = v => esc(v === '' || v == null ? '—' : v);
  if (!sp.multi) return one(sp.terms[0].price);
  return '<div class="plines">' + sp.terms.map(t => {
    const c = cidLabel(t.card);
    return `<span class="pl"><i class="ct ct-${t.card}">${c.abbr}</i>${one(t.price)}</span>`;
  }).join('') + '</div>';
}
function benCell(sp) {
  return '<div class="blines">' + sp.terms.map(t => {
    const c = cidLabel(t.card);
    const pre = sp.multi ? `<i class="ct ct-${t.card}">${c.abbr}</i>` : '';
    return `<span class="bl">${pre}<span class="pill ${benClass(t.benefit)}">${esc(t.benefit || '—')}</span></span>`;
  }).join('') + '</div>';
}
function cardCell(sp) {
  const chips = sp.cards.map(cid => {
    const c = cidLabel(cid);
    return `<i class="ct ct-${cid}" title="${esc(c.name)}">${c.name}</i>`;
  }).join('');
  const jt = sp.terms.find(t => t.card === 'jp' && t.n);
  return chips + (jt ? `<em class="ordno">精品版 #${jt.n}</em>` : '');
}

function render() {
  const kw = qEl.value.trim().toLowerCase();
  const rg = rEl.value, bn = bEl.value, kd = kEl.value;
  const filter = x => {
    if (kw && !(x.name.toLowerCase().includes(kw) || x.terms.some(t => (t.note || '').toLowerCase().includes(kw)))) return false;
    if (rg && x.region !== rg) return false;
    if (bn && !x.terms.some(t => t.benefit === bn)) return false;
    if (kd === '2' && x.kid !== 2) return false;
    if (kd === '1' && x.kid < 1) return false;
    if (kd === 'n2' && x.kid === 2) return false;        // 非亲子 = 除亲子专属外的全部
    if (kd === '0' && x.kid !== 0) return false;
    if (cardSel === 'both' && x.cards.length < 2) return false;
    if (cardSel !== 'all' && cardSel !== 'both' && x.cards.indexOf(cardSel) < 0) return false;
    if (period && !x.terms.some(t => t.p === period)) return false;   // 任一张卡满足即算满足
    return true;
  };
  let html = '', total = 0;
  visible = []; visibleN = new Set();
  REGIONS.forEach(g => {
    const list = g.d.filter(filter);
    if (!list.length) return;
    total += list.length;
    list.forEach(x => { visible.push(x); visibleN.add(x.i); });
    const cj = list.filter(x => x.cards.indexOf('jp') >= 0).length;
    const cz = list.filter(x => x.cards.indexOf('zx') >= 0).length;
    html += `<tr class="region"><td colspan="5">${esc(g.r)}` +
      `<span class="rcount">共 ${list.length} 个 · 精品版 ${cj} · 臻选版 ${cz}</span></td></tr>`;
    list.forEach(x => {
      const lv = x.level ? `<span class="badge b-level">${x.level}</span>` : '';
      const nw = x.isNew ? `<span class="badge b-new">新增</span>` : '';
      const kb = x.kid === 2 ? `<span class="badge b-kid">${KIDTXT[2]}</span>`
        : x.kid === 1 ? `<span class="badge b-fam">${KIDTXT[1]}</span>` : '';
      const cls = x.i === selI ? 'item sel' : recI.indexOf(x.i) >= 0 ? 'item rec-pick' : 'item';
      html += `<tr class="${cls}" data-i="${x.i}">
        <td class="card">${cardCell(x)}</td>
        <td class="name"><span class="nm">${esc(x.name)}</span>${lv}${nw}${kb}</td>
        <td class="price">${priceCell(x)}</td>
        <td class="benefit">${benCell(x)}</td>
        <td class="info">${x.terms.map(t => termLine(x, t)).join('')}</td>
      </tr>`;
    });
  });
  tb.innerHTML = html;
  shownEl.textContent = total;
  setTxt('shown-all', SPOTS.length);
  emptyEl.style.display = total ? 'none' : 'block';
  const s = selI != null ? SPOTS[selI] : null;
  if (s) { paintRows(); recommend(s); } else { recI = []; paintRows(); syncMap(); }
}
function paintRows() {
  tb.querySelectorAll('tr.item').forEach(tr => {
    const n = +tr.dataset.i;
    tr.className = 'item' + (n === selI ? ' sel' : recI.indexOf(n) >= 0 ? ' rec-pick' : '');
  });
}

/* ============================ 一日联玩推荐 ============================ */
function winOf(sp) {                       // 当前模式下该景区可用的日期（两卡合并）
  let out = [];
  sp.terms.forEach(t => {
    let s = parseRanges(t.dates);
    if (!s.length) return;
    if (mode === 'W') { const p = PWIN[t.p]; if (!p) return; s = isect(s, [p]); }
    out = out.concat(s);
  });
  return out;
}
function cardAvail(sp) {                   // 各卡在当前模式下是否可用
  return sp.terms.map(t => {
    let ok = false;
    if (mode === 'W') ok = !!PWIN[t.p] && parseRanges(t.dates).length > 0;
    else ok = parseRanges(t.dates).length > 0;
    return { card: t.card, ok: ok, p: t.p };
  });
}
function tiers(d) { return d <= 15 ? '顺路，可同日串联' : d <= 40 ? '建议自驾，半日车程内' : '距离较远，需早起或分天'; }
function flagOf(sp) {
  const nt = sp.terms.map(t => t.note || '').join(' '), bs = sp.terms.map(t => t.benefit || '').join(' ');
  let s = '';
  if (/预约/.test(nt)) s += '<span class="mini m-book">需预约</span>';
  if (/自付|补|保险费|卫生费|缴费|半价|优惠价|特惠/.test(nt) || /优惠|特价|限\d+次/.test(bs)) s += '<span class="mini m-pay">需补费</span>';
  if (!s) s = '<span class="mini m-ok">持卡直接前往</span>';
  return s;
}
function kidLabel(sp) { return '<span class="kidflag' + (sp.kid === 0 ? ' no' : '') + '">' + KIDNAME[sp.kid] + '</span>'; }
function bindReco() {
  document.querySelectorAll('#reco .modes button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.m;
    document.querySelectorAll('#reco .modes button').forEach(o => o.classList.toggle('on', o.dataset.m === mode));
    const s = selI != null ? SPOTS[selI] : null; if (s) recommend(s);
  }));
  const cb = document.getElementById('kidonly');
  if (cb) cb.addEventListener('change', () => { kidOnly = cb.checked; const s = selI != null ? SPOTS[selI] : null; if (s) recommend(s); });
}
function recommend(sel) {
  const box = document.getElementById('reco');
  const head = '<h3>🎯 一日联玩推荐</h3><div class="modes">' +
    '<button class="' + (mode === 'W' ? 'on' : '') + '" data-m="W">9.24–10.7 期间</button>' +
    '<button class="' + (mode === 'A' ? 'on' : '') + '" data-m="A">整个年卡有效期</button></div>' +
    '<label class="kidsw"><input type="checkbox" id="kidonly"' + (kidOnly ? ' checked' : '') +
    '> 只推荐 <b>亲子 / 儿童友好</b> 项目（排除文博、温泉、长城攀爬、漂流等成人向景区）</label>';

  const sw = winOf(sel);
  const cardsTxt = sel.cards.map(c => cidLabel(c).name).join(' + ');
  if (!sw.length) {
    recI = [];
    box.innerHTML = head + '<div class="selname">已选：<b>' + esc(sel.name) + '</b>（' + esc(sel.region) +
      '｜' + cardsTxt + '）' + kidLabel(sel) + '</div>' +
      '<div class="rec-empty">该景区在所选时段内不可使用（或原文未给出接待时间），无法给出联玩组合。</div>';
    bindReco(); paintRows(); syncMap(); return;
  }
  const pool = visibleN.size ? visible : SPOTS;
  const cands = pool.map(t => {
    if (t.i === sel.i) return null;
    if (kidOnly && t.kid === 0) return null;
    const w = winOf(t);
    if (!w.length) return null;
    const com = isect(sw, w);
    if (!com.length) return null;
    return { t: t, d: dist(sel, t), com: com };
  }).filter(Boolean).sort((a, b) => a.d - b.d);

  let picks = cands.filter(c => c.d <= 40).slice(0, 3);
  let broad = false;
  if (picks.length < 2) { picks = cands.slice(0, 3); broad = true; }
  recI = picks.map(c => c.t.i);

  let common = sw;
  picks.forEach(c => { common = isect(common, c.com); });
  const cw = common.length ? fmt(common[0][0]) + ' – ' + fmt(common[0][1]) : '无完全重合时段';

  let html = head + '<div class="selname">已选：<b>' + esc(sel.name) + '</b>（' + esc(sel.region) +
    '｜' + esc(cardsTxt) + '）' + kidLabel(sel) + '</div>';
  html += '<div class="rec-sum">可同日联玩 <b>' + picks.length + '</b> 个景点' +
    (kidOnly ? '（已限定<b>亲子 / 儿童友好</b>项目）' : '') +
    (broad ? '（附近 40km 内不足 2 个，已放宽范围）' : '') +
    '<br>共同可用日期：<b>' + cw + '</b></div>';
  if (!picks.length) {
    html += '<div class="rec-empty">没有接待时间重合、可同日游玩的搭配。</div>';
  } else {
    picks.forEach((c, i) => {
      const t = c.t;
      const chips = t.cards.map(cid => '<i class="ct ct-' + cid + '">' + cidLabel(cid).name + '</i>').join('');
      const av = cardAvail(t).map(a => '<span class="av ' + (a.ok ? 'ok' : 'no') + '">' +
        cidLabel(a.card).name + (a.ok ? ' ✓' : ' ✕') + '</span>').join('');
      html += '<div class="rec-card" data-i="' + t.i + '">' +
        '<div class="rt"><span class="rk">搭配 ' + (i + 1) + '</span><span class="rn">' + esc(t.name) + '</span>' +
        (t.level ? '<span class="badge b-level">' + t.level + '</span>' : '') +
        (t.kid === 2 ? '<span class="badge b-kid">' + KIDTXT[2] + '</span>'
          : t.kid === 1 ? '<span class="badge b-fam">' + KIDTXT[1] + '</span>' : '') +
        '<span class="rd">直线约 ' + c.d + ' km · ' + tiers(c.d) + '</span></div>' +
        '<div class="rl">' + chips + av + '</div>' +
        '<div class="rl">可用日期：<b>' + c.com.map(r => fmt(r[0]) + '–' + fmt(r[1])).join('；') + '</b>　' +
        esc(t.terms.map(x => x.benefit + (x.price !== '' ? '（门票 ' + x.price + ' 元）' : '')).join(' / ')) + flagOf(t) + '</div>' +
        (t.terms.map(x => x.note).filter(Boolean).length ? '<div class="rl">' + esc(t.terms.map(x => x.note).filter(Boolean).join('｜')) + '</div>' : '') +
        '</div>';
    });
    html += '<div class="rec-empty">距离为按区县定位的直线估算，仅供参考；出发前请与景区电话确认。</div>';
  }
  box.innerHTML = html;
  bindReco();
  box.querySelectorAll('.rec-card').forEach(el => el.addEventListener('click', () => select(+el.dataset.i, true)));
  paintRows();
  syncMap();
}
function select(i, scroll) {
  selI = i;
  render();
  if (scroll) {
    const row = document.querySelector('tr.item[data-i="' + i + '"]');
    if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/* ============================ 地图 ============================ */
let map, markerLayer, lineLayer;
const ICON = c => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">' +
  '<path d="M14 0C6.3 0 0 6.3 0 14c0 10 14 22 14 22s14-12 14-22C28 6.3 21.7 0 14 0z" fill="' + c +
  '" stroke="#ffffff" stroke-width="2"/><circle cx="14" cy="14" r="5.2" fill="#fff"/></svg>');
function initMap() {
  const el = document.getElementById('map');
  if (typeof TMap === 'undefined') {
    el.innerHTML = '<div style="padding:24px;color:#999;font-size:13px;line-height:1.8">地图组件未加载（当前环境无法访问地图服务）。<br>右侧景区列表与"一日联玩推荐"功能不受影响。</div>';
    return;
  }
  map = new TMap.Map(el, { zoom: 8, center: new TMap.LatLng(39.90, 116.90) });
  markerLayer = new TMap.MultiMarker({
    map, styles: {
      n: new TMap.MarkerStyle({ width: 24, height: 31, src: ICON('#2b7de9'), anchor: { x: 12, y: 31 } }),
      z: new TMap.MarkerStyle({ width: 24, height: 31, src: ICON('#e8842f'), anchor: { x: 12, y: 31 } }),
      g: new TMap.MarkerStyle({ width: 24, height: 31, src: ICON('#b9bcc4'), anchor: { x: 12, y: 31 } }),
      s: new TMap.MarkerStyle({ width: 32, height: 41, src: ICON('#e8484f'), anchor: { x: 16, y: 41 } }),
      r: new TMap.MarkerStyle({ width: 28, height: 36, src: ICON('#2fa84f'), anchor: { x: 14, y: 36 } })
    }, geometries: []
  });
  lineLayer = new TMap.MultiPolyline({
    map, styles: { l: new TMap.PolylineStyle({ color: '#e8484f', width: 4, borderWidth: 2, borderColor: '#ffffff', lineCap: 'round' }) },
    geometries: []
  });
  markerLayer.on('click', e => { if (e && e.geometry) select(+e.geometry.id, true); });
  syncMap();
}
function mappable(x) { return NO_MAP.indexOf(x.region) < 0; }
function syncMap() {
  if (!map || !markerLayer) return;
  const rec = new Set(recI);
  const sel = selI != null ? SPOTS[selI] : null;
  const pts = visible.filter(mappable);
  if (sel && mappable(sel) && visibleN.has(sel.i) === false) pts.push(sel);
  markerLayer.setGeometries(pts.map(x => ({
    id: String(x.i),
    styleId: x.i === selI ? 's' : rec.has(x.i) ? 'r'
      : (x.p === 'N' || x.p === 'U') ? 'g' : (x.cards.length > 1 ? 'n' : 'z'),
    position: new TMap.LatLng(x.lat, x.lng)
  })));
  if (!sel || !mappable(sel)) { lineLayer.setGeometries([]); return; }
  lineLayer.setGeometries(recI.map(n => {
    const t = SPOTS[n];
    return t ? { id: 'L' + n, styleId: 'l', paths: [new TMap.LatLng(sel.lat, sel.lng), new TMap.LatLng(t.lat, t.lng)] } : null;
  }).filter(Boolean));
  fitTo([sel].concat(recI.map(n => SPOTS[n])).filter(Boolean));
}
function fitTo(items) {
  if (!items.length) return;
  try {
    const b = new TMap.LatLngBounds();
    items.forEach(x => b.extend(new TMap.LatLng(x.lat, x.lng)));
    map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 60, right: 60 } });
  } catch (e) {
    try { map.setCenter(new TMap.LatLng(items[0].lat, items[0].lng)); map.setZoom(11); } catch (_) { }
  }
}

/* ============================ 事件 ============================ */
tb.addEventListener('click', e => { const tr = e.target.closest('tr.item'); if (tr) select(+tr.dataset.i, false); });
document.querySelectorAll('#chips .chip').forEach(c => c.addEventListener('click', () => {
  document.querySelectorAll('#chips .chip').forEach(o => o.classList.remove('on'));
  c.classList.add('on'); period = c.dataset.p; render();
}));
qEl.addEventListener('input', render);
cEl.addEventListener('change', () => { cardSel = cEl.value; render(); });
rEl.addEventListener('change', render);
bEl.addEventListener('change', render);
kEl.addEventListener('change', render);
bindReco();
fillStats();
render();
initMap();
