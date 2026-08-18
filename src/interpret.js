// 解读层（滴天髓 + 周易 双典参证）：读取排盘 JSON，按「命理师深度解读报告」结构输出
// 首栏为文言文「命局总览」，其后为白话文分板块详解；最后附《周易》参证。
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

// 月令旺相休囚死判定
function lingState(dmEl, monthZhi) {
  const season = D.SEASON[monthZhi];
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
  zhis.forEach((z, idx) => {
    if (idx === 2) {
      if (C.ZHI_MAIN[z] === dm) strongRoot++;
      else if ((C.ZHI_HIDDEN[z] || []).some((g) => C.elementOfGan(g) === dm)) anyRoot++;
      return;
    }
    if (C.ZHI_MAIN[z] === dm) { strongRoot++; anyRoot++; }
    else if ((C.ZHI_HIDDEN[z] || []).some((g) => C.elementOfGan(g) === dm)) anyRoot++;
  });
  return { strongRoot, anyRoot, hasRoot: anyRoot > 0 };
}

// 干支作用关系（天干五合/相冲 + 地支三合/三会/六合/六冲/相刑/相害）
function coordination(chart) {
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  const gans = [chart.sizhu.year[0], chart.sizhu.month[0], chart.sizhu.day[0], chart.sizhu.hour[0]];
  const notes = [];
  Object.keys(D.SANHE).forEach((k) => { if (k.split('').every((c) => zhis.includes(c))) notes.push(`地支${k}三合${D.SANHE[k]}局，气势凝聚`); });
  Object.keys(C.SANHUI).forEach((k) => { if (k.split('').every((c) => zhis.includes(c))) notes.push(`地支${k}三会${C.SANHUI[k]}方，一行能量汇聚放大`); });
  for (let i = 0; i < zhis.length; i++) for (let j = i + 1; j < zhis.length; j++) {
    const pair = [zhis[i], zhis[j]].sort().join('');
    const rev = [zhis[j], zhis[i]].sort().join('');
    if (D.LIUHE[pair] || D.LIUHE[rev]) notes.push(`地支${zhis[i]}${zhis[j]}六合（合${D.LIUHE[pair] || D.LIUHE[rev]}），主牵绊结缘`);
    if (D.LIUCHONG.includes(pair)) notes.push(`地支${zhis[i]}${zhis[j]}六冲，主变动起伏、根基动摇`);
    if (C.XING_PAIRS.includes(pair)) notes.push(`地支${zhis[i]}${zhis[j]}相刑，主是非内耗、暗伤`);
    if (C.HAI_PAIRS.includes(pair)) notes.push(`地支${zhis[i]}${zhis[j]}相害，主小人暗中损耗`);
  }
  C.XING_SELF.forEach((z) => { if (zhis.filter((x) => x === z).length > 1) notes.push(`地支${z}自刑，主内心纠结`); });
  const he = { '甲己': '土', '乙庚': '金', '丙辛': '水', '丁壬': '木', '戊癸': '火' };
  for (let i = 0; i < gans.length; i++) for (let j = i + 1; j < gans.length; j++) {
    const key = [gans[i], gans[j]].sort().join('');
    if (he[key]) notes.push(`天干${gans[i]}${gans[j]}五合（化${he[key]}），主牵缠合作、性情圆融`);
    if (C.GAN_CHONG.includes(key)) notes.push(`天干${gans[i]}${gans[j]}相冲，主思想矛盾、人际对立`);
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
  return [k1, k2];
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
  if (monthZhi === '丑' || monthZhi === '辰') { kind = '湿土厚重'; needEl = '火'; need = '用火来制土除湿、暖局'; }
  else if (monthZhi === '未' || monthZhi === '戌') { kind = '燥土焦枯'; needEl = '水'; need = '用水来润燥、润土生金'; }
  else if (season === '冬') { kind = '寒水湿冷'; needEl = '火'; need = '用火暖局'; }
  else if (season === '夏') { kind = '火旺燥热'; needEl = '水'; need = '用水降温润燥'; }
  else if (season === '秋') { kind = '金旺寒凉'; needEl = '火'; need = '用火暖局、兼以水润'; }
  else { kind = '温润平和'; needEl = null; need = '寒暖尚匀，调候非急所，可随旺衰取用'; }
  return { season, kind, needEl, need };
}

// 五行 → 脏腑
const HEALTH = { 金: '肺与呼吸道', 木: '肝胆', 水: '肾与泌尿生殖', 火: '心与血液循环', 土: '脾胃消化系统' };

// 喜用神 → 行业 / 方位 / 颜色
const INDUSTRY = {
  木: '文化教育、出版、园林木制品、服装',
  火: '能源、餐饮、互联网、传媒、美容',
  土: '地产、建筑、农业、矿产、仓储',
  金: '金融、机械、五金、汽车、军警',
  水: '物流、水产、贸易、旅游、咨询',
};
const DIRECTION = { 木: '东方', 火: '南方', 土: '中央/西南/东北', 金: '西方', 水: '北方' };
const COLOR = { 木: '青、绿', 火: '红、紫', 土: '黄、棕', 金: '白、金', 水: '黑、蓝' };

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
  if (g.includes('印')) return '正印格';
  if (g.includes('财')) return '财格';
  if (g.includes('建禄') || g.includes('月劫') || g.includes('比劫')) return '建禄格';
  return '中和格';
}

