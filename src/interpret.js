// 解读层（滴天髓 + 周易 双典参证）：读取排盘 JSON，按命理逻辑链输出报告
// 文风：半文半白——存命理术语之髓，加以白话串讲，令深奥者可解。
const C = require('./constants');
const D = require('./ditiansui');
const Z = require('./zhouyi');
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
  if (chart.strength === '身弱') verdict = '偏弱，譬若春苗初发，犹待雨露以生扶';
  else if (chart.strength === '身强') verdict = '偏强，譬若大树已成，尚需疏剪以通风';
  else verdict = '中和，气血匀停，刚柔各得其所';
  return { dm, monthSeason, ling, verdict, score: chart.strength_score };
}

// 干支配合检测（三合 / 六合 / 刑冲）
function coordination(chart) {
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  const notes = [];
  const tri = zhis.join('');
  Object.keys(D.SANHE).forEach((k) => {
    if (k.split('').every((c) => zhis.includes(c))) notes.push(`地支会${D.SANHE[k]}局（${k}三合），气势凝聚`);
  });
  for (let i = 0; i < zhis.length; i++) for (let j = i + 1; j < zhis.length; j++) {
    const pair = [zhis[i], zhis[j]].sort().join('');
    const rev = [zhis[j], zhis[i]].sort().join('');
    if (D.LIUHE[pair] || D.LIUHE[rev]) notes.push(`地支${zhis[i]}${zhis[j]}相合（${D.LIUHE[pair] || D.LIUHE[rev]}），主情投意合，亦或牵绊`);
  }
  for (let i = 0; i < zhis.length; i++) for (let j = i + 1; j < zhis.length; j++) {
    const pair = [zhis[i], zhis[j]].sort().join('');
    if (D.LIUCHONG.includes(pair)) notes.push(`地支${zhis[i]}${zhis[j]}相冲，主变动起伏，或根基动摇`);
  }
  const gans = [chart.sizhu.year[0], chart.sizhu.month[0], chart.sizhu.day[0], chart.sizhu.hour[0]];
  const he = { '甲己': '土', '乙庚': '金', '丙辛': '水', '丁壬': '木', '戊癸': '火' };
  for (let i = 0; i < gans.length; i++) for (let j = i + 1; j < gans.length; j++) {
    const key = [gans[i], gans[j]].sort().join('');
    if (he[key]) notes.push(`天干${gans[i]}${gans[j]}相合（化${he[key]}），主性情圆融，亦或牵缠`);
  }
  return notes;
}

function overview(chart) {
  const s = chart.sizhu;
  const tg = D.TIANGAN[chart.day_master];
  const sd = strengthDetail(chart);
  const coor = coordination(chart);
  let txt = `观其四柱，乃「${s.year} ${s.month} ${s.day} ${s.hour}」也。日主${tg.name}，生于${tg.name}日——${tg.show}，${tg.trait}`;
  txt += `论其旺衰：日主${sd.dm}五行，${sd.verdict}（旺衰评分约 ${sd.score}，聊作参考）；${sd.ling || '未得月令独旺，当观全局生扶之多寡'}。生于${sd.monthSeason}月，${D.SEASON_NOTE[sd.monthSeason]}。`;
  txt += `命入${chart.geju}。`;
  if (coor.length) txt += `干支配合之间：${coor.join('；')}。`;
  txt += D.TIANGAN_ZONG;
  return txt;
}

function personality(chart) {
  const tg = D.TIANGAN[chart.day_master];
  const lines = [`日主属${tg.name}，《滴天髓》有云：「${tg.jing}」`];
  lines.push(`气象取象：${tg.trait}`);
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
  let txt = `取用之法，先辨旺衰：${sd.verdict}。`;
  txt += D.YONG_PRINCIPLES.fu_yi + ' ';
  txt += D.YONG_PRINCIPLES.bing_yao + ' ';
  const season = sd.monthSeason;
  if (season === '冬') txt += `又此命冬生而寒湿，依调候之理「寒虽甚，要暖有气」，是以火为调候之要；`;
  else if (season === '夏') txt += `又此命夏生而炎燥，依调候之理「暖虽至，要寒有根」，是以水为调候之关键；`;
  else txt += D.YONG_PRINCIPLES.tiao_hou + ' ';
  txt += `综而观之，原局用神为「${chart.yongshen}」（喜神${chart.xishen}），所忌者为「${chart.jishen}」。${D.YONG_PRINCIPLES.qing_zhuo}`;
  return txt;
}

