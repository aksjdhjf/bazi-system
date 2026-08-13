// 解读层（规则引擎，离线可用）：读取排盘 JSON，按提示词第三节结构输出命理报告
const C = require('./constants');
const { sanitize } = require('./nlp');

const ELEM_TRAIT = {
  木: '仁厚有上进心、条理清晰',
  火: '热情外向、行动力强',
  土: '踏实稳重、重信守诺',
  金: '果断讲原则、有决断力',
  水: '聪慧灵活、善于变通',
};
const SHEN_TRAIT = {
  正官: '自律守规、有责任感',
  七杀: '魄力十足、敢闯敢担（偏官）',
  正印: '喜钻研、内心细腻涵容',
  偏印: '善思考、有独到见解',
  食神: '聪颖平和、表达顺畅',
  伤官: '才华外露、富有创意锋芒',
  正财: '务实稳健、善理财物',
  偏财: '灵活机变、偏得外财',
  比肩: '独立有主见、重朋友',
  劫财: '果敢仗义、行动力强',
};

function pillarElements(pillar) {
  const gan = pillar[0], zhi = pillar[1];
  return [C.elementOfGan(gan), C.ZHI_MAIN[zhi]].filter(Boolean);
}
function containsSet(arr, set) { return arr.some((e) => set.includes(e)); }

function overview(chart) {
  const s = chart.sizhu;
  return `四柱为「${s.year} ${s.month} ${s.day} ${s.hour}」，日主${chart.day_master}（${C.elementOfGan(chart.day_master)}）${chart.strength}，` +
    `入${chart.geju}。整体而言，此命局${chart.strength === '身弱' ? '宜以稳为主、借力前行' : chart.strength === '身强' ? '自身能量充沛、可主动施展' : '中和可调、攻守兼备'}。`;
}

function personality(chart) {
  const dm = C.elementOfGan(chart.day_master);
  const lines = [`日主属${dm}，${ELEM_TRAIT[dm]}。`];
  // 取分布中最突出的两个「非比劫」十神
  const dist = chart.shishen_distribution || {};
  const ranked = Object.entries(dist)
    .filter(([k]) => k !== '比肩' && k !== '劫财')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);
  ranked.forEach((k) => { if (SHEN_TRAIT[k]) lines.push(`命带${k}（${k === '七杀' || k === '正官' ? '克我之星' : k === '正印' || k === '偏印' ? '生我之星' : k === '食神' || k === '伤官' ? '我生之星' : '我克之星'}），${SHEN_TRAIT[k]}。`); });
  return lines.join('');
}

function career(chart) {
  const yong = chart.yongshen.split('、');
  const dist = chart.shishen_distribution || {};
  const hasCai = (dist['正财'] || 0) + (dist['偏财'] || 0) > 0;
  const hasGuan = (dist['正官'] || 0) + (dist['七杀'] || 0) > 0;
  let s = `用神为${chart.yongshen}（喜神${chart.xishen}），${chart.strength === '身弱' ? '利于借师长、同伴之力，宜稳健积累、厚积薄发' : chart.strength === '身强' ? '利于施展才华、担责任事、开拓进取' : '宜平衡发展、动静得宜'}。`;
  if (hasCai) s += '命中有财星（代表资源与收益之星），对务实经营、理财有天然倾向；';
  if (hasGuan) s += '命中有官杀星（代表事业与规则之星），利于在结构中承担责任、建立秩序；';
  s += `需留意忌神${chart.jishen}所代表的人事与环境，避免过度消耗。`;
  return s;
}

function marriage(chart) {
  const isMale = chart.birth.gender === '男';
  const spouseStar = isMale ? '财星（正财为妻星）' : '官杀星（正官为夫星）';
  const spousePalace = chart.sizhu.day[1];
  const dist = chart.shishen_distribution || {};
  const hasSpouse = isMale ? (dist['正财'] || 0) + (dist['偏财'] || 0) > 0 : (dist['正官'] || 0) + (dist['七杀'] || 0) > 0;
  let s = `配偶星看${spouseStar}，配偶宫（日支）为「${spousePalace}」（${C.ZHI_MAIN[spousePalace]}）。`;
  s += hasSpouse ? '命局中配偶星有根气，感情中易有踏实牵绊与经营空间；' : '配偶星偏弱，感情更需主动经营与沟通；';
  s += '相处上建议多换位思考、以柔化刚，缘分与质量仍由双方共同经营，非命定结局。';
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
    if (containsSet(els, yong)) tag = '利好运（贴合用神）';
    else if (containsSet(els, ji)) tag = '宜守运（犯忌神）';
    return `${d.start_age}岁起「${d.pillar}」${tag}`;
  });
  return '关键大运：' + parts.join('；') + '。整体仅为阶段趋势，具体境遇仍看个人选择与环境。';
}

function advice(chart) {
  const yong = chart.yongshen.split('、');
  const dm = C.elementOfGan(chart.day_master);
  const map = {
    木: '多接触自然、文化教育、咨询策划类事务，养「生发」之气',
    火: '参与展示、传播、创意类活动，发挥热情与行动力',
    土: '夯实专业基础、稳健理财与人际，重信守约',
    金: '在规则与专业领域精进、果敢决策，避免过度固执',
    水: '保持学习与灵活变通，借助人际流动与信息资源',
  };
  const tips = yong.map((e) => map[e]).filter(Boolean);
  const base = `结合用神${chart.yongshen}（喜${chart.xishen}、忌${chart.jishen}），建议：`;
  if (!tips.length) return base + '顺势而为、扬长避短，在自身擅长的领域持续积累。';
  return base + tips.slice(0, 3).join('；') + '。';
}

function buildReport(chart) {
  const sections = [
    { key: '命局总览', text: overview(chart) },
    { key: '性格特质', text: personality(chart) },
    { key: '事业财运', text: career(chart) },
    { key: '婚姻感情', text: marriage(chart) },
    { key: '大运提示', text: dayun(chart) },
    { key: '行动建议', text: advice(chart) },
  ];
  sections.forEach((s) => { s.text = sanitize(s.text); });
  return sections;
}

module.exports = { buildReport };
