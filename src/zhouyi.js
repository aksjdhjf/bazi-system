// 《周易》义理知识库（精髓逻辑层）
// 职责：把八字命局要素（日主五行 / 十神 / 格局 / 旺衰）映射为《周易》卦象与义理，
//       按"卦气—时位"逻辑做推演。与 data/zhouyi_pages.json（OCR 原文语料）配合：
//       本库负责"推导规则"，语料负责"原书引证"，二者解耦，语料缺失亦能输出。
const C = require('./constants');

// 去模板化工具：确定性哈希与句池选择（同输入必同输出，杜绝随机，保证同一八字结果可复现）
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

// 八纯卦义理（象 + 五行 + 核心义理 + 大象传主旨）
const BAGUA = {
  乾: { glyph: '☰', xiang: '天', wx: '金', yili: '刚健中正，自强不息；亢则有悔，盈不可久', xiangzhuan: '天行健，君子以自强不息' },
  坤: { glyph: '☷', xiang: '地', wx: '土', yili: '厚德载物，柔顺利贞；含章可贞，以时发也', xiangzhuan: '地势坤，君子以厚德载物' },
  震: { glyph: '☳', xiang: '雷', wx: '木', yili: '动也，奋发惊远；惧以终始，不敢妄动', xiangzhuan: '洊雷，震；君子以恐惧修省' },
  巽: { glyph: '☴', xiang: '风', wx: '木', yili: '入也，谦逊申命；随风巽，申命行事', xiangzhuan: '随风，巽；君子以申命行事' },
  坎: { glyph: '☵', xiang: '水', wx: '水', yili: '陷也，习坎维心；水流不盈，行险不失其信', xiangzhuan: '水洊至，习坎；君子以常德行，习教事' },
  离: { glyph: '☲', xiang: '火', wx: '火', yili: '丽也，明两作；日月丽乎天，百谷草木丽乎土', xiangzhuan: '明两作，离；大人以继明照于四方' },
  艮: { glyph: '☶', xiang: '山', wx: '土', yili: '止也，稳重敦厚；时止则止，时行则行', xiangzhuan: '兼山，艮；君子以思不出其位' },
  兑: { glyph: '☱', xiang: '泽', wx: '金', yili: '悦也，和悦讲习；丽泽兑，朋友讲习', xiangzhuan: '丽泽，兑；君子以朋友讲习' },
};

// 日主五行 → 主导卦（卦气之说：五行各有所属之象）
const WX_GUA = { 木: ['震', '巽'], 火: ['离'], 土: ['坤', '艮'], 金: ['乾', '兑'], 水: ['坎'] };

// 十神 → 易理范畴（以《易》象释十神之性）
const SHEN_YI = {
  正官: '乾之刚健、秩序之道——官者管也、法也，主规矩与担当',
  七杀: '乾之决断、习坎之勇——煞者肃杀，主魄力亦主压力',
  正财: '坤之资生、兑之悦——财者养命之源，主稳实之利',
  偏财: '兑之欢悦、流通之利——偏财为外财、流动之获',
  正印: '艮之蒙养、山止之庇——印者荫也、德也，主庇佑与涵养',
  偏印: '艮之潜藏、孤峰之慧——偏印为偏荫，主独到之思',
  食神: '兑之口悦、巽之入——食神吐秀，主才艺与安和',
  伤官: '兑之言语、需防口舌——伤官泄秀亦招非，贵在"和兑"',
  比肩: '同人之亲、类族辨物——比肩为同气，主手足之助',
  劫财: '同人之助亦争——劫财分财，亲中藏竞',
};

// 格局 → 主卦倾向
const GEJU_GUA = { 七杀: '乾', 偏官: '乾', 正官: '乾', 财: '坤', 印: '艮', 食神: '兑', 伤官: '兑', 比劫: '乾' };

// 旺衰 → 《易》"时、位"观（潜见惕跃，各当其时）；结合日主五行与命局最强十神，从句池确定性选句
function shiweiView(chart) {
  const strength = chart.strength;
  const dmName = chart.day_master;
  const dm = C.elementOfGan(dmName);
  const dist = chart.shishen_distribution || {};
  const top = Object.entries(dist)
    .filter(([k]) => k !== '日主')
    .sort((a, b) => b[1] - a[1])[0];
  const topShen = top ? top[0] : null;

  const weak = [
    `《易》重"待时"：日主${dmName}（${dm}）身弱${topShen ? `、以「${topShen}」为显` : ''}，如《乾》初九"潜龙勿用"，当藏器于身、蓄德俟命，不宜冒进；待风云相济，乃可"见龙在田"。`,
    `身弱而气属${dm}${topShen ? `、带「${topShen}」` : ''}，宜效《屯》"利建侯"之渐进：根基未固，先养气蓄力，勿与强争，待时而动。`,
    `${dmName}日主身弱${topShen ? `、主「${topShen}」` : ''}，合《复》"七日来复"之义：静养归根、厚积薄发，戒躁进，渐图恢复。`,
  ];
  const strong = [
    `《易》贵"与时偕行"：日主${dmName}（${dm}）身强${topShen ? `、以「${topShen}」为显` : ''}，如《乾》九三"君子终日乾乾"，自强而不息；然上九"亢龙有悔"，戒在盈满——强极当知敛。`,
    `身强而气属${dm}${topShen ? `、带「${topShen}」` : ''}，宜效《大有》"遏恶扬善"：势盛当惠及于人、纳谏防骄，勿恃刚而折。`,
    `${dmName}日主身强${topShen ? `、主「${topShen}」` : ''}，合《谦》"裒多益寡"之义：势大者宜谦退自牧，盈不可久，防亢极而悔。`,
  ];
  const balanced = [
    `《易》尚"中和"：日主${dmName}（${dm}）中和${topShen ? `、以「${topShen}」为显` : ''}，如《泰》"天地交而万物通"，刚柔相推、各得其位，宜守常道、顺势而为。`,
    `中和而气属${dm}${topShen ? `、带「${topShen}」` : ''}，合《既济》"水火相济"：刚柔得中，宜维持平衡、不偏不倚，稳中求进。`,
    `${dmName}日主中和${topShen ? `、主「${topShen}」` : ''}，宜效《咸》"君子以虚受人"：以虚受实、兼容并包，随运取用。`,
  ];

  const pool = strength === '身弱' ? weak : strength === '身强' ? strong : balanced;
  return pickFrom(pool, [C.ganIndex(dmName), C.zhiIndex(chart.sizhu.month[1]), chart.geju, strength, topShen].join('|'));
}