// 周易参证：以《易》卦象与义理印证命局，按卦气—时位逻辑推演
function zhouyiSection(chart) {
  const { gua, tuiyan } = Z.derive(chart);
  const gdisplay = gua.map((g) => `${g.glyph}${g.name}（${g.xiang}）`).join('、');
  let txt = `《易》以卦象穷天地万物之情，今以斯命合之：`;
  if (gua.length) txt += `主导之卦为${gdisplay}。`;
  txt += tuiyan;
  return txt;
}

function career(chart) {
  const dist = chart.shishen_distribution || {};
  const hasCai = (dist['正财'] || 0) + (dist['偏财'] || 0) > 0;
  const hasGuan = (dist['正官'] || 0) + (dist['七杀'] || 0) > 0;
  let s = `事业看官杀——权柄、规则、担当之星；财运看财星——养命、资源之星。二者皆须贴合用神，方能得以发用。`;
  if (hasGuan) s += '命带官杀，具责任意识与开拓之魄，宜于规矩之中担纲、于秩序之内建功；';
  else s += '官杀不显，事业多凭专业与协作立身，不宜强求权位；';
  if (hasCai) s += '命带财星，于经营、理财有天然之向，善以才智生财；';
  else s += '财星不显，求财宜稳扎稳打，以一技之长立身；';
  s += `配合用神${chart.yongshen}、喜神${chart.xishen}，顺势而为则事业财运可得其宜；至若忌神${chart.jishen}所临之大运流年，宜守不宜攻。`;
  return s;
}

function marriage(chart) {
  const isMale = chart.birth.gender === '男';
  const spouseStar = isMale ? '财星（正财为妻星）' : '官杀星（正官为夫星）';
  const spousePalace = chart.sizhu.day[1];
  const dist = chart.shishen_distribution || {};
  const hasSpouse = isMale ? (dist['正财'] || 0) + (dist['偏财'] || 0) > 0 : (dist['正官'] || 0) + (dist['七杀'] || 0) > 0;
  let s = `六亲之法：男命以财为妻、女命以官为夫。配偶星看${spouseStar}，配偶宫（日支）为「${spousePalace}」（属${C.ZHI_MAIN[spousePalace]}）。`;
  s += hasSpouse ? '配偶星有根气，感情中易得踏实之牵绊，亦有经营之余地；' : '配偶星偏弱，感情更须主动经营、以诚相待；';
  s += '相处之道，贵在多换位思考、以柔化刚。缘分之深浅、相处之质，终由二人共同栽培，非命定之数也。';
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
    if (containsSet(els, yong)) tag = '利好之运（贴用神）';
    else if (containsSet(els, ji)) tag = '宜守之运（犯忌神）';
    return `${d.start_age}岁起「${d.pillar}」${tag}`;
  });
  return '关键大运：' + parts.join('；') + '。' + D.YUN_PRINCIPLE + '（此仅为阶段之趋势，具体境遇仍看个人之抉择与环境。）';
}

function advice(chart) {
  const yong = chart.yongshen.split('、');
  const tg = D.TIANGAN[chart.day_master];
  const map = {
    木: '多亲近自然、文化、教育、咨询策划之务，以养「生发」之气',
    火: '投身展示、传播、创意之业，以发其热情与行动之力',
    土: '夯实专业之基、稳健理财与人际，重信守约',
    金: '于规则与专业之域精进、果敢以决，然须防执之太过',
    水: '保持学习、灵活以变，借人际之流动与信息之资源',
  };
  const tips = yong.map((e) => map[e]).filter(Boolean);
  const base = `依《滴天髓》用神之理，用神为${chart.yongshen}（喜${chart.xishen}、忌${chart.jishen}）。${tg.name}之喜：${tg.xi}；所忌：${tg.ji}。建言：`;
  if (!tips.length) return base + '顺势而为、扬长避短，于所擅长之域持续积累足矣。';
  return base + tips.slice(0, 3).join('；') + '。';
}

function buildReport(chart) {
  const sections = [
    { key: '命局总览', text: overview(chart) },
    { key: '日主气象', text: personality(chart) },
    { key: '用神与忌神', text: yongShen(chart) },
    { key: '周易参证', text: zhouyiSection(chart) },
    { key: '事业财运', text: career(chart) },
    { key: '婚姻感情', text: marriage(chart) },
    { key: '大运走势', text: dayun(chart) },
    { key: '行动建议', text: advice(chart) },
  ];
  sections.forEach((s) => { s.text = sanitize(s.text); });
  return sections;
}

module.exports = { buildReport };
