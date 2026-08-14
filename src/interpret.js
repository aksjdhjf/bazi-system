// 解读层（滴天髓逻辑框架）：读取排盘 JSON，按《滴天髓》逻辑链输出命理报告
// 逻辑链：定日主 → 辨旺衰 → 察配合 → 取用神 → 论格局 → 六亲 → 行运
const C = require('./constants');
const D = require('./ditiansui');
const { sanitize } = require('./nlp');

function pillarElements(pillar) {
  const gan = pillar[0], zhi = pillar[1];
  return [C.elementOfGan(gan), C.ZHI_MAIN[zhi]].filter(Boolean);
}
function containsSet(arr, set) { return arr.some((e) => set.includes(e)); }

// 旺衰判定明细（结合评分，透明说明得令/得地/得生助）
function strengthDetail(chart) {
  const dm = C.elementOfGan(chart.day_master);
  const monthZhi = chart.sizhu.month[1];
  const monthSeason = D.SEASON[monthZhi];
  const ling = C.ZHI_MAIN[monthZhi] === dm ? '得月令（提纲当旺）'
    : C.SHENG[monthZhi] ? (C.elementOfGan(C.SHENG_INV[dm]) === C.ZHI_MAIN[monthZhi] ? '得月令生扶' : '')
    : '';
  let verdict;
  if (chart.strength === '身弱') verdict = '偏弱，如幼苗待雨露生扶';
  else if (chart.strength === '身强') verdict = '偏强，如大树需疏剪通风';
  else verdict = '中和，气血匀停';
  return { dm, monthSeason, ling, verdict, score: chart.strength_score };
}

// 干支配合检测（三合 / 六合 / 刑冲）
function coordination(chart) {
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  const notes = [];
  // 三合（任意三支配齐）
  const tri = zhis.join('');
  Object.keys(D.SANHE).forEach((k) => {
    if (k.split('').every((c) => zhis.includes(c))) notes.push(`地支会${D.SANHE[k]}局（${k}三合），气势凝聚`);
  });
  // 六合（两两）
  for (let i = 0; i < zhis.length; i++) for (let j = i + 1; j < zhis.length; j++) {
    const pair = [zhis[i], zhis[j]].sort().join('');
    const rev = [zhis[j], zhis[i]].sort().join('');
    if (D.LIUHE[pair] || D.LIUHE[rev]) notes.push(`地支${zhis[i]}${zhis[j]}相合（${D.LIUHE[pair] || D.LIUHE[rev]}），主情投意合或牵绊`);
  }
  // 刑冲
  for (let i = 0; i < zhis.length; i++) for (let j = i + 1; j < zhis.length; j++) {
    const pair = [zhis[i], zhis[j]].sort().join('');
    if (D.LIUCHONG.includes(pair)) notes.push(`地支${zhis[i]}${zhis[j]}相冲，主变动、起伏或根基动摇`);
  }
  // 天干五合
  const gans = [chart.sizhu.year[0], chart.sizhu.month[0], chart.sizhu.day[0], chart.sizhu.hour[0]];
  const he = { '甲己': '土', '乙庚': '金', '丙辛': '水', '丁壬': '木', '戊癸': '火' };
  for (let i = 0; i < gans.length; i++) for (let j = i + 1; j < gans.length; j++) {
    const key = [gans[i], gans[j]].sort().join('');
    if (he[key]) notes.push(`天干${gans[i]}${gans[j]}相合（化${he[key]}），主性情圆融或牵缠`);
  }
  return notes;
}

function overview(chart) {
  const s = chart.sizhu;
  const tg = D.TIANGAN[chart.day_master];
  const sd = strengthDetail(chart);
  const coor = coordination(chart);
  let txt = `四柱为「${s.year} ${s.month} ${s.day} ${s.hour}」。`;
  txt += `${tg.name}日出生，${tg.show}——${tg.trait}`;
  txt += `论旺衰：日主${sd.dm}五行，${sd.verdict}（综合旺衰评分约 ${sd.score}，参考值）；${sd.ling || '未得月令独旺，须看全局生扶'}。生于${sd.monthSeason}月，${D.SEASON_NOTE[sd.monthSeason]}。`;
  txt += `入${chart.geju}。`;
  if (coor.length) txt += `干支配合方面：${coor.join('；')}。`;
  txt += D.TIANGAN_ZONG;
  return txt;
}

function personality(chart) {
  const dm = C.elementOfGan(chart.day_master);
  const tg = D.TIANGAN[chart.day_master];
  const lines = [`日主属${tg.name}，《滴天髓》云：「${tg.jing}」`];
  lines.push(`气象取象：${tg.trait}`);
  // 突出非比劫的十神
  const dist = chart.shishen_distribution || {};
  const ranked = Object.entries(dist)
    .filter(([k]) => k !== '比肩' && k !== '劫财')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);
  ranked.forEach((k) => { if (D.SHEN_SHOW[k]) lines.push(`命带${k}：${D.SHEN_SHOW[k]}`); });
  return lines.join('');
}

