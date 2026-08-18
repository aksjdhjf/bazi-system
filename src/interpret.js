// 解读层（滴天髓 + 周易 双典参证）：读取排盘 JSON，按「十步标准拆解」输出报告
// 第一栏「白话详解」= 严格按十大模块、详细通俗逐步拆解；第二栏「周易参证」为《易》理印证。
const C = require('./constants');
const D = require('./ditiansui');
const Z = require('./zhouyi');
const { sanitize } = require('./nlp');

function pillarElements(pillar) {
  const gan = pillar[0], zhi = pillar[1];
  return [C.elementOfGan(gan), C.ZHI_MAIN[zhi]].filter(Boolean);
}
function containsSet(arr, set) { return arr.some((e) => set.includes(e)); }

// 取出某五行对应的任意一个天干（用于"根"的判断）
function ganOfElement(el) { return C.GAN[C.GAN_WX.indexOf(el)]; }

// 四柱藏干展开（天干 + 地支本气 + 藏干）
function pillarHidden(chart) {
  const names = ['年柱', '月柱', '日柱', '时柱'];
  const pillars = [chart.sizhu.year, chart.sizhu.month, chart.sizhu.day, chart.sizhu.hour];
  return pillars.map((p, i) => {
    const zhi = p[1];
    const hidden = (C.ZHI_HIDDEN[zhi] || []).map((g) => `${g}(${C.elementOfGan(g)})`).join('、');
    return `${names[i]} ${p[0]}(${C.elementOfGan(p[0])})${zhi}(${C.ZHI_MAIN[zhi]})，藏干 ${hidden || '无'}`;
  }).join('；\n');
}

// 月令旺相休囚死判定（方法1：月令第一优先级）
function lingState(dmEl, monthZhi) {
  const season = D.SEASON[monthZhi];
  const tbl = C.SEASON_WANGXIU[season];
  const state = tbl[dmEl];
  const note = {
    旺: '得月令，先天底气最足（得令）',
    相: '得月令生扶，先天得势（相）',
    休: '在月令处于休态，先天偏弱',
    囚: '在月令处于囚态，先天受制',
    死: '在月令处于死态，先天最弱',
  };
  return { season, state, note: note[state] };
}

// 全局生扶 vs 克泄耗 量化统计（方法2）
function quantify(chart) {
  const dm = C.elementOfGan(chart.day_master);
  let sheng = 0, ke = 0;
  const classify = (we) => (we === dm || C.SHENG[we] === dm) ? 'sheng' : 'ke';
  const pillars = [chart.sizhu.year, chart.sizhu.month, chart.sizhu.day, chart.sizhu.hour];
  pillars.forEach((p, idx) => {
    if (idx !== 2) { // 日干自身不计为外来生扶
      if (classify(C.elementOfGan(p[0])) === 'sheng') sheng += 1; else ke += 1;
    }
    const hidden = C.ZHI_HIDDEN[p[1]] || [];
    hidden.forEach((g, k) => {
      const we = C.elementOfGan(g);
      const w = C.HIDDEN_WEIGHT[k] || 0.3;
      if (idx === 2 && we === dm) return; // 日支之根不算外来生扶
      if (classify(we) === 'sheng') sheng += w; else ke += w;
    });
  });
  return { sheng: +sheng.toFixed(1), ke: +ke.toFixed(1) };
}