// ───────────────────────────────────────────────
// 栏一：命局总览（文言文，80-150字，针对具体命局）
// ───────────────────────────────────────────────
function mingjuZonglan(chart) {
  const dm = chart.day_master;
  const dmName = D.TIANGAN[dm].name; // 甲木/乙木…
  const mz = chart.sizhu.month[1];
  const gs = gejuShort(chart);
  const monthShen = chart.shishen.month_gan; // 月干十神（格局核心）

  const season = D.SEASON[mz];
  let tiaoW;
  if (mz === '丑' || mz === '辰') tiaoW = '湿土厚重，须火燥之';
  else if (mz === '未' || mz === '戌') tiaoW = '燥土焦枯，须水润之';
  else if (season === '冬') tiaoW = '冬令寒湿，须火暖局';
  else if (season === '夏') tiaoW = '夏令炎燥，须水润局';
  else if (season === '秋') tiaoW = '秋令肃杀，喜火温润';
  else tiaoW = '春气和煦，调候非急';

  let wenshuaiW;
  if (chart.strength === '身弱') wenshuaiW = '日主根浅，克泄交加，身弱之象';
  else if (chart.strength === '身强') wenshuaiW = '日主得势，生扶有力，身旺之象';
  else wenshuaiW = '日主刚柔相济，中和之象';

  let yongjiW;
  if (chart.strength === '身弱') yongjiW = `喜印比生扶（用${chart.yongshen}），忌官杀财耗（忌${chart.jishen}）`;
  else if (chart.strength === '身强') yongjiW = `喜财官食伤（用${chart.yongshen}），忌印比再助（忌${chart.jishen}）`;
  else yongjiW = `以流通为要（用${chart.yongshen}），忌${chart.jishen}`;

  const dashiMap = {
    七杀格: '宜于权柄职守，化压力为功名',
    正官格: '宜于规矩公门，稳步升迁',
    食神格: '宜以才艺饮食生财',
    伤官格: '宜以技艺创意扬名',
    正印格: '宜文教钻研，得长者提携',
    财格: '宜经商理财，善聚四方之财',
    建禄格: '宜自立合伙，白手起家',
    中和格: '宜顺势而为，随运取用',
  };
  const dashi = dashiMap[gs] || '宜顺势而为';

  return `${dmName}生于${mz}月，${gs}也，月令透${monthShen}。${tiaoW}；${wenshuaiW}。${yongjiW}。${dashi}，中年行用神之地，方得舒展。`;
}

