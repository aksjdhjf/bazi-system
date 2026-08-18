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

// 白话详解：用最通俗的大白话，把整套命局逐条拆开讲清楚，作为报告第一栏
function baihua(chart) {
  const s = chart.sizhu;
  const dm = chart.day_master;
  const dmEl = C.elementOfGan(dm);
  const tg = D.TIANGAN[dm];
  const sd = strengthDetail(chart);
  const wx = chart.wuxing;
  const wxDesc = Object.entries(wx).map(([k, v]) => `${k}行${v}个`).join('、');
  const ss = chart.shishen_distribution || {};
  const topShen = Object.entries(ss)
    .filter(([k]) => k !== '比肩' && k !== '劫财')
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

  // 日主五行意象（口语化）
  const elImg = {
    木: '它好比春天破土的小草、攀附的藤蔓——温柔、坚韧，生命力强，但也需要依靠和滋养才能长好',
    火: '它好比一簇跳动的火苗——热情外露、行动力强，招人注意，但也要有柴薪添着才能烧得久',
    土: '它好比厚重的大地——稳重、踏实、包容，是承载万物的根基，不张扬却最可靠',
    金: '它好比精炼过的金属——刚毅、果断、讲原则，棱角分明，认准的事很难被说服',
    水: '它好比流动的江河——聪明、灵活、适应力强，遇阻就绕、遇壑便盈，最善变通',
  };

  // 旺衰大白话
  let strengthPlain;
  if (chart.strength === '身弱') {
    strengthPlain = '通俗点说，你天生"本钱"稍欠，做事更容易累、更容易被外界影响，需要有人帮、有环境扶，才能把力气使出来。';
  } else if (chart.strength === '身强') {
    strengthPlain = '通俗点说，你天生底气足、有主见、扛得住事；但有时正因为太刚硬、太能扛，反而容易在人际关系或决策上吃亏，需要适当"泄一泄、松一松"。';
  } else {
    strengthPlain = '通俗点说，你不强也不弱，刚柔比较均衡，是相对好调理的命局，顺势而行即可。';
  }

  // 格局大白话
  let gejuPlain;
  if (chart.geju.includes('七杀')) gejuPlain = '七杀代表挑战、压力和魄力——你天生带一股不服输的劲，敢冲敢闯，但压力也常如影随形，关键在把压力化作动力。';
  else if (chart.geju.includes('正官')) gejuPlain = '正官代表规则、责任与名望——你做事讲规矩、有担当，更适合在框架内稳步建功。';
  else if (chart.geju.includes('食神') || chart.geju.includes('伤官')) gejuPlain = '食伤代表才华、表达与创意——你脑子活、点子多，适合靠才艺或想法吃饭。';
  else if (chart.geju.includes('财')) gejuPlain = '财星代表资源、财富与务实——你对钱和物质有较好的嗅觉，善于把事情落到实处。';
  else if (chart.geju.includes('印')) gejuPlain = '印星代表学习、庇护与贵人——你容易得到长辈、知识或平台的托举，适合走积累与沉淀的路。';
  else gejuPlain = '你的格局比较中和，多种力量交织，没有特别突出的单一主线。';

  // 用神大白话
  let yongPlain;
  if (chart.strength === '身弱') yongPlain = `因为你身弱，最喜"生你、帮你"的力量——比如你的用神「${chart.yongshen}」能补强你，喜神「${chart.xishen}」也来帮忙；最要避开的是忌神「${chart.jishen}」，它会再消耗你。`;
  else if (chart.strength === '身强') yongPlain = `因为你身强，最喜"泄你、克你"的力量来平衡——你的用神「${chart.yongshen}」就是干这事的，喜神「${chart.xishen}」相辅；忌神「${chart.jishen}」再来添力，反而会过刚易折。`;
  else yongPlain = `你中和，用神以"调候与流通"为先，核心是用神「${chart.yongshen}」、喜神「${chart.xishen}」，忌神「${chart.jishen}」宜避。`;

  // 五行偏枯白话
  const entries = Object.entries(wx);
  const max = Math.max(...entries.map((e) => e[1]));
  const min = Math.min(...entries.map((e) => e[1]));
  const mx = entries.filter((e) => e[1] === max).map((e) => e[0]);
  const mn = entries.filter((e) => e[1] === min).map((e) => e[0]);
  const wxPlain = `其中${mx.join('、')}偏旺、${mn.join('、')}偏弱——打个比方，就像一道菜里${mx.join('、')}味重了些、${mn.join('、')}味淡了些，整体再调和一下口感就更好。`;

  let t = '';
  t += `【先认识你的"八字"】所谓八字，说白了就是你出生那一刻的"时间密码"：把年、月、日、时各换算成一组天干地支，凑成八个字。你的八个字依次是——年柱「${s.year}」、月柱「${s.month}」、日柱「${s.day}」、时柱「${s.hour}」。\n`;
  t += `【哪个字代表"你"】这八个字里，最关键的是"日主"，也就是你出生那天的天干（${dm}），它代表的是"你这个人"本身。你的日主属${tg.name}（${dmEl}行），${elImg[dmEl] || '它是你性格与能量的底色'}。\n`;
  t += `【你是强是弱（旺衰）】八字最讲究"日主"是强是弱。${strengthPlain}你是${chart.strength}（评语：${sd.verdict.replace(/。.*$/, '')}；旺衰评分约 ${sd.score}，仅作参考）。你出生在${sd.monthSeason}月，${D.SEASON_NOTE[sd.monthSeason]}\n`;
  t += `【你的"人生牌型"（格局）】格局相当于你这盘八字的主旋律。你属于「${chart.geju}」——${gejuPlain}\n`;
  t += `【最该补什么（用神）】这是八字里最实用的一件事："用神"就是能让你的命局变平衡的"良药"。${yongPlain}往后选行业、交朋友、挑时机，尽量往用神的方向靠，就更容易顺。\n`;
  t += `【五行分布一览】你八字里的五行数量是：${wxDesc}。${wxPlain}\n`;
  if (topShen.length) t += `【性格里最明显的几股力量】按十神看，你命中最突出的三样是：${topShen.join('、')}。它们叠加在一起，构成了你对外最常被感知到的气质。\n`;
  t += `（下面几栏会用更接近典籍的方式，从命理、周易两面再做参证，你可以对照着看。）`;
  return t;
}

function buildReport(chart) {
  const sections = [
    { key: '白话详解', text: baihua(chart) },
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
