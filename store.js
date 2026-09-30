/* ============================================================================
 * store.js —— 个人记录层（我的年卡 / 计划去 / 已使用）
 *
 *   只负责"用户自己的数据"，不碰景区目录数据：
 *     activeCard  当前使用中的卡种
 *     price       两种卡各自的购买价格（原文没有，由用户自己填）
 *     plans       { 归并键: 1 } 计划去的景区
 *     uses        { 归并键: [ {card, date, saved} ] } 已使用记录
 *
 *   键统一用 core.js 的归并键（改名/换卡都不影响记录归属）。
 *   数据存 localStorage，取不到时退化为内存态（不报错）。
 *   对外接口挂在 window.STORE。
 * ==========================================================================*/
(function () {
  'use strict';

  const LSKEY = 'jingjinji.card.v1';
  const DEF = { activeCard: 'jp', price: { jp: 0, zx: 0 }, plans: {}, uses: {} };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  let mem = null;
  function load() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(LSKEY);
      if (!raw) return clone(DEF);
      const o = JSON.parse(raw);
      const s = clone(DEF);
      if (o && typeof o === 'object') {
        if (o.activeCard) s.activeCard = o.activeCard;
        if (o.price && typeof o.price === 'object') Object.keys(o.price).forEach(k => { s.price[k] = Number(o.price[k]) || 0; });
        if (o.plans && typeof o.plans === 'object') s.plans = o.plans;
        if (o.uses && typeof o.uses === 'object') s.uses = o.uses;
      }
      return s;
    } catch (e) { return clone(DEF); }
  }
  const state = load();

  let saveWarned = false;
  function save() {
    try {
      if (window.localStorage) window.localStorage.setItem(LSKEY, JSON.stringify(state));
      mem = null;
    } catch (e) {
      /* 隐私模式 / file:// 受限时退化为内存态 */
      if (!saveWarned) { saveWarned = true; }
      mem = clone(state);
    }
    notify();
  }

  const subs = [];
  function notify() { subs.forEach(f => { try { f(); } catch (e) { } }); }

  /* ---------------- 卡种 / 价格 ---------------- */
  function activeCard() { return state.activeCard; }
  function setActiveCard(id) { state.activeCard = id; save(); }
  function priceOf(id) { return Number(state.price[id]) || 0; }
  function setPrice(id, v) {
    const n = Math.max(0, Number(v) || 0);
    state.price[id] = n; save(); return n;
  }

  /* ---------------- 计划去 ---------------- */
  function isPlanned(key) { return !!state.plans[key]; }
  function togglePlan(key) {
    if (state.plans[key]) delete state.plans[key]; else state.plans[key] = 1;
    save(); return !!state.plans[key];
  }
  function plannedCount() { return Object.keys(state.plans).length; }

  /* ---------------- 已使用 ---------------- */
  function usesOf(key) { return state.uses[key] || []; }
  function useCount(key) { return usesOf(key).length; }
  /* 优惠票种不知道具体优惠了多少，默认按 0 记，可手动改 */
  function estimateSaved(price, benefit) {
    const p = Number(price);
    if (!isFinite(p) || p <= 0) return 0;
    if (/优惠|特价|折扣/.test(benefit || '')) return 0;
    return p;
  }
  function addUse(key, cardId, saved, price, benefit) {
    const arr = state.uses[key] || (state.uses[key] = []);
    const d = new Date();
    const pad = n => (n < 10 ? '0' + n : '' + n);
    arr.push({
      card: cardId,
      date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      saved: saved == null ? estimateSaved(price, benefit) : Math.max(0, Number(saved) || 0)
    });
    save(); return arr.length;
  }
  function removeUse(key) { if (state.uses[key] && state.uses[key].length) { state.uses[key].pop(); if (!state.uses[key].length) delete state.uses[key]; save(); } }
  function setUseSaved(key, idx, v) {
    const arr = state.uses[key]; if (!arr || !arr[idx]) return;
    arr[idx].saved = Math.max(0, Number(v) || 0); save();
  }
  function totalUseCount(cardId) {
    let n = 0;
    Object.keys(state.uses).forEach(k => state.uses[k].forEach(u => { if (!cardId || u.card === cardId) n++; }));
    return n;
  }
  function totalSaved(cardId) {
    let s = 0;
    Object.keys(state.uses).forEach(k => state.uses[k].forEach(u => { if (!cardId || u.card === cardId) s += Number(u.saved) || 0; }));
    return s;
  }

  /* ---------------- 年卡总览 ---------------- */
  function totals(cardId) {
    const id = cardId || state.activeCard;
    const price = priceOf(id);
    const count = totalUseCount(id);
    const saved = totalSaved(id);
    const net = saved - price;
    return {
      card: id, price: price, count: count, saved: saved, net: net,
      avg: count ? Math.round((price / count) * 10) / 10 : 0,
      progress: price ? Math.max(0, Math.min(1, saved / price)) : 0,
      set: price > 0, planned: plannedCount(),
      allCount: totalUseCount(), allSaved: totalSaved()
    };
  }

  function reset() {
    state.activeCard = DEF.activeCard; state.price = clone(DEF.price);
    state.plans = {}; state.uses = {}; save();
  }

  window.STORE = {
    state: state, subs: subs,
    subscribe: function (f) { subs.push(f); },
    save: save, reset: reset,
    activeCard: activeCard, setActiveCard: setActiveCard,
    priceOf: priceOf, setPrice: setPrice,
    isPlanned: isPlanned, togglePlan: togglePlan, plannedCount: plannedCount,
    usesOf: usesOf, useCount: useCount, addUse: addUse, removeUse: removeUse,
    setUseSaved: setUseSaved, estimateSaved: estimateSaved,
    totalUseCount: totalUseCount, totalSaved: totalSaved, totals: totals
  };
})();