// ───────────────────────────────────────────────
// 栏二：命盘基础信息
// ───────────────────────────────────────────────
function jichu(chart) {
  const s = chart.sizhu;
  const kong = xunKong(chart);
  const zhis = [s.year[1], s.month[1], s.day[1], s.hour[1]];
  const kongHit = ['年支', '月支', '日支', '时支'].filter((_, i) => kong.includes(zhis[i]));
  const qiYun = (chart.dayun && chart.dayun[0]) ? chart.dayun[0].start_age : '—';
  const dayunTxt = (chart.dayun || []).map((d) => `${d.start_age}岁${d.pillar}`).join('、');
  const approx = chart.birth.longitude_approx ? '（经度按120°E近似）' : '';
  const lines = [
    `公历出生  ${chart.birth.gregorian}`,
    `真太阳时  ${chart.birth.true_solar_time}（经度${chart.birth.longitude}°E，校正${chart.birth.long_corr}分钟${approx}）`,
    `性别      ${chart.birth.gender}`,
    `出生地    ${chart.birth.city || '—'}（经度${chart.birth.longitude}°E）`,
    `年柱      ${s.year[0]}${s.year[1]}（藏干：${(C.ZHI_HIDDEN[s.year[1]] || []).join('、')}）`,
    `月柱      ${s.month[0]}${s.month[1]}（藏干：${(C.ZHI_HIDDEN[s.month[1]] || []).join('、')}）`,
    `日柱      ${s.day[0]}${s.day[1]}（日主${s.day[0]}；藏干：${(C.ZHI_HIDDEN[s.day[1]] || []).join('、')}）`,
    `时柱      ${s.hour[0]}${s.hour[1]}（藏干：${(C.ZHI_HIDDEN[s.hour[1]] || []).join('、')}）`,
    `空亡      ${kong.join('、')}${kongHit.length ? '（命局' + kongHit.join('、') + '逢空）' : '（命局四柱无逢空）'}`,
    `大运      ${qiYun}岁起运：${dayunTxt}`,
  ];
  return lines.join('\n');
}

// ───────────────────────────────────────────────
// 栏三：日主旺衰深度解析
// ───────────────────────────────────────────────
function wangshuai(chart) {
  const dm = chart.day_master;
  const dmEl = C.elementOfGan(dm);
  const ling = lingState(dmEl, chart.sizhu.month[1]);
  const q = quantify(chart);
  const det = shengKeDetail(chart);
  const rt = rootInfo(chart);
  let summary;
  if (chart.strength === '身弱') summary = '此命身弱无疑，如风中残烛，最忌再遇克泄耗之运，喜得生扶方能站稳。';
  else if (chart.strength === '身强') summary = '此命身强，如乔木成林，须泄其秀、疏其枝，方能成器，最忌再生扶。';
  else summary = '此命中和，气血匀停，刚柔各得其所，随运取用即可。';
  return (
    `【日主本性】你的日主是「${dm}」（属${dmEl}行），${C.GAN_NATURE[dm]}，这是你先天性格的底色。\n` +
    `【月令根基】月令${chart.sizhu.month[1]}属${ling.season}季，日主${dmEl}行在其中处于「${ling.state}」——${ling.note}。\n` +
    `【全局力量对比】生扶方（印+比劫）有：${det.shengList.join('、') || '无'}；克泄耗方（官杀+食伤+财）有：${det.keList.join('、') || '无'}。加权统计：生扶≈${q.sheng}，克泄耗≈${q.ke}（地支重于天干、本气重于藏干、紧贴重于远隔）。\n` +
    `【根气情况】日主在地支有${rt.strongRoot}处本气强根、共${rt.anyRoot}处根气${rt.hasRoot ? '' : '（几无根气，仅靠印生，身弱倾向明显）'}。\n` +
    `【旺衰结论】综合月令+全局力量+根气，判定为「${chart.strength}」（旺衰评分约 ${chart.strength_score}，仅作参考）。${summary}`
  );
}

// ───────────────────────────────────────────────
// 栏四：格局与调候
// ───────────────────────────────────────────────
function gejuTiaohou(chart) {
  const gs = gejuShort(chart);
  const monthShen = chart.shishen.month_gan;
  const th = tiaoHou(chart.sizhu.month[1]);
  const coor = coordination(chart);
  const yong = chart.yongshen.split('、');
  const broken = coor.some((c) => c.includes('冲') || c.includes('刑') || c.includes('害'));
  const gejuCheng = broken
    ? `格局用神恐有冲克刑害之扰（${coor.filter((c) => c.includes('冲') || c.includes('刑') || c.includes('害')).join('；')}），须看是否有印星转化护卫，有则格局不破，无则格局有损。`
    : '格局干支配合尚安，用神无破，格局较为清纯。';
  const wangTiao = yong.includes(th.needEl) ? '旺衰用神与调候用神一致，喜忌统一，取用更为专一。' : (th.needEl ? `旺衰用神（${chart.yongshen}）与调候所需（${th.needEl}）不尽相同，取用时以月令气候刚需为优先、旺衰平衡为辅，二者兼顾。` : '此命寒暖尚匀，调候非急，以旺衰取用为主。');
  return (
    `【所定格局】你属「${chart.geju}」。定格理由：月令${chart.sizhu.month[1]}本气透干、月干为${monthShen}，以此为格。\n` +
    `【格局成败】${gejuCheng}（《滴天髓》云：正官格忌伤官破，有印化伤则成；此理可类推各格。）\n` +
    `【调候分析】你出生在${th.season}季（月令${chart.sizhu.month[1]}），格局偏「${th.kind}」，${th.need}。\n` +
    `【旺衰与调候的关系】${wangTiao}`
  );
}

