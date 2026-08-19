// 解读层（滴天髓 + 周易 双典参证）：读取排盘 JSON，按「八字报告生成提示词 V2」输出
// 首栏为文言文「命局总览」(120-200字)，其后为白话文分板块详解；最后附《周易》参证。
const C = require('./constants');
const D = require('./ditiansui');
const Z = require('./zhouyi');
const { sanitize } = require('./nlp');

function pillarElements(pillar) {
  const gan = pillar[0], zhi = pillar[1];
  return [C.elementOfGan(gan), C.ZHI_MAIN[zhi]].filter(Boolean);
}
function containsSet(arr, set) { return arr.some((e) => set.includes(e)); }

// 四柱藏干展开（天干 + 地支本气 + 藏干）
function pillarHidden(chart) {
  const names = ['年柱', '月柱', '日柱', '时柱'];
  const pillars = [chart.sizhu.year, chart.sizhu.month, chart.sizhu.day, chart.sizhu.hour];
  return pillars.map((p, i) => {
    const zhi = p[1];
    const hidden = (C.ZHI_HIDDEN[zhi] || []).map((g) => `${g}(${C.elementOfGan(g)})`).join('、');
    return `${names[i]} ${p[0]}(${C.elementOfGan(p[0])})${zhi}(${C.ZHI_MAIN[zhi]})，藏干 ${hidden || '无'}`;
  }).join('\n');
}

// 月令旺相休囚死判定（辰戌丑未四季土月单独处理）
function lingState(dmEl, monthZhi) {
  const season = ['辰', '戌', '丑', '未'].includes(monthZhi) ? '四季' : D.SEASON[monthZhi];
  const tbl = C.SEASON_WANGXIU[season];
  let state = null;
  for (const [st, el] of Object.entries(tbl)) { if (el === dmEl) { state = st; break; } }
  const note = {
    旺: '得月令，先天底气最足（得令）',
    相: '得月令生扶，先天得势（相）',
    休: '在月令处于休态，先天偏弱',
    囚: '在月令处于囚态，先天受制',
    死: '在月令处于死态，先天最弱',
  };
  return { season, state, note: note[state] };
}

// 全局生扶 vs 克泄耗 量化统计
function quantify(chart) {
  const dm = C.elementOfGan(chart.day_master);
  let sheng = 0, ke = 0;
  const classify = (we) => (we === dm || C.SHENG[we] === dm) ? 'sheng' : 'ke';
  const pillars = [chart.sizhu.year, chart.sizhu.month, chart.sizhu.day, chart.sizhu.hour];
  pillars.forEach((p, idx) => {
    if (idx !== 2) {
      if (classify(C.elementOfGan(p[0])) === 'sheng') sheng += 1; else ke += 1;
    }
    const hidden = C.ZHI_HIDDEN[p[1]] || [];
    hidden.forEach((g, k) => {
      const we = C.elementOfGan(g);
      const w = C.HIDDEN_WEIGHT[k] || 0.3;
      if (idx === 2 && we === dm) return;
      if (classify(we) === 'sheng') sheng += w; else ke += w;
    });
  });
  return { sheng: +sheng.toFixed(1), ke: +ke.toFixed(1) };
}

// 生扶方 / 克泄耗方 具体干支（用于白话列举）
function shengKeDetail(chart) {
  const dm = C.elementOfGan(chart.day_master);
  const shengList = [], keList = [];
  const pillars = [chart.sizhu.year, chart.sizhu.month, chart.sizhu.day, chart.sizhu.hour];
  pillars.forEach((p, idx) => {
    if (idx !== 2) {
      const g = p[0], ge = C.elementOfGan(g);
      if (ge === dm || C.SHENG[ge] === dm) shengList.push(g); else keList.push(g);
    }
    const hidden = C.ZHI_HIDDEN[p[1]] || [];
    hidden.forEach((g) => {
      const we = C.elementOfGan(g);
      if (idx === 2 && we === dm) return;
      if (we === dm || C.SHENG[we] === dm) shengList.push(`${g}(${p[1]}藏)`); else keList.push(`${g}(${p[1]}藏)`);
    });
  });
  return { shengList, keList };
}

// 根气判定
function rootInfo(chart) {
  const dm = C.elementOfGan(chart.day_master);
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  let strongRoot = 0, anyRoot = 0;
  const strongPos = [];
  zhis.forEach((z, idx) => {
    const posName = ['年支', '月支', '日支', '时支'][idx];
    if (idx === 2) {
      if (C.ZHI_MAIN[z] === dm) { strongRoot++; strongPos.push(posName); }
      else if ((C.ZHI_HIDDEN[z] || []).some((g) => C.elementOfGan(g) === dm)) anyRoot++;
      return;
    }
    if (C.ZHI_MAIN[z] === dm) { strongRoot++; anyRoot++; strongPos.push(posName); }
    else if ((C.ZHI_HIDDEN[z] || []).some((g) => C.elementOfGan(g) === dm)) anyRoot++;
  });
  return { strongRoot, anyRoot, hasRoot: anyRoot > 0, strongPos };
}

// 得势判定：天干比劫、印星帮衬
function deShi(chart) {
  const dm = C.elementOfGan(chart.day_master);
  const gans = [chart.sizhu.year[0], chart.sizhu.month[0], chart.sizhu.hour[0]];
  const names = ['年干', '月干', '时干'];
  const list = [];
  gans.forEach((g, i) => {
    const ge = C.elementOfGan(g);
    const shen = C.shiShen(chart.day_master, g);
    if (ge === dm || C.SHENG[ge] === dm) list.push(`${names[i]}${g}（${shen}）`);
  });
  return { list, hasShi: list.length > 0 };
}

// 干支作用关系（天干五合/相冲 + 地支三合/三会/六合/六冲/相刑/相害）
function coordination(chart) {
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  const gans = [chart.sizhu.year[0], chart.sizhu.month[0], chart.sizhu.day[0], chart.sizhu.hour[0]];
  const notes = [];
  Object.keys(D.SANHE).forEach((k) => { if (k.split('').every((c) => zhis.includes(c))) notes.push(`地支${k}三合${D.SANHE[k]}局，气势凝聚`); });
  Object.keys(C.SANHUI).forEach((k) => { if (k.split('').every((c) => zhis.includes(c))) notes.push(`地支${k}三会${C.SANHUI[k]}方，一行能量汇聚放大`); });
  for (let i = 0; i < zhis.length; i++) for (let j = i + 1; j < zhis.length; j++) {
    const p1 = zhis[i] + zhis[j], p2 = zhis[j] + zhis[i];
    if (D.LIUHE[p1] || D.LIUHE[p2]) notes.push(`地支${zhis[i]}${zhis[j]}六合（合${D.LIUHE[p1] || D.LIUHE[p2]}），主牵绊结缘`);
    if (D.LIUCHONG.includes(p1) || D.LIUCHONG.includes(p2)) notes.push(`地支${zhis[i]}${zhis[j]}六冲，主变动起伏、根基动摇`);
    if (C.XING_PAIRS.includes(p1) || C.XING_PAIRS.includes(p2)) notes.push(`地支${zhis[i]}${zhis[j]}相刑，主是非内耗、暗伤`);
    if (C.HAI_PAIRS.includes(p1) || C.HAI_PAIRS.includes(p2)) notes.push(`地支${zhis[i]}${zhis[j]}相害，主小人暗中损耗`);
  }
  C.XING_SELF.forEach((z) => { if (zhis.filter((x) => x === z).length > 1) notes.push(`地支${z}自刑，主内心纠结`); });
  const he = { '甲己': '土', '乙庚': '金', '丙辛': '水', '丁壬': '木', '戊癸': '火' };
  for (let i = 0; i < gans.length; i++) for (let j = i + 1; j < gans.length; j++) {
    const k1 = gans[i] + gans[j], k2 = gans[j] + gans[i];
    if (he[k1] || he[k2]) notes.push(`天干${gans[i]}${gans[j]}五合（化${he[k1] || he[k2]}），主牵缠合作、性情圆融`);
    if (C.GAN_CHONG.includes(k1) || C.GAN_CHONG.includes(k2)) notes.push(`天干${gans[i]}${gans[j]}相冲，主思想矛盾、人际对立`);
  }
  return notes;
}

// 空亡（以日柱查旬空）
function xunKong(chart) {
  const g = C.ganIndex(chart.sizhu.day[0]);
  const z = C.zhiIndex(chart.sizhu.day[1]);
  const zs = ((z - g) % 12 + 12) % 12; // 旬首地支序号
  const k1 = C.ZHI[((zs - 1) % 12 + 12) % 12];
  const k2 = C.ZHI[((zs - 2) % 12 + 12) % 12];
  // 按地支顺序排（如甲子旬空亡戌亥，而非亥戌）
  return [k1, k2].sort((a, b) => C.ZHI.indexOf(a) - C.ZHI.indexOf(b));
}

// 流年干支（公元年份 → 六十甲子）
function liunianGanzhi(year) {
  const g = C.GAN[((year - 4) % 10 + 10) % 10];
  const z = C.ZHI[((year - 4) % 12 + 12) % 12];
  return `${g}${z}`;
}

