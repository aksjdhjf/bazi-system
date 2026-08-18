// 排盘引擎：输入公历生日+性别+出生地经度 → 结构化八字 JSON（严格对照提示词第二节契约）
const { Solar, Lunar } = require('lunar-javascript');
const C = require('./constants');

// 均时差（equation of time），单位分钟，精度 ~1-2 分钟，足够定辰
function equationOfTime(y, m, d) {
  const start = new Date(Date.UTC(y, 0, 1));
  const cur = new Date(Date.UTC(y, m - 1, d));
  const N = Math.floor((cur - start) / 86400000) + 1;
  const B = ((360 / 365) * (N - 81)) * Math.PI / 180;
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

function addDays(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function pad(n) { return String(n).padStart(2, '0'); }

// 计算真太阳时，返回 { date:{y,m,d}, hour, minute, tstText, shifted }
function trueSolarTime(input) {
  const { year, month, day, hour, minute, longitude } = input;
  const E = equationOfTime(year, month, day);
  const longCorr = (longitude - 120) * 4; // 中国标准经度 120°E（UTC+8）
  let total = hour * 60 + minute + E + longCorr;
  let y = year, mo = month, da = day;
  if (total < 0) { const d2 = addDays(y, mo, da, -1); y = d2.y; mo = d2.m; da = d2.d; total += 1440; }
  else if (total >= 1440) { const d2 = addDays(y, mo, da, 1); y = d2.y; mo = d2.m; da = d2.d; total -= 1440; }
  let h = Math.floor(total / 60);
  let mi = Math.round(total - h * 60);
  if (mi === 60) { h += 1; mi = 0; }
  if (h >= 24) { h -= 24; const d2 = addDays(y, mo, da, 1); y = d2.y; mo = d2.m; da = d2.d; }
  // 晚子时（23:00 起）按次日换日，日柱/时干用次日
  let shifted = false;
  if (h >= 23) {
    const d2 = addDays(y, mo, da, 1);
    y = d2.y; mo = d2.m; da = d2.d; shifted = true;
  }
  const tstText = `${y}-${pad(mo)}-${pad(da)} ${pad(h)}:${pad(mi)}`;
  return { date: { y, m: mo, d: da }, hour: h, minute: mi, tstText, shifted, E: +E.toFixed(1), longCorr: +longCorr.toFixed(1) };
}

// 五行计数（表面：干五行+支本气五行。健康偏枯另有含藏干的全计，见 interpret）
function countWuxing(baZiWuXing) {
  const cnt = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  baZiWuXing.forEach((pair) => {
    for (const ch of pair) {
      if (C.WUXING.includes(ch)) cnt[ch] += 1;
    }
  });
  return cnt;
}

// ── 旺衰强弱评分（★自定义量化指标，非传统命理条文，仅作系统内部辅助参考★）──
// 设计遵循正统原则的相对量级：得令(月令提纲)最重 > 得地(地支根气，本气>藏干、紧贴日支>远隔) > 得势(天干帮扶，虚浮较轻)。
// 阈值(身强>=7 / 身弱<=3)为经验校准值，非命理定规。
function evalStrength(dayMasterGan, baZi, baZiWuXing) {
  const dm = C.elementOfGan(dayMasterGan);
  let score = 0;
  // 一、得令：月令（月支本气）对日主的旺相休囚死（提纲挈领，权重最高，单独计）
  const monthZhiEl = baZiWuXing[1][1];
  if (monthZhiEl === dm) score += 4;                 // 旺（同气）
  else if (C.SHENG[monthZhiEl] === dm) score += 3;   // 相（月令生我，印）
  else if (C.SHENG[dm] === monthZhiEl) score -= 1;   // 休（我生月令，食伤泄）
  else if (C.KE[dm] === monthZhiEl) score -= 2;      // 囚（我克月令，财耗）
  else if (C.KE[monthZhiEl] === dm) score -= 3;      // 死（月令克我，官杀）

  // 二、得地：年/日/时支的根气（月令已单独计，此处跳过月支，避免重复加权）
  //    地支重于天干；本气>中气>余气；紧贴(日支)>远隔(年支)。
  const zhiPos = [
    { zhi: baZi[0][1], w: 0.6, day: false },  // 年支（远隔）
    { zhi: baZi[2][1], w: 1.0, day: true },   // 日支（紧贴日主，权重最高）
    { zhi: baZi[3][1], w: 0.7, day: false },  // 时支（较近）
  ];
  zhiPos.forEach((zp) => {
    (C.ZHI_HIDDEN[zp.zhi] || []).forEach((g, k) => {
      const we = C.elementOfGan(g);
      const w = (C.HIDDEN_WEIGHT[k] || 0.3) * zp.w; // 本气1/中气0.6/余气0.3 × 位置权重
      if (we === dm) score += (zp.day ? 3.0 : 2.2) * w;   // 同我=根（日支禄最强）
      else if (C.SHENG[we] === dm) score += 1.2 * w;       // 生我=印根
      else if (C.KE[dm] === we) score -= 0.5 * w;          // 我克=财（耗）
      else if (C.SHENG[dm] === we) score -= 0.5 * w;       // 我生=食伤（泄）
      else if (C.KE[we] === dm) score -= 0.7 * w;          // 克我=官杀
    });
  });

  // 三、得势：天干比劫、印星帮扶（天干虚浮无根，权重低于地支根气）
  [baZi[0][0], baZi[1][0], baZi[3][0]].forEach((g) => { // 年/月/时干（日干本身除外）
    const ge = C.elementOfGan(g);
    if (ge === dm) score += 1.5;             // 比劫帮身
    else if (C.SHENG[ge] === dm) score += 1; // 印星生身
  });

  let strength, level;
  if (score >= 6) { strength = '身强'; level = 'strong'; }
  else if (score <= 2) { strength = '身弱'; level = 'weak'; }
  else { strength = '中和'; level = 'balanced'; }
  return { strength, level, score: +score.toFixed(1) };
}

// 调候用神（《滴天髓》调候法：冬寒须火、夏炎须水、湿土须火、燥土须水、秋金寒凉须火）
function tiaoHouEl(monthZhi) {
  if (monthZhi === '丑' || monthZhi === '辰') return '火'; // 湿土厚重，用火除湿暖局
  if (monthZhi === '未' || monthZhi === '戌') return '水'; // 燥土焦枯，用水润土
  const season = { 寅: '春', 卯: '春', 辰: '春', 巳: '夏', 午: '夏', 未: '夏', 申: '秋', 酉: '秋', 戌: '秋', 亥: '冬', 子: '冬', 丑: '冬' }[monthZhi];
  if (season === '冬') return '火';
  if (season === '夏') return '水';
  if (season === '秋') return '火';
  return null; // 春温润平和，调候非急
}

// 用神 / 喜神 / 忌神（扶抑取用为主；调候为急者另见 chart.tiaohou_shen，取用优先）
function evalYong(dayMasterGan, strengthLevel) {
  const dm = C.elementOfGan(dayMasterGan);
  const bi = dm;                 // 比劫（同我）
  const shen = C.SHENG_INV[dm];  // 印（生我）
  const shang = C.SHENG[dm];     // 食伤（我生）
  const cai = C.KE[dm];          // 财（我克）
  const guan = C.KE_INV[dm];     // 官杀（克我）
  let yong, xi, ji;
  if (strengthLevel === 'weak') {
    yong = [bi, shen]; xi = [bi, shen]; ji = [shang, cai, guan];
  } else if (strengthLevel === 'strong') {
    yong = [guan, shang, cai]; xi = [guan, shang, cai]; ji = [bi, shen];
  } else {
    yong = [shen, bi]; xi = [shen, bi]; ji = [guan, shang, cai];
  }
  return {
    yongshen: [...new Set(yong)].join('、'),
    xishen: [...new Set(xi)].join('、'),
    jishen: [...new Set(ji)].join('、'),
  };
}

// 格局判定（《子平真诠》格局法：以月令为尊、透干优先取格）
// 月支所藏天干按 本气→中气→余气 顺序，取第一个透出于年/月/时干者定格；
// 全不透干则取月支本气定格。
function evalGeju(dayMasterGan, shishenGan, shishenZhiAll, monthZhi, gans) {
  // 十神分布（供性格画像）：统计全部十神，但排除日干自身（'日主'）
  const all = [...shishenGan.filter((_, i) => i !== 2), ...shishenZhiAll.flat()];
  const cnt = {};
  all.forEach((s) => { if (s && s !== '日主') cnt[s] = (cnt[s] || 0) + 1; });

  // 透干判断：年/月/时干（日干本身不计入"透"）
  const touGans = [gans[0], gans[1], gans[3]];
  const hidden = C.ZHI_HIDDEN[monthZhi] || []; // [本气, 中气, 余气]
  let geGan = null;
  for (const hg of hidden) { if (touGans.includes(hg)) { geGan = hg; break; } } // 透干优先
  const tou = geGan !== null;
  if (!geGan) geGan = hidden[0]; // 全不透，取本气
  const geShen = C.shiShen(dayMasterGan, geGan);

  let name = '普通格（日主中和，无突出十神）';
  if (geShen === '七杀') name = '七杀格（偏官格）';
  else if (geShen === '正官') name = '正官格';
  else if (geShen === '食神') name = '食神格';
  else if (geShen === '伤官') name = '伤官格';
  else if (geShen === '正印' || geShen === '偏印') name = '印格（正印/偏印）';
  else if (geShen === '正财' || geShen === '偏财') name = '财格';
  else if (geShen === '比肩' || geShen === '劫财') name = '比劫格（建禄/月劫）';
  return { geju: name, distribution: cnt, ge_shen: geShen, ge_gan: geGan, tou };
}

// 大运（顺逆与起运由 lunar 依节气精确计算：阳男阴女顺排、阴男阳女逆排）
function evalDaYun(lunar, gender) {
  const ec = lunar.getEightChar();
  const yun = ec.getYun(gender === '男' ? 1 : 0);
  const list = yun.getDaYun();
  const out = [];
  list.forEach((d) => {
    const gz = d.getGanZhi();
    if (!gz) return; // 跳过起运前的空运
    out.push({ start_age: d.getStartAge(), pillar: gz });
  });
  return out.slice(0, 8);
}

// 主入口：输入结构化出生信息 → 排盘 JSON
function computeChart(input) {
  const tst = trueSolarTime(input);
  const { y, m, d } = tst.date;
  const solar = Solar.fromYmdHms(y, m, d, tst.hour, tst.minute, 0);
  const lunar = solar.getLunar();
  const baZi = lunar.getBaZi();           // [年柱,月柱,日柱,时柱]
  const baZiWuXing = lunar.getBaZiWuXing();
  const wuxing = countWuxing(baZiWuXing);
  const dayMaster = baZi[2][0];
  const shishenGan = lunar.getBaZiShiShenGan(); // [年干,月干,日主,时干]
  const shishenZhiMain = lunar.getBaZiShiShenZhi(); // [年支,月支,日支,时支] 主气
  // 地支藏干十神（完整数组，对照提示词契约）
  const shishenZhi = {
    year_zhi: C.zhiShiShen(dayMaster, baZi[0][1]),
    month_zhi: C.zhiShiShen(dayMaster, baZi[1][1]),
    day_zhi: C.zhiShiShen(dayMaster, baZi[2][1]),
    hour_zhi: C.zhiShiShen(dayMaster, baZi[3][1]),
  };
  const strengthObj = evalStrength(dayMaster, baZi, baZiWuXing);
  const yong = evalYong(dayMaster, strengthObj.level);
  const thEl = tiaoHouEl(baZi[1][1]); // 调候用神（调候为急，取用优先）
  const shishenZhiAll = [shishenZhi.year_zhi, shishenZhi.month_zhi, shishenZhi.day_zhi, shishenZhi.hour_zhi];
  const gansAll = [baZi[0][0], baZi[1][0], baZi[2][0], baZi[3][0]];
  const geju = evalGeju(dayMaster, shishenGan, shishenZhiAll, baZi[1][1], gansAll);

  return {
    birth: {
      gregorian: `${pad(input.year)}-${pad(input.month)}-${pad(input.day)} ${pad(input.hour)}:${pad(input.minute)}`,
      gender: input.gender,
      longitude: input.longitude,
      city: input.city || '',
      longitude_approx: !!input.longitude_approx,
      true_solar_time: tst.tstText,
      tst_shifted: tst.shifted,
      eq_time: tst.E,
      long_corr: tst.longCorr,
    },
    sizhu: { year: baZi[0], month: baZi[1], day: baZi[2], hour: baZi[3] },
    day_master: dayMaster,
    wuxing,
    shishen: {
      year_gan: shishenGan[0], month_gan: shishenGan[1], day_gan_self: shishenGan[2], hour_gan: shishenGan[3],
      year_zhi: shishenZhi.year_zhi, month_zhi: shishenZhi.month_zhi,
      day_zhi: shishenZhi.day_zhi, hour_zhi: shishenZhi.hour_zhi,
      _zhi_main: { year: shishenZhiMain[0], month: shishenZhiMain[1], day: shishenZhiMain[2], hour: shishenZhiMain[3] },
    },
    strength: strengthObj.strength,
    strength_score: strengthObj.score,
    yongshen: yong.yongshen,
    xishen: yong.xishen,
    jishen: yong.jishen,
    geju: geju.geju,
    ge_shen: geju.ge_shen,
    ge_gan: geju.ge_gan,
    ge_tou: geju.tou,
    tiaohou_shen: thEl,
    shishen_distribution: geju.distribution,
    dayun: evalDaYun(lunar, input.gender),
  };
}

module.exports = { computeChart, trueSolarTime, countWuxing };
