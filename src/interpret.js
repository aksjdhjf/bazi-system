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

  let summary;
  if (chart.strength === '身弱') summary = '此命身弱无疑，如风中残烛，最忌再遇克泄耗之运，喜得生扶方能站稳。';
  else if (chart.strength === '身强') summary = '此命身强，如乔木成林，须泄其秀、疏其枝方能成器，最忌再生扶。';
  else summary = '此命中和，气血匀停，刚柔各得其所，随运取用即可。';

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
  const gejuCheng = broken.length
    ? `格局用神恐有冲克刑害之扰（${broken.join('；')}），须看是否有印星转化护卫，有则格局不破，无则格局有损。`
    : '格局干支配合尚安，用神无破，格局较为清纯。';
  const jiuYing = gejuJiuYing(chart);

  const heHua = ganHeHua(chart);
  const zheng = zhengHe(chart);

  const kong = xunKong(chart);
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  const kongHit = ['年支', '月支', '日支', '时支'].filter((_, i) => kong.includes(zhis[i]));

  const dingge = tou
    ? `月令${mz}所藏天干为${hiddenNames}，其中「${geGan}」透出天干，依《子平真诠》「透干会支，以透出者定格」，取其所成十神「${geShen}」定格`
    : `月令${mz}所藏天干为${hiddenNames}，皆不透干，取月令本气「${geGan}」（十神${geShen}）定格`;

  return (
    `【所定格局】你属「${chart.geju}」。定格理由：遵循《子平真诠》格局法「以月令为尊、透干优先」——${dingge}。\n` +
    `【格局成败】${gejuCheng}\n` +
    (jiuYing.length ? `【格局救应】${jiuYing.join('；')}。\n` : '') +
    `【天干五合】${heHua.length ? heHua.join('；') + '。' : '天干无五合，人际与性情较少被合星牵绊，行事相对独立。'}\n` +
    `【争合取象】${zheng.length ? zheng.join('；') + '。' : '天干无争合，无多方牵制之象。'}\n` +
    `【地支作用】${coor.length ? coor.join('；') + '。' : '全局地支安静、少合冲，人生整体平稳。'}（合冲并见时，紧贴之合冲优先、力量大者优先。）\n` +
    `【空亡影响】空亡在「${kong.join('、')}」，${kongHit.length ? kongHit.join('、') + '逢空，对应领域（' + {'年支': '祖辈与早年根基', '月支': '父母与青年运', '日支': '夫妻宫与中年', '时支': '子女与晚年'}[kongHit[0]] + '等）力量虚浮、事多不成或缘浅。' : '命局四柱无逢空，各领域力量较实。'}`
  );
}

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

  // 性格三维度（按最强十神）
  const styleMap = {
    七杀: '做事风格果决敢闯、有魄力，压力越大越能激发斗志；人际上容易刚愎自用、与人冲突；情绪上易急躁冲动',
    正官: '做事风格循规蹈矩、注重章法；人际上重名声、讲原则、得人信任；情绪上较克制自律',
    食神: '做事风格平和从容、靠才华与口才；人际上随和好相处、人缘佳；情绪上乐观豁达',
    伤官: '做事风格敢想敢干、才华外露；人际上锋芒较盛、不服管束；情绪上情绪起伏大、易挑剔',
    正印: '做事风格沉稳内敛、爱钻研；人际上温和厚道、得长辈缘；情绪上平和但有依赖性',
    偏印: '做事风格别具一格、善独立思考；人际上较疏离、喜独处；情绪上敏感多思',
    正财: '做事风格务实稳健、勤劳务实；人际上重信守诺、讲实际；情绪上稳定但偏保守',
    偏财: '做事风格灵活机变、善抓机会；人际上广结人缘、大方豪爽；情绪上活跃但不耐寂寞',
    比肩: '做事风格独立自主、靠实力；人际上重朋友义气、但易竞争；情绪上倔强好强',
    劫财: '做事风格果敢行动力强；人际上仗义但易分财争利；情绪上冲动易变',
  };
  const style = styleMap[top] || '做事风格稳健中正；人际上平和；情绪上稳定';

  const coor = coordination(chart);
  const heNums = coor.filter((c) => c.includes('合')).length;
  const chongNums = coor.filter((c) => c.includes('冲') || c.includes('刑') || c.includes('害')).length;
  const heChong = `天干地支中「合」有${heNums}处、「冲刑害」有${chongNums}处——${heNums > chongNums ? '合多则人缘好但牵绊多、易被多方裹挟' : chongNums > heNums ? '冲多则变动大、有冲劲但也易与人起摩擦' : '合冲相衡，人际与自身节奏较为均衡'}。`;

  return (
    `【十神分布概览】以日主${dm}为"我"，七字标十神：${pos}。其中力量最强、最贴身的是「${top}」（${topShow.trim()}）。\n` +
    `【核心性格画像】以「${top}」为主导，融合日主${dm}本性（${C.GAN_NATURE[dm].split('，')[0]}），你的性格可从三个维度看：①做事风格：${style.split('；')[0]}；②人际模式：${style.split('；')[1]}；③情绪特点：${style.split('；')[2]}。\n` +
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

  // 婚恋（宫位+星曜三重印证：日支坐十神 + 配偶星旺衰 + 夫妻宫逢冲合刑）
  const dayZhiMainShen = chart.shishen._zhi_main.day; // 日支本气十神（配偶宫坐何星）
  const hunRels = ['年支', '月支', '时支'];
  const hunRelsZhi = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.hour[1]];
  const dayChong = [];
  hunRelsZhi.forEach((z, i) => {
    const r = zhiRelation(dayZhi, z);
    if (r) dayChong.push(`${r}${hunRels[i]}(${z})`);
  });
  const zuoDesc = {
    正财: '配偶务实稳重、重家庭', 偏财: '配偶慷慨灵活、善交际',
    正官: '配偶正派有担当、重规矩', 七杀: '配偶个性强势、有魄力',
    正印: '配偶宽厚慈爱、得长辈缘', 偏印: '配偶心思独特、有偏才',
    食神: '配偶温和随性、懂生活', 伤官: '配偶才华外露、个性强',
    比肩: '配偶独立好强、易有竞争', 劫财: '配偶行动力强、易争拗',
  };
  let hun = `${isMale ? '男命以财为妻' : '女命以官杀为夫'}。夫妻宫为日支${dayZhi}，坐「${dayZhiMainShen}」——${zuoDesc[dayZhiMainShen] || '配偶性情随坐支而定'}。`;
  hun += isMale
    ? (hasCai ? `配偶星（财）在命中有气，正缘可期、感情易得牵绊。` : `配偶星（财）不显，正缘偏迟、感情须主动经营。`)
    : (hasGuan ? `配偶星（官杀）在命中有气，正缘可期、感情易得牵绊。` : `配偶星（官杀）不显，正缘偏迟、感情须主动经营。`);
  if (dayChong.length) hun += `然夫妻宫逢${dayChong.join('、')}，婚姻易有波动，宜晚婚、择性格包容之伴侣。`;
  else hun += `夫妻宫安稳，婚姻根基较实。`;

  // 事业
  let shiye;
  if (hasGuan && hasYin) shiye = '官印相生，宜体制内、公门、大平台，循规蹈矩可稳步升迁。';
  else if (hasShiShang && hasCai) shiye = '食伤生财，宜经商创业、靠才艺技术变现。';
  else if (hasShiShang) shiye = '食伤泄秀，宜技术、创意、自由职业，凭一技之长立身。';
  else if (hasCai) shiye = '财星为用，宜经商理财、务实经营。';
  else shiye = '官杀财星皆不显，多凭专业协作立身，不宜强求权位。';
  const qiYunAge = (chart.dayun && chart.dayun[0]) ? chart.dayun[0].start_age : 0;
  shiye += `结合大运，${qiYunAge}岁起运后逐步进入事业上升通道，走用神运时（${chart.yongshen}当令之年）事业机遇最明显。`;

  // 财运
  let cai;
  if (hasCai) cai = '命带财星，求财有天然向度；' + (hasShiShang ? '食伤生财，利创意求财、技能变现' : '宜稳扎稳打、以正财为主');
  else cai = '财星不显，求财宜踏实积累、以一技之长立身';
  if (hasBiJie && hasCai) cai += '；但比劫夺财，合作易分财，理财宜独不宜众，防破财竞争。';
  else cai += '。';
  if (chart.strength === '身弱' && hasCai) cai += '（身弱财多不担财，宜先固本再求财，勿贪多冒进。）';

  // 六亲
  const liuqin = `年柱看祖辈（${chart.sizhu.year[0]}${chart.sizhu.year[1]}）、月柱看父母（${chart.sizhu.month[0]}${chart.sizhu.month[1]}）、时柱看子女（${chart.sizhu.hour[0]}${chart.sizhu.hour[1]}）。${hasYin ? '印星在命，与长辈、学历、贵人之缘较深' : '印星不显，长辈助力有限，宜自强'}；${hasShiShang ? '食伤在命，子女缘分、才华表达有向度' : '食伤不显，子女缘分或表达欲偏内敛'}。`;

  // 健康（以天干+地支藏干全计的五行分布判偏枯，贴近"气"的真实强弱）
  const wx = wuxingFull(chart);
  const entries = Object.entries(wx);
  const mx = entries.filter((e) => e[1] === Math.max(...entries.map((x) => x[1]))).map((e) => e[0]);
  const mn = entries.filter((e) => e[1] === Math.min(...entries.map((x) => x[1]))).map((e) => e[0]);
  const health = `五行中${mx.join('、')}偏旺、${mn.join('、')}偏弱（按天干与地支藏干全计）。按五行对应脏腑：${mx.map((e) => HEALTH[e] + '易亢').join('、')}；${mn.map((e) => HEALTH[e] + '易弱').join('、')}。以上仅为基于五行类象的体质趋势分析，不能替代医学诊断，如有不适请及时就医。`;

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
  let habit;
  if (th.kind.includes('寒') || th.kind.includes('湿')) habit = '命局偏寒湿，宜多晒太阳、居住向阳、喜温热饮食，忌久居阴冷潮湿之地。';
  else if (th.kind.includes('燥') || th.kind.includes('热')) habit = '命局偏燥热，宜近水而居、多静少躁、清淡饮食，忌熬夜上火。';
  else habit = '命局寒暖尚匀，保持作息规律、劳逸结合即可。';

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
      const els = pillarElements(d.pillar);
      const good = containsSet(els, yong);
      const rels = dayunRelation(chart, d.pillar[1]);
      const relTxt = rels.length
        ? `；此运${d.pillar[1]}与原局${rels.join('、')}，易触发结婚、换工作、搬家、破财等变动，变动方向以所冲合之宫位对应领域为准`
        : '；此运与原局无刑冲合害，变动较小、以平稳蓄势为主';
      return `${d.start_age}-${d.start_age + 9}岁走${d.pillar}运：${good ? '干支贴用神，整体上扬、机遇多，宜积极进取' : '干支犯忌神，压力增大，宜守不宜攻'}${relTxt}。`;
    }).join('\n')
    : '各步大运以平稳过渡为主，无明显大起大落，随喜忌年份顺势而为即可。';

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

  return (
    `【起运信息】年干${yearGan}为${yangYear ? '阳' : '阴'}年、${isMale ? '男' : '女'}命，故大运${forward ? '顺' : '逆'}排（阳男阴女顺排、阴男阳女逆排）。\n` +
    `【大运总览表】\n${table}\n` +
    `【关键大运详解】\n${keyTxt}\n` +
    `【近五年流年表】\n${liunian.join('\n')}\n` +
    `【关键年份预警】流年冲夫妻宫多应婚恋、动财星多应财运；逢忌神且冲原局之岁，宜保守、防口舌破财。以上为阶段趋势，具体境遇仍看个人抉择。`
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

  // 病与药
  let bing, yao;
  if (chart.strength === '身弱') {
    bing = `日主身弱，克泄耗方（官杀+财+食伤）力量占优，如${chart.jishen}等泄耗过重`;
    yao = `以${yong}帮身生扶，借印比之力稳住根基`;
  } else if (chart.strength === '身强') {
    bing = `日主身强，生扶方（印+比劫）力量过剩，如${chart.jishen}等再助则过亢`;
    yao = `以${yong}泄克，疏其秀、耗其过，使归于中和`;
  } else {
    bing = `日主中和，但仍有${th.kind}之偏性需调`;
    yao = `以${yong}流通取用，顺应气候偏性`;
  }

  const weak = chart.strength === '身弱' ? '身弱易被外界牵动，须借印比之力、避独扛' : chart.strength === '身强' ? '身强易刚愎，须泄秀、纳谏、防过刚' : '中和之体，忌偏执一端';

  return (
    `【命局核心矛盾】"病"：${bing}。"药"：${yao}。所有人生建议，都围绕"治病用药"展开，形成闭环。\n` +
    `【命局核心特质】日主${dm}（${dmEl}），${gs}，${chart.strength}，${th.kind}——${chart.strength === '身弱' ? '底子偏弱但可借力，格局有救应' : chart.strength === '身强' ? '底子厚实，须防过刚过满' : '底子均衡，胜在稳'}。\n` +
    `【四条核心建议】1. 事业：选${chart.yongshen}所属行业（${INDUSTRY[yong.split('、')[0]]}），${chart.strength === '身弱' ? '进大平台、循规借力' : '主动开拓、发挥所长'}；2. 人际：${chart.strength === '身弱' ? '广结贵人、团队合作，勿单打独斗' : '适当放权、纳谏，防刚愎'};3. 生活：${th.needEl ? '起居顺应季节，调候取「' + th.needEl + '」' : '起居顺应四时，劳逸结合'}；4. 心态：${chart.strength === '身弱' ? '养精蓄锐、稳中求进，忌急于求成' : '戒骄戒躁、以退为进，忌得意忘形'}。\n` +
    `【正向引导】《周易》云："天行健，君子以自强不息。"命为先天趋势，运为后天条件，人的选择与行动才是最终变量。好命不努力亦难成，命局有缺亦可凭后天选择趋吉避凶。`
  );
}

// 周易参证：以《易》卦象与义理印证命局
function zhouyiSection(chart) {
  const { gua, tuiyan } = Z.derive(chart);
  const gdisplay = gua.map((g) => `${g.glyph}${g.name}（${g.xiang}）`).join('、');
  let txt = `《易》以卦象穷天地万物之情，今以斯命合之：`;
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