// 十神 → 人事范畴
const SHEN_DOMAIN = {
  正官: '事业、规则、名声、职场压力、管制；女命又看配偶',
  七杀: '魄力、挑战、压力；女命又看配偶（偏夫）',
  正财: '收入、资产、物质；男命又看配偶',
  偏财: '流动之财、人缘机变；男命又看配偶（偏妻）',
  正印: '长辈、学历、贵人、房产、内心安全感',
  偏印: '特殊才华、冷门学问、偏门贵人',
  食神: '才华、表达、口福、创造力',
  伤官: '才艺外露、不拘礼法、欲望想法',
  比肩: '朋友、同辈、竞争对手、手足',
  劫财: '仗义行动、同辈分财、合作竞争',
};
function shenCategory(s) {
  if (s === '正官' || s === '七杀') return '官杀';
  if (s === '正财' || s === '偏财') return '财星';
  if (s === '正印' || s === '偏印') return '印星';
  if (s === '食神' || s === '伤官') return '食伤';
  return '比劫';
}

// ── 去模板化工具：确定性哈希与句池选择（同输入必同输出，杜绝 Math.random，保证同一八字结果可复现）──
function stableHash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pickFrom(pool, seedStr) {
  return pool[stableHash(String(seedStr)) % pool.length];
}
// 种子：日主干序 + 月支序 + 格局 + 旺衰 + 特殊格局 + 附加因子
function seedOf(chart, extra) {
  return [
    C.ganIndex(chart.day_master),
    C.zhiIndex(chart.sizhu.month[1]),
    chart.geju || '',
    chart.strength || '',
    chart.special_geju || '',
    extra || '',
  ].join('|');
}
// 某十神在四柱的落点（透干/藏支 + 柱位 + 干支）
function shenLocations(chart, shen) {
  const pillars = [chart.sizhu.year, chart.sizhu.month, chart.sizhu.day, chart.sizhu.hour];
  const posGan = ['年干', '月干', '日干', '时干'];
  const posZhi = ['年支', '月支', '日支', '时支'];
  const out = [];
  pillars.forEach((p, i) => {
    if (i !== 2 && C.shiShen(chart.day_master, p[0]) === shen) {
      out.push({ via: '透干', pos: posGan[i], gz: p[0], main: true });
    }
    (C.ZHI_HIDDEN[p[1]] || []).forEach((g, k) => {
      if (C.shiShen(chart.day_master, g) === shen) {
        out.push({ via: k === 0 ? '本气' : '藏干', pos: posZhi[i], gz: `${p[1]}中${g}`, main: k === 0 });
      }
    });
  });
  return out;
}
// 配偶星（男财女官杀）落点
function spouseStar(chart) {
  const isMale = chart.birth.gender === '男';
  const targetShens = isMale ? ['正财', '偏财'] : ['正官', '七杀'];
  const locs = [];
  targetShens.forEach((s) => {
    shenLocations(chart, s).forEach((x) => locs.push({ shen: s, ...x }));
  });
  return { isMale, targetShens, locs };
}
// 十神五大类落点
function categoryLocs(chart) {
  const map = { 官杀: [], 财星: [], 印星: [], 食伤: [], 比劫: [] };
  Object.keys(chart.shishen_distribution || {}).forEach((s) => {
    const cat = shenCategory(s);
    if (!map[cat]) return;
    shenLocations(chart, s).forEach((x) => map[cat].push({ shen: s, ...x }));
  });
  return map;
}
// 落点描述（透干/藏支）
function locDesc(loc) {
  return loc.via === '透干' ? `${loc.pos}${loc.gz}透「${loc.shen}」` : `${loc.pos}${loc.gz}藏「${loc.shen}」`;
}

// 调候分析
function tiaoHou(monthZhi) {
  const season = D.SEASON[monthZhi];
  let kind, needEl, need;
  if (monthZhi === '丑' || monthZhi === '辰') { kind = '湿土厚重'; needEl = '火'; need = '用火制土除湿、暖局'; }
  else if (monthZhi === '未' || monthZhi === '戌') { kind = '燥土焦枯'; needEl = '水'; need = '用水润燥、润土生金'; }
  else if (monthZhi === '亥' || monthZhi === '子') { kind = '冬水寒凝'; needEl = '火'; need = '用火暖局'; }
  else if (monthZhi === '巳' || monthZhi === '午') { kind = '火旺燥热'; needEl = '水'; need = '用水降温润燥'; }
  else if (monthZhi === '申') { kind = '初秋金旺、暑气未消'; needEl = '水'; need = '用水润金（金白水清），兼防燥'; }
  else if (monthZhi === '酉') { kind = '仲秋金肃、天气渐寒'; needEl = '火'; need = '用火温局，防金寒水冷'; }
  else { kind = '春气温润平和'; needEl = null; need = '寒暖尚匀，调候非急，可随旺衰取用'; }
  return { season, kind, needEl, need };
}

// 五行 → 脏腑
const HEALTH = { 金: '肺与呼吸道', 木: '肝胆', 水: '肾与泌尿生殖', 火: '心与血液循环', 土: '脾胃消化系统' };

// 五行全计（天干 + 地支藏干全计），用于健康偏枯判断（比表面五行更贴近"气"的真实分布）
function wuxingFull(chart) {
  const cnt = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  [chart.sizhu.year, chart.sizhu.month, chart.sizhu.day, chart.sizhu.hour].forEach((p) => {
    cnt[C.elementOfGan(p[0])] += 1; // 天干
    (C.ZHI_HIDDEN[p[1]] || []).forEach((g) => { cnt[C.elementOfGan(g)] += 1; }); // 地支藏干全计
  });
  return cnt;
}

// 喜用神 → 行业 / 方位 / 颜色（《穷通宝鉴》类象体系）
const INDUSTRY = {
  木: '文教、出版、园林林业、服装纺织、家具、中医中药',
  火: '能源电力、餐饮、互联网、影视广告、美容、电子',
  土: '地产建筑、农业、陶瓷、仓储、咨询',
  金: '金融银行、机械五金、汽车、珠宝、法律、军警',
  水: '物流运输、水产、贸易、旅游酒店、酒水、咨询',
};
const DIRECTION = { 木: '东方', 火: '南方', 土: '中央/西南/东北', 金: '西方', 水: '北方' };
const COLOR = { 木: '青、绿、翠色', 火: '红、紫、橙色', 土: '黄、棕、咖啡色', 金: '白、银、金色', 水: '黑、蓝、深灰色' };

// 十神组合效应
function shenCombo(chart) {
  const dist = chart.shishen_distribution || {};
  const has = (k) => (dist[k] || 0) > 0;
  const out = [];
  if (has('七杀') && (has('正印') || has('偏印'))) out.push('杀印相生——压力反成功名，易得贵人或权威提携');
  if (has('伤官') && has('正官')) out.push('伤官见官——才华与规则冲突，易有口舌是非，须以印化解');
  if ((has('正财') || has('偏财')) && has('七杀')) out.push('财生杀党——压力多源于钱财或人事，宜稳财守成');
  if ((has('比肩') || has('劫财')) && (has('正财') || has('偏财'))) out.push('比劫夺财——合作易分财，破财竞争信号，理财宜独不宜众');
  return out;
}

// 格局简称（文言用）
function gejuShort(chart) {
  const g = chart.geju;
  if (g.includes('七杀')) return '七杀格';
  if (g.includes('正官')) return '正官格';
  if (g.includes('食神')) return '食神格';
  if (g.includes('伤官')) return '伤官格';
  if (g.includes('印')) return '印格';
  if (g.includes('财')) return '财格';
  if (g.includes('建禄') || g.includes('月劫') || g.includes('比劫')) return '建禄格';
  return '中和格';
}

// ───────────────────────────────────────────────
// 栏一：命局总览（文言文，120-200字，针对具体命局）
// ───────────────────────────────────────────────
function mingjuZonglan(chart) {
  const dm = chart.day_master;
  const dmName = D.TIANGAN[dm].name;
  const dmShow = D.TIANGAN[dm].show;
  const mz = chart.sizhu.month[1];
  const gs = gejuShort(chart);
  const yueShen = chart.shishen._zhi_main.month; // 月支本气十神
  const season = D.SEASON[mz];

  let tiaoW;
  if (mz === '丑' || mz === '辰') tiaoW = '湿土厚重，须火燥之';
  else if (mz === '未' || mz === '戌') tiaoW = '燥土焦枯，须水润之';
  else if (mz === '亥' || mz === '子') tiaoW = '冬令寒凝，须火暖局';
  else if (mz === '巳' || mz === '午') tiaoW = '夏令炎燥，须水润局';
  else if (mz === '申') tiaoW = '初秋金旺，暑气未消，喜水润金';
  else if (mz === '酉') tiaoW = '仲秋金肃，天气渐寒，喜火温润';
  else tiaoW = '春气和煦，调候非急';

  let wsW;
  if (chart.strength === '身弱') wsW = '日主根浅，克泄交加，身弱之象';
  else if (chart.strength === '身强') wsW = '日主得势，生扶有力，身旺之象';
  else wsW = '日主刚柔相济，中和之象';

  const rt = rootInfo(chart);
  const rootW = rt.hasRoot
    ? (rt.strongRoot > 0 ? `地支${rt.strongPos.join('、')}见本气之根` : '地支仅见余气之根')
    : '地支几无本气之根，全赖印绶相生';

  // 天干十神概述
  const yg = chart.sizhu.year[0], mg = chart.sizhu.month[0], hg = chart.sizhu.hour[0];
  const ygs = chart.shishen.year_gan, mgs = chart.shishen.month_gan, hgs = chart.shishen.hour_gan;

  let yjW;
  if (chart.strength === '身弱') yjW = `喜${chart.yongshen}帮身，忌${chart.jishen}再增克泄`;
  else if (chart.strength === '身强') yjW = `喜${chart.yongshen}泄克，忌${chart.jishen}再助`;
  else yjW = `以${chart.yongshen}流通为要`;

  const dashiMap = {
    七杀格: '宜于权柄职守，化压力为功名',
    正官格: '宜入大平台循规而进，借贵人之力而成事',
    食神格: '宜以才艺饮食生财，靠技术本领安身',
    伤官格: '宜以技艺创意扬名，不居人下',
    印格: '宜文教钻研，得长者提携庇护',
    财格: '宜经商理财，善聚四方之财',
    建禄格: '宜自立合伙，白手起家',
    中和格: '宜顺势而为，随运取用',
  };
  const dashi = dashiMap[gs] || '宜顺势而为';

  // 中年大运走势（约25-55岁所行大运是否贴用神），动态判断晚运，避免与盘面脱节的固定套话
  const yongEls = chart.yongshen.split('、');
  const midYun = (chart.dayun || []).filter((d) => d.start_age >= 25 && d.start_age <= 55);
  const midGood = midYun.some((d) => {
    const els = [C.elementOfGan(d.pillar[0]), C.ZHI_MAIN[d.pillar[1]]];
    return els.some((e) => yongEls.includes(e));
  });
  const wanYun = midGood ? '中年行运渐入佳境，枯木逢春，晚景安泰' : '中年行运多经磨砺，须守中蓄力、待时而发，晚岁方宁';

  return `${dmName}（${dmShow}）生于${mz}月，${gs}也，月令${yueShen}司权，月干透${mgs}。${tiaoW}；${wsW}，${rootW}。年干${yg}为${ygs}、月干${mg}为${mgs}、时干${hg}为${hgs}，各司其位。全局${yjW}。${dashi}，${wanYun}。`;
}