// 主推导：据命局返回相关卦象与半文半白推演
function derive(chart) {
  const dm = C.elementOfGan(chart.day_master);
  const guaNames = new Set();
  // 1) 日主五行定主卦
  (WX_GUA[dm] || []).forEach((g) => guaNames.add(g));
  // 2) 格局定主卦
  const geju = chart.geju || '';
  Object.keys(GEJU_GUA).forEach((k) => { if (geju.includes(k)) guaNames.add(GEJU_GUA[k]); });
  // 保底：至少取日主五行主卦
  if (!guaNames.size && WX_GUA[dm]) WX_GUA[dm].forEach((g) => guaNames.add(g));

  const gua = [...guaNames].slice(0, 2).map((n) => ({ name: n, ...BAGUA[n] }));

  // 3) 十神易理（取命局中显著者）
  const dist = chart.shishen_distribution || {};
  const ranked = Object.entries(dist)
    .filter(([k]) => k !== '日主')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k)
    .filter((k) => SHEN_YI[k]);

  // 4) 组装推演（半文半白）
  const g = gua[0];
  let tuiyan = '';
  if (g) {
    tuiyan += `观君命局，日主属${dm}，其气近《${g.name}》之象（${g.glyph} ${g.xiang}）。《象》曰："${g.xiangzhuan}。"——${g.yili}。`;
  }
  if (ranked.length) {
    tuiyan += `命带${ranked.join('、')}：${ranked.map((k) => SHEN_YI[k]).join('；')}。`;
  }
  tuiyan += shiweiView(chart);

  // 结尾义理句：结合日主五行与显著十神，从句池确定性选择
  const topShen = ranked[0] || null;
  const closePool = [
    `《系辞》云："穷理尽性，以至于命。"日主属${dm}行${topShen ? `、以「${topShen}」为显` : ''}，命之理终须以心性体之、以时势行之，非徒执象数可尽。`,
    `《系辞》云："变通者，趣时者也。"${dm}行之性${topShen ? `合「${topShen}」之用` : ''}，知变而能适，方能安身。`,
    `《系辞》云："易与天地准，故能弥纶天地之道。"观${dm}气之偏全${topShen ? `、「${topShen}」之显隐` : '、十神之显隐'}，贵在日用之际自证自省。`,
    `《系辞》云："君子居则观其象而玩其辞，动则观其变而玩其占。"象数之外，须以时势行之，${dm}行${topShen ? `与「${topShen}」` : ''}相参，方尽其理。`,
  ];
  tuiyan += pickFrom(closePool, [chart.day_master, C.zhiIndex(chart.sizhu.month[1]), chart.geju, chart.strength, topShen].join('|'));

  return { gua, tuiyan, shiwei: shiweiView(chart) };
}

// 周易检索词（供 corpus 检索原文语料）：卦名 + 日主五行卦 + 显著十神易理关键词
function zhouyiTerms(chart) {
  const terms = [];
  const dm = C.elementOfGan(chart.day_master);
  (WX_GUA[dm] || []).forEach((g) => { terms.push(g); });
  const geju = chart.geju || '';
  Object.keys(GEJU_GUA).forEach((k) => { if (geju.includes(k)) terms.push(GEJU_GUA[k]); });
  const dist = chart.shishen_distribution || {};
  Object.keys(dist)
    .filter((k) => k !== '日主')
    .sort((a, b) => dist[b] - dist[a])
    .slice(0, 2)
    .forEach((k) => { if (SHEN_YI[k]) terms.push(k); });
  // 旺衰对应的时位关键词
  if (chart.strength === '身弱') terms.push('潜龙');
  else if (chart.strength === '身强') terms.push('亢龙', '乾乾');
  return [...new Set(terms)].filter(Boolean);
}

module.exports = { BAGUA, WX_GUA, SHEN_YI, GEJU_GUA, derive, zhouyiTerms, shiweiView };
