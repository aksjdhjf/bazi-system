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

// ── 十天干本质属性（用于「定日主」模块白话讲解《滴天髓》取象）──
const GAN_NATURE = {
  甲: '甲木，好比参天大树——向上生长、有担当、需要阳光雨露才能成材',
  乙: '乙木，好比花草藤萝——柔软灵巧、善于依附借力、韧性强',
  丙: '丙火，好比太阳之火——光芒外显、热情开朗、富有感染力',
  丁: '丁火，好比灯烛之火——外柔内明、心思细腻、持久温润',
  戊: '戊土，好比城墙厚土——中正稳重、包容担当、最可靠',
  己: '己土，好比田园软土——务实滋养、善于承载、能纳百川',
  庚: '庚金，好比矿石刀剑——刚健果决、有魄力、须经锻造方成器',
  辛: '辛金，好比珠宝首饰——温润精致、审美独到、聪慧清奇',
  壬: '壬水，好比江河大水——聪慧豁达、周流变通、善于顺势',
  癸: '癸水，好比雨露泉水——至柔至弱、灵秀内敛、潜藏智慧',
};

// ── 月令地支 → 节气月名（不以农历定月，依二十四节气划分）──
const MONTH_ZHI = {
  寅: '正月·立春', 卯: '二月·惊蛰', 辰: '三月·清明',
  巳: '四月·立夏', 午: '五月·芒种', 未: '六月·小暑',
  申: '七月·立秋', 酉: '八月·白露', 戌: '九月·寒露',
  亥: '十月·立冬', 子: '十一月·大雪', 丑: '十二月·小寒',
};

// ── 四季 旺相休囚死（月令定旺衰第一优先级）──
// 春木旺火相水休金囚土死；夏火旺土相木休水囚金死；秋金旺水相土休火囚木死；冬水旺木相金休土囚火死
// 四季土月（辰戌丑未）土旺金相火休木囚水死
const SEASON_WANGXIU = {
  春: { 旺: '木', 相: '火', 休: '水', 囚: '金', 死: '土' },
  夏: { 旺: '火', 相: '土', 休: '木', 囚: '水', 死: '金' },
  秋: { 旺: '金', 相: '水', 休: '土', 囚: '火', 死: '木' },
  冬: { 旺: '水', 相: '木', 休: '金', 囚: '土', 死: '火' },
  四季: { 旺: '土', 相: '金', 休: '火', 囚: '木', 死: '水' },
};

// ── 地支三会（汇聚一行能量，大幅放大对应十神）──
const SANHUI = { '寅卯辰': '木', '巳午未': '火', '申酉戌': '金', '亥子丑': '水' };
// ── 地支相刑（pair：无恩之刑寅巳申、恃势之刑丑戌未、无礼之刑子卯）──
const XING_PAIRS = ['寅巳', '巳申', '寅申', '丑戌', '戌未', '丑未', '子卯'];
// ── 地支自刑（单支：辰午酉亥）──
const XING_SELF = ['辰', '午', '酉', '亥'];
// ── 地支六害（子未、丑午、寅巳、卯辰、申亥、酉戌）──
const HAI_PAIRS = ['子未', '丑午', '寅巳', '卯辰', '申亥', '酉戌'];
// ── 天干四冲（甲庚、乙辛、丙壬、丁癸）──
const GAN_CHONG = ['甲庚', '乙辛', '丙壬', '丁癸'];

module.exports = {
  GAN, ZHI, WUXING, GAN_WX, ZHI_MAIN, ZHI_HIDDEN, HIDDEN_WEIGHT,
  SHENG, KE, SHENG_INV, KE_INV, isYang, ganIndex, zhiIndex, elementOfGan, shiShen, zhiShiShen, SHEN_WX,
  GAN_NATURE, MONTH_ZHI, SEASON_WANGXIU, SANHUI, XING_PAIRS, XING_SELF, HAI_PAIRS, GAN_CHONG,
};