// ───────────────────────────────────────────────
// 栏二：命盘基础信息（表格形式）
// ───────────────────────────────────────────────
function jichu(chart) {
  const s = chart.sizhu;
  const kong = xunKong(chart);
  const zhis = [s.year[1], s.month[1], s.day[1], s.hour[1]];
  const kongHit = ['年支', '月支', '日支', '时支'].filter((_, i) => kong.includes(zhis[i]));
  const yearGan = s.year[0];
  const yangYear = C.isYang(C.ganIndex(yearGan));
  const isMale = chart.birth.gender === '男';
  const forward = (yangYear && isMale) || (!yangYear && !isMale);
  const qiYun = (chart.dayun && chart.dayun[0]) ? chart.dayun[0].start_age : '—';
  const dayunTxt = (chart.dayun || []).map((d) => `${d.start_age}岁${d.pillar}`).join('、');
  const approx = chart.birth.longitude_approx ? '（经度按120°E近似）' : '';
  const lines = [
    `公历出生   ${chart.birth.gregorian}`,
    `真太阳时   ${chart.birth.true_solar_time}（经度${chart.birth.longitude}°E，校正${chart.birth.long_corr}分钟${approx}）`,
    `性别       ${chart.birth.gender}`,
    `出生地     ${chart.birth.city || '—'}（经度${chart.birth.longitude}°E）`,
    `年柱       ${s.year[0]}${s.year[1]}（藏干：${(C.ZHI_HIDDEN[s.year[1]] || []).join('、')}）`,
    `月柱       ${s.month[0]}${s.month[1]}（藏干：${(C.ZHI_HIDDEN[s.month[1]] || []).join('、')}）`,
    `日柱       ${s.day[0]}${s.day[1]}（日主${s.day[0]}；藏干：${(C.ZHI_HIDDEN[s.day[1]] || []).join('、')}）`,
    `时柱       ${s.hour[0]}${s.hour[1]}（藏干：${(C.ZHI_HIDDEN[s.hour[1]] || []).join('、')}）`,
    `空亡       ${kong.join('、')}${kongHit.length ? '（命局' + kongHit.join('、') + '逢空）' : '（命局四柱无逢空）'}`,
    `大运       ${qiYun}岁起运（${forward ? '顺' : '逆'}排）：${dayunTxt}`,
  ];
  return lines.join('\n');
}

// ───────────────────────────────────────────────
// 栏三：命局旺衰深度解析（日主本性/得令/得地/得势/力量对比/结论/调候）
// ───────────────────────────────────────────────
// 旺衰结论：多因子交叉（旺衰 × 得令态 × 根气位置 × 克泄耗具体干支 × 调候），句池确定性选句
function wangshuaiSummary(chart, ling, rt, det, th) {
  const dm = chart.day_master;
  const dmEl = C.elementOfGan(dm);
  const mz = chart.sizhu.month[1];
  const strength = chart.strength;

  let rootTxt;
  if (rt.strongRoot > 0) rootTxt = `${dmEl}行本气强根见于${rt.strongPos.join('、')}`;
  else if (rt.anyRoot > 0) rootTxt = `${dmEl}行仅有余气之根，根浮不固`;
  else rootTxt = `四柱地支几无${dmEl}行根气`;

  const keTxt = det.keList.length ? det.keList.slice(0, 3).join('、') : '无';
  const shengTxt = det.shengList.length ? det.shengList.slice(0, 3).join('、') : '无';
  const tiaoTxt = th.needEl ? `；月令${mz}属「${th.kind}」，需「${th.needEl}」调候` : '；寒暖尚匀，无调候之扰';

  const pools = {
    身弱: [
      `其因在于：日主${dm}（${dmEl}）生${mz}月而处「${ling.state}」地，${rootTxt}，复受${keTxt}等克泄耗，生扶仅靠${shengTxt}${tiaoTxt}。`,
      `推原其故：${dm}日主于月令${mz}「${ling.state}」，${rootTxt}，克泄耗（${keTxt}）偏重、帮身（${shengTxt}）不足${tiaoTxt}。`,
      `${dm}日主${rootTxt}，月令${mz}「${ling.state}」，${keTxt}层层耗泄而${shengTxt}势孤，众寡不敌${tiaoTxt}。`,
    ],
    身强: [
      `其因在于：日主${dm}（${dmEl}）得${mz}月「${ling.state}」之令，${rootTxt}，生扶有${shengTxt}，克泄耗仅${keTxt}，气势偏旺${tiaoTxt}。`,
      `推原其故：${dm}日主于月令${mz}「${ling.state}」，${rootTxt}，生扶（${shengTxt}）有力、克泄（${keTxt}）不敌${tiaoTxt}。`,
      `${dm}日主${rootTxt}，月令${mz}「${ling.state}」，${shengTxt}层层帮身而${keTxt}势孤，故身旺${tiaoTxt}。`,
    ],
    中和: [
      `其因在于：日主${dm}（${dmEl}）生${mz}月处「${ling.state}」，${rootTxt}，生扶（${shengTxt}）与克泄（${keTxt}）大体相抵，刚柔得中${tiaoTxt}。`,
      `推原其故：${dm}日主于月令${mz}「${ling.state}」，${rootTxt}，生扶（${shengTxt}）与克泄耗（${keTxt}）旗鼓相当，故中和${tiaoTxt}。`,
      `${dm}日主${rootTxt}，月令${mz}「${ling.state}」，${shengTxt}与${keTxt}相衡，无偏胜之弊${tiaoTxt}。`,
    ],
  };
  return pickFrom(pools[strength] || pools['中和'], seedOf(chart, 'wangshuai'));
}

function wangshuai(chart) {
  const dm = chart.day_master;
  const dmEl = C.elementOfGan(dm);
  const ling = lingState(dmEl, chart.sizhu.month[1]);
  const q = quantify(chart);
  const det = shengKeDetail(chart);
  const rt = rootInfo(chart);
  const ds = deShi(chart);
  const th = tiaoHou(chart.sizhu.month[1]);
  const yong = chart.yongshen.split('、');

  const summary = wangshuaiSummary(chart, ling, rt, det, th);

  const tiaoTong = th.needEl
    ? (yong.includes(th.needEl) ? `调候用神（${th.needEl}）与扶身用神（${chart.yongshen}）${chart.yongshen.includes(th.needEl) ? '重合，用神专一，行运改善明显' : '方向一致'}。` : `调候用神（${th.needEl}）与扶身用神（${chart.yongshen}）不尽相同，取用时以月令气候刚需为优先（调候为急，扶抑次之），二者兼顾。`)
    : '此命寒暖尚匀，调候非急，以旺衰扶抑取用为主。';

  // 特殊格局判定（从格/专旺）：《滴天髓》"从得真者只论从"；已按此自动切换喜忌取用
  let special = '';
  if (chart.special_geju === 'cong') {
    special = '【特殊格局判定】日主无根无生、孤立无援，定为「从格」——弃命从势，取用克泄耗（顺其旺势），忌印比帮扶。本命喜忌已按从格取用。\n';
  } else if (chart.special_geju === 'zhuanwang') {
    special = '【特殊格局判定】满局生扶、克泄耗几无，定为「专旺格」——顺其旺势，用食伤泄秀，忌财官逆制。本命喜忌已按专旺取用。\n';
  }

  return (
    `【日主本性】你的日主是「${dm}」（属${dmEl}行），${C.GAN_NATURE[dm]}，这是你先天性格的底色。\n` +
    `【得令判定】月令${chart.sizhu.month[1]}属${ling.season === '四季' ? '四季土月' : ling.season + '季'}，日主${dmEl}行在其中处于「${ling.state}」——${ling.note}。\n` +
    `【得地判定】日主在地支有${rt.strongRoot}处本气强根${rt.strongPos.length ? '（' + rt.strongPos.join('、') + '）' : ''}、共${rt.anyRoot}处根气${rt.hasRoot ? '' : '（几无根气，仅靠印生，身弱倾向明显）'}。\n` +
    `【得势判定】天干帮衬：${ds.hasShi ? ds.list.join('、') + '，比劫印星生扶，得势' + (ds.list.length >= 2 ? '有力' : '尚可') : '天干无比劫印星帮身，得势微弱，多靠自身与地支根气'}。\n` +
    `【全局力量对比】生扶方（印+比劫）有：${det.shengList.join('、') || '无'}；克泄耗方（官杀+食伤+财）有：${det.keList.join('、') || '无'}。加权统计：生扶≈${q.sheng}，克泄耗≈${q.ke}（地支重于天干、本气重于藏干、紧贴重于远隔）。\n` +
    `【旺衰最终结论】综合月令+全局力量+根气，判定为「${chart.strength}」（旺衰评分约 ${chart.strength_score}，仅作参考）。${summary}\n` +
    special +
    `【调候分析】你出生在${th.season}季（月令${chart.sizhu.month[1]}），格局偏「${th.kind}」，${th.need}。${tiaoTong}`
  );
}

