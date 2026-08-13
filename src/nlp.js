// 信息抽取：自由输入一句话 → 结构化出生字段；含城市经度表与合规红线
// 主要城市经度（东经，用于真太阳时校正）
const CITIES = {
  北京: 116.4, 上海: 121.47, 广州: 113.26, 深圳: 114.06, 天津: 117.2,
  重庆: 106.55, 成都: 104.07, 杭州: 120.15, 南京: 118.8, 武汉: 114.31,
  西安: 108.95, 苏州: 120.62, 郑州: 113.65, 长沙: 112.94, 沈阳: 123.43,
  大连: 121.62, 青岛: 120.38, 济南: 117.0, 哈尔滨: 126.63, 长春: 125.35,
  石家庄: 114.51, 太原: 112.55, 合肥: 117.27, 福州: 119.3, 厦门: 118.1,
  南昌: 115.89, 昆明: 102.71, 贵阳: 106.71, 南宁: 108.37, 海口: 110.33,
  兰州: 103.83, 西宁: 101.78, 银川: 106.27, 乌鲁木齐: 87.62, 拉萨: 91.11,
  呼和浩特: 111.75, 香港: 114.17, 澳门: 113.55, 台北: 121.5, 三亚: 109.5,
  宁波: 121.55, 无锡: 120.3, 东莞: 113.75, 佛山: 113.12, 温州: 120.7,
};

function matchCity(text) {
  for (const c of Object.keys(CITIES)) {
    if (text.includes(c)) return { city: c, longitude: CITIES[c] };
  }
  return null;
}

function parseTime(text) {
  let hour = null, minute = 0;
  // 直接 时:分 或 时点
  let m = text.match(/(\d{1,2})[:：](\d{2})/);
  if (m) { hour = +m[1]; minute = +m[2]; }
  else {
    m = text.match(/(\d{1,2})\s*点\s*(半|一刻|三刻|[\u4e00-\u9fa5]?刻)?/);
    if (!m) m = text.match(/(\d{1,2})\s*时/);
    if (m) {
      hour = +m[1];
      const tail = m[2] || '';
      if (tail.includes('半')) minute = 30;
      else if (tail.includes('三刻')) minute = 45;
      else if (tail.includes('一刻')) minute = 15;
    }
  }
  if (hour === null) return null;
  // 时段词修正
  if (/(下午|晚上|夜里|夜晚|晚间)/.test(text)) { if (hour < 12) hour += 12; }
  else if (/(上午|早上|早晨|凌晨|清晨|早上)/.test(text)) { if (hour === 12) hour = 0; }
  else if (/(中午|正午)/.test(text)) { hour = 12; }
  if (hour > 23) hour = 23;
  return { hour, minute };
}

function parseDate(text) {
  let m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (!m) m = text.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) m = text.match(/(\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/); // 两位年份
  if (!m) return null;
  let y = +m[1];
  if (y < 100) y = y < 30 ? 2000 + y : 1900 + y;
  return { year: y, month: +m[2], day: +m[3] };
}

function parseGender(text) {
  if (/(男|先生|男士|兄弟|公子)/.test(text)) return '男';
  if (/(女|女士|姑娘|妹|姐|小姐)/.test(text)) return '女';
  return null;
}

// 合并已知字段 + 文本抽取，返回结构化字段与缺失项
function extract(text, known = {}) {
  const merged = { ...known };
  if (text && typeof text === 'string') {
    const d = parseDate(text);
    if (d) Object.assign(merged, d);
    const t = parseTime(text);
    if (t) { merged.hour = t.hour; merged.minute = t.minute; }
    const g = parseGender(text);
    if (g) merged.gender = g;
    const c = matchCity(text);
    if (c) { merged.city = c.city; merged.longitude = c.longitude; }
  }
  // 城市经纬度兜底（来自表单 known 时文本未匹配）
  if (merged.city && (merged.longitude === undefined || merged.longitude === null)) {
    if (CITIES[merged.city] !== undefined) merged.longitude = CITIES[merged.city];
  }
  // 校验
  const missing = [];
  if (!merged.year || !merged.month || !merged.day) missing.push('birth_date');
  if (merged.hour === undefined || merged.hour === null) missing.push('birth_time');
  if (!merged.gender) missing.push('gender');
  if (merged.longitude === undefined || merged.longitude === null) missing.push('birth_place');
  const complete = missing.length === 0;
  return { fields: merged, missing, complete };
}

// 合规红线：危机信号识别
const CRISIS_KEYWORDS = ['自杀', '不想活', '活不下去', '轻生', '寻死', '结束生命', '活着没意思', '崩溃', '活著沒意思'];
function checkCrisis(text) {
  if (!text) return false;
  return CRISIS_KEYWORDS.some((k) => text.includes(k));
}
const CRISIS_REPLY = '听到你这么说，我很牵挂。命理只能看趋势，无法也绝不该替代真实的陪伴与专业帮助。' +
  '如果你正经历艰难时刻，请务必联系信任的人，或拨打心理援助热线（如全国24小时心理危机干预热线 400-161-9995）。' +
  '你值得被认真倾听与帮助，请先照顾好自己。';

// 报告合规词净化：确保不出现绝对化断言
function sanitize(text) {
  return text
    .replace(/必定/g, '倾向')
    .replace(/注定/g, '更可能')
    .replace(/一定/g, '通常');
}

module.exports = { CITIES, matchCity, extract, parseDate, parseTime, parseGender, checkCrisis, CRISIS_REPLY, sanitize };
