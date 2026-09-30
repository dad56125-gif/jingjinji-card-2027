/* ============================================================================
 * test.js —— 回归测试（node test.js）
 *   用 mock document / localStorage 加载 data*.js + core.js + store.js + app.js，
 *   实测：合并结果、筛选、一日联玩推荐、我的年卡统计、事件链路、渲染产物、样式配对。
 *   不依赖浏览器，也不需要安装 Chromium。
 * ==========================================================================*/
const fs = require('fs');
const vm = require('vm');

/* ------------------------------ mock 环境 ------------------------------ */
class El {
  constructor(id) {
    this.id = id;
    this.innerHTML = ''; this.textContent = ''; this.value = '';
    this.hidden = false; this.style = {}; this.dataset = {}; this.type = '';
    this.checked = false; this.scrollTop = 0; this.scrollHeight = 1000; this.clientHeight = 400;
    this._ls = {}; this._cls = new Set();
    this.classList = {
      add: (...c) => c.forEach(x => this._cls.add(x)),
      remove: (...c) => c.forEach(x => this._cls.delete(x)),
      toggle: (x, f) => { if (f === undefined) { this._cls.has(x) ? this._cls.delete(x) : this._cls.add(x); } else { f ? this._cls.add(x) : this._cls.delete(x); } },
      contains: x => this._cls.has(x)
    };
  }
  addEventListener(t, f) { (this._ls[t] = this._ls[t] || []).push(f); }
  removeEventListener() { }
  getBoundingClientRect() { return { top: 60, left: 20, right: 360, bottom: 106, width: 340, height: 46 }; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  setPointerCapture() { } releasePointerCapture() { }
  appendChild() { } focus() { }
  fire(t, ev) { (this._ls[t] || []).forEach(f => f(ev || { target: this, stopPropagation() { }, preventDefault() { } })); }
}

const els = {};
const docLs = {};
const document = {
  readyState: 'complete',
  getElementById: id => (els[id] = els[id] || new El(id)),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(t, f) { (docLs[t] = docLs[t] || []).push(f); },
  fire(t, ev) { (docLs[t] || []).forEach(f => f(ev)); },
  createElement: tag => new El(tag)
};
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const window = {
  SCENIC: null, CATALOG: {}, _TMapSecurityConfig: {},
  document, localStorage, innerWidth: 1280, innerHeight: 820,
  addEventListener() { }, confirm: () => true
};
const ctx = {
  window, document, localStorage, console, Date, Math, JSON, String, Number,
  Set, Map, Array, Object, Boolean, isNaN, parseInt, parseFloat, RegExp, Error,
  setTimeout: (fn) => 0, clearTimeout() { }, TMap: undefined
};
vm.createContext(ctx);
['data.js', 'data-jp.js', 'data-zx.js', 'core.js', 'store.js', 'app.js'].forEach(f =>
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));

const C = window.CORE, S = window.STORE, A = window.APP;
const SPOTS = C.SPOTS;
let pass = 0, fail = 0;
function ck(label, cond, extra) {
  (cond ? pass++ : fail++);
  console.log('  ' + (cond ? '✔' : '✘') + ' ' + label + (extra !== undefined ? '  → ' + extra : ''));
}
function fireAct(act, data) {
  const t = {
    dataset: Object.assign({ act }, data || {}),
    type: '', checked: false,
    closest(sel) { return sel === '[data-act]' ? t : null; }
  };
  document.fire('click', { target: t, stopPropagation() { }, preventDefault() { } });
  return t;
}
function fireChange(dataset, value, extra) {
  document.fire('change', Object.assign({ target: { dataset, value, type: 'number', checked: false } }, extra || {}));
}
function resetFilters() {
  Object.assign(A.state, {
    kw: '', region: '', benefit: '', kid: '', period: '', card: 'all',
    planned: false, used: false, inViewOnly: false
  });
  fireAct('resetall');
}
const visible = () => (A.computeVisible(), A.state.visible);

/* 页面与样式文件：提前读入，并把 <template id="notesTpl"> 的内容注入 mock 元素，
   这样"使用说明"这条链路（模板 → 详情层）在无头环境里也能真跑到。 */
const html = fs.readFileSync('京津冀一卡通景区目录.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');
(function injectTemplate() {
  const m = html.match(/<template id="notesTpl">([\s\S]*?)<\/template>/);
  els['notesTpl'] = els['notesTpl'] || new El('notesTpl');
  els['notesTpl'].innerHTML = m ? m[1] : '';
})();