// 天干五合化气三条件检验
function ganHeHua(chart) {
  const gans = [chart.sizhu.year[0], chart.sizhu.month[0], chart.sizhu.day[0], chart.sizhu.hour[0]];
  const pos = ['年干', '月干', '日干', '时干'];
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  const he = { '甲己': '土', '乙庚': '金', '丙辛': '水', '丁壬': '木', '戊癸': '火' };
  const mz = chart.sizhu.month[1];
  const season = ['辰', '戌', '丑', '未'].includes(mz) ? '四季' : D.SEASON[mz];
  const tbl = C.SEASON_WANGXIU[season];
  const result = [];
  // 紧贴之合（相邻两干）方可论化气（《滴天髓》：合化须紧贴，遥隔不论化）
  for (let i = 0; i < gans.length - 1; i++) {
    const j = i + 1;
    const k1 = gans[i] + gans[j], k2 = gans[j] + gans[i];
    const key = he[k1] ? k1 : k2;
    if (!he[key]) continue;
    const huaEl = he[key];
    // 条件一：化神在月令旺或相
    let huaState = null;
    for (const [st, el] of Object.entries(tbl)) { if (el === huaEl) { huaState = st; break; } }
    const cond1 = huaState === '旺' || huaState === '相';
    // 条件二：化神透干
    const cond2 = gans.some((g) => C.elementOfGan(g) === huaEl);
    // 条件三：无克制化神之五行（地支本气克化神）
    const keEl = C.KE_INV[huaEl];
    const cond3 = !zhis.some((z) => C.ZHI_MAIN[z] === keEl);
    if (cond1 && cond2 && cond3) {
      result.push(`天干${gans[i]}${gans[j]}五合化${huaEl}：两干紧贴、月令化神当令、化神透干、无克，论「化气」，化气后${huaEl}行力量大增，主性情专注、气机纯粹`);
    } else {
      const why = !cond1 ? '化神不当令' : (!cond2 ? '化神不透干' : '有克制化神之五行');
      result.push(`天干${gans[i]}${gans[j]}五合（化${huaEl}）：两干虽紧贴，因${why}，只论「合身」不论化气——主${pos[i]}${gans[i]}与${pos[j]}${gans[j]}相互牵绊、性情圆融`);
    }
  }
  // 遥隔之合（隔位两干）：合力微，只论牵绊、不论化气
  for (let i = 0; i < gans.length; i++) for (let j = i + 2; j < gans.length; j++) {
    const k1 = gans[i] + gans[j], k2 = gans[j] + gans[i];
    const key = he[k1] ? k1 : k2;
    if (!he[key]) continue;
    result.push(`天干${gans[i]}${gans[j]}遥隔相合：两干隔位，合力微而难化，仅主${pos[i]}与${pos[j]}暗中牵绊`);
  }
  return result;
}

// 争合检测
function zhengHe(chart) {
  const gans = [chart.sizhu.year[0], chart.sizhu.month[0], chart.sizhu.day[0], chart.sizhu.hour[0]];
  const he = { '甲己': '土', '乙庚': '金', '丙辛': '水', '丁壬': '木', '戊癸': '火' };
  const cnt = {};
  gans.forEach((g) => { cnt[g] = (cnt[g] || 0) + 1; });
  const notes = [];
  Object.entries(cnt).forEach(([g, n]) => {
    if (n < 2) return;
    for (const k of Object.keys(he)) {
      if (k.includes(g)) {
        const other = k.replace(g, '');
        if (cnt[other]) notes.push(`天干${g}叠见，与${other}成「争合」——主多方牵制、机会多但身不由己`);
      }
    }
  });
  return notes;
}

// 格局成败救应（《子平真诠》病药法：伤官见官有印制、杀重用食制、财多身弱用比劫等）
function gejuJiuYing(chart) {
  const dist = chart.shishen_distribution || {};
  const has = (k) => (dist[k] || 0) > 0;
  const cnt = (k) => (dist[k] || 0);
  const notes = [];
  if (has('伤官') && has('正官')) {
    if (has('正印') || has('偏印')) notes.push('伤官见官，幸有印星制伤护官，格局可救，反主才华入正途');
    else notes.push('伤官见官，无印化解，易口舌是非、事业多阻');
  }
  if (cnt('七杀') >= 2) {
    if (has('食神')) notes.push('七杀重而食神制杀，压力化为权柄，贵气可成');
    else if (has('正印') || has('偏印')) notes.push('七杀重而印星化杀，以德化煞，转危为安');
    else notes.push('七杀重而无制无化，压力过甚，须防灾祸劳碌');
  }
  if ((cnt('正财') + cnt('偏财')) >= 2 && chart.strength === '身弱') {
    if (has('比肩') || has('劫财')) notes.push('财多身弱，幸有比劫帮身担财，可守可进');
    else notes.push('财多身弱，无印比帮扶，富屋贫人，宜先固本');
  }
  if (has('正官') && has('七杀')) notes.push('官杀混杂，宜去留舒配，事业易有取舍纠葛');
  return notes;
}

// ───────────────────────────────────────────────
// 栏四：格局与干支合化
// ───────────────────────────────────────────────
function gejuHehua(chart) {
  const gs = gejuShort(chart);
  const mz = chart.sizhu.month[1];
  const geShen = chart.ge_shen;      // 定格十神
  const geGan = chart.ge_gan;        // 定格所取天干
  const tou = chart.ge_tou;          // 定格干是否透干
  const hiddenNames = (C.ZHI_HIDDEN[mz] || []).join('、'); // 月支所藏

  const coor = coordination(chart);
  const broken = coor.filter((c) => c.includes('冲') || c.includes('刑') || c.includes('害'));

  const kong = xunKong(chart);
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  const kongHit = ['年支', '月支', '日支', '时支'].filter((_, i) => kong.includes(zhis[i]));

  // 格局成败：无冲刑害时绑定月令与定格用神，句池确定性选句
  const gejuAnPool = [
    `格局用神「${geShen}」（${geGan}${tou ? '透干' : '藏支'}）落于月令${mz}，四柱干支无冲克刑害，用神清纯不破，格局成立较顺。`,
    `月令${mz}司权，取「${geShen}」为用（${geGan}${tou ? '透' : '不透'}），干支配合安静、无冲刑害之忧，格局可安。`,
    `格局以「${geShen}」立，用神${geGan}安于${mz}月，四柱少冲合刑害，喜用（${chart.yongshen}）无损，格局清正。`,
  ];
  const gejuCheng = broken.length
    ? `格局用神恐有冲克刑害之扰（${broken.join('；')}），须看是否有印星转化护卫，有则格局不破，无则格局有损。`
    : pickFrom(gejuAnPool, seedOf(chart, 'geju-an'));
  const jiuYing = gejuJiuYing(chart);

  const heHua = ganHeHua(chart);
  const zheng = zhengHe(chart);

  const dingge = tou
    ? `月令${mz}所藏天干为${hiddenNames}，其中「${geGan}」透出天干，依《子平真诠》「透干会支，以透出者定格」，取其所成十神「${geShen}」定格`
    : `月令${mz}所藏天干为${hiddenNames}，皆不透干，取月令本气「${geGan}」（十神${geShen}）定格`;

  // 天干无五合兜底：绑定具体天干十神
  const ganHePool = [
    `年干${chart.sizhu.year[0]}（${chart.shishen.year_gan}）、月干${chart.sizhu.month[0]}（${chart.shishen.month_gan}）、时干${chart.sizhu.hour[0]}（${chart.shishen.hour_gan}）三干各自独立、无五合相牵，性情相对直率不黏连。`,
    `年、月、时三干（${chart.sizhu.year[0]}${chart.sizhu.month[0]}${chart.sizhu.hour[0]}）互不五合，人际与性情少受合星裹挟，行事较为果决独立。`,
    `天干${chart.sizhu.year[0]}、${chart.sizhu.month[0]}、${chart.sizhu.hour[0]}皆无五合，主为人不喜牵缠、立场分明。`,
  ];
  const ganHeTxt = heHua.length ? heHua.join('；') + '。' : pickFrom(ganHePool, seedOf(chart, 'ganhe'));

  // 天干无争合兜底
  const zhengPool = [
    '天干无叠见争合，无多方牵制、机会两难之象。',
    '三干无争合，无"合住又争"的纠缠，选择相对单一明确。',
    '天干少争合，主遇事少受多方牵制，立场较稳。',
  ];
  const zhengTxt = zheng.length ? zheng.join('；') + '。' : pickFrom(zhengPool, seedOf(chart, 'zhenghe'));

  // 地支安静兜底：绑定月令与用神
  const zhiPool = [
    `全局地支（${zhis.join('')}）安静少合冲，月令${mz}之气贯穿全局，人生节奏较稳。`,
    `四支${zhis.join('')}无冲合刑害，气机清静，${mz}月令之「${geShen}」用神安稳，主命途起伏较小。`,
    `地支${zhis.join('')}各自安静、无合冲刑害，喜用（${chart.yongshen}）不易受动，整体平稳。`,
  ];
  const zhiTxt = coor.length ? coor.join('；') + '。' : pickFrom(zhiPool, seedOf(chart, 'zhi'));

  return (
    `【所定格局】你属「${chart.geju}」。定格理由：遵循《子平真诠》格局法「以月令为尊、透干优先」——${dingge}。\n` +
    `【格局成败】${gejuCheng}\n` +
    (jiuYing.length ? `【格局救应】${jiuYing.join('；')}。\n` : '') +
    `【天干五合】${ganHeTxt}\n` +
    `【争合取象】${zhengTxt}\n` +
    `【地支作用】${zhiTxt}（合冲并见时，紧贴之合冲优先、力量大者优先。）\n` +
    `【空亡影响】空亡在「${kong.join('、')}」，${kongHit.length ? kongHit.join('、') + '逢空，对应领域（' + {'年支': '祖辈与早年根基', '月支': '父母与青年运', '日支': '夫妻宫与中年', '时支': '子女与晚年'}[kongHit[0]] + '等）力量虚浮、事多不成或缘浅。' : '命局四柱无逢空，各领域力量较实。'}`
  );
}

