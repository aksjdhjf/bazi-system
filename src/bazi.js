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
  // 晚子时（23:00 起）按次日换日，日柱/时干用次日
  let shifted = false;
  if (h >= 23) {
    const d2 = addDays(y, mo, da, 1);
    y = d2.y; mo = d2.m; da = d2.d; shifted = true;
  }
  const tstText = `${y}-${pad(mo)}-${pad(da)} ${pad(h)}:${pad(mi)}`;
  return { date: { y, m: mo, d: da }, hour: h, minute: mi, tstText, shifted, E: +E.toFixed(1), longCorr: +longCorr.toFixed(1) };
}

// 五行计数（getBaZiWuXing 已是「干五行+支本气五行」的字符）
function countWuxing(baZiWuXing) {
  const cnt = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  baZiWuXing.forEach((pair) => {
    for (const ch of pair) {
      if (C.WUXING.includes(ch)) cnt[ch] += 1;
    }
  });
  return cnt;
}

// 强弱评分（透明启发式，标注为参考）
function evalStrength(dayMasterGan, baZi, baZiWuXing) {
  const dm = C.elementOfGan(dayMasterGan);
  let score = 0;
  // 月令（月支本气）
  const monthZhiEl = baZiWuXing[1][1];
  if (monthZhiEl === dm) score += 4;
  else if (C.SHENG[monthZhiEl] === dm) score += 3;
  else if (C.SHENG[dm] === monthZhiEl) score -= 1;
  else if (C.KE[dm] === monthZhiEl) score -= 2;
  else if (C.KE[monthZhiEl] === dm) score -= 3;

  const pillars = [
    { gan: baZi[0][0], zhi: baZi[0][1] },
    { gan: baZi[1][0], zhi: baZi[1][1] },
    { gan: baZi[2][0], zhi: baZi[2][1] },
    { gan: baZi[3][0], zhi: baZi[3][1] },
  ];
  pillars.forEach((p, i) => {
    const ge = C.elementOfGan(p.gan);
    if (i !== 2) { // 日干本身是日主，不重复计
      if (ge === dm) score += 2;
      else if (C.SHENG[ge] === dm) score += 1; // 印
    }
    (C.ZHI_HIDDEN[p.zhi] || []).forEach((g, k) => {
      const we = C.elementOfGan(g);
      const w = C.HIDDEN_WEIGHT[k] || 0.3;
      if (we === dm) score += 1.5 * w;
      else if (C.SHENG[we] === dm) score += 0.8 * w;
      else if (C.KE[dm] === we) score -= 0.4 * w;
      else if (C.SHENG[dm] === we) score -= 0.4 * w;
      else if (C.KE[we] === dm) score -= 0.6 * w;
    });
  });

  let strength, level;
  if (score >= 7) { strength = '身强'; level = 'strong'; }
  else if (score <= 3) { strength = '身弱'; level = 'weak'; }
  else { strength = '中和'; level = 'balanced'; }
  return { strength, level, score: +score.toFixed(1) };
}

// 用神 / 喜神 / 忌神
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

// 格局判定（《子平真诠》格局法：以月令为尊，月支本气所藏十神定格）
function evalGeju(dayMasterGan, shishenGan, shishenZhiAll, strengthLevel, monthZhiMainShen) {
  const all = [...shishenGan, ...shishenZhiAll.flat()];
  const cnt = {};
  all.forEach((s) => { cnt[s] = (cnt[s] || 0) + 1; });
  const yue = monthZhiMainShen; // 月支本气十神
  let name = '普通格（日主中和，无突出十神）';
  if (yue === '七杀') name = '七杀格（偏官格）';
  else if (yue === '正官') name = '正官格';
  else if (yue === '食神') name = '食神格';
  else if (yue === '伤官') name = '伤官格';
  else if (yue === '正印' || yue === '偏印') name = '印格（正印/偏印）';
  else if (yue === '正财' || yue === '偏财') name = '财格';
  else if (yue === '比肩' || yue === '劫财') name = '比劫格（建禄/月劫）';
  return { geju: name, distribution: cnt, yueling_shen: yue };
}

// 大运
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
  const shishenZhiAll = [shishenZhi.year_zhi, shishenZhi.month_zhi, shishenZhi.day_zhi, shishenZhi.hour_zhi];
  const geju = evalGeju(dayMaster, shishenGan, shishenZhiAll, strengthObj.level, shishenZhiMain[1]);

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
    shishen_distribution: geju.distribution,
    dayun: evalDaYun(lunar, input.gender),
  };
}

module.exports = { computeChart, trueSolarTime, countWuxing };