function yongShen(chart) {
  const sd = strengthDetail(chart);
  const dm = C.elementOfGan(chart.day_master);
  let txt = `取用之法，先辨旺衰：${sd.verdict}。`;
  txt += D.YONG_PRINCIPLES.fu_yi + ' ';
  txt += D.YONG_PRINCIPLES.bing_yao + ' ';
  // 调候维度
  const season = sd.monthSeason;
  if (season === '冬') txt += `又此命冬生寒湿，按调候之理「寒虽甚，要暖有气」，火为重中之重之调候用神；`;
  else if (season === '夏') txt += `又此命夏生炎燥，按调候之理「暖虽至，要寒有根」，水为关键之调候用神；`;
  else txt += D.YONG_PRINCIPLES.tiao_hou + ' ';
  txt += `综上，原局之用神为「${chart.yongshen}」（喜神${chart.xishen}），所忌者为「${chart.jishen}」。${D.YONG_PRINCIPLES.qing_zhuo}`;
  return txt;
}

function career(chart) {
  const dist = chart.shishen_distribution || {};
  const hasCai = (dist['正财'] || 0) + (dist['偏财'] || 0) > 0;
  const hasGuan = (dist['正官'] || 0) + (dist['七杀'] || 0) > 0;
  let s = `事业看官杀（权柄、规则、担当之星），财运看财星（养命、资源之星），二者皆须贴合用神方能发力。`;
  if (hasGuan) s += '命带官杀，具责任意识与开拓魄力，宜在结构内担纲、建立秩序；';
  else s += '官杀不显，事业更多凭专业与协作立身，不宜强求权位；';
  if (hasCai) s += '命带财星，对经营、理财有天然倾向，善以才智生财；';
  else s += '财星不显，求财宜稳扎稳打、以专技立身；';
  s += `配合用神${chart.yongshen}、喜神${chart.xishen}，顺势而为则事业财运可得其宜；忌神${chart.jishen}所临之运岁，宜守不宜攻。`;
  return s;
}

function marriage(chart) {
  const isMale = chart.birth.gender === '男';
  const spouseStar = isMale ? '财星（正财为妻星）' : '官杀星（正官为夫星）';
  const spousePalace = chart.sizhu.day[1];
  const dist = chart.shishen_distribution || {};
  const hasSpouse = isMale ? (dist['正财'] || 0) + (dist['偏财'] || 0) > 0 : (dist['正官'] || 0) + (dist['七杀'] || 0) > 0;
  let s = `六亲之法：男命以财为妻、女命以官为夫。配偶星看${spouseStar}，配偶宫（日支）为「${spousePalace}」（${C.ZHI_MAIN[spousePalace]}）。`;
  s += hasSpouse ? '配偶星有根气，感情中易有踏实牵绊与经营空间；' : '配偶星偏弱，感情更需主动经营与沟通；';
  s += '相处上建议多换位思考、以柔化刚。缘分深浅、相处质量，仍由双方共同经营，非命定之数。';
  return s;
}

function dayun(chart) {
  const yong = chart.yongshen.split('、');
  const ji = chart.jishen.split('、');
  const list = (chart.dayun || []).slice(0, 4);
  if (!list.length) return '大运信息暂缺。';
  const parts = list.map((d) => {
    const els = pillarElements(d.pillar);
    let tag = '平运';
    if (containsSet(els, yong)) tag = '利好运（贴用神）';
    else if (containsSet(els, ji)) tag = '宜守运（犯忌神）';
    return `${d.start_age}岁起「${d.pillar}」${tag}`;
  });
  return '关键大运：' + parts.join('；') + '。' + D.YUN_PRINCIPLE + '（仅为阶段趋势，具体境遇仍看个人选择与环境。）';
}

function advice(chart) {
  const yong = chart.yongshen.split('、');
  const dm = C.elementOfGan(chart.day_master);
  const tg = D.TIANGAN[chart.day_master];
  const map = {
    木: '多亲近自然、文化、教育、咨询策划类事务，养「生发」之气',
    火: '参与展示、传播、创意类活动，发挥热情与行动力',
    土: '夯实专业基础、稳健理财与人际，重信守约',
    金: '在规则与专业领域精进、果敢决策，避免过度固执',
    水: '保持学习与灵活变通，借助人际流动与信息资源',
  };
  const tips = yong.map((e) => map[e]).filter(Boolean);
  const base = `依《滴天髓》用神之理，用神为${chart.yongshen}（喜${chart.xishen}、忌${chart.jishen}）。${tg.name}之喜：${tg.xi}；所忌：${tg.ji}。建议：`;
  if (!tips.length) return base + '顺势而为、扬长避短，在自身擅长的领域持续积累。';
  return base + tips.slice(0, 3).join('；') + '。';
}

function buildReport(chart) {
  const sections = [
    { key: '命局总览', text: overview(chart) },
    { key: '日主气象', text: personality(chart) },
    { key: '用神与忌神', text: yongShen(chart) },
    { key: '事业财运', text: career(chart) },
    { key: '婚姻感情', text: marriage(chart) },
    { key: '大运走势', text: dayun(chart) },
    { key: '行动建议', text: advice(chart) },
  ];
  sections.forEach((s) => { s.text = sanitize(s.text); });
  return sections;
}

module.exports = { buildReport };