// 十神性格句池（做事/人际/情绪三维度，每维多句，按命局特征确定性选句，避免千人一面）
const SHEN_STYLE = {
  七杀: {
    do: ['果决敢闯、遇强则强，压力越大越有斗志', '雷厉风行、敢担风险，喜攻坚克难', '目标感强、行动迅猛，不畏硬仗'],
    rel: ['立场强硬、易与人冲突，宜以柔济刚', '重义气但易压人一头，当存宽厚', '较刚愎、少纳言，宜多听人劝'],
    emo: ['性急易躁，须防冲动误事', '情绪外放、来得快去得也快', '胜负心重、易紧绷，宜养静气'],
  },
  正官: {
    do: ['循规蹈矩、按章办事，重秩序', '踏实守正、一步一阶，不喜越矩', '讲求方法、有条不紊，执行力稳'],
    rel: ['重名声、讲原则，易得人信任', '待人持正、有分寸，但略拘谨', '重礼数、守承诺，人缘清正'],
    emo: ['克制自律，情绪较平稳', '内敛不外露，喜藏情绪', '较理性、少冲动，偶显严肃'],
  },
  食神: {
    do: ['平和从容、靠才华与口才取胜', '顺势而为、不急不躁，善发挥所长', '以技养身、以和待人，节奏舒缓'],
    rel: ['随和好相处、人缘佳', '温和宽厚、易结善缘', '不争不抢、讨人喜欢'],
    emo: ['乐观豁达，情绪较平稳', '知足常乐、少纠结', '心态松弛、易自洽'],
  },
  伤官: {
    do: ['敢想敢干、才华外露，不拘一格', '点子多、爱创新，行动出位', '恃才而进、锋芒毕露，喜走新路'],
    rel: ['锋芒较盛、不服管束', '直言不讳、易得罪人，宜藏锋', '才高易招妒，须以谦和待人'],
    emo: ['情绪起伏大、易挑剔', '爱憎分明、来得强烈', '敏感易激，宜节怒'],
  },
  正印: {
    do: ['沉稳内敛、爱钻研，走厚积薄发之路', '重学问、喜思考，做事有根底', '以德服人、慢工出细活'],
    rel: ['温和厚道、得长辈缘', '慈和包容、易获提携', '重情重义、待人诚恳'],
    emo: ['平和但有依赖性', '情绪稳定、略被动', '安于现状、不喜突变'],
  },
  偏印: {
    do: ['别具一格、善独立思考，喜冷门', '另辟蹊径、不随大流', '钻研深、点子偏，长于专业'],
    rel: ['较疏离、喜独处', '与人保持距离、交友贵精', '不喜热闹、独来独往'],
    emo: ['敏感多思、易多疑', '心思重、喜琢磨', '内敛警觉、易情绪内耗'],
  },
  正财: {
    do: ['务实稳健、勤劳务实，重积累', '精打细算、按部就班', '踏实经营、信守承诺'],
    rel: ['重信守诺、讲实际', '待人实在、不虚与委蛇', '勤恳可靠、易得信任'],
    emo: ['稳定但偏保守', '情绪平稳、不冒进', '务实理性、少幻想'],
  },
  偏财: {
    do: ['灵活机变、善抓机会，喜流动之财', '眼明手快、善于交际生财', '敢于尝试、不拘一业'],
    rel: ['广结人缘、大方豪爽', '出手阔绰、朋友多', '善谈会来事、人脉广'],
    emo: ['活跃但不耐寂寞', '情绪来得快、喜新鲜', '好动爱热闹、闲不住'],
  },
  比肩: {
    do: ['独立自主、靠实力打拼', '亲力亲为、不喜依赖', '与人较劲、凭真本事'],
    rel: ['重朋友义气、但易竞争', '待同辈诚恳、爱抱团', '与人相处直来直往'],
    emo: ['倔强好强、不服输', '自尊心强、易较劲', '性子硬、不易低头'],
  },
  劫财: {
    do: ['果敢行动力强、说干就干', '冲劲足、敢闯敢拼', '重行动、不拖泥带水'],
    rel: ['仗义但易分财争利', '对朋友大方、易被拖累', '讲义气、但边界感弱'],
    emo: ['冲动易变、情绪化', '来得快、易上头', '易激动、须防意气用事'],
  },
};

// ───────────────────────────────────────────────
// 栏五：十神与性格画像（三维度）
// ───────────────────────────────────────────────
function shishenXingge(chart) {
  const s = chart.sizhu;
  const sh = chart.shishen;
  const zm = sh._zhi_main || {};
  const dist = chart.shishen_distribution || {};
  const ranked = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const combos = shenCombo(chart);
  const top = ranked.length ? ranked[0][0] : '比肩';
  const topShow = D.SHEN_SHOW[top] || '';
  const dm = chart.day_master;
  const pos = [
    `年干${s.year[0]}→${sh.year_gan}`, `月干${s.month[0]}→${sh.month_gan}`, `时干${s.hour[0]}→${sh.hour_gan}`,
    `年支${s.year[1]}→${zm.year || sh.year_zhi[0]}`, `月支${s.month[1]}→${zm.month || sh.month_zhi[0]}`,
    `日支${s.day[1]}→${zm.day || sh.day_zhi[0]}`, `时支${s.hour[1]}→${zm.hour || sh.hour_zhi[0]}`,
  ].join('、');

  // 最强十神落点（透干/藏支 + 具体柱位 + 干支），结合落柱落神织入性格
  const topLoc = shenLocations(chart, top);
  const locTxt = topLoc.length
    ? topLoc.map((l) => (l.via === '透干' ? `${l.pos}${l.gz}透干` : `${l.pos}${l.gz}藏`)).join('、')
    : '全局藏于余气，力量较隐';
  const viaMain = topLoc.some((l) => l.via === '透干') ? '透干而显' : '藏支而隐';
  const st = SHEN_STYLE[top] || SHEN_STYLE['正官'];
  const doTxt = pickFrom(st.do, seedOf(chart, `do-${top}`));
  const relTxt = pickFrom(st.rel, seedOf(chart, `rel-${top}`));
  const emoTxt = pickFrom(st.emo, seedOf(chart, `emo-${top}`));
  const dmEl = C.elementOfGan(dm);
  const dmNature = C.GAN_NATURE[dm].split('，')[0];
  const wsMod = chart.strength === '身弱' ? '身弱则其性偏内敛、须借势' : chart.strength === '身强' ? '身强则其性外放、易过' : '中和则其性较稳';

  const coor = coordination(chart);
  const heNums = coor.filter((c) => c.includes('合')).length;
  const chongNums = coor.filter((c) => c.includes('冲') || c.includes('刑') || c.includes('害')).length;
  const heChong = `天干地支中「合」有${heNums}处、「冲刑害」有${chongNums}处——${heNums > chongNums ? '合多则人缘好但牵绊多、易被多方裹挟' : chongNums > heNums ? '冲多则变动大、有冲劲但也易与人起摩擦' : '合冲相衡，人际与自身节奏较为均衡'}。`;

  return (
    `【十神分布概览】以日主${dm}为"我"，七字标十神：${pos}。其中力量最强、最贴身的是「${top}」（${topShow.trim()}）。\n` +
    `【核心性格画像】你的最强十神「${top}」落于${locTxt}，属${viaMain}；日主${dm}（属${dmEl}行，${dmNature}），${wsMod}。性格三维：①做事风格：${doTxt}；②人际模式：${relTxt}；③情绪特点：${emoTxt}。\n` +
    `【十神组合效应】${combos.length ? combos.join('；') + '。' : '无明显特殊十神组合，性格以日主本性与最强十神为主导。'}\n` +
    `【合冲对性格人际的影响】${heChong}`
  );
}