/* ================================ ① 合并 ================================ */
console.log('① 合并结果（core.js）');
console.log('  景区数:', SPOTS.length, '| 地区数:', C.REGIONS.length, '| 卡种:', C.CARDS.map(c => c.id).join('/'));
const cCount = { jp: 0, zx: 0, both: 0 };
SPOTS.forEach(s => { if (s.cards.length > 1) cCount.both++; else if (s.cards[0] === 'jp') cCount.jp++; else cCount.zx++; });
console.log('  单卡/两卡:', JSON.stringify(cCount), '| kid:', JSON.stringify(SPOTS.reduce((a, s) => (a[s.kid] = (a[s.kid] || 0) + 1, a), {})));
console.log('  p :', JSON.stringify(C.stats().p));
ck('坐标齐全且不越界', SPOTS.every(s => s.lat && s.lng && s.lat > 30 && s.lat < 45 && s.lng > 110 && s.lng < 125));
ck('无空名称 / 无空权益', SPOTS.every(s => s.name) && SPOTS.every(s => s.terms.every(t => t.benefit)));
ck('两卡共有的行都是 multi=true', SPOTS.filter(s => s.cards.length > 1).every(s => s.multi));
ck('行数 = 精品版 200 + 仅臻选版新增行', SPOTS.length === 200 + SPOTS.filter(s => s.cards.indexOf('jp') < 0).length,
  200 + ' + ' + SPOTS.filter(s => s.cards.indexOf('jp') < 0).length + ' = ' + SPOTS.length);

/* ================================ ② 筛选 ================================ */
console.log('\n② 筛选（core.filterSpots 驱动 UI）');
resetFilters();
ck('默认显示全部', visible().length === SPOTS.length, visible().length);
A.state.card = 'jp'; ck('精品版', visible().length === SPOTS.filter(s => s.cards.indexOf('jp') >= 0).length, visible().length);
A.state.card = 'zx'; ck('臻选版', visible().length === SPOTS.filter(s => s.cards.indexOf('zx') >= 0).length, visible().length);
A.state.card = 'both'; ck('仅两卡共有', visible().length === cCount.both, visible().length);
A.state.card = 'all';
A.state.kid = '2'; ck('亲子专属', visible().length === SPOTS.filter(s => s.kid === 2).length, visible().length);
A.state.kid = '1'; ck('亲子友好（含家庭）', visible().length === SPOTS.filter(s => s.kid >= 1).length, visible().length);
A.state.kid = 'n2'; ck('非亲子专属 = 总数 − 亲子专属', visible().length === SPOTS.filter(s => s.kid !== 2).length, visible().length);
A.state.kid = '0'; ck('仅非亲子 / 成人向', visible().length === SPOTS.filter(s => s.kid === 0).length, visible().length);
A.state.kid = '';
A.state.region = '唐山'; ck('地区 = 唐山', visible().every(s => s.region === '唐山') && visible().length > 0, visible().length);
A.state.region = '';
A.state.period = 'A'; ck('时段 A 任一张卡满足即算', visible().length === SPOTS.filter(s => s.terms.some(t => t.p === 'A')).length, visible().length);
A.state.period = '';
A.state.kw = '动物园';
ck('关键词搜索命中名称或备注', visible().length > 0 && visible().every(s => s.name.includes('动物园') || s.terms.some(t => (t.note || '').includes('动物园'))), visible().length);
A.state.kw = '';
ck('亲子专属 + 非亲子专属 = 总数', SPOTS.filter(s => s.kid === 2).length + SPOTS.filter(s => s.kid !== 2).length === SPOTS.length);

/* ============================== ③ 一日联玩 ============================== */
console.log('\n③ 一日联玩推荐');
function pick(name) {
  const s = SPOTS.find(x => x.name === name);
  if (!s) { console.log('  找不到 ' + name); return []; }
  A.select(s.i, { focus: false });
  const r = A.state.recI;
  console.log('  ' + name + ' → ' + (r.length ? r.map(i => SPOTS[i].name + '(' + (SPOTS[i].cards.length > 1 ? '两卡' : SPOTS[i].cards[0]) + ',kid' + SPOTS[i].kid + ')').join('、') : '（无）'));
  return r;
}
const r1 = pick('国家速滑馆');
ck('推荐不含成人向(kid=0)', r1.every(i => SPOTS[i].kid !== 0));
['唐山皮影主题乐园', '中央电视塔', '熊猫亲子乐园', '蟒山森林公园'].forEach(n => pick(n));