// ───────────────────────────────────────────────
// 栏五：十神人事与性格画像
// ───────────────────────────────────────────────
function shishenXingge(chart) {
  const s = chart.sizhu;
  const sh = chart.shishen;
  const zm = sh._zhi_main || {};
  const dist = chart.shishen_distribution || {};
  const ranked = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const combos = shenCombo(chart);
  const pos = [
    `年干${s.year[0]}→${sh.year_gan}`, `月干${s.month[0]}→${sh.month_gan}`, `时干${s.hour[0]}→${sh.hour_gan}`,
    `年支${s.year[1]}→${zm.year || sh.year_zhi[0]}`, `月支${s.month[1]}→${zm.month || sh.month_zhi[0]}`,
    `日支${s.day[1]}→${zm.day || sh.day_zhi[0]}`, `时支${s.hour[1]}→${zm.hour || sh.hour_zhi[0]}`,
  ].join('、');
  return (
    `【十神分布】以日主${chart.day_master}为"我"，七字标十神：${pos}。\n` +
    `【核心性格】命中最突出的十神是「${ranked.map(([k]) => k).join('、')}」。${ranked.map(([k]) => D.SHEN_SHOW[k] || '').filter(Boolean).join(' ')}\n` +
    `【十神组合效应】${combos.length ? combos.join('；') + '。' : '无明显特殊十神组合，性格以日主本性与最强十神为主导。'}\n` +
    `【十神人事对应】${Object.entries(SHEN_DOMAIN).map(([k, v]) => `${k}→${v}`).join('；')}。`
  );
}

// ───────────────────────────────────────────────
// 栏六：干支作用与人生牵绊
// ───────────────────────────────────────────────
function ganzhiZuoyong(chart) {
  const coor = coordination(chart);
  const kong = xunKong(chart);
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  const kongHit = ['年支', '月支', '日支', '时支'].filter((_, i) => kong.includes(zhis[i]));
  const gans = [chart.sizhu.year[0], chart.sizhu.month[0], chart.sizhu.day[0], chart.sizhu.hour[0]];
  const he = { '甲己': '土', '乙庚': '金', '丙辛': '水', '丁壬': '木', '戊癸': '火' };
  const ganHe = [];
  for (let i = 0; i < gans.length; i++) for (let j = i + 1; j < gans.length; j++) {
    const key = [gans[i], gans[j]].sort().join('');
    if (he[key]) ganHe.push(`天干${gans[i]}${gans[j]}合（化${he[key]}）`);
  }
  const ganChong = [];
  for (let i = 0; i < gans.length; i++) for (let j = i + 1; j < gans.length; j++) {
    const key = [gans[i], gans[j]].sort().join('');
    if (C.GAN_CHONG.includes(key)) ganChong.push(`天干${gans[i]}${gans[j]}冲`);
  }
  return (
    `【天干作用】五合：${ganHe.length ? ganHe.join('；') + '（合身主人际牵绊；化气须满足月令化神当令+透干+无克，否则只论合身）' : '无天干五合'}。相冲：${ganChong.length ? ganChong.join('；') + '（主思想矛盾、人际对立）' : '无天干相冲'}。\n` +
    `【地支作用】${coor.length ? coor.join('；') + '。' : '全局地支安静、少合冲，人生整体平稳。'}\n` +
    `【合冲与宫位】日支为夫妻宫，年月管长辈家庭，时柱管子女晚年——上述合冲落到哪个宫位，就对应哪个领域的变化。紧贴之合冲优先、力量大者优先。\n` +
    `【空亡影响】空亡在「${kong.join('、')}」，${kongHit.length ? kongHit.join('、') + '逢空，对应领域力量虚浮、事多不成或缘浅。' : '命局四柱无逢空。'}`
  );
}