// ───────────────────────────────────────────────
// 栏六：六亲·婚恋·事业·财运·健康
// ───────────────────────────────────────────────
function liuQin(chart) {
  const isMale = chart.birth.gender === '男';
  const ss = chart.shishen_distribution || {};
  const dayZhi = chart.sizhu.day[1];
  const hasCai = (ss['正财'] || 0) + (ss['偏财'] || 0) > 0;
  const hasGuan = (ss['正官'] || 0) + (ss['七杀'] || 0) > 0;
  const hasShiShang = (ss['食神'] || 0) + (ss['伤官'] || 0) > 0;
  const hasYin = (ss['正印'] || 0) + (ss['偏印'] || 0) > 0;
  const hasBiJie = (ss['比肩'] || 0) + (ss['劫财'] || 0) > 0;

  // 婚恋（宫位+星曜三重印证：日支坐十神 + 配偶星旺衰落点 + 夫妻宫逢冲合刑）
  const dayZhiMainShen = chart.shishen._zhi_main.day; // 日支本气十神（配偶宫坐何星）
  const dayZhiHidden = (C.ZHI_HIDDEN[dayZhi] || []).map((g) => `${g}(${C.shiShen(chart.day_master, g)})`).join('、');
  const hunRels = ['年支', '月支', '时支'];
  const hunRelsZhi = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.hour[1]];
  const dayChong = [];
  hunRelsZhi.forEach((z, i) => {
    const r = zhiRelation(dayZhi, z);
    if (r) dayChong.push(`${r}${hunRels[i]}(${z})`);
  });
  const zuoPool = {
    正财: ['务实稳重、重家庭、善持家', '精打细算、顾家守成', '勤恳重信、长于理财'],
    偏财: ['慷慨灵活、善交际、出手大方', '会来事、人缘广、爱面子', '机变活泼、不喜拘束'],
    正官: ['正派有担当、重规矩、顾名声', '端庄守礼、自律性强', '责任感重、有原则'],
    七杀: ['个性强势、有魄力、敢作敢当', '果决刚硬、掌控欲强', '行动力强、不拖沓'],
    正印: ['宽厚慈爱、得长辈缘、顾家', '温和包容、重情义', '慈和厚道、乐于付出'],
    偏印: ['心思独特、有偏才、较孤僻', '独到聪慧、喜静', '思维跳脱、不按常理'],
    食神: ['温和随性、懂生活、有口福', '乐观和善、好相处', '从容淡泊、会享受'],
    伤官: ['才华外露、个性强、不服输', '锋芒毕露、有主见', '聪明外显、情绪较烈'],
    比肩: ['独立好强、易有竞争、讲义气', '自立自重、要强', '同气相求、易争拗'],
    劫财: ['行动力强、易争拗、重朋友', '冲劲足、爱热闹', '爽快仗义、但易冲动'],
  };
  const zuoDesc = pickFrom(zuoPool[dayZhiMainShen] || ['配偶性情随坐支而定'], seedOf(chart, `zuo-${dayZhiMainShen}`));
  let hun = `${isMale ? '男命以财为妻' : '女命以官杀为夫'}。夫妻宫为日支${dayZhi}（藏干${dayZhiHidden}），本气坐「${dayZhiMainShen}」，主配偶${zuoDesc}。`;

  const sp = spouseStar(chart);
  if (sp.locs.length) {
    const locList = sp.locs.map((l) => (l.via === '透干' ? `${l.pos}${l.gz}透「${l.shen}」` : `${l.pos}${l.gz}藏「${l.shen}」`)).join('、');
    hun += `配偶星（${sp.targetShens.join('/')}）在命中有气，见${locList}，正缘可期、感情易得牵绊。`;
  } else {
    hun += `配偶星（${sp.targetShens.join('/')}）全局不显，正缘偏迟、感情须主动经营。`;
  }
  if (dayChong.length) hun += `然夫妻宫（日支${dayZhi}）逢${dayChong.join('、')}，婚姻易有波动，宜晚婚、择性格包容之伴侣。`;
  else hun += `夫妻宫（日支${dayZhi}）与年月时三支皆无冲合刑害，宫位清静，婚姻根基较实。`;

  // 事业（绑定具体十神落点）
  const cat = categoryLocs(chart);
  const guanLoc = cat['官杀'].map(locDesc).join('、');
  const yinLoc = cat['印星'].map(locDesc).join('、');
  const shishangLoc = cat['食伤'].map(locDesc).join('、');
  const caiLoc = cat['财星'].map(locDesc).join('、');
  let shiye;
  if (hasGuan && hasYin) shiye = `官印相生：官杀见${guanLoc}、印星见${yinLoc}，宜体制内、公门、大平台，循规蹈矩可稳步升迁。`;
  else if (hasShiShang && hasCai) shiye = `食伤生财：食伤见${shishangLoc}、财星见${caiLoc}，宜经商创业、靠才艺技术变现。`;
  else if (hasShiShang) shiye = `食伤泄秀：食伤见${shishangLoc}，宜技术、创意、自由职业，凭一技之长立身。`;
  else if (hasCai) shiye = `财星为用：财星见${caiLoc}，宜经商理财、务实经营。`;
  else shiye = '官杀财星皆不显，多凭专业协作立身，不宜强求权位。';
  const qiYunAge = (chart.dayun && chart.dayun[0]) ? chart.dayun[0].start_age : 0;
  shiye += `结合大运，${qiYunAge}岁起运后逐步进入事业上升通道，走用神运时（${chart.yongshen}当令之年）事业机遇最明显。`;

  // 财运（绑定财星落点）
  let cai;
  if (hasCai) cai = `命带财星（见${caiLoc}），求财有天然向度；` + (hasShiShang ? `食伤（${shishangLoc}）生财，利创意求财、技能变现` : '宜稳扎稳打、以正财为主');
  else cai = '财星不显，求财宜踏实积累、以一技之长立身';
  if (hasBiJie && hasCai) cai += '；但比劫夺财，合作易分财，理财宜独不宜众，防破财竞争。';
  else cai += '。';
  if (chart.strength === '身弱' && hasCai) cai += '（身弱财多不担财，宜先固本再求财，勿贪多冒进。）';

  // 六亲（绑定印星/食伤具体落点）
  const liuqin = `年柱看祖辈（${chart.sizhu.year[0]}${chart.sizhu.year[1]}）、月柱看父母（${chart.sizhu.month[0]}${chart.sizhu.month[1]}）、时柱看子女（${chart.sizhu.hour[0]}${chart.sizhu.hour[1]}）。${hasYin ? `印星见${yinLoc}，与长辈、学历、贵人之缘较深` : '印星不显，长辈助力有限，宜自强'}；${hasShiShang ? `食伤见${shishangLoc}，子女缘分、才华表达有向度` : '食伤不显，子女缘分或表达欲偏内敛'}。`;

  // 健康（按天干+地支藏干全计，溯源具体干支 → 五行偏枯 → 脏腑）
  const wx = wuxingFull(chart);
  const src = { 木: [], 火: [], 土: [], 金: [], 水: [] };
  [chart.sizhu.year, chart.sizhu.month, chart.sizhu.day, chart.sizhu.hour].forEach((p) => {
    src[C.elementOfGan(p[0])].push(`天干${p[0]}`);
    (C.ZHI_HIDDEN[p[1]] || []).forEach((g) => src[C.elementOfGan(g)].push(`${p[1]}藏${g}`));
  });
  const entries = Object.entries(wx);
  const mx = entries.filter((e) => e[1] === Math.max(...entries.map((x) => x[1]))).map((e) => e[0]);
  const mn = entries.filter((e) => e[1] === Math.min(...entries.map((x) => x[1]))).map((e) => e[0]);
  const mxSrc = mx.map((e) => `${e}（因${src[e].join('、')}）`).join('；');
  const mnSrc = mn.map((e) => `${e}（仅${src[e].join('、') || '全无'}）`).join('；');
  const health = `五行全计中，${mx.join('、')}偏旺——${mxSrc}；${mn.join('、')}偏弱——${mnSrc}。对应脏腑：${mx.map((e) => HEALTH[e] + '易亢').join('、')}；${mn.map((e) => HEALTH[e] + '易弱').join('、')}。以上仅为基于五行类象的体质趋势分析，不能替代医学诊断，如有不适请及时就医。`;

  return (
    `【6.1 婚恋感情】${hun}\n` +
    `【6.2 事业方向】${shiye}\n` +
    `【6.3 财运分析】${cai}\n` +
    `【6.4 六亲关系】${liuqin}\n` +
    `【6.5 健康提示】${health}`
  );
}