console.log('\n③b 推荐受当前筛选约束（原 bug）');
resetFilters(); A.state.region = '唐山';
const r2 = pick('唐山皮影主题乐园');
ck('地区=唐山 时推荐都在唐山', r2.length > 0 && r2.every(i => SPOTS[i].region === '唐山'));
resetFilters(); A.state.card = 'zx';
const r3 = pick('蟒山森林公园');
ck('卡种=臻选版 时推荐都能被臻选版覆盖', r3.length > 0 && r3.every(i => SPOTS[i].cards.indexOf('zx') >= 0));
resetFilters(); A.state.kid = '2';
const r4 = pick('熊猫亲子乐园');
ck('亲子专属 时推荐都是 kid=2', r4.length > 0 && r4.every(i => SPOTS[i].kid === 2));
resetFilters(); A.state.kw = '动物园';
const wild = SPOTS.find(x => x.name.includes('野生动物'));
const r5 = pick(wild.name);
ck('搜索时推荐只来自搜索结果', r5.every(i => A.state.visibleN.has(i)));
resetFilters();

/* ============================== ④ 我的年卡 ============================== */
console.log('\n④ 我的年卡 / 计划去 / 使用记录（store.js）');
S.reset();
const speed = SPOTS.find(x => x.name === '国家速滑馆');
S.setPrice('jp', 200);
ck('设置卡价', S.priceOf('jp') === 200, S.priceOf('jp'));
ck('未设置时 progress=0', S.totals('jp').progress === 0);
S.addUse(speed.key, 'jp', null, speed.terms[0].price, speed.terms[0].benefit);
ck('标记已使用后计数 = 1', S.useCount(speed.key) === 1, S.useCount(speed.key));
ck('已节省按门票价累计', S.totalSaved('jp') === Number(speed.terms[0].price), S.totalSaved('jp'));
let t = S.totals('jp');
ck('净收益 = 已节省 − 卡价', t.net === t.saved - 200, t.net);
ck('平均单次成本 = 卡价 / 次数', t.avg === Math.round((200 / t.count) * 10) / 10, t.avg);
ck('回本进度 = 已节省 / 卡价', Math.abs(t.progress - t.saved / 200) < 1e-9, t.progress.toFixed(3));
ck('进度上限为 1（超额不溢出）', S.totals('jp').progress <= 1);
S.addUse(speed.key, 'jp', null, speed.terms[0].price, speed.terms[0].benefit);
S.addUse(speed.key, 'jp', null, speed.terms[0].price, speed.terms[0].benefit);
S.addUse(speed.key, 'jp', null, speed.terms[0].price, speed.terms[0].benefit);
S.addUse(speed.key, 'jp', null, speed.terms[0].price, speed.terms[0].benefit);
ck('达到 5 次后 progress 封顶 1', S.totals('jp').progress === 1);
S.removeUse(speed.key);
ck('撤销一次', S.useCount(speed.key) === 4, S.useCount(speed.key));
S.setUseSaved(speed.key, 0, 30);
ck('手动改单次节省金额', S.usesOf(speed.key)[0].saved === 30, S.usesOf(speed.key)[0].saved);
S.togglePlan(speed.key);
ck('计划去可切换', S.isPlanned(speed.key) && S.plannedCount() === 1);
A.state.planned = true;
ck('筛选「只看计划去」生效', visible().length === 1 && visible()[0].key === speed.key, visible().length);
A.state.planned = false;
A.state.used = true;
ck('筛选「只看已使用」生效', visible().length === 1, visible().length);
A.state.used = false;
ck('localStorage 已写入', !!localStorage.getItem('jingjinji.card.v1'));
const persist = JSON.parse(localStorage.getItem('jingjinji.card.v1'));
ck('持久化含价格/计划/记录', persist.price.jp === 200 && !!persist.plans[speed.key] && persist.uses[speed.key].length === 4);
S.setActiveCard('zx');
ck('切换我的卡种', S.activeCard() === 'zx' && C.termOf(speed, S.activeCard()).onCard === false);
S.setActiveCard('jp');
S.reset();

