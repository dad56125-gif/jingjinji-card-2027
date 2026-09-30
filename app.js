/* ============================================================================
 * app.js —— UI 层：地图为底层，所有操作以悬浮卡片覆盖在地图上
 *
 *   第 1 层  地图（铺满可视区，始终最底）
 *   第 2 层  地图标记
 *   第 3 层  搜索 / 筛选胶囊 / 我的年卡入口 / 底部导航
 *   第 4 层  景区浮卡（桌面右下）、列表紧凑卡片
 *   第 5 层  完整详情、一日联玩、我的年卡统计
 *
 *   数据与算法全部来自 core.js（window.CORE），个人记录来自 store.js（window.STORE），
 *   本文件不含任何景区数据、也不重实现筛选/推荐规则。
 * ==========================================================================*/
(function () {
  'use strict';

  const C = window.CORE;
  const S = window.STORE;
  const esc = C.esc, TAG = C.TAG, KIDTXT = C.KIDTXT, KIDNAME = C.KIDNAME;
  const cidLabel = C.cidLabel, benClass = C.benClass, flagOf = C.flagOf, tiers = C.tiers, fmt = C.fmt;

  /* ============================ 状态 ============================ */
  const state = {
    tab: 'map',                 // map | list | plan | card
    kw: '', region: '', benefit: '', kid: '', card: 'all', period: '',
    planned: false, used: false, inViewOnly: false,
    mode: 'W', kidOnly: true,
    selI: null, recI: [],
    visible: [], visibleN: new Set(), inView: new Set(), inViewReady: false,
    limit: 60, expanded: {},
    snap: 1,                    // 移动端 Bottom Sheet：1 收起 / 2 半展开 / 3 接近全屏
    detailI: null
  };

  /* ============================ DOM ============================ */
  const $ = id => document.getElementById(id);
  const elMap = $('map'), elFallback = $('mapFallback'), elTop = $('hudTop');
  const elQ = $('q'), elQClear = $('qClear'), elPills = $('pills'), elEntry = $('cardEntry');
  const elFilterBtn = $('filterBtn'), elFilterDot = $('filterDot'), elPop = $('pop');
  const elNav = $('nav'), elPanel = $('panel'), elSpotCard = $('spotCard');
  const elSheet = $('sheet'), elSheetHandle = $('sheetHandle'), elSheetBody = $('sheetBody');
  const elDetail = $('detail'), elToast = $('toast');

  const mq = window.matchMedia ? window.matchMedia('(max-width: 899px)') : null;
  const isMobile = () => (mq ? mq.matches : window.innerWidth < 900);

  /* ============================ 小工具 ============================ */
  function sp(i) { return i == null ? null : C.SPOTS[i]; }
  function sel() { return sp(state.selI); }
  function myTerm(s) { return C.termOf(s, S.activeCard()); }
  function toast(msg) {
    if (!elToast) return;
    elToast.textContent = msg;
    elToast.hidden = false;
    elToast.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { elToast.classList.remove('on'); }, 1800);
  }
  function pTag(p) { const t = TAG[p] || TAG.U; return '<span class="tag ' + t[0] + '">' + t[1] + '</span>'; }
  function badges(s, opts) {
    opts = opts || {};
    let h = '';
    if (s.level) h += '<span class="badge b-level">' + esc(s.level) + '</span>';
    if (s.isNew) h += '<span class="badge b-new">新增</span>';
    if (s.kid === 2) h += '<span class="badge b-kid">' + KIDTXT[2] + '</span>';
    else if (s.kid === 1 && opts.fam) h += '<span class="badge b-fam">' + KIDTXT[1] + '</span>';
    if (s.cards.length > 1) h += '<span class="badge b-both">两卡</span>';
    return h;
  }
  function ctChips(s) {
    return s.cards.map(id => {
      const c = cidLabel(id);
      return '<i class="ct ct-' + id + '">' + esc(c.name) + '</i>';
    }).join('');
  }
  function nowChip(s) {
    const a = C.availNow(s, S.activeCard());
    const cls = a.ok === true ? 'ok' : a.ok === false ? 'no' : 'unk';
    return '<span class="st st-' + cls + '">' + esc(a.text) + '</span>';
  }
  function flagChips(s) {
    return flagOf(s).map(f => '<span class="mini m-' + f.k + '">' + esc(f.t) + '</span>').join('');
  }
  function planStar(s) { return S.isPlanned(s.key) ? '★' : '☆'; }
  function priceText(t) { return t.price === '' || t.price == null ? '—' : t.price; }
  function myPrice(s) {
    const r = myTerm(s);
    return r.onCard ? priceText(r.t) : '—';
  }

  /* ============================ 顶部：搜索 + 筛选胶囊 ============================ */
  const PILL_DEF = [
    { k: 'card', name: '卡种', def: 'all' },
    { k: 'region', name: '地区', def: '' },
    { k: 'benefit', name: '权益', def: '' },
    { k: 'kid', name: '亲子', def: '' },
    { k: 'period', name: '可用', def: '' },
    { k: 'more', name: '更多', def: '' }
  ];
  const CARDVAL = { all: '全部卡', jp: '精品版', zx: '臻选版', both: '仅两卡共有' };
  const KIDVAL = { '': '全部', '1': '亲子友好', '2': '亲子专属', 'n2': '非亲子专属', '0': '仅非亲子' };
  const PVAL = { '': '全部时段', A: '9.24–10.7 可用', B: '仅 9.24–9.30', C: '仅 10.1–10.7', D: '部分日期', N: '该时段不可用', U: '时间未提及' };

  function pillValue(k) {
    if (k === 'card') return CARDVAL[state.card] || '全部卡';
    if (k === 'region') return state.region || '全部地区';
    if (k === 'benefit') return state.benefit || '全部权益';
    if (k === 'kid') return KIDVAL[state.kid] || '全部';
    if (k === 'period') return PVAL[state.period] || '全部时段';
    return moreActive() ? '已设条件' : '更多';
  }
  function pillOn(k) {
    if (k === 'card') return state.card !== 'all';
    if (k === 'region') return !!state.region;
    if (k === 'benefit') return !!state.benefit;
    if (k === 'kid') return !!state.kid;
    if (k === 'period') return !!state.period;
    return moreActive();
  }
  function moreActive() { return state.planned || state.used || state.inViewOnly; }
  function anyFilter() {
    return state.kw || state.region || state.benefit || state.kid || state.period ||
      state.card !== 'all' || moreActive();
  }

  function renderPills() {
    if (!elPills) return;
    elPills.innerHTML = PILL_DEF.map(p => {
      const v = pillValue(p.k);
      const on = pillOn(p.k) ? ' on' : '';
      const dot = p.k === 'more' && moreActive() ? '<i class="pdot"></i>' : '';
      return '<button type="button" class="glass pill' + on + '" data-act="pill" data-pill="' + p.k + '">' +
        '<span class="pk">' + p.name + '</span><span class="pv">' + esc(v) + '</span>' + dot + '</button>';
    }).join('') + (anyFilter() ? '<button type="button" class="glass pill ghost" data-act="clearfilters">清空</button>' : '');
    if (elFilterDot) elFilterDot.hidden = !anyFilter();
  }

  function renderCardEntry() {
    if (!elEntry) return;
    const id = S.activeCard(), c = cidLabel(id), t = S.totals(id);
    const pct = Math.round(t.progress * 100);
    elEntry.innerHTML =
      '<span class="ce-ring" style="--p:' + pct + '"><b>' + (t.set ? pct + '%' : '—') + '</b></span>' +
      '<span class="ce-txt"><span class="ce-k">我的年卡</span>' +
      '<span class="ce-v">' + esc(c.name) + (t.set ? ' · 已回本 ' + pct + '%' : ' · 未设卡价') + '</span></span>';
  }

  /* ============================ 浮层（筛选 / 更多） ============================ */
  function closePop() { if (elPop) { elPop.hidden = true; elPop.innerHTML = ''; elPop.dataset.for = ''; } }
  function openPop(anchor, html, key) {
    if (!elPop) return;
    if (!elPop.hidden && elPop.dataset.for === key) { closePop(); return; }
    elPop.dataset.for = key || '';
    elPop.innerHTML = html;
    elPop.hidden = false;
    placePop(anchor);
  }
  function placePop(anchor) {
    if (!elPop) return;
    let r = null;
    if (anchor && typeof anchor.getBoundingClientRect === 'function') r = anchor.getBoundingClientRect();
    if (!r) r = { bottom: 64, left: 20 };          // 拿不到锚点（已卸载/合成事件）时退化为左上位置
    if (isMobile()) {
      const hr = elTop ? elTop.getBoundingClientRect() : { bottom: 64 };
      elPop.style.left = '14px'; elPop.style.right = '14px';
      elPop.style.top = Math.round(hr.bottom + 8) + 'px';
      elPop.style.bottom = 'auto'; elPop.style.maxHeight = '58vh';
    } else {
      const w = elPop.offsetWidth || 280;
      let left = r.left;
      left = Math.max(16, Math.min(left, (window.innerWidth || 1200) - w - 16));
      elPop.style.left = Math.round(left) + 'px';
      elPop.style.right = 'auto';
      elPop.style.top = Math.round(r.bottom + 10) + 'px';
      elPop.style.bottom = 'auto';
      elPop.style.maxHeight = Math.round((window.innerHeight || 800) - r.bottom - 40) + 'px';
    }
  }
  function optRow(label, on, attrs, hint) {
    return '<button type="button" class="opt' + (on ? ' on' : '') + '" ' + attrs + '>' +
      '<span class="ol">' + esc(label) + '</span>' +
      (hint ? '<span class="oh">' + esc(hint) + '</span>' : '') +
      (on ? '<span class="ok">✓</span>' : '') + '</button>';
  }
  function popHTML(k) {
    if (k === 'card') {
      return '<div class="pop-h">卡种</div>' + Object.keys(CARDVAL).map(v =>
        optRow(CARDVAL[v], state.card === v, 'data-act="opt" data-k="card" data-v="' + v + '"')).join('');
    }
    if (k === 'region') {
      const counts = {};
      C.SPOTS.forEach(x => { counts[x.region] = (counts[x.region] || 0) + 1; });
      return '<div class="pop-h">地区<span class="pop-c">' + C.REGIONS.length + ' 个分区</span></div>' +
        '<div class="pop-scroll">' +
        optRow('全部地区', !state.region, 'data-act="opt" data-k="region" data-v=""', C.SPOTS.length + ' 个') +
        C.REGIONS.map(g => optRow(g.r, state.region === g.r, 'data-act="opt" data-k="region" data-v="' + esc(g.r) + '"', counts[g.r] + ' 个')).join('') +
        '</div>';
    }
    if (k === 'benefit') {
      return '<div class="pop-h">持卡权益</div><div class="pop-scroll">' +
        optRow('全部权益', !state.benefit, 'data-act="opt" data-k="benefit" data-v=""') +
        C.BENS.map(b => optRow(b, state.benefit === b, 'data-act="opt" data-k="benefit" data-v="' + esc(b) + '"')).join('') +
        '</div>';
    }
    if (k === 'kid') {
      const st = C.stats();
      return '<div class="pop-h">亲子属性</div>' +
        optRow('全部（含非亲子）', !state.kid, 'data-act="opt" data-k="kid" data-v=""', C.SPOTS.length + ' 个') +
        optRow('亲子友好（含家庭）', state.kid === '1', 'data-act="opt" data-k="kid" data-v="1"', (st.kid2 + st.kid1) + ' 个') +
        optRow('儿童 · 亲子专属', state.kid === '2', 'data-act="opt" data-k="kid" data-v="2"', st.kid2 + ' 个') +
        optRow('非亲子专属（其余全部）', state.kid === 'n2', 'data-act="opt" data-k="kid" data-v="n2"', (st.total - st.kid2) + ' 个') +
        optRow('仅非亲子 / 成人向', state.kid === '0', 'data-act="opt" data-k="kid" data-v="0"', st.kid0 + ' 个') +
        '<div class="pop-note">亲子属性为页面补充标注（原文无此字段），已按景区实际业态逐项核实。</div>';
    }
    if (k === 'period') {
      const st = C.stats();
      const cnt = { '': C.SPOTS.length, A: st.p.A, B: st.p.B, C: st.p.C, D: st.p.D, N: st.p.N, U: st.p.U };
      return '<div class="pop-h">当前可用时段<span class="pop-c">凡窗口内可用 9.24–10.7 共 ' + st.avail + ' 个</span></div>' +
        Object.keys(PVAL).map(v => optRow(PVAL[v], state.period === v, 'data-act="opt" data-k="period" data-v="' + v + '"', cnt[v] + ' 个')).join('');
    }
    /* more */
    const tg = (label, on, k, hint) =>
      '<button type="button" class="opt' + (on ? ' on' : '') + '" data-act="toggle" data-k="' + k + '">' +
      '<span class="ol">' + esc(label) + '</span>' + (hint ? '<span class="oh">' + esc(hint) + '</span>' : '') +
      '<span class="sw' + (on ? ' on' : '') + '"></span></button>';
    return '<div class="pop-h">更多条件</div>' +
      tg('只看地图视野内的景区', state.inViewOnly, 'inViewOnly', state.inView.size + ' 个在视野内') +
      tg('只看我计划去的', state.planned, 'planned', "标记 ★ 的景区") +
      tg('只看我已使用过的', state.used, 'used', S.totalUseCount() + ' 次记录') +
      '<div class="pop-h sub">一日联玩</div>' +
      '<div class="seg"><button type="button" class="' + (state.mode === 'W' ? 'on' : '') + '" data-act="mode" data-v="W">9.24–10.7 期间</button>' +
      '<button type="button" class="' + (state.mode === 'A' ? 'on' : '') + '" data-act="mode" data-v="A">整个年卡有效期</button></div>' +
      tg('只推荐 亲子 / 儿童友好 项目', state.kidOnly, 'kidOnly', '排除成人向景区') +
      '<div class="pop-foot"><button type="button" class="mini-btn" data-act="notes">使用说明与图例</button>' +
      '<button type="button" class="mini-btn danger" data-act="resetall">重置全部筛选</button></div>';
  }

  /* ============================ 底部导航 ============================ */
  const TABS = [
    { k: 'map', name: '地图' },
    { k: 'list', name: '景区' },
    { k: 'plan', name: '联玩' },
    { k: 'card', name: '年卡' }
  ];
  function renderNav() {
    if (!elNav) return;
    const cnt = { list: state.visible.length, plan: state.recI.length, card: S.plannedCount() };
    elNav.innerHTML = TABS.map(t => {
      const n = cnt[t.k];
      return '<button type="button" class="navbtn' + (state.tab === t.k ? ' on' : '') + '" data-act="tab" data-tab="' + t.k + '">' +
        '<span class="nb-ico">' + NAV_ICO[t.k] + '</span><span class="nb-t">' + t.name + '</span>' +
        (n ? '<i class="nb-n">' + n + '</i>' : '') + '</button>';
    }).join('');
  }
  const NAV_ICO = {
    map: '<svg viewBox="0 0 24 24"><path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 7 9 4z"/><path d="M9 4v13M15 7v12.5"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    plan: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.6 7-11a7 7 0 10-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    card: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10h18"/></svg>'
  };

  /* ============================ 内容构件 ============================ */
  function headHTML(s) {
    return '<div class="sc-head"><div class="sc-title">' +
      '<span class="nm">' + esc(s.name) + '</span>' + badges(s, { fam: true }) + '</div>' +
      '<div class="sc-sub">' + esc(s.region) + ' · ' + ctChips(s) + '</div></div>';
  }
  /* 核心信息：地区 / 门票 / 当前卡种权益 / 当前可用状态 */
  function coreHTML(s) {
    const r = myTerm(s);
    const ben = r.onCard
      ? '<span class="bpill ' + benClass(r.t.benefit) + '">' + esc(r.t.benefit) + '</span>'
      : '<span class="bpill pill-off">本卡未收录</span>';
    const price = r.onCard
      ? esc(priceText(r.t)) + '<span class="cu"> 元</span>'
      : '<span class="cv-off">—</span>';
    return '<div class="sc-stats">' +
      '<div class="cell"><span class="cl">门票</span><b class="cv">' + price + '</b></div>' +
      '<div class="cell"><span class="cl">' + esc(cidLabel(S.activeCard()).name) + '权益</span><b class="cv">' + ben + '</b></div>' +
      '<div class="cell"><span class="cl">当前可用</span><b class="cv">' + nowChip(s) + '</b></div>' +
      '</div>' +
      '<div class="sc-flags">' + pTag(s.p) + flagChips(s) +
      '<span class="uses">已用 ' + S.useCount(s.key) + ' 次</span></div>';
  }
  /* 操作：计划去 / 已使用 */
  function opsHTML(s) {
    const used = S.usesOf(s.key);
    return '<div class="sc-ops">' +
      '<button type="button" class="gl-btn' + (S.isPlanned(s.key) ? ' on' : '') + '" data-act="plan" data-key="' + esc(s.key) + '">' +
      '<span class="stari">' + planStar(s) + '</span>' + (S.isPlanned(s.key) ? '已加入计划' : '计划去') + '</button>' +
      '<button type="button" class="gl-btn" data-act="use" data-key="' + esc(s.key) + '">标记已使用 +1</button>' +
      (used.length ? '<button type="button" class="gl-btn ghost" data-act="unuse" data-key="' + esc(s.key) + '">撤销一次</button>' : '') +
      '</div>';
  }
  /* 完整详情：分卡权益 / 接待时间 / 预约 / 使用记录 / 推荐 */
  function detailHTML(s, opts) {
    opts = opts || {};
    const r = myTerm(s);
    let h = '';
    /* 分卡权益明细 */
    h += '<div class="dsec"><div class="dsec-h">持卡权益与接待时间</div>' +
      s.terms.map(t => {
        const c = cidLabel(t.card);
        const mine = t.card === S.activeCard();
        return '<div class="tcard' + (mine ? ' mine' : '') + '">' +
          '<div class="tc-h"><i class="ct ct-' + t.card + '">' + esc(c.name) + '</i>' +
          (mine ? '<span class="mineflag">我的卡</span>' : '') +
          '<span class="tc-price">门票 ' + esc(priceText(t)) + ' 元</span>' +
          '<span class="bpill ' + benClass(t.benefit) + '">' + esc(t.benefit) + '</span></div>' +
          '<div class="tc-r">' + pTag(t.p) + '<span class="date">' + esc(t.dates || '—') + '</span>' +
          (t.zt ? '<span class="badge b-zt">专属</span>' : '') + '</div>' +
          '<div class="tc-r">' + flagChips(s) + '</div>' +
          (t.note ? '<div class="tc-note">' + esc(t.note) + '</div>'
            : (/^[ABCD]$/.test(t.p) ? '<div class="tc-note muted">未注明需预约，持卡可直接前往。</div>' : '')) +
          '</div>';
      }).join('') + '</div>';

    /* 可用性 */
    const a = C.availNow(s, S.activeCard());
    h += '<div class="dsec"><div class="dsec-h">可用性</div>' +
      '<div class="kv"><span>今日（按' + esc(cidLabel(S.activeCard()).name) + '）</span><b>' + nowChip(s) + '</b></div>' +
      '<div class="kv"><span>9.24–10.7 窗口</span><b>' + pTag(s.p) + '</b></div>' +
      '<div class="kv"><span>接待期</span><b>' + esc(a.term ? a.term.dates : (s.terms[0].dates || '—')) + '</b></div>' +
      (s.terms.length > 1 ? '<div class="kv"><span>两卡可用</span><b>' + C.cardAvail(s, state.mode).map(x =>
        '<span class="av ' + (x.ok ? 'ok' : 'no') + '">' + esc(cidLabel(x.card).name) + (x.ok ? ' ✓' : ' ✕') + '</span>').join('') + '</b></div>' : '') +
      '</div>';

    /* 我的记录 */
    const uses = S.usesOf(s.key);
    h += '<div class="dsec"><div class="dsec-h">我的记录</div>' + opsHTML(s) +
      (uses.length ? '<div class="ulist">' + uses.map((u, i) =>
        '<div class="uitem"><span class="ud">' + esc(u.date) + '</span>' +
        '<i class="ct ct-' + u.card + '">' + esc(cidLabel(u.card).name) + '</i>' +
        '<span class="us">节省 <input type="number" min="0" step="1" class="uin" data-act="saved" data-key="' + esc(s.key) + '" data-idx="' + i + '" value="' + (Number(u.saved) || 0) + '"> 元</span></div>'
      ).join('') + '</div>'
        : '<div class="dempty">还没有使用记录。去过之后点「标记已使用 +1」，会自动按门票价计入已节省金额（优惠票种默认为 0，可手动修改）。</div>') +
      '</div>';

    /* 一日联玩 */
    if (opts.reco !== false) {
      const pool = state.visibleN.size ? state.visible : C.SPOTS;
      const rec = C.recommend(s, pool.length ? pool : C.SPOTS, { mode: state.mode, kidOnly: state.kidOnly });
      h += '<div class="dsec"><div class="dsec-h">一日联玩' +
        '<span class="dh">' + (state.mode === 'W' ? '9.24–10.7 期间' : '整个年卡有效期') +
        (state.kidOnly ? ' · 仅亲子友好' : '') + '</span></div>';
      if (!rec.ok) {
        h += '<div class="dempty">该景区在所选时段内不可使用（或原文未给出接待时间），无法给出联玩组合。</div>';
      } else if (!rec.picks.length) {
        h += '<div class="dempty">没有接待时间重合、可同日游玩的搭配。</div>';
      } else {
        h += '<div class="rsum">可同日联玩 <b>' + rec.picks.length + '</b> 个 · 共同可用日期 <b>' + rec.commonText + '</b>' +
          (rec.broad ? '<br>附近 40km 内不足 2 个，已放宽范围' : '') + '</div>' +
          rec.picks.map((c, i) => recCardHTML(c, i)).join('');
      }
      h += '</div>';
    }
    return h;
  }
  function recCardHTML(c, i) {
    const t = c.t;
    return '<button type="button" class="rec" data-act="sel" data-i="' + t.i + '">' +
      '<span class="rec-h"><span class="rk">' + (i + 1) + '</span>' +
      '<span class="rn">' + esc(t.name) + '</span>' + badges(t) +
      '<span class="rd">' + c.d + ' km</span></span>' +
      '<span class="rec-m">' + esc(t.region) + ' · ' + tiers(c.d) + '</span>' +
      '<span class="rec-m">可用日期 <b>' + c.com.map(r => fmt(r[0]) + '–' + fmt(r[1])).join('；') + '</b></span>' +
      '<span class="rec-m">' + t.terms.map(x => esc(x.benefit + (x.price !== '' ? '（门票 ' + x.price + ' 元）' : ''))).join(' / ') + flagChips(t) + '</span>' +
      '</button>';
  }

  /* 列表紧凑卡片（不用表格） */
  function rowHTML(s) {
    const ex = !!state.expanded[s.i];
    const r = myTerm(s);
    const ben = r.onCard ? '<span class="bpill ' + benClass(r.t.benefit) + '">' + esc(r.t.benefit) + '</span>'
      : '<span class="bpill pill-off">本卡未收录</span>';
    let h = '<div class="row' + (state.selI === s.i ? ' sel' : '') + (state.recI.indexOf(s.i) >= 0 ? ' pick' : '') +
      '" data-i="' + s.i + '">' +
      '<button type="button" class="row-plan" data-act="plan" data-key="' + esc(s.key) + '" aria-label="计划去">' + planStar(s) + '</button>' +
      '<button type="button" class="row-main" data-act="row" data-i="' + s.i + '">' +
      '<span class="row-t"><span class="nm">' + esc(s.name) + '</span>' + badges(s) + '</span>' +
      '<span class="row-m">' + esc(s.region) + ' · 门票 ' + esc(myPrice(s)) + ' 元 · ' + ben + nowChip(s) + '</span>' +
      '<span class="row-m sub">' + pTag(s.p) + '<span class="uses">已用 ' + S.useCount(s.key) + ' 次</span>' +
      (S.isPlanned(s.key) ? '<span class="mini m-plan">计划去</span>' : '') + '</span>' +
      '</button>' +
      '<button type="button" class="row-exp" data-act="expand" data-i="' + s.i + '" aria-label="展开">' + (ex ? '▴' : '▾') + '</button>' +
      '</div>';
    if (ex) h += '<div class="row-detail" data-detail="' + s.i + '">' + detailHTML(s) + '</div>';
    return h;
  }

  /* 列表内容 */
  function listHTML() {
    const list = state.visible;
    if (!list.length) return '<div class="dempty big">没有符合条件的景区。<br><button type="button" class="mini-btn" data-act="resetall">重置筛选</button></div>';
    let h = '<div class="sec-head"><span class="sh-t">景区</span>' +
      '<span class="sh-c">' + list.length + ' / ' + C.SPOTS.length + ' 个</span></div>';

    let rest = list, inViewPart = [];
    if (state.inViewReady && state.inView.size) {
      inViewPart = list.filter(s => state.inView.has(s.i));
      rest = list.filter(s => !state.inView.has(s.i));
    }
    let shown = 0;
    if (inViewPart.length) {
      h += '<div class="grp">📍 当前地图视野内 · ' + inViewPart.length + ' 个</div>';
      inViewPart.slice(0, state.limit).forEach(s => { h += rowHTML(s); shown++; });
    }
    /* 按地区分组（同一地区内按精品版序号） */
    const byReg = {};
    rest.forEach(s => { (byReg[s.region] = byReg[s.region] || []).push(s); });
    C.REGIONS.forEach(g => {
      const arr = byReg[g.r]; if (!arr || !arr.length) return;
      h += '<div class="grp">' + esc(g.r) + ' · ' + arr.length + ' 个</div>';
      arr.forEach(s => { if (shown < state.limit) { h += rowHTML(s); shown++; } });
    });
    Object.keys(byReg).forEach(r => {
      if (C.REGIONS.some(g => g.r === r)) return;
      h += '<div class="grp">' + esc(r) + ' · ' + byReg[r].length + ' 个</div>';
      byReg[r].forEach(s => { if (shown < state.limit) { h += rowHTML(s); shown++; } });
    });
    if (shown < list.length) {
      h += '<button type="button" class="more-btn" data-act="loadmore">继续显示剩余 ' + (list.length - shown) + ' 个</button>';
    }
    return h;
  }

  /* 一日联玩面板 */
  function planHTML() {
    const s = sel();
    let h = '<div class="sec-head"><span class="sh-t">一日联玩</span>' +
      '<span class="sh-c">' + (state.mode === 'W' ? '9.24–10.7 期间' : '整个年卡有效期') + '</span></div>' +
      '<div class="seg row2"><button type="button" class="' + (state.mode === 'W' ? 'on' : '') + '" data-act="mode" data-v="W">9.24–10.7 期间</button>' +
      '<button type="button" class="' + (state.mode === 'A' ? 'on' : '') + '" data-act="mode" data-v="A">整个年卡有效期</button></div>' +
      '<label class="swrow"><input type="checkbox" data-act="toggle" data-k="kidOnly"' + (state.kidOnly ? ' checked' : '') +
      '><span>只推荐 <b>亲子 / 儿童友好</b> 项目</span></label>';
    if (!s) {
      return h + '<div class="dempty big">从地图上点一个标记，或在「景区」里选一条，就能算出一天内可以一起玩的 2–3 个景点。<br>推荐只在当前筛选后的景区里挑，并标出每个搭配被哪张卡覆盖。</div>';
    }
    const pool = state.visibleN.size ? state.visible : C.SPOTS;
    const rec = C.recommend(s, pool.length ? pool : C.SPOTS, { mode: state.mode, kidOnly: state.kidOnly });
    h += '<div class="picked"><span class="pk-t">已选</span><span class="pk-n">' + esc(s.name) + '</span>' +
      badges(s, { fam: true }) + '<span class="pk-r">' + esc(s.region) + '</span>' +
      '<span class="kidname">' + KIDNAME[s.kid] + '</span></div>';
    if (!rec.ok) {
      return h + '<div class="dempty">该景区在所选时段内不可使用（或原文未给出接待时间），无法给出联玩组合。</div>';
    }
    h += '<div class="rsum">可同日联玩 <b>' + rec.picks.length + '</b> 个 · 共同可用日期 <b>' + rec.commonText + '</b>' +
      (rec.broad ? '<br>附近 40km 内不足 2 个，已放宽范围' : '') + '</div>';
    if (!rec.picks.length) h += '<div class="dempty">没有接待时间重合、可同日游玩的搭配。</div>';
    else {
      h += rec.picks.map((c, i) => recCardHTML(c, i)).join('');
      h += '<div class="pop-note">距离按区县定位直线估算，仅供参考；出发前请与景区电话确认。</div>';
    }
    return h;
  }

  /* 我的年卡面板 */
  function cardHTML() {
    const id = S.activeCard(), t = S.totals(id), c = cidLabel(id);
    const pct = Math.round(t.progress * 100);
    let h = '<div class="sec-head"><span class="sh-t">我的年卡</span><span class="sh-c">记录只存在本机</span></div>';
    h += '<div class="seg row2">' + C.CARDS.map(cd =>
      '<button type="button" class="' + (id === cd.id ? 'on' : '') + '" data-act="setcard" data-v="' + cd.id + '">' +
      esc(cd.name) + '</button>').join('') + '</div>';
    h += '<div class="csum"><div class="csum-top"><span class="csum-k">' + esc(c.name) + '</span>' +
      '<span class="csum-v">' + (t.set ? '已回本 ' + pct + '%' : '未设置卡价') + '</span></div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
    h += '<div class="dsec"><div class="dsec-h">年卡成本</div>' +
      '<div class="kv"><span>购买价格（自己填，原文未给）</span><b>' +
      '<input type="number" min="0" step="1" class="uin wide" data-act="setprice" data-card="' + id + '" value="' + t.price + '" placeholder="0"> 元</b></div>' +
      '</div>';
    h += '<div class="dsec"><div class="dsec-h">使用统计</div>' +
      '<div class="stats2">' +
      '<div class="st2"><b>' + t.count + '</b><span>已使用次数</span></div>' +
      '<div class="st2"><b>' + t.saved + '</b><span>已节省金额（元）</span></div>' +
      '<div class="st2 ' + (t.net >= 0 ? 'good' : 'bad') + '"><b>' + (t.net > 0 ? '+' : '') + t.net + '</b><span>净收益（元）</span></div>' +
      '<div class="st2"><b>' + (t.count ? t.avg : '—') + '</b><span>平均单次成本（元）</span></div>' +
      '</div>' +
      '<div class="kv"><span>回本进度</span><b>' + (t.set ? t.saved + ' / ' + t.price + ' 元（' + pct + '%）' : '设置卡价后显示') + '</b></div>' +
      '<div class="kv"><span>计划去</span><b>' + t.planned + ' 个</b></div>' +
      '<div class="kv"><span>全部记录（不分卡）</span><b>' + t.allCount + ' 次 · 节省 ' + t.allSaved + ' 元</b></div>' +
      '</div>';
    h += '<div class="dsec"><div class="dsec-h">说明</div>' +
      '<div class="pop-note">已节省金额按景区门票原价累计；标注"优惠 / 特价"的票种不知道具体优惠了多少，默认记 0，可在景区详情的使用记录里手动改成实际金额。</div>' +
      '<div class="pop-foot"><button type="button" class="mini-btn" data-act="planned">看计划去的 ' + t.planned + ' 个</button>' +
      '<button type="button" class="mini-btn danger" data-act="resetstore">清空本机记录</button></div></div>';
    return h;
  }

  /* ============================ 景区浮卡（桌面右下） ============================ */
  function renderSpotCard() {
    if (!elSpotCard) return;
    const s = sel();
    /* 桌面端：只要选中了就浮在右下，与左侧内容面板互不遮挡 */
    const show = !!s && !isMobile();
    if (!show) { elSpotCard.hidden = true; elSpotCard.innerHTML = ''; return; }
    const hidden = !state.visibleN.has(s.i);
    elSpotCard.hidden = false;
    elSpotCard.innerHTML =
      '<button type="button" class="sc-x" data-act="close-spot" aria-label="关闭">✕</button>' +
      headHTML(s) + coreHTML(s) + opsHTML(s) +
      (hidden ? '<div class="sc-warn">当前筛选条件下这条已被隐藏，地图上仍保留它的红点作为连线起点。</div>' : '') +
      '<div class="sc-foot">' +
      '<button type="button" class="gl-btn primary" data-act="detail" data-i="' + s.i + '">查看完整详情</button>' +
      '<button type="button" class="gl-btn ghost" data-act="focus" data-i="' + s.i + '">定位</button>' +
      '<button type="button" class="gl-btn ghost" data-act="tab" data-tab="plan">联玩</button>' +
      '</div>';
  }

  /* ============================ 详情层（第 5 层） ============================ */
  function renderDetail() {
    if (!elDetail) return;
    if (state.detailI === -1) { renderDetailNotes(); return; }   // -1 = 显示使用说明
    const s = sp(state.detailI);
    if (!s) { elDetail.hidden = true; elDetail.innerHTML = ''; return; }
    elDetail.hidden = false;
    elDetail.innerHTML =
      '<div class="d-wrap">' +
      '<div class="d-top"><button type="button" class="sc-x" data-act="close-detail" aria-label="关闭">✕</button>' +
      headHTML(s) + '</div>' +
      '<div class="d-scroll">' + coreHTML(s) + detailHTML(s) + '</div>' +
      '<div class="d-foot"><button type="button" class="gl-btn ghost" data-act="focus" data-i="' + s.i + '">在地图上定位</button>' +
      '<button type="button" class="gl-btn ghost" data-act="closeshow">关闭</button></div>' +
      '</div>';
  }

  /* ============================ Bottom Sheet（移动端） ============================ */
  function snapHeights() {
    const vh = window.innerHeight || 700;
    const navH = elNav ? elNav.getBoundingClientRect().height || 58 : 58;
    const base = navH + 26;
    return { 1: 132, 2: Math.round(vh * 0.46), 3: Math.round(vh - base - 96) };
  }
  function applySnap() {
    if (!elSheet) return;
    const h = snapHeights()[state.snap] || snapHeights()[1];
    elSheet.style.height = h + 'px';
    elSheet.dataset.snap = state.snap;
  }
  function renderSheet() {
    if (!elSheet) return;
    const show = isMobile() && (!!sel() || state.tab !== 'map');
    if (!show) { elSheet.hidden = true; elSheet.innerHTML = ''; return; }
    elSheet.hidden = false;
    if (!elSheetBody) return;
    let body = '';
    if (state.tab === 'map') {
      const s = sel();
      body = headHTML(s) + coreHTML(s);
      if (state.snap >= 2) body += opsHTML(s);
      if (state.snap >= 3) body += detailHTML(s);
      else if (state.snap >= 2) {
        const pool = state.visibleN.size ? state.visible : C.SPOTS;
        const rec = C.recommend(s, pool.length ? pool : C.SPOTS, { mode: state.mode, kidOnly: state.kidOnly });
        if (rec.ok && rec.picks.length) {
          body += '<div class="dsec"><div class="dsec-h">一日联玩<span class="dh">共同可用 ' + rec.commonText + '</span></div>' +
            rec.picks.map((c, i) => recCardHTML(c, i)).join('') + '</div>';
        }
      }
      if (state.snap < 3) body += '<button type="button" class="gl-btn primary wide" data-act="snap" data-v="3">展开全部权益、时间、预约与使用记录</button>';
    } else if (state.tab === 'list') {
      body = listHTML();
    } else if (state.tab === 'plan') {
      body = planHTML();
    } else {
      body = cardHTML();
    }
    elSheetBody.innerHTML = body;
    elSheetBody.scrollTop = state.snap >= 3 ? elSheetBody.scrollTop : 0;
    applySnap();
  }

  /* ============================ 地图 ============================ */
  let map = null, markerLayer = null, lineLayer = null, idleTimer = null;
  const ICON = c => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">' +
    '<path d="M14 0C6.3 0 0 6.3 0 14c0 10 14 22 14 22s14-12 14-22C28 6.3 21.7 0 14 0z" fill="' + c +
    '" stroke="#ffffff" stroke-width="2"/><circle cx="14" cy="14" r="5.2" fill="#fff"/></svg>');

  function initMap() {
    if (typeof TMap === 'undefined' || !elMap) {
      if (elFallback) {
        elFallback.hidden = false;
        elFallback.innerHTML = '地图组件未加载（当前环境无法访问地图服务）。<br>搜索、筛选、景区卡片、一日联玩与我的年卡都不受影响。';
      }
      return;
    }
    try {
      map = new TMap.Map(elMap, { zoom: 8, center: new TMap.LatLng(39.90, 116.90) });
    } catch (e) { map = null; return; }
    markerLayer = new TMap.MultiMarker({
      map: map, styles: {
        n: new TMap.MarkerStyle({ width: 24, height: 31, src: ICON('#2b7de9'), anchor: { x: 12, y: 31 } }),
        z: new TMap.MarkerStyle({ width: 24, height: 31, src: ICON('#e8842f'), anchor: { x: 12, y: 31 } }),
        g: new TMap.MarkerStyle({ width: 24, height: 31, src: ICON('#b9bcc4'), anchor: { x: 12, y: 31 } }),
        p: new TMap.MarkerStyle({ width: 26, height: 34, src: ICON('#7c4dff'), anchor: { x: 13, y: 34 } }),
        s: new TMap.MarkerStyle({ width: 34, height: 44, src: ICON('#e8484f'), anchor: { x: 17, y: 44 } }),
        r: new TMap.MarkerStyle({ width: 28, height: 36, src: ICON('#2fa84f'), anchor: { x: 14, y: 36 } })
      }, geometries: []
    });
    lineLayer = new TMap.MultiPolyline({
      map: map,
      styles: { l: new TMap.PolylineStyle({ color: '#e8484f', width: 4, borderWidth: 2, borderColor: '#ffffff', lineCap: 'round' }) },
      geometries: []
    });
    markerLayer.on('click', e => {
      if (!e || !e.geometry) return;
      select(+e.geometry.id, { focus: false, sheet: true });
      if (state.tab !== 'map') { state.tab = 'map'; render(); }
    });
    /* 视野变化 → 记录视野内景区（列表优先展示） */
    const onView = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(readView, 260);
    };
    ['idle', 'bounds_changed', 'zoom_changed'].forEach(ev => { try { map.on(ev, onView); } catch (e) { } });
    readView();
    syncMap();
  }
  function readView() {
    const b = mapBounds();
    if (!b) { state.inViewReady = false; return; }
    const set = new Set();
    C.SPOTS.forEach(x => { if (x.lat <= b.n && x.lat >= b.s && x.lng <= b.e && x.lng >= b.w) set.add(x.i); });
    const changed = set.size !== state.inView.size;
    state.inView = set; state.inViewReady = true;
    if (changed && (state.tab === 'list' || state.inViewOnly || state.tab === 'map')) render();
    renderPills();
  }
  function mapBounds() {
    if (!map) return null;
    try {
      const b = typeof map.getBounds === 'function' ? map.getBounds() : null;
      if (!b) return null;
      let ne = null, sw = null;
      if (typeof b.getNorthEast === 'function') { ne = b.getNorthEast(); sw = b.getSouthWest(); }
      else if (b._ne && b._sw) { ne = b._ne; sw = b._sw; }
      else if (b.northEast && b.southWest) { ne = b.northEast; sw = b.southWest; }
      const nlat = ne && (ne.lat != null ? ne.lat : (typeof ne.getLat === 'function' ? ne.getLat() : null));
      const nlng = ne && (ne.lng != null ? ne.lng : (typeof ne.getLng === 'function' ? ne.getLng() : null));
      const slat = sw && (sw.lat != null ? sw.lat : (typeof sw.getLat === 'function' ? sw.getLat() : null));
      const slng = sw && (sw.lng != null ? sw.lng : (typeof sw.getLng === 'function' ? sw.getLng() : null));
      if ([nlat, nlng, slat, slng].some(v => typeof v !== 'number')) return null;
      return { n: nlat, s: slat, e: nlng, w: slng };
    } catch (e) { return null; }
  }
  function syncMap() {
    if (!map || !markerLayer) return;
    const s = sel();
    const rec = new Set(state.recI);
    const pts = state.visible.filter(C.mappable);
    if (s && C.mappable(s) && !state.visibleN.has(s.i)) pts.push(s);
    markerLayer.setGeometries(pts.map(x => ({
      id: String(x.i),
      styleId: x.i === state.selI ? 's'
        : rec.has(x.i) ? 'r'
          : S.isPlanned(x.key) ? 'p'
            : (x.p === 'N' || x.p === 'U') ? 'g'
              : (x.cards.length > 1 ? 'n' : 'z'),
      position: new TMap.LatLng(x.lat, x.lng)
    })));
    if (!s || !C.mappable(s) || !lineLayer) { if (lineLayer) lineLayer.setGeometries([]); return; }
    lineLayer.setGeometries(state.recI.map(n => {
      const t = C.SPOTS[n];
      return t && C.mappable(t)
        ? { id: 'L' + n, styleId: 'l', paths: [new TMap.LatLng(s.lat, s.lng), new TMap.LatLng(t.lat, t.lng)] }
        : null;
    }).filter(Boolean));
  }
  function focusSpot(x, fit) {
    if (!map || !x || !C.mappable(x)) return;
    try {
      if (fit && fit.length > 1) {
        const b = new TMap.LatLngBounds();
        fit.forEach(p => b.extend(new TMap.LatLng(p.lat, p.lng)));
        map.fitBounds(b, { padding: { top: 120, bottom: 200, left: 340, right: 380 } });
      } else {
        if (typeof map.setCenter === 'function') map.setCenter(new TMap.LatLng(x.lat, x.lng));
        if (typeof map.getZoom === 'function' && typeof map.setZoom === 'function' && map.getZoom() < 12) map.setZoom(12);
      }
    } catch (e) { }
  }

  /* ============================ 选中 / 导航 ============================ */
  function select(i, opts) {
    opts = opts || {};
    state.selI = i;
    const s = sp(i);
    if (s && opts.focus !== false) focusSpot(s, opts.fit);
    if (opts.sheet && isMobile()) state.snap = Math.max(state.snap, 2);
    if (opts.tab) state.tab = opts.tab;
    render();
  }
  function setTab(k) {
    state.tab = k;
    /* 移动端：切到非地图页时，把 Bottom Sheet 抬到半展开，别停在一行的高度 */
    if (isMobile() && k !== 'map' && state.snap === 1) state.snap = 2;
    render();
  }

  /* ============================ 主渲染 ============================ */
  function computeVisible() {
    state.visible = C.filterSpots({
      kw: state.kw, region: state.region, benefit: state.benefit, kid: state.kid,
      card: state.card, period: state.period,
      planned: state.planned, used: state.used,
      inView: state.inViewOnly ? state.inView : null
    });
    state.visibleN = new Set(state.visible.map(x => x.i));
    const s = sel();
    if (s) {
      const pool = state.visibleN.size ? state.visible : C.SPOTS;
      const rec = C.recommend(s, pool.length ? pool : C.SPOTS, { mode: state.mode, kidOnly: state.kidOnly });
      state.recI = rec.ok ? rec.picks.map(c => c.t.i) : [];
    } else state.recI = [];
  }
  function render() {
    computeVisible();
    renderPills();
    renderCardEntry();
    renderNav();
    syncMap();
    renderSpotCard();
    if (elPanel) {
      const show = !isMobile() && state.tab !== 'map';
      elPanel.hidden = !show;
      if (show) elPanel.innerHTML =
        '<button type="button" class="panel-x" data-act="tab" data-tab="map" aria-label="关闭">✕</button>' +
        (state.tab === 'list' ? listHTML() : state.tab === 'plan' ? planHTML() : cardHTML());
    }
    renderSheet();
    renderDetail();
  }

  /* ============================ 事件 ============================ */
  function bind() {
    if (elQ) elQ.addEventListener('input', () => {
      state.kw = elQ.value; state.limit = 60;
      if (elQClear) elQClear.hidden = !elQ.value;
      render();
    });
    if (elQClear) elQClear.addEventListener('click', () => {
      elQ.value = ''; state.kw = ''; elQClear.hidden = true; state.limit = 60; render();
    });
    if (elFilterBtn) elFilterBtn.addEventListener('click', e => {
      e.stopPropagation();
      openPop(elFilterBtn, popHTML('more') + '<div class="pop-sep"></div>' +
        PILL_DEF.filter(p => p.k !== 'more').map(p => {
          const v = pillValue(p.k);
          const on = pillOn(p.k) ? ' on' : '';
          return '<button type="button" class="opt wide' + on + '" data-act="pill" data-pill="' + p.k + '">' +
            '<span class="ol">' + p.name + '</span><span class="oh">' + esc(v) + '</span></button>';
        }).join(''), 'more');
    }, false);
    if (elPop) elPop.addEventListener('click', e => e.stopPropagation());

    document.addEventListener('click', e => {
      const t = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!t) { if (elPop && !elPop.hidden) closePop(); return; }
      const act = t.dataset.act;
      const s = sel();
      switch (act) {
        case 'pill':
          e.stopPropagation();
          openPop(t, popHTML(t.dataset.pill), t.dataset.pill);
          break;
        case 'opt': {
          const k = t.dataset.k, v = t.dataset.v || '';
          state[k] = v; state.limit = 60;
          closePop(); render(); break;
        }
        case 'toggle': {
          const k = t.dataset.k;
          state[k] = !state[k];
          if (k === 'inViewOnly' && state[k] && !state.inViewReady) readView();
          render(); break;
        }
        case 'mode': state.mode = t.dataset.v; closePop(); render(); break;
        case 'clearfilters': case 'resetall':
          state.region = ''; state.benefit = ''; state.kid = ''; state.period = '';
          state.card = 'all'; state.planned = false; state.used = false; state.inViewOnly = false;
          closePop(); render(); break;
        case 'tab': setTab(t.dataset.tab); break;
        case 'row': {
          const i = +t.dataset.i;
          select(i, { focus: true });
          break;
        }
        case 'expand': {
          const i = +t.dataset.i;
          if (state.expanded[i]) delete state.expanded[i]; else { state.expanded = {}; state.expanded[i] = 1; }
          render(); break;
        }
        case 'sel': select(+t.dataset.i, { focus: true, tab: 'map', fit: recFocus(+t.dataset.i) }); break;
        case 'focus': focusSpot(sp(+t.dataset.i), null); break;
        case 'detail': state.detailI = +t.dataset.i; renderDetail(); break;
        case 'close-detail': case 'closeshow': state.detailI = null; renderDetail(); break;
        case 'close-spot': state.selI = null; render(); break;
        case 'plan': {
          const on = S.togglePlan(t.dataset.key);
          toast(on ? '已加入计划' : '已移出计划');
          render(); break;
        }
        case 'use': {
          const x = C.SPOTS.find(y => y.key === t.dataset.key);
          if (x) {
            const r = C.termOf(x, S.activeCard());
            S.addUse(x.key, S.activeCard(), null, r.onCard ? r.t.price : 0, r.t.benefit);
            toast('已记录 1 次使用');
          }
          render(); break;
        }
        case 'unuse': S.removeUse(t.dataset.key); toast('已撤销最近一次记录'); render(); break;
        case 'setcard': S.setActiveCard(t.dataset.v); closePop(); render(); break;
        case 'snap': state.snap = +t.dataset.v; renderSheet(); break;
        case 'loadmore': state.limit += 60; render(); break;
        case 'planned': state.planned = true; state.tab = 'list'; state.limit = 60; render(); break;
        case 'resetstore':
          if (window.confirm && window.confirm('确定清空本机的年卡、计划去与使用记录吗？')) { S.reset(); render(); }
          break;
        case 'notes': closePop(); state.detailI = -1; renderDetailNotes(); break;
        default: break;
      }
      if (act !== 'pill') { if (elPop && !elPop.hidden && !t.closest('#pop')) closePop(); }
    });

    document.addEventListener('change', e => {
      const t = e.target;
      if (!t || !t.dataset || !t.dataset.act) return;
      if (t.dataset.act === 'setprice') { S.setPrice(t.dataset.card, t.value); render(); }
      if (t.dataset.act === 'saved') { S.setUseSaved(t.dataset.key, +t.dataset.idx, t.value); renderCardEntry(); }
      if (t.dataset.act === 'toggle' && t.type === 'checkbox' && t.dataset.k) { state[t.dataset.k] = t.checked; render(); }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (elPop && !elPop.hidden) closePop();
        else if (state.detailI != null) { state.detailI = null; renderDetail(); }
        else if (state.selI != null) { state.selI = null; render(); }
      }
    });

    if (elSheetHandle && elSheetHandle.addEventListener) {
      let drag = null;
      const cur = () => (elSheet ? elSheet.getBoundingClientRect().height : 132);
      elSheetHandle.addEventListener('pointerdown', e => {
        drag = { y: e.clientY, h: cur(), moved: 0 };
        if (elSheet) elSheet.classList.add('dragging');
        if (elSheetHandle.setPointerCapture && e.pointerId != null) { try { elSheetHandle.setPointerCapture(e.pointerId); } catch (err) { } }
      });
      elSheetHandle.addEventListener('pointermove', e => {
        if (!drag || !elSheet) return;
        const hs = snapHeights();
        const h = Math.max(96, Math.min(drag.h + (drag.y - e.clientY), hs[3]));
        drag.moved = Math.abs(drag.y - e.clientY);
        elSheet.style.height = h + 'px';
      });
      const end = e => {
        if (!drag) return;
        if (elSheet) elSheet.classList.remove('dragging');
        const h = cur(), hs = snapHeights();
        if (drag.moved < 6) { state.snap = state.snap >= 3 ? 1 : state.snap + 1; }
        else {
          let best = 1, bd = 1e9;
          [1, 2, 3].forEach(k => { const d = Math.abs(h - hs[k]); if (d < bd) { bd = d; best = k; } });
          state.snap = best;
        }
        drag = null;
        renderSheet();
      };
      elSheetHandle.addEventListener('pointerup', end);
      elSheetHandle.addEventListener('pointercancel', end);
      elSheetHandle.addEventListener('click', e => e.stopPropagation());
    }

    const onResize = () => { if (map && typeof map.resize === 'function') { try { map.resize(); } catch (e) { } } render(); };
    if (window.addEventListener) window.addEventListener('resize', onResize);
    if (mq && mq.addEventListener) mq.addEventListener('change', () => render());
    if (elSheetBody) elSheetBody.addEventListener('scroll', () => {
      if (state.snap === 3 && elSheetBody.scrollHeight - elSheetBody.scrollTop - elSheetBody.clientHeight < 4) return;
    });
  }
  function recFocus(i) {
    const s = sp(i);
    if (!s) return null;
    return [s].concat(state.recI.map(n => C.SPOTS[n]).filter(Boolean));
  }
  /* 读取 <template id="notesTpl"> 里的说明内容（浏览器走 content，兜底走 innerHTML） */
  function notesHTML() {
    const tpl = $('notesTpl');
    if (!tpl) return '';
    try {
      if (tpl.content && tpl.content.childElementCount) {
        const wrap = document.createElement('div');
        wrap.appendChild(tpl.content.cloneNode(true));
        return wrap.innerHTML;
      }
    } catch (e) { }
    return tpl.innerHTML || '';
  }
  function renderDetailNotes() {
    if (!elDetail) return;
    const st = C.stats();
    elDetail.hidden = false;
    elDetail.innerHTML = '<div class="d-wrap"><div class="d-top"><button type="button" class="sc-x" data-act="close-detail">✕</button>' +
      '<div class="sc-head"><div class="sc-title"><span class="nm">使用说明与图例</span></div>' +
      '<div class="sc-sub">' + st.total + ' 个景区 · ' + st.regions + ' 个分区 · 两张卡合并</div></div></div>' +
      '<div class="d-scroll">' + notesHTML() + '</div>' +
      '<div class="d-foot"><button type="button" class="gl-btn ghost" data-act="closeshow">关闭</button></div></div>';
    const put = (id, v) => { const el = elDetail.querySelector ? elDetail.querySelector('#' + id) : null; if (el) el.textContent = v; };
    put('nt-kid2', st.kid2); put('nt-kid1', st.kid1); put('nt-kid0', st.kid0);
  }

  /* ============================ 启动 ============================ */
  function boot() {
    bind();
    render();
    initMap();
    render();
  }
  if (document.readyState === 'loading' && document.addEventListener) document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* 供回归测试使用 */
  window.APP = {
    state: state, render: render, select: select, setTab: setTab,
    computeVisible: computeVisible, isMobile: isMobile,
    listHTML: listHTML, planHTML: planHTML, cardHTML: cardHTML,
    detailHTML: detailHTML, popHTML: popHTML, rowHTML: rowHTML
  };
})();