// ───────────────────────────────────────────────
// 栏七：喜用神与人生调整指南
// ───────────────────────────────────────────────
function xiyongZhinan(chart) {
  const yong = chart.yongshen.split('、');
  const xi = chart.xishen.split('、');
  const ji = chart.jishen.split('、');
  const allEls = ['木', '火', '土', '金', '水'];
  const used = [...new Set([...yong, ...xi, ...ji])];
  const xian = allEls.filter((e) => !used.includes(e));
  const mainYong = yong[0];
  const th = tiaoHou(chart.sizhu.month[1]);

  // 喜忌判定过程（调候 > 格局 > 扶抑）
  const tiaoShen = th.needEl || '无（寒暖尚匀）';
  const gejuYong = mainYong;
  const fuYi = chart.strength === '身弱' ? '身弱喜印比生扶（印+比劫）' : chart.strength === '身强' ? '身强喜财官食伤泄克' : '中和喜流通';
  const unified = (th.needEl && yong.includes(th.needEl)) ? '三者高度统一，用神专一，行运到该五行之地改善明显' : '调候与扶抑方向不完全一致，取用时以调候为第一优先、扶抑为辅';

  // 万物类象（行业/方位/颜色）以调候用神为第一优先，辅以扶抑用神
  const primaryEls = chart.tiaohou_shen ? [chart.tiaohou_shen, ...yong.filter((e) => e !== chart.tiaohou_shen)] : yong;
  const industry = primaryEls.map((e) => INDUSTRY[e]).filter(Boolean).join('；');
  const direction = primaryEls.map((e) => DIRECTION[e]).filter(Boolean).join('、');
  const color = primaryEls.map((e) => COLOR[e]).filter(Boolean).join('、');
  // 生活习惯：结合调候五行与月令，句池确定性选句
  const mz = chart.sizhu.month[1];
  const el = th.needEl;
  let habitPool;
  if (th.kind.includes('寒') || th.kind.includes('湿')) {
    habitPool = [
      `命局偏寒湿（月令${mz}），宜以「${el}」温养：居向阳暖处、多晒晨光、饮食偏温热，忌久居阴冷潮湿之地。`,
      `月令${mz}主寒湿，调候需「${el}」，生活宜暖衣暖食、住朝南向阳之屋，避湿寒侵体。`,
      `命局气偏寒湿，取「${el}」为调候：作息宜早起迎阳、喜温热饮食，忌生冷与久坐湿地。`,
    ];
  } else if (th.kind.includes('燥') || th.kind.includes('热')) {
    habitPool = [
      `命局偏燥热（月令${mz}），宜以「${el}」润之：近水而居、多静少躁、饮食清淡，忌熬夜上火。`,
      `月令${mz}主燥热，调候需「${el}」，宜居水木清幽之地、清淡饮食、早睡养阴，忌辛辣油腻。`,
      `命局气偏燥热，取「${el}」为调候：作息宜避午时暴晒、多饮水、心境平和，忌急火攻心。`,
    ];
  } else {
    habitPool = [
      `命局寒暖尚匀（月令${mz}），无急迫调候，保持作息规律、劳逸结合即可。`,
      `月令${mz}气机和顺，寒暖得中，起居随四时而动、饮食均衡即可。`,
      `此命调候非急，四季宜平和起居、张弛有度，不必刻意避忌。`,
    ];
  }
  const habit = pickFrom(habitPool, seedOf(chart, 'habit'));

  return (
    `【喜忌判定过程】按「调候用神 > 格局用神 > 扶抑用神」的优先级：①调候用神为「${tiaoShen}」（解决季节气候偏性）；②格局用神为「${gejuYong}」（成全格局成败）；③扶抑用神为「${fuYi}」。${unified}。\n` +
    `【喜用神】${chart.tiaohou_shen ? `调候用神「${chart.tiaohou_shen}」（调候为急，第一优先）＋扶抑用神「${chart.yongshen}」（辅助）` : chart.yongshen}——能平衡全局、补偏救弊的"良药"${mainYong ? `，扶抑主用神为「${mainYong}」` : ''}。\n` +
    `【喜神】${chart.xishen}——辅助用神。\n` +
    `【忌神】${chart.jishen}——加剧失衡、带来压力损耗者，宜避。\n` +
    `【闲神】${xian.length ? xian.join('、') + '——力量中性，增减无明显吉凶' : '无（五行皆已分属用/喜/忌）'}。\n` +
    `【行业选择建议】${industry}。\n` +
    `【方位建议】${direction}。\n` +
    `【颜色建议】${color}。\n` +
    `【生活习惯调整】${habit}`
  );
}

// 地支关系检测（冲/合/刑/害）
function zhiRelation(a, b) {
  const p1 = a + b, p2 = b + a;
  if (D.LIUCHONG.includes(p1) || D.LIUCHONG.includes(p2)) return '冲';
  if (D.LIUHE[p1] || D.LIUHE[p2]) return '合';
  if (C.XING_PAIRS.includes(p1) || C.XING_PAIRS.includes(p2)) return '刑';
  if (C.HAI_PAIRS.includes(p1) || C.HAI_PAIRS.includes(p2)) return '害';
  return null;
}

// 大运地支与原局地支的冲合刑害
function dayunRelation(chart, zhi) {
  const yuanZhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  const pos = ['年支', '月支', '日支', '时支'];
  const rels = [];
  yuanZhis.forEach((yz, i) => {
    const r = zhiRelation(yz, zhi);
    if (r) rels.push(`${r}${pos[i]}(${yz})`);
  });
  return rels;
}

// 流年触发事件（冲/合夫妻宫、财星/官杀为用为忌）
function liunianEvent(chart, gz) {
  const g = gz[0], z = gz[1];
  const dayZhi = chart.sizhu.day[1];
  const yong = chart.yongshen.split('、');
  const events = [];
  const r = zhiRelation(dayZhi, z);
  if (r === '冲') events.push('冲夫妻宫（日支），易应婚恋、感情波动或家庭变动');
  if (r === '合') events.push('合入夫妻宫（日支），易有姻缘、感情牵动或合伙机缘');
  const gShen = C.shiShen(chart.day_master, g);
  const gEl = C.elementOfGan(g);
  if (gShen === '正财' || gShen === '偏财') {
    events.push(yong.includes(gEl) ? `${g}为财星且为喜用，利求财进账` : `${g}为财星但犯忌，防破财、开销增大`);
  }
  if (gShen === '正官' || gShen === '七杀') {
    events.push(yong.includes(gEl) ? `${g}为官杀且为喜用，利事业升迁得权` : `${g}为官杀但犯忌，防压力是非、职场变动`);
  }
  return events;
}

// ───────────────────────────────────────────────
// 栏八：大运流年推演
// ───────────────────────────────────────────────
function dayunLiunian(chart) {
  const yearGan = chart.sizhu.year[0];
  const yangYear = C.isYang(C.ganIndex(yearGan));
  const isMale = chart.birth.gender === '男';
  const forward = (yangYear && isMale) || (!yangYear && !isMale);
  const yong = chart.yongshen.split('、');
  const ji = chart.jishen.split('、');
  const list = (chart.dayun || []).slice(0, 8);
  const table = list.map((d) => {
    const g = d.pillar[0], z = d.pillar[1];
    const shen = `${C.shiShen(chart.day_master, g)}/${C.shiShen(chart.day_master, C.ZHI_HIDDEN[z][0])}`;
    const els = pillarElements(d.pillar);
    let tag = '平';
    if (containsSet(els, yong)) tag = '利好（贴用神）';
    else if (containsSet(els, ji)) tag = '宜守（犯忌神）';
    const rels = dayunRelation(chart, z);
    const relTxt = rels.length ? `，与原局${rels.join('、')}` : '';
    return `${d.start_age}-${d.start_age + 9}岁  ${d.pillar}  十神${shen}  ${tag}${relTxt}`;
  }).join('\n');

  // 关键大运详解（挑 3-4 步用神/忌神运，并细化刑冲合害）
  const keyDayun = list.filter((d) => {
    const els = pillarElements(d.pillar);
    return containsSet(els, yong) || containsSet(els, ji);
  }).slice(0, 4);
  const keyTxt = keyDayun.length
    ? keyDayun.map((d) => {
      const g = d.pillar[0], z = d.pillar[1];
      const gShen = C.shiShen(chart.day_master, g);
      const zShen = C.shiShen(chart.day_master, C.ZHI_HIDDEN[z][0]);
      const els = pillarElements(d.pillar);
      const good = containsSet(els, yong);
      const rels = dayunRelation(chart, z);
      const relPool = rels.length
        ? [
            `；此运${z}与原局${rels.join('、')}，易触发婚恋、迁动、财帛等变动，方向以所冲合之宫位对应领域为准`,
            `；且${z}动原局${rels.join('、')}，对应宫位易有起落，宜随变而安`,
            `；复见${z}与原局${rels.join('、')}，主该运于相应人事有动静，宜早作打算`,
          ]
        : [
            '；此运与原局无刑冲合害，变动较小、以平稳蓄势为主',
            '；此运不犯原局冲合，宜稳中求进、蓄势待时',
            '；此运干支安静，主循序渐进、波澜不惊',
          ];
      const goodPool = [
        `天干${g}（${gShen}）、地支${z}（${zShen}）贴用神，整体上扬、机遇多，宜积极进取`,
        `此运${gShen}${zShen}为喜用，事业生活多顺遂，宜乘势而上`,
        `干支${g}${z}（${gShen}${zShen}）皆助喜用，运势抬头，宜主动作为`,
      ];
      const badPool = [
        `天干${g}（${gShen}）、地支${z}（${zShen}）犯忌神，压力增大，宜守不宜攻`,
        `此运${gShen}${zShen}为忌，多耗多阻，宜稳守蓄力`,
        `干支${g}${z}（${gShen}${zShen}）逆喜用，诸事吃力，宜避重就轻`,
      ];
      const mainTxt = pickFrom(good ? goodPool : badPool, seedOf(chart, `dayun-${d.pillar}-${d.start_age}`));
      const relTxt = pickFrom(relPool, seedOf(chart, `dayun-rel-${d.pillar}-${d.start_age}`));
      return `${d.start_age}-${d.start_age + 9}岁（${d.start_age}岁起）走${d.pillar}运：${mainTxt}${relTxt}。`;
    }).join('\n')
    : `大运干支多属闲神，无明确喜忌起伏，随流年${chart.yongshen}、${chart.jishen}之向顺势而为即可。`;

  // 流年（近5年，含具体触发事件）
  const base = new Date().getFullYear();
  const liunian = [];
  for (let i = -1; i <= 3; i++) {
    const y = base + i;
    const gz = liunianGanzhi(y);
    const g = gz[0], z = gz[1];
    const els = [C.elementOfGan(g), C.ZHI_MAIN[z]];
    let tag = '平';
    if (els.some((e) => yong.includes(e))) tag = '利好';
    else if (els.some((e) => ji.includes(e))) tag = '宜守';
    const evts = liunianEvent(chart, gz);
    const evtTxt = evts.length ? `（${evts.join('；')}）` : '';
    liunian.push(`${y}年 ${gz}  ${tag}${evtTxt}`);
  }

  // 关键年份预警：按命局特征（夫妻宫、喜忌神）生成，句池确定性选句
  const dayZhi = chart.sizhu.day[1];
  const warnPool = [
    `流年冲合日支（夫妻宫${dayZhi}）多应婚恋感情，动${chart.jishen}之岁防破财口舌；逢忌神且冲原局之岁宜保守。以上为阶段趋势，具体境遇仍看个人抉择。`,
    `岁运遇${chart.jishen}当值又冲原局者，多主压力与变动，宜守不宜攻；合入夫妻宫${dayZhi}则多应感情家宅之事。`,
    `凡流年干支带${chart.jishen}或冲动日支${dayZhi}，当留心财帛、人际与家宅；带${chart.yongshen}则多顺遂。以上仅为阶段趋势。`,
  ];
  const warnTxt = pickFrom(warnPool, seedOf(chart, 'warn'));

  return (
    `【起运信息】年干${yearGan}为${yangYear ? '阳' : '阴'}年、${isMale ? '男' : '女'}命，故大运${forward ? '顺' : '逆'}排（阳男阴女顺排、阴男阳女逆排）。\n` +
    `【大运总览表】\n${table}\n` +
    `【关键大运详解】\n${keyTxt}\n` +
    `【近五年流年表】\n${liunian.join('\n')}\n` +
    `【关键年份预警】${warnTxt}`
  );
}