// 根气判定（方法3）
function rootInfo(chart) {
  const dm = C.elementOfGan(chart.day_master);
  const zhis = [chart.sizhu.year[1], chart.sizhu.month[1], chart.sizhu.day[1], chart.sizhu.hour[1]];
  let strongRoot = 0, anyRoot = 0;
  zhis.forEach((z, idx) => {
    if (idx === 2) { // 日支为坐根
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

// ───────────────────────────────────────────────
// 第一栏：白话详解（严格按十大模块逐步拆解）
// ───────────────────────────────────────────────
function baihua(chart) {
  const s = chart.sizhu;
  const dm = chart.day_master;
  const dmEl = C.elementOfGan(dm);
  const wx = chart.wuxing;
  const wxDesc = Object.entries(wx).map(([k, v]) => `${k}行${v}个`).join('、');
  const ss = chart.shishen_distribution || {};
  const isMale = chart.birth.gender === '男';

  const parts = [];

  // 模块一：前置准备——排盘基础校准
  const mz = C.MONTH_ZHI[s.month[1]] || s.month[1] + '月';
  const tst = chart.birth.true_solar_time;
  const approx = chart.birth.longitude_approx ? '（出生地经度按120°E近似）' : '';
  parts.push(
    `【第一步 · 前置准备：排盘基础校准】\n` +
    `先把你的出生信息校准成"八字"。公历 ${chart.birth.gregorian}，性别${chart.birth.gender}${approx}。` +
    `出生地经度 ${chart.birth.longitude}°E，已做真太阳时校正，校正后出生时辰为 ${tst}（经度差校正约 ${chart.birth.long_corr} 分钟、均时差约 ${chart.birth.eq_time} 分钟）。` +
    `注意：月令不以农历月份定，而由二十四节气划分——你出生在「${mz}」，这才是命理上的"月令"。\n` +
    `排出的完整四柱（天干+地支本气+藏干）如下：\n${pillarHidden(chart)}\n` +
    `四柱各管一段人生：年柱看祖上、早年（0-16岁）；月柱看父母、青年（16-32岁）与门户格局；日柱是"你自己"、日支为夫妻宫；时柱看子女、晚年与行事结果。`
  );

  // 模块二：确立日主
  parts.push(
    `【第二步 · 确立日主】\n` +
    `八字里最重要的一个字是"日主"，它就是出生那天的天干——你的日主是「${dm}」（属${dmEl}行）。` +
    `其余七个字全部围绕日主来论。日主的本质属性决定了你的先天性格底色：${C.GAN_NATURE[dm]}。`
  );

  // 模块三：旺衰判定
  const ling = lingState(dmEl, s.month[1]);
  const q = quantify(chart);
  const rt = rootInfo(chart);
  let strengthPlain = chart.strength === '身弱'
    ? '通俗讲，你"本钱"稍欠，做事容易累、容易被外界影响，需要有人帮、有环境扶，才使得出力气。'
    : chart.strength === '身强'
      ? '通俗讲，你底气足、有主见、扛得住事；但有时太刚太能扛，反易在人际或决策上吃亏，需要适当"泄一泄、松一松"。'
      : '通俗讲，你不强不弱、刚柔比较均衡，是相对好调理的命局，顺势而行即可。';
  parts.push(
    `【第三步 · 旺衰判定（身强/身弱/中和）】旺衰是整个八字的根基，决定后面喜忌怎么取。我们用三套方法交叉验证：\n` +
    `① 月令定根基（第一优先级）：你月令${s.month[1]}属${ling.season}季，日主${dmEl}行在该季处于「${ling.state}」状态——${ling.note}。\n` +
    `② 全局生扶 vs 克泄耗统计：把八个字按"帮你的（印+比劫）"和"耗你的（官杀+食伤+财）"加权统计，得到 生扶≈${q.sheng}、克泄耗≈${q.ke}（地支权重大于天干、本气大于藏干）。\n` +
    `③ 根气补强：日主在地支有${rt.strongRoot}处本气强根、共${rt.anyRoot}处根气${rt.hasRoot ? '' : '（几无根气，偏弱信号明显）'}。\n` +
    `三点综合，结论：你是「${chart.strength}」（旺衰评分约 ${chart.strength_score}，仅作参考）。${strengthPlain}`
  );

  // 模块四：十神人事对应
  const sh = chart.shishen;
  const zm = sh._zhi_main || {};
  const shenList = [
    `年干 ${s.year[0]}→${sh.year_gan}`, `月干 ${s.month[0]}→${sh.month_gan}`, `时干 ${s.hour[0]}→${sh.hour_gan}`,
    `年支 ${s.year[1]}→${zm.year || sh.year_zhi[0]}`, `月支 ${s.month[1]}→${zm.month || sh.month_zhi[0]}`,
    `日支 ${s.day[1]}（夫妻宫）→${zm.day || sh.day_zhi[0]}`, `时支 ${s.hour[1]}→${zm.hour || sh.hour_zhi[0]}`,
  ].join('；');
  const cats = {};
  Object.keys(ss).forEach((k) => { const c = shenCategory(k); cats[c] = (cats[c] || 0) + ss[k]; });
  const catDesc = Object.entries(cats).map(([c, n]) => `${c}（${n}处）`).join('、');
  parts.push(
    `【第四步 · 十神人事对应】以日主${dm}为"我"，给其余七个干支逐一标十神：\n${shenList}。\n` +
    `十神对应固定生活范畴：${Object.entries(SHEN_DOMAIN).map(([k, v]) => `${k}→${v}`).join('；')}。\n` +
    `你命局中十神分布为：${catDesc}。这些"星"就是构成你人生剧本的各种角色。`
  );

  // 模块五：格局定格
  let gejuFit;
  if (chart.strength === '身弱') gejuFit = '你身弱，格局喜印星、比劫来帮扶，最忌官杀、财星再来加重消耗。';
  else if (chart.strength === '身强') gejuFit = '你身强，格局可担财、担官，喜财官食伤来制衡自身。';
  else gejuFit = '你中和，格局以流通为美，不宜过偏。';
  const coor = coordination(chart);
  const coorTxt = coor.length ? coor.join('；') + '。' : '全局干支安静、少冲合，人生整体较为平稳。';
  parts.push(
    `【第五步 · 格局定格】格局是人生的主要发展模式。定格优先看月柱透出的十神，月令不透则取全局最强十神——你属「${chart.geju}」。` +
    `${gejuFit}\n格局成败看是否被冲克破坏、有无护卫：你的干支配合中，${coorTxt}`
  );

  // 模块六：干支作用解析
  parts.push(
    `【第六步 · 干支作用解析（性格/人际/吉凶诱因）】上面"格局成败"已列出主要合冲刑害，这里讲它们的含义：\n` +
    `· 天干五合（如甲己合）：主合作牵绊、人情往来；若化气成功则该五行力量大增。\n` +
    `· 天干相冲（如甲庚冲）：主思想矛盾、人际对立、是非。\n` +
    `· 地支六合/三合/三会：主结缘合作、汇聚能量，改变全局强弱。\n` +
    `· 地支六冲（冲则动）：主地域变动、感情矛盾、工作变动、家庭分歧。\n` +
    `· 地支相刑：主是非内耗、内心纠结、暗伤。\n` +
    `· 地支相害：主小人暗中拖累、隐秘烦心。\n` +
    `位置规则：日支是夫妻宫，被冲/合/刑重点对应婚姻变化；年月管家庭长辈，时柱管远方晚年。紧贴的干支作用力大于远隔，地支力量大于天干。`
  );

  // 模块七：调候分析
  const th = tiaoHou(s.month[1]);
  parts.push(
    `【第七步 · 调候分析（独立于旺衰的气候刚需）】你出生在${th.season}季（月令${s.month[1]}），格局偏「${th.kind}」，${th.need}。` +
    `调候与旺衰是两回事：旺衰解决日主强弱平衡，调候解决先天寒热燥湿平衡。二者一致时喜忌统一；冲突时以月令气候轻重取舍——${th.needEl ? `此命调候首取「${th.needEl}」。` : '此命寒暖尚匀，调候非急。'}`
  );

  // 模块八：六亲/事业/婚姻/健康细分
  const spouseStar = isMale ? '财星（正财为妻星）' : '官杀星（正官为夫星）';
  const hasSpouse = isMale ? (ss['正财'] || 0) + (ss['偏财'] || 0) > 0 : (ss['正官'] || 0) + (ss['七杀'] || 0) > 0;
  const hasGuan = (ss['正官'] || 0) + (ss['七杀'] || 0) > 0;
  const hasCai = (ss['正财'] || 0) + (ss['偏财'] || 0) > 0;
  const entries = Object.entries(wx);
  const mx = entries.filter((e) => e[1] === Math.max(...entries.map((x) => x[1]))).map((e) => e[0]);
  const mn = entries.filter((e) => e[1] === Math.min(...entries.map((x) => x[1]))).map((e) => e[0]);
  parts.push(
    `【第八步 · 六亲 / 事业 / 婚姻 / 健康细分】\n` +
    `· 婚姻：男命看财、女命看官，兼看夫妻宫（日支${s.day[1]}）。你${isMale ? '男命' : '女命'}，配偶星看${spouseStar}，${hasSpouse ? '配偶星有根气，感情易得踏实牵绊、有经营余地' : '配偶星偏弱，感情更须主动经营、以诚相待'}。日支为夫妻宫，若逢冲合刑则婚姻易有波动。\n` +
    `· 事业：以格局核心十神（官杀、食伤、财星）为主。${hasGuan ? '命带官杀，具责任与开拓之魄，宜于规矩中担纲建功' : '官杀不显，多凭专业协作立身，不宜强求权位'}；${hasCai ? '命带财星，善经营理财、以才智生财' : '财星不显，求财宜稳扎、以一技立身'}。配用神${chart.yongshen}顺势则宜。\n` +
    `· 财运：看财星旺衰与日主能否"担财"。${hasCai ? '命带财星，求财有天然向度' : '财星不显，宜踏实积累'}；比劫多则防分财，食伤生财则利创意求财。\n` +
    `· 六亲：年柱看祖辈、月柱看父母、时柱看子女，看对应宫位十神吉凶。\n` +
    `· 健康：五行过旺过弱易对应脏腑隐患——${mx.join('、')}偏旺、${mn.join('、')}偏弱；按五行对应：${Object.entries(HEALTH).map(([k, v]) => `${k}旺防${v}`).join('，')}。此仅为趋势参考，具体请以医学检查为准。`
  );

  // 模块九：大运流年推导
  const yearGan = s.year[0];
  const yangYear = C.isYang(C.ganIndex(yearGan));
  const forward = (yangYear && isMale) || (!yangYear && !isMale);
  const yong = chart.yongshen.split('、');
  const ji = chart.jishen.split('、');
  const dayunList = (chart.dayun || []).slice(0, 6).map((d) => {
    const els = pillarElements(d.pillar);
    let tag = '平运';
    if (containsSet(els, yong)) tag = '利好（贴用神）';
    else if (containsSet(els, ji)) tag = '宜守（犯忌神）';
    return `${d.start_age}岁起「${d.pillar}」${tag}`;
  }).join('；');
  parts.push(
    `【第九步 · 大运流年推导】大运按"阳年男/阴年女顺排、阴年男/阳年女逆排"起运，每步管十年。你的年干${yearGan}为${yangYear ? '阳' : '阴'}年、${isMale ? '男' : '女'}命，故大运${forward ? '顺' : '逆'}排。\n` +
    `关键大运：${dayunList}。走喜用神大运整体上扬；走忌神大运宜守不宜攻，遇冲合刑易触发结婚、换工作、搬家、破财等变动。\n` +
    `流年细化：把具体年份的干支代入，看它与原局+当下大运的生克合冲，即可判断当年吉凶（如冲夫妻宫多应婚恋、动财星多应财运）。你可在关心之年代入查看。`
  );

  // 模块十：综合喜忌总结
  const allEls = ['木', '火', '土', '金', '水'];
  const used = [...new Set([...chart.yongshen.split('、'), ...chart.xishen.split('、'), ...chart.jishen.split('、')])];
  const xian = allEls.filter((e) => !used.includes(e));
  parts.push(
    `【第十步 · 综合喜忌总结】\n` +
    `· 喜用神：${chart.yongshen}——能平衡全局、补全格局缺陷的"良药"，行业/方位/颜色/习惯都可往这方向靠。\n` +
    `· 喜神：${chart.xishen}——辅助用神。\n` +
    `· 忌神：${chart.jishen}——加剧失衡、带来压力损耗者，宜避。\n` +
    `· 闲神：${xian.length ? xian.join('、') + '——力量中性，增减无明显吉凶' : '无（五行皆已分属用/喜/忌）'}。\n` +
    `整合五层结论：日干${dmEl}本性（${C.GAN_NATURE[dm].split('，')[0]}）+ 旺衰带来的处事短板（${chart.strength}）+ 格局主打方向（${chart.geju}）+ 干支合冲带来的人际牵绊 + 调候所需改善（${th.needEl ? '取' + th.needEl : '寒暖尚匀'}）。\n` +
    `重要提醒：先天仅为趋势，冲克合动才是运势触发条件；即使忌神运，也可通过职业选择、行为习惯规避不利，喜运也需自身行动才能兑现。命理看的是"概率与倾向"，不是宿命定论。`
  );

  return parts.join('\n\n');
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
    { key: '白话详解', text: baihua(chart) },
    { key: '周易参证', text: zhouyiSection(chart) },
  ];
  sections.forEach((s) => { s.text = sanitize(s.text); });
  return sections;
}

module.exports = { buildReport };