// ───────────────────────────────────────────────
// 栏七：六亲·婚恋·事业·财运·健康
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

  // 婚恋
  let hun;
  if (isMale) {
    hun = `男命以财为妻。${hasCai ? '命带财星，配偶星有根气，感情易得踏实牵绊' : '财星不显，配偶星偏弱，感情更须主动经营'}。夫妻宫为日支${dayZhi}（属${C.ZHI_MAIN[dayZhi]}），${dayZhi === chart.sizhu.hour[1] ? '' : ''}若逢冲合刑则婚姻易有波动，宜晚婚并选性格包容之伴侣。`;
  } else {
    hun = `女命以官杀为夫。${hasGuan ? '命带官杀，配偶星有根气，感情易得踏实牵绊' : '官杀不显，配偶星偏弱，感情更须主动经营'}。夫妻宫为日支${dayZhi}（属${C.ZHI_MAIN[dayZhi]}），若逢冲合刑则婚姻易有波动，宜晚婚并选性格包容之伴侣。`;
  }

  // 事业
  let shiye;
  if (hasGuan && hasYin) shiye = '官印相生，宜体制内、公门、大平台，循规蹈矩可稳步升迁。';
  else if (hasShiShang && hasCai) shiye = '食伤生财，宜经商创业、靠才艺技术变现。';
  else if (hasShiShang) shiye = '食伤泄秀，宜技术、创意、自由职业，凭一技之长立身。';
  else if (hasCai) shiye = '财星为用，宜经商理财、务实经营。';
  else shiye = '官杀财星皆不显，多凭专业协作立身，不宜强求权位。';

  // 财运
  let cai;
  if (hasCai) cai = '命带财星，求财有天然向度；' + (hasShiShang ? '食伤生财，利创意求财、技能变现' : '宜稳扎稳打、以正财为主');
  else cai = '财星不显，求财宜踏实积累、以一技之长立身';
  if (hasBiJie && hasCai) cai += '；但比劫夺财，合作易分财，理财宜独不宜众，防破财竞争。';
  else cai += '。';

  // 六亲
  const liuqin = `年柱看祖辈（${chart.sizhu.year[0]}${chart.sizhu.year[1]}）、月柱看父母（${chart.sizhu.month[0]}${chart.sizhu.month[1]}）、时柱看子女（${chart.sizhu.hour[0]}${chart.sizhu.hour[1]}）。${hasYin ? '印星在命，与长辈、学历、贵人之缘较深' : '印星不显，长辈助力有限，宜自强'}；${hasShiShang ? '食伤在命，子女缘分、才华表达有向度' : '食伤不显，子女缘分或表达欲偏内敛'}。`;

  // 健康
  const wx = chart.wuxing;
  const entries = Object.entries(wx);
  const mx = entries.filter((e) => e[1] === Math.max(...entries.map((x) => x[1]))).map((e) => e[0]);
  const mn = entries.filter((e) => e[1] === Math.min(...entries.map((x) => x[1]))).map((e) => e[0]);
  const health = `五行中${mx.join('、')}偏旺、${mn.join('、')}偏弱。按五行对应脏腑：${mx.map((e) => HEALTH[e] + '易亢').join('、')}；${mn.map((e) => HEALTH[e] + '易弱').join('、')}。此为趋势参考，具体请以医学检查为准。`;

  return (
    `【1. 婚恋感情】${hun}\n` +
    `【2. 事业方向】${shiye}\n` +
    `【3. 财运分析】${cai}\n` +
    `【4. 六亲关系】${liuqin}\n` +
    `【5. 健康提示】${health}`
  );
}

// ───────────────────────────────────────────────
// 栏八：喜用神与人生调整指南
// ───────────────────────────────────────────────
function xiyongZhinan(chart) {
  const yong = chart.yongshen.split('、');
  const xi = chart.xishen.split('、');
  const ji = chart.jishen.split('、');
  const allEls = ['木', '火', '土', '金', '水'];
  const used = [...new Set([...yong, ...xi, ...ji])];
  const xian = allEls.filter((e) => !used.includes(e));
  const mainYong = yong[0];
  const industry = yong.map((e) => INDUSTRY[e]).filter(Boolean).join('；');
  const direction = yong.map((e) => DIRECTION[e]).filter(Boolean).join('、');
  const color = yong.map((e) => COLOR[e]).filter(Boolean).join('、');
  const th = tiaoHou(chart.sizhu.month[1]);
  let habit;
  if (th.kind.includes('寒') || th.kind.includes('湿')) habit = '命局偏寒湿，宜多晒太阳、居住向阳、喜温热饮食，忌久居阴冷潮湿之地。';
  else if (th.kind.includes('燥') || th.kind.includes('热')) habit = '命局偏燥热，宜近水而居、多静少躁、清淡饮食，忌熬夜上火。';
  else habit = '命局寒暖尚匀，保持作息规律、劳逸结合即可。';
  return (
    `【喜用神】${chart.yongshen}——能平衡全局、补偏救弊的"良药"${mainYong ? `，主用神为「${mainYong}」` : ''}。\n` +
    `【喜神】${chart.xishen}——辅助用神。\n` +
    `【忌神】${chart.jishen}——加剧失衡、带来压力损耗者，宜避。\n` +
    `【闲神】${xian.length ? xian.join('、') + '——力量中性，增减无明显吉凶' : '无（五行皆已分属用/喜/忌）'}。\n` +
    `【行业建议】${industry}。\n` +
    `【方位建议】${direction}。\n` +
    `【颜色建议】${color}。\n` +
    `【生活习惯】${habit}`
  );
}