/* ============================= ⑤ 事件链路 ============================= */
console.log('\n⑤ 事件链路（真实委托处理器）');
resetFilters();
fireAct('tab', { tab: 'list' });
ck('底部导航切到「景区」', A.state.tab === 'list');
ck('切换后渲染出列表', els['panel'].innerHTML.indexOf('class="row') >= 0);
fireAct('pill', { pill: 'region' });
ck('点筛选胶囊打开浮层', els['pop'].innerHTML.indexOf('全部地区') >= 0 && !els['pop'].hidden);
fireAct('opt', { k: 'region', v: '唐山' });
ck('浮层选地区后写入状态并收起', A.state.region === '唐山' && els['pop'].hidden, A.state.region);
fireAct('clearfilters');
ck('清空筛选', A.state.region === '' && visible().length === SPOTS.length);

fireAct('tab', { tab: 'map' });
const panda = SPOTS.find(x => x.name === '熊猫亲子乐园');
fireAct('sel', { i: String(panda.i) });
ck('选中景区后进入地图页', A.state.selI === panda.i && A.state.tab === 'map');
ck('景区浮卡渲染出来', !els['spotCard'].hidden && els['spotCard'].innerHTML.indexOf('熊猫亲子乐园') >= 0);
ck('浮卡含 门票/权益/状态 三格', els['spotCard'].innerHTML.indexOf('class="cell"') >= 0);

fireAct('plan', { key: panda.key });
ck('点「计划去」写入 store', S.isPlanned(panda.key));
fireAct('use', { key: panda.key });
ck('点「标记已使用」写入记录', S.useCount(panda.key) === 1);
fireAct('unuse', { key: panda.key });
ck('点「撤销一次」删除记录', S.useCount(panda.key) === 0);

fireAct('detail', { i: String(panda.i) });
ck('打开完整详情层', !els['detail'].hidden && els['detail'].innerHTML.indexOf('持卡权益与接待时间') >= 0);
ck('详情含使用记录区与联玩区', els['detail'].innerHTML.indexOf('我的记录') >= 0 && els['detail'].innerHTML.indexOf('一日联玩') >= 0);
fireAct('close-detail');
ck('关闭详情层', els['detail'].hidden);

fireAct('tab', { tab: 'plan' });
ck('联玩面板渲染', els['panel'].innerHTML.indexOf('一日联玩') >= 0);
fireAct('tab', { tab: 'card' });
ck('年卡面板含六项统计', ['已使用次数', '已节省金额', '净收益', '平均单次成本', '回本进度', '购买价格'].every(k => els['panel'].innerHTML.indexOf(k) >= 0));
fireChange({ act: 'setprice', card: 'jp' }, 288);
ck('年卡面板里改卡价生效', S.priceOf('jp') === 288, S.priceOf('jp'));
fireAct('toggle', { k: 'kidOnly' });
ck('联玩「只推亲子」可关闭', A.state.kidOnly === false);
A.state.kidOnly = true;
fireAct('notes');
ck('使用说明与图例可打开', els['detail'].innerHTML.indexOf('出游须知') >= 0 && els['detail'].innerHTML.indexOf('法定节假日') >= 0);
fireAct('closeshow');

/* ============================= ⑥ 渲染产物 ============================= */
console.log('\n⑥ 渲染产物与结构');
resetFilters(); A.state.tab = 'list'; A.render();
const lh = A.listHTML();
const rows = (lh.match(/class="row(?: [^"]*)?"/g) || []).length;
const groups = (lh.match(/class="grp"/g) || []).length;
console.log('  紧凑卡片:', rows, '| 分组标题:', groups, '| 含浮卡样式类:', /class="row-main"/.test(lh));
ck('列表已改成卡片（无 <table>）', lh.indexOf('<table') < 0 && lh.indexOf('<tr') < 0);
ck('卡片数量受 limit 约束', rows <= A.state.limit + groups, rows);
ck('每张卡片保留 名称/地区/门票/权益/状态', ['row-t', 'row-m', 'bpill', 'st '].every(k => lh.indexOf(k) >= 0));
ck('div 标签配对', (lh.match(/<div/g) || []).length === (lh.match(/<\/div>/g) || []).length);
ck('button 标签配对', (lh.match(/<button/g) || []).length === (lh.match(/<\/button>/g) || []).length);
ck('span 标签配对', (lh.match(/<span/g) || []).length === (lh.match(/<\/span>/g) || []).length);

