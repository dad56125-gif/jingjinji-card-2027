/* ============================================================================
 * core.js —— 数据与算法层（完全不碰 DOM）
 *
 *   载入 data.js / data-jp.js / data-zx.js 后，把两张卡合并成"一个景区一行"，
 *   并提供：筛选、接待时间/可用性解析、直线距离、一日联玩推荐、统计。
 *
 *   合并规则（想修正误合、漏合，改 data.js 的 merge.alias 即可）：
 *     1. 名称归一化（去【新增】、去等级、去括号、去常见地理后缀）得到"归并键"
 *     2. 同键视为同一景区，把各卡的权益、门票、接待时间挂在同一行
 *     3. 同一张卡里同名但权益不同的另起一行
 *
 *   对外接口统一挂在 window.CORE，UI 层（app.js）只消费、不重实现。
 * ==========================================================================*/
(function () {
  'use strict';

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

  function slotFor(key, cardId, benefit) {
    const cands = byKey.get(key) || [];
    for (const s of cands) {
      const t = s.terms.find(x => x.card === cardId);
      if (!t) return s;                      // 这张卡还没挂到该行 → 复用
      if (t.benefit === benefit) return s;   // 同卡同权益 → 复用
    }
    return null;                             // 同卡但权益不同 → 另起一行
  }

  let seq = 0;
  CARDS.forEach(card => {
    (CAT[card.id] || []).forEach(g => g.d.forEach(it => {
      const key = keyOf(it.name);
      const ben = it.benefit || '';
      let sp = slotFor(key, card.id, ben);
      if (!sp) {
        sp = { key: key, name: it.name, region: regionName(g.r), regionRaw: g.r,
               level: it.level || '', isNew: it.isNew ? 1 : 0, terms: [], seq: seq++ };
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
    sp.prices = sp.terms.map(t => t.price).filter(v => v !== '' && v != null);
    sp.samePrice = sp.prices.length ? sp.prices.every(v => String(v) === String(sp.prices[0])) : true;
    sp.minPrice = sp.prices.length ? Math.min.apply(null, sp.prices.map(Number).filter(v => !isNaN(v))) : null;
  });

  /* 同地区内按精品版序号（无则排后）排序；regionOrder 未登记的地区自动补在最后 */
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
  const REGION_INDEX = {};
  REGIONS.forEach(g => g.d.forEach(x => { REGION_INDEX[x.i] = g.r; }));

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
  function mappable(x) { return NO_MAP.indexOf(x.region) < 0; }

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
  const HOLIDAY = (META.holidays || []).map(h => [toUTC(h[0]), toUTC(h[1])]);
  function isect(a, b) {
    const out = [];
    a.forEach(p => b.forEach(q => { const s = Math.max(p[0], q[0]), e = Math.min(p[1], q[1]); if (s <= e) out.push([s, e]); }));
    return out;
  }
  const fmt = ms => { const d = new Date(ms); return d.getUTCFullYear() + '.' + (d.getUTCMonth() + 1) + '.' + d.getUTCDate(); };
  function todayUTC() { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); }
  function inHoliday(t) { return HOLIDAY.some(h => t >= h[0] && t <= h[1]); }
  function dist(a, b) {
    const dLat = (a.lat - b.lat) * RAD, dLng = (a.lng - b.lng) * RAD;
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return Math.round(2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
  }

  /* ============================ 文案 / 分类 ============================ */
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
    return 'p-free';
  }
  function benKind(b) {
    b = b || '';
    if (/不限次/.test(b)) return 'unl';
    if (/优惠|特价|折扣/.test(b)) return 'disc';
    return 'free';
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* 权益类型汇总（供筛选胶囊用） */
  const BENS = [];
  SPOTS.forEach(s => s.terms.forEach(t => { if (t.benefit && BENS.indexOf(t.benefit) < 0) BENS.push(t.benefit); }));
  BENS.sort((a, b) => a.localeCompare(b, 'zh'));

  /* ============================ 取用工具 ============================ */
  function cidLabel(cid) { return CARD[cid] || { name: cid, abbr: cid }; }
  /* 指定卡的条目；该卡未收录则返回第一条并标记 */
  function termOf(sp, cardId) {
    const t = sp.terms.find(x => x.card === cardId);
    return t ? { t: t, onCard: true } : { t: sp.terms[0], onCard: false };
  }
  /* 各卡在当前模式下是否可用 */
  function cardAvail(sp, mode) {
    return sp.terms.map(t => {
      const ok = mode === 'W' ? (!!PWIN[t.p] && parseRanges(t.dates).length > 0) : parseRanges(t.dates).length > 0;
      return { card: t.card, ok: ok, p: t.p };
    });
  }
  /* 当前模式下该景区可用的日期区间（两卡合并） */
  function winOf(sp, mode) {
    let out = [];
    sp.terms.forEach(t => {
      let s = parseRanges(t.dates);
      if (!s.length) return;
      if (mode === 'W') { const p = PWIN[t.p]; if (!p) return; s = isect(s, [p]); }
      out = out.concat(s);
    });
    return out;
  }
  /* 今天能不能用（按指定卡） */
  function availNow(sp, cardId) {
    const r = termOf(sp, cardId), t = r.t;
    if (!r.onCard) return { st: 'no-card', text: cidLabel(cardId).name + '未收录', ok: false };
    const rng = parseRanges(t.dates);
    if (!rng.length) return { st: 'unknown', text: '接待时间未提及', ok: null, term: t };
    const now = todayUTC();
    const hit = rng.find(x => now >= x[0] && now <= x[1]);
    if (!hit) {
      if (now < rng[0][0]) return { st: 'before', text: '未到接待期', ok: false, term: t };
      return { st: 'after', text: '已过接待期', ok: false, term: t };
    }
    if (/法定假期/.test(t.note || '') && inHoliday(now)) {
      return { st: 'holiday', text: '法定假期不可用', ok: false, term: t };
    }
    return { st: 'ok', text: '今日可用', ok: true, term: t };
  }
  function tiers(d) { return d <= 15 ? '顺路，可同日串联' : d <= 40 ? '建议自驾，半日车程内' : '距离较远，需早起或分天'; }
  function flagOf(sp) {
    const nt = sp.terms.map(t => t.note || '').join(' '), bs = sp.terms.map(t => t.benefit || '').join(' ');
    const out = [];
    if (/预约/.test(nt)) out.push({ k: 'book', t: '需预约' });
    if (/自付|补|保险费|卫生费|缴费|半价|优惠价|特惠/.test(nt) || /优惠|特价|限\d+次/.test(bs)) out.push({ k: 'pay', t: '需补费' });
    if (!out.length) out.push({ k: 'ok', t: '持卡直接前往' });
    return out;
  }

  /* ============================ 筛选 ============================ */
  /* c: { kw, region, benefit, kid, card, period, planned, used, inView }
     planned / used 走 window.STORE（软依赖，没载入时忽略） */
  function filterSpots(c) {
    c = c || {};
    const kw = String(c.kw || '').trim().toLowerCase();
    const rg = c.region || '', bn = c.benefit || '';
    const kd = c.kid == null ? '' : String(c.kid);
    const card = c.card || 'all', period = c.period || '';
    const S = window.STORE;
    return SPOTS.filter(x => {
      if (kw && !(x.name.toLowerCase().includes(kw) || x.terms.some(t => (t.note || '').toLowerCase().includes(kw)))) return false;
      if (rg && x.region !== rg) return false;
      if (bn && !x.terms.some(t => t.benefit === bn)) return false;
      if (kd === '2' && x.kid !== 2) return false;
      if (kd === '1' && x.kid < 1) return false;
      if (kd === 'n2' && x.kid === 2) return false;      // 非亲子 = 除亲子专属外的全部
      if (kd === '0' && x.kid !== 0) return false;
      if (card === 'both' && x.cards.length < 2) return false;
      if (card !== 'all' && card !== 'both' && x.cards.indexOf(card) < 0) return false;
      if (period && !x.terms.some(t => t.p === period)) return false;   // 任一张卡满足即算满足
      if (c.planned && !(S && S.isPlanned(x.key))) return false;
      if (c.used && !(S && S.usesOf(x.key).length)) return false;
      if (c.inView && !c.inView.has(x.i)) return false;
      return true;
    });
  }

  /* ============================ 一日联玩推荐 ============================ */
  function recommend(sel, pool, opts) {
    opts = opts || {};
    const mode = opts.mode || 'W', kidOnly = !!opts.kidOnly;
    const sw = winOf(sel, mode);
    if (!sw.length) return { ok: false, reason: 'no-window', picks: [], broad: false, commonText: '', common: [] };
    const cands = pool.filter(t => t.i !== sel.i && (!kidOnly || t.kid !== 0)).map(t => {
      const w = winOf(t, mode);
      if (!w.length) return null;
      const com = isect(sw, w);
      if (!com.length) return null;
      return { t: t, d: dist(sel, t), com: com };
    }).filter(Boolean).sort((a, b) => a.d - b.d);

    let picks = cands.filter(x => x.d <= 40).slice(0, 3), broad = false;
    if (picks.length < 2) { picks = cands.slice(0, 3); broad = true; }
    let common = sw;
    picks.forEach(x => { common = isect(common, x.com); });
    const commonText = common.length ? fmt(common[0][0]) + ' – ' + fmt(common[0][1]) : '无完全重合时段';
    return { ok: true, picks: picks, broad: broad, commonText: commonText, common: common, cands: cands };
  }

  /* ============================ 统计 ============================ */
  function stats() {
    const cnt = k => SPOTS.filter(x => x.p === k).length;
    const k2 = SPOTS.filter(x => x.kid === 2).length;
    const k0 = SPOTS.filter(x => x.kid === 0).length;
    const jp = SPOTS.filter(x => x.cards.indexOf('jp') >= 0).length;
    const zx = SPOTS.filter(x => x.cards.indexOf('zx') >= 0).length;
    const p = { A: cnt('A'), B: cnt('B'), C: cnt('C'), D: cnt('D'), N: cnt('N'), U: cnt('U') };
    return {
      total: SPOTS.length, regions: REGIONS.length, cards: CARDS.length,
      jp: jp, zx: zx, both: SPOTS.filter(x => x.cards.length > 1).length,
      p: p, avail: p.A + p.B + p.C + p.D,
      kid2: k2, kid1: SPOTS.length - k2 - k0, kid0: k0,
      bens: BENS, title: META.title || '景区目录'
    };
  }

  /* 视野内优先排序：给定可见序号集合，把视野内的排前面 */
  function sortInView(list, inView) {
    if (!inView || !inView.size) return list.slice();
    const a = list.filter(x => inView.has(x.i)), b = list.filter(x => !inView.has(x.i));
    return a.concat(b);
  }

  window.CORE = {
    /* 数据 */
    SPOTS: SPOTS, REGIONS: REGIONS, REGION_INDEX: REGION_INDEX, CARDS: CARDS, CARD: CARD,
    META: META, BENS: BENS, NO_MAP: NO_MAP, CENTER: CENTER,
    /* 工具 */
    norm: norm, keyOf: keyOf, regionName: regionName, cidLabel: cidLabel, termOf: termOf,
    parseRanges: parseRanges, isect: isect, fmt: fmt, dist: dist, esc: esc,
    TAG: TAG, KIDTXT: KIDTXT, KIDNAME: KIDNAME, PRANK: PRANK, PWIN: PWIN,
    benClass: benClass, benKind: benKind, flagOf: flagOf, tiers: tiers,
    /* 业务 */
    filterSpots: filterSpots, winOf: winOf, cardAvail: cardAvail, availNow: availNow,
    recommend: recommend, stats: stats, mappable: mappable, sortInView: sortInView,
    byKeyOf: function (key) { return byKey.get(key) || []; },
    todayUTC: todayUTC, inHoliday: inHoliday
  };
})();
