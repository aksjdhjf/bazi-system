// 八字核心常量与命理数据表
// 天干
const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
// 地支
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
// 五行
const WUXING = ['木', '火', '土', '金', '水'];
// 天干五行与阴阳：index 偶数=阳，奇数=阴
const GAN_WX = ['木', '木', '火', '火', '土', '土', '金', '金', '水', '水'];
// 地支本气（主气）五行
const ZHI_MAIN = {
  子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火',
  午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水',
};
// 地支藏干（含本气/中气/余气），顺序即权重递减
const ZHI_HIDDEN = {
  子: ['癸'],
  丑: ['己', '癸', '辛'],
  寅: ['甲', '丙', '戊'],
  卯: ['乙'],
  辰: ['戊', '乙', '癸'],
  巳: ['丙', '庚', '戊'],
  午: ['丁', '己'],
  未: ['己', '丁', '乙'],
  申: ['庚', '壬', '戊'],
  酉: ['辛'],
  戌: ['戊', '辛', '丁'],
  亥: ['壬', '甲'],
};
// 藏干权重（本气/中气/余气）
const HIDDEN_WEIGHT = [1, 0.6, 0.3];
// 五行相生：key 生 value
const SHENG = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
// 五行相克：key 克 value
const KE = { 木: '土', 火: '金', 土: '水', 金: '木', 水: '火' };
// 逆映射：value 生 key；value 克 key
const SHENG_INV = {}; Object.keys(SHENG).forEach((k) => { SHENG_INV[SHENG[k]] = k; });
const KE_INV = {}; Object.keys(KE).forEach((k) => { KE_INV[KE[k]] = k; });

const isYang = (ganIdx) => ganIdx % 2 === 0;
const ganIndex = (g) => GAN.indexOf(g);
const zhiIndex = (z) => ZHI.indexOf(z);
const elementOfGan = (g) => GAN_WX[ganIndex(g)];

// 十神：以日主为「我」，other 为另一干/支本气
function shiShen(dayMasterGan, otherGan) {
  const di = ganIndex(dayMasterGan);
  const oi = ganIndex(otherGan);
  const de = GAN_WX[di];
  const oe = GAN_WX[oi];
  if (de === oe) return isYang(di) === isYang(oi) ? '比肩' : '劫财';
  if (SHENG[oe] === de) return isYang(di) === isYang(oi) ? '偏印' : '正印'; // 生我
  if (SHENG[de] === oe) return isYang(di) === isYang(oi) ? '食神' : '伤官'; // 我生
  if (KE[oe] === de) return isYang(di) === isYang(oi) ? '七杀' : '正官';     // 克我
  if (KE[de] === oe) return isYang(di) === isYang(oi) ? '偏财' : '正财';     // 我克
  return '未知';
}

// 地支藏干 → 十神数组（相对日主）
function zhiShiShen(dayMasterGan, zhi) {
  const hidden = ZHI_HIDDEN[zhi] || [];
  return hidden.map((g) => shiShen(dayMasterGan, g));
}

// 十神 → 五行倾向（用于强弱/用神快速判断）
const SHEN_WX = {
  比肩: null, 劫财: null, // 同我
  正印: null, 偏印: null, // 生我
  食神: null, 伤官: null, // 我生
  正财: null, 偏财: null, // 我克
  正官: null, 七杀: null, // 克我
};

module.exports = {
  GAN, ZHI, WUXING, GAN_WX, ZHI_MAIN, ZHI_HIDDEN, HIDDEN_WEIGHT,
  SHENG, KE, SHENG_INV, KE_INV, isYang, ganIndex, zhiIndex, elementOfGan, shiShen, zhiShiShen, SHEN_WX,
};