// ───────────────────────────────────────────────
// 栏九：综合总结与人生建议（病与药）
// ───────────────────────────────────────────────
function zongjie(chart) {
  const dm = chart.day_master;
  const dmEl = C.elementOfGan(dm);
  const gs = gejuShort(chart);
  const th = tiaoHou(chart.sizhu.month[1]);
  const yong = chart.yongshen;

  // 病与药：绑定具体十神落点（如"官杀为忌""食伤泄秀"）
  const cat = categoryLocs(chart);
  const guanLoc = cat['官杀'].map(locDesc).join('、');
  const yinLoc = cat['印星'].map(locDesc).join('、');
  const shishangLoc = cat['食伤'].map(locDesc).join('、');
  const caiLoc = cat['财星'].map(locDesc).join('、');
  const bijieLoc = cat['比劫'].map(locDesc).join('、');

  let bing, yao;
  if (chart.strength === '身弱') {
    const keParts = [guanLoc && `官杀（${guanLoc}）`, caiLoc && `财星（${caiLoc}）`, shishangLoc && `食伤（${shishangLoc}）`].filter(Boolean);
    const shengParts = [yinLoc && `印星（${yinLoc}）`, bijieLoc && `比劫（${bijieLoc}）`].filter(Boolean);
    bing = `日主${dm}身弱，"病"在克泄耗偏重：${keParts.join('、') || chart.jishen} 耗身太过`;
    yao = `以${yong}帮身生扶（${shengParts.join('、') || '借印比之力'}），稳住根基`;
  } else if (chart.strength === '身强') {
    const shengParts = [yinLoc && `印星（${yinLoc}）`, bijieLoc && `比劫（${bijieLoc}）`].filter(Boolean);
    const keParts = [guanLoc && `官杀（${guanLoc}）`, caiLoc && `财星（${caiLoc}）`, shishangLoc && `食伤（${shishangLoc}）`].filter(Boolean);
    bing = `日主${dm}身强，"病"在生扶过剩：${shengParts.join('、') || chart.jishen} 再助则过亢`;
    yao = `以${yong}泄克（${keParts.join('、') || '疏其秀、耗其过'}），使归于中和`;
  } else {
    bing = `日主${dm}中和，但仍有${th.kind}之偏性需调（月令${chart.sizhu.month[1]}）`;
    yao = `以${yong}流通取用，顺应气候偏性`;
  }

  // 四条核心建议（事业/人际/生活/心态，绑定用神行业与调候）
  const mainYong = yong.split('、')[0];
  const shiyeAdvice = chart.strength === '身弱'
    ? `选${chart.yongshen}所属行业（${INDUSTRY[mainYong]}），进大平台、循规借力`
    : chart.strength === '身强'
      ? `选${chart.yongshen}所属行业（${INDUSTRY[mainYong]}），主动开拓、发挥所长`
      : `选${chart.yongshen}所属行业（${INDUSTRY[mainYong]}），顺势而为`;
  const renjiAdvice = chart.strength === '身弱' ? '广结贵人、团队合作，勿单打独斗' : chart.strength === '身强' ? '适当放权、纳谏，防刚愎' : '不偏不倚、与人和善';
  const shenghuoAdvice = th.needEl ? `起居顺应${th.kind}，调候取「${th.needEl}」` : '起居顺应四时，劳逸结合';
  const xintaiPool = {
    身弱: ['养精蓄锐、稳中求进，忌急于求成', '守静蓄力、以退为进，忌操之过急', '以柔克刚、厚积薄发，忌孤注一掷'],
    身强: ['戒骄戒躁、以退为进，忌得意忘形', '虚怀若谷、盛时思退，忌恃强冒进', '谦和自牧、纳言避满，忌刚愎自用'],
    中和: ['守中持平、不偏不倚，忌偏执一端', '随运取用、张弛有度，忌好走极端', '稳中求变、和而不流，忌因循守旧'],
  };
  const xintai = pickFrom(xintaiPool[chart.strength] || xintaiPool['中和'], seedOf(chart, 'xintai'));

  // 正向引导：按命局特征从句池确定性选择
  const zhengPool = [
    `《周易》云："天行健，君子以自强不息。"命为先天趋势，运为后天条件，人的选择与行动才是最终变量。`,
    `《周易》云："君子藏器于身，待时而动。"命局有缺，亦可凭后天选择趋吉避凶；好命不努力亦难成。`,
    `《易》曰："地势坤，君子以厚德载物。"德与行是立身之本，命为势、运为时，操之在我。`,
    `《易》云："乐天知命，故不忧。"知命而不认命，顺其势而修其德，方是安身之道。`,
  ];
  const zheng = pickFrom(zhengPool, seedOf(chart, 'zhengxiang'));

  return (
    `【命局核心矛盾】"病"：${bing}。"药"：${yao}。所有人生建议，都围绕"治病用药"展开，形成闭环。\n` +
    `【命局核心特质】日主${dm}（${dmEl}），${gs}，${chart.strength}，${th.kind}——${chart.strength === '身弱' ? '底子偏弱但可借力，格局有救应' : chart.strength === '身强' ? '底子厚实，须防过刚过满' : '底子均衡，胜在稳'}。\n` +
    `【四条核心建议】1. 事业：${shiyeAdvice}；2. 人际：${renjiAdvice}；3. 生活：${shenghuoAdvice}；4. 心态：${xintai}。\n` +
    `【正向引导】${zheng}`
  );
}

// 周易参证：以《易》卦象与义理印证命局
function zhouyiSection(chart) {
  const { gua, tuiyan } = Z.derive(chart);
  const gdisplay = gua.map((g) => `${g.glyph}${g.name}（${g.xiang}）`).join('、');
  const dmEl = C.elementOfGan(chart.day_master);
  let txt = `《易》以卦象穷天地万物之情，今以日主${chart.day_master}（属${dmEl}行）之命合之：`;
  if (gua.length) txt += `主导之卦为${gdisplay}。`;
  txt += tuiyan;
  return txt;
}

function buildReport(chart) {
  const sections = [
    { key: '命局总览', text: mingjuZonglan(chart) },
    { key: '命盘基础信息', text: jichu(chart) },
    { key: '命局旺衰深度解析', text: wangshuai(chart) },
    { key: '格局与干支合化', text: gejuHehua(chart) },
    { key: '十神与性格画像', text: shishenXingge(chart) },
    { key: '六亲·婚恋·事业·财运·健康', text: liuQin(chart) },
    { key: '喜用神与人生调整指南', text: xiyongZhinan(chart) },
    { key: '大运流年推演', text: dayunLiunian(chart) },
    { key: '综合总结与人生建议', text: zongjie(chart) },
    { key: '周易参证', text: zhouyiSection(chart) },
  ];
  sections.forEach((s) => { s.text = sanitize(s.text); });
  return sections;
}

module.exports = { buildReport };
