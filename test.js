/* 用 mock document 加载 data*.js + app.js，实测合并结果 / 筛选 / 推荐 */
const fs = require('fs');
const vm = require('vm');

const els = {};
function mkEl(id) {
  const e = { id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, className: '', _ls: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(t, f) { (this._ls[t] = this._ls[t] || []).push(f); },
    fire(t) { (this._ls[t] || []).forEach(f => f({ target: this })); },
    querySelectorAll: () => [], querySelector: () => null,
    closest: () => null, scrollIntoView() {} };
  return e;
}
const document = {
  getElementById: id => (els[id] = els[id] || mkEl(id)),
  querySelectorAll: () => [], querySelector: () => null, addEventListener() {}
};
const window = { SCENIC: null, CATALOG: {}, _TMapSecurityConfig: {} };
const ctx = { window, document, console, Date, Math, JSON, String, Number, Set, Map, Array, Object, TMap: undefined };
vm.createContext(ctx);
['data.js', 'data-jp.js', 'data-zx.js'].forEach(f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
vm.runInContext(fs.readFileSync('app.js', 'utf8').replace('initMap();', ''), ctx, { filename: 'app.js' });
const api = vm.runInContext('({SPOTS,REGIONS,CARDS,render,select,recommend,keyOf,norm,winOf,getRec:()=>recI,getSel:()=>selI,getVisible:()=>visibleN,vCount:()=>visible.length})', ctx);

const S = api.SPOTS;
let pass = 0, fail = 0;
function ck(label, cond, extra) {
  (cond ? pass++ : fail++);
  console.log('  ' + (cond ? '✔' : '✘') + ' ' + label + (extra !== undefined ? '  → ' + extra : ''));
}
console.log('① 合并结果');
console.log('  景区数:', S.length, '| 地区数:', api.REGIONS.length);
const cCount = { jp: 0, zx: 0, both: 0 };
S.forEach(s => { if (s.cards.length > 1) cCount.both++; else if (s.cards[0] === 'jp') cCount.jp++; else cCount.zx++; });
console.log('  单卡/两卡:', JSON.stringify(cCount), '| kid:', JSON.stringify(S.reduce((a, s) => (a[s.kid] = (a[s.kid] || 0) + 1, a), {})));
console.log('  p :', JSON.stringify(S.reduce((a, s) => (a[s.p] = (a[s.p] || 0) + 1, a), {})));
ck('坐标齐全且不越界', S.every(s => s.lat && s.lng && s.lat > 30 && s.lat < 45 && s.lng > 110 && s.lng < 125));
ck('无空名称 / 无空权益', S.every(s => s.name) && S.every(s => s.terms.every(t => t.benefit)));
ck('两卡共有的行都是 multi=true', S.filter(s => s.cards.length > 1).every(s => s.multi));
ck('行数 = 精品版行数(200) + 仅臻选版新增行', S.length === 200 + S.filter(s => s.cards.indexOf('jp') < 0).length,
  200 + ' + ' + S.filter(s => s.cards.indexOf('jp') < 0).length + ' = ' + S.length);

const cEl = els['card'], rEl = els['region'], bEl = els['benefit'], kEl = els['kid'], qEl = els['q'];
function shown() { return +els['shown'].textContent; }
function set(el, v) { el.value = v; el.fire('change'); }

console.log('\n② 卡种筛选');
set(cEl, 'all'); ck('全部 = 总数', shown() === S.length, shown());
set(cEl, 'jp'); ck('精品版 = 收录精品版的行数', shown() === S.filter(s => s.cards.indexOf('jp') >= 0).length, shown());
set(cEl, 'zx'); ck('臻选版', shown() === S.filter(s => s.cards.indexOf('zx') >= 0).length, shown());
set(cEl, 'both'); ck('仅两卡共有', shown() === cCount.both, shown());
set(cEl, 'all');

console.log('\n③ 亲子筛选');
set(kEl, '2'); ck('亲子专属 = 33 个景区（34 行，杰嘉花乐园两种权益各一行）', shown() === S.filter(s => s.kid === 2).length, shown());
set(kEl, '1'); ck('亲子友好（含家庭）', shown() === S.filter(s => s.kid >= 1).length, shown());
set(kEl, 'n2'); ck('非亲子专属 = 总数 − 亲子专属 = kid!=2', shown() === S.filter(s => s.kid !== 2).length, shown());
set(kEl, '0'); ck('仅非亲子 / 成人向 = kid==0', shown() === S.filter(s => s.kid === 0).length, shown());
set(kEl, '');
ck('亲子专属 + 非亲子专属 = 总数', S.filter(s => s.kid === 2).length + S.filter(s => s.kid !== 2).length === S.length);

console.log('\n④ 推荐');
function pick(name) {
  const s = S.find(x => x.name === name);
  if (!s) { console.log('  找不到 ' + name); return []; }
  api.select(s.i, false);
  const r = api.getRec();
  console.log('  ' + name + ' → ' + (r.length ? r.map(i => S[i].name + '(' + (S[i].cards.length > 1 ? '两卡' : S[i].cards[0]) + ',kid' + S[i].kid + ')').join('、') : '（无）'));
  return r;
}
set(qEl, ''); set(cEl, 'all'); set(kEl, ''); set(rEl, '');
const r1 = pick('国家速滑馆');
ck('推荐结果都不含成人向(kid=0)', r1.every(i => S[i].kid !== 0));
['唐山皮影主题乐园', '中央电视塔', '熊猫亲子乐园', '盘山', '慕田峪长城', '蟒山森林公园'].forEach(pick);

console.log('\n⑤ 推荐受筛选约束（原来会连线到被隐藏的景区）');
set(rEl, '唐山');
const r2 = pick('唐山皮影主题乐园');
ck('地区=唐山 时推荐都在唐山', r2.every(i => S[i].region === '唐山'));
set(rEl, ''); set(cEl, 'zx');
const r3 = pick('蟒山森林公园');
ck('卡种=臻选版 时推荐都可被臻选版覆盖', r3.every(i => S[i].cards.indexOf('zx') >= 0));
set(cEl, 'both');
const r4 = pick('蟒山森林公园');
ck('卡种=两卡共有 时推荐也都两卡共存', r4.every(i => S[i].cards.length > 1));
set(cEl, 'all'); set(kEl, '2');
const r5 = pick('熊猫亲子乐园');
ck('亲子专属 时推荐都是 kid=2', r5.every(i => S[i].kid === 2));
set(kEl, '');
set(qEl, '动物园');
const r6 = pick(S.find(x => x.name.includes('野生动物')).name);
ck('搜索「动物园」时推荐只来自搜索结果', r6.every(i => { const s = S[i]; return s.name.toLowerCase().includes('动物园') || s.terms.some(t => (t.note || '').toLowerCase().includes('动物园')); }));
set(qEl, '');

console.log('\n⑥ 渲染产物');
api.render();
const h = els['tb'].innerHTML;
console.log('  行数:', (h.match(/<tr class="item/g) || []).length, '| 地区行:', (h.match(/<tr class="region"/g) || []).length);
ck('tr 标签配对', (h.match(/<tr/g) || []).length === (h.match(/<\/tr>/g) || []).length);
ck('td 标签配对', (h.match(/<td/g) || []).length === (h.match(/<\/td>/g) || []).length);
ck('每行 5 个 td', (h.match(/<td/g) || []).length === (h.match(/<tr class="item/g) || []).length * 5 + (h.match(/<tr class="region"/g) || []).length);
console.log('  统计卡: 总数=' + els['st-total'].textContent + ' 两卡=' + els['st-both'].textContent +
  ' 精=' + els['st-jp'].textContent + ' 臻=' + els['st-zx'].textContent +
  ' 可用=' + els['st-avail'].textContent + ' N=' + els['st-n'].textContent + ' U=' + els['st-u'].textContent +
  ' 亲子专属=' + els['st-kid2'].textContent);
const css = fs.readFileSync('styles.css', 'utf8');
ck('CSS 花括号配对', (css.match(/{/g) || []).length === (css.match(/}/g) || []).length);

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