// ───────────────────────────────────────────────
// 栏九：大运流年推演
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
    return `${d.start_age}-${d.start_age + 9}岁  ${d.pillar}  十神${shen}  ${tag}`;
  }).join('\n');
  // 流年（近5年）
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
    liunian.push(`${y}年 ${gz}  ${tag}`);
  }
  return (
    `【起运信息】年干${yearGan}为${yangYear ? '阳' : '阴'}年、${isMale ? '男' : '女'}命，故大运${forward ? '顺' : '逆'}排。\n` +
    `【大运总览】\n${table}\n` +
    `【大运要义】走喜用神大运整体上扬，走忌神大运宜守不宜攻；大运与原局合冲刑，易触发结婚、换工作、搬家、破财等变动。\n` +
    `【近五年流年】\n${liunian.join('\n')}\n` +
    `【关键年份预警】流年冲夫妻宫多应婚恋、动财星多应财运；逢忌神且冲原局之岁，宜保守、防口舌破财。以上为阶段趋势，具体境遇仍看个人抉择。`
  );
}

// ───────────────────────────────────────────────
// 栏十：综合总结与人生建议
// ───────────────────────────────────────────────
function zongjie(chart) {
  const dm = chart.day_master;
  const dmEl = C.elementOfGan(dm);
  const gs = gejuShort(chart);
  const th = tiaoHou(chart.sizhu.month[1]);
  const yong = chart.yongshen.split('、');
  const advantage = `日主${dmEl}本性（${C.GAN_NATURE[dm].split('，')[0]}）、格局${gs}`;
  const weak = chart.strength === '身弱' ? '身弱易被外界牵动，须借印比之力、避独扛' : chart.strength === '身强' ? '身强易刚愎，须泄秀、纳谏、防过刚' : '中和之体，忌偏执一端';
  return (
    `【命局核心特质】日主${dm}（${dmEl}），${gs}，${chart.strength}，${th.kind}。${advantage}，构成你人生的主轴。\n` +
    `【优势与短板】优势：${advantage}，可资发扬。短板：${weak}。\n` +
    `【核心建议】1. 顺势取用神「${chart.yongshen}」，选行业、方位、颜色多往此靠；2. ${chart.strength === '身弱' ? '借贵人、团队之力，勿单打独斗' : '适当泄秀、放权，勿事事亲为'}；3. ${th.needEl ? '调候取「' + th.needEl + '」，起居顺应季节寒暖' : '起居顺应四时，劳逸结合'}；4. 忌神「${chart.jishen}」所临之岁运宜守，逢冲合多谨慎。\n` +
    `【命理观】《周易》云："天行健，君子以自强不息。"命为先天趋势，运为后天条件，人的选择与行动才是最终变量。好命不努力亦难成，命局有缺亦可凭后天选择趋吉避凶。`
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
    { key: '日主旺衰解析', text: wangshuai(chart) },
    { key: '格局与调候', text: gejuTiaohou(chart) },
    { key: '十神与性格画像', text: shishenXingge(chart) },
    { key: '干支作用与人生牵绊', text: ganzhiZuoyong(chart) },
    { key: '六亲·婚恋·事业·财运·健康', text: liuQin(chart) },
    { key: '喜用神与调整指南', text: xiyongZhinan(chart) },
    { key: '大运流年推演', text: dayunLiunian(chart) },
    { key: '综合总结与人生建议', text: zongjie(chart) },
    { key: '周易参证', text: zhouyiSection(chart) },
  ];
  sections.forEach((s) => { s.text = sanitize(s.text); });
  return sections;
}

module.exports = { buildReport };