const dh = A.detailHTML(SPOTS.find(x => x.name === '蟒山森林公园'));
ck('详情 div/span/button 配对',
  (dh.match(/<div/g) || []).length === (dh.match(/<\/div>/g) || []).length &&
  (dh.match(/<span/g) || []).length === (dh.match(/<\/span>/g) || []).length &&
  (dh.match(/<button/g) || []).length === (dh.match(/<\/button>/g) || []).length);
ck('两卡景区详情分卡列出权益', dh.indexOf('精品版') >= 0 && dh.indexOf('臻选版') >= 0);

console.log('  统计：总数=' + C.stats().total + ' 两卡=' + C.stats().both + ' 精=' + C.stats().jp +
  ' 臻=' + C.stats().zx + ' 可用=' + C.stats().avail + ' 亲子专属=' + C.stats().kid2);

/* HTML 结构 */
console.log('\n⑥b 页面分层结构');
ck('页面已无表格', html.indexOf('<table') < 0 && html.indexOf('</table>') < 0);
ck('地图容器在最外层', html.indexOf('id="map"') > 0);
['hudTop', 'pills', 'cardEntry', 'nav', 'panel', 'spotCard', 'sheet', 'sheetHandle', 'sheetBody', 'detail', 'pop', 'toast']
  .forEach(id => ck('悬浮层元素 #' + id, html.indexOf('id="' + id + '"') > 0));
ck('移动端筛选入口 #filterBtn', html.indexOf('id="filterBtn"') > 0);
ck('Bottom Sheet 有拖拽把手', html.indexOf('class="handle"') > 0);
ck('脚本顺序 data* → core → store → app',
  html.indexOf('core.js') < html.indexOf('store.js') && html.indexOf('store.js') < html.indexOf('app.js'));
ck('保留腾讯地图合规配置块', html.indexOf('_TMapSecurityConfig') > 0 && html.indexOf('_TMapService') > 0);
ck('图例与出游须知未丢失', html.indexOf('出游须知') > 0 && html.indexOf('亲子属性说明') > 0);

/* CSS */
console.log('\n⑥c 样式');
ck('CSS 花括号配对', (css.match(/{/g) || []).length === (css.match(/}/g) || []).length,
  (css.match(/{/g) || []).length + ' / ' + (css.match(/}/g) || []).length);
ck('地图铺满且不做背景模糊', /#map\s*{[^}]*position:\s*fixed/.test(css) && css.indexOf('#map') < css.indexOf('.glass'));
['.hud-top', '.pills', '.nav', '.panel', '.spotcard', '.sheet', '.detail', '.pop', '.glass']
  .forEach(k => ck('样式含 ' + k, css.indexOf(k) > 0));
ck('移动端断点存在（Bottom Sheet）', css.indexOf('@media (max-width: 899px)') > 0 && css.indexOf('.sheet-scroll') > 0);
ck('详情面板提高了不透明度', /\.d-wrap\s*{[^}]*rgba\(255,\s*255,\s*255,\s*\.9/.test(css));
ck('不是只给所有元素加模糊（地图与标记无 backdrop）', (css.match(/backdrop-filter/g) || []).length < 20,
  (css.match(/backdrop-filter/g) || []).length + ' 处');

/* ============================== ⑦ 移动端 ============================== */
console.log('\n⑦ 移动端布局切换');
window.innerWidth = 390; window.innerHeight = 780;
ck('识别为移动端', A.isMobile() === true);
A.state.tab = 'map'; A.state.selI = panda.i; A.state.snap = 1;
A.render();
ck('移动端显示 Bottom Sheet', els['sheet'].hidden === false);
ck('收起态只显示核心信息', els['sheetBody'].innerHTML.indexOf('class="cell"') >= 0 && els['sheetBody'].innerHTML.indexOf('我的记录') < 0);
A.state.snap = 3; A.render();
ck('全屏态显示完整权益/时间/预约/使用记录',
  els['sheetBody'].innerHTML.indexOf('持卡权益与接待时间') >= 0 && els['sheetBody'].innerHTML.indexOf('我的记录') >= 0);
ck('移动端隐藏浮卡与面板', els['spotCard'].hidden === true && els['panel'].hidden === true);
window.innerWidth = 1280; window.innerHeight = 820;
A.render();
ck('回桌面端恢复浮卡', els['spotCard'].hidden === false);

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
