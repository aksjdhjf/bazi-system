// 原书语料检索（RAG 钩子）
// 支持多源联合检索：①《滴天髓详解》data/ditiansui_pages.json；②《周易》data/zhouyi_pages.json
// 用途：离线时在报告中给出「原书参考」片段（标注来源）；接入 LLM 时作为检索增强（RAG）语料。
// 健壮性：任一语料文件缺失时降级为空，不影响主流程。
const fs = require('fs');
const path = require('path');

const SOURCES = [
  { key: 'ditiansui', label: '滴天髓', file: 'ditiansui_pages.json' },
  { key: 'zhouyi', label: '周易', file: 'zhouyi_pages.json' },
];
let cache = null; // { ditiansui: {...}, zhouyi: {...} }

function load() {
  if (cache !== null) return cache;
  cache = {};
  for (const s of SOURCES) {
    const p = path.join(__dirname, '..', 'data', s.file);
    try {
      cache[s.key] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
    } catch (e) {
      cache[s.key] = {};
    }
  }
  return cache;
}

// 清洗：去多余空白
function clean(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

// 取片段中命中最密集的一句
function bestClause(text, terms) {
  const clauses = clean(text).split(/[。；;！!？?]/).filter((c) => c.length >= 6);
  let best = '', bestScore = 0;
  for (const c of clauses) {
    let s = 0;
    for (const t of terms) if (c.includes(t)) s += 1;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}

// terms: 检索词数组。返回 topK 片段 [{source, sourceLabel, page, text}]
// 各源均衡取数：保证《滴天髓》与《周易》都能出现在结果中
function search(terms, topK = 4) {
  const data = load();
  if (!terms || !terms.length) return [];
  const perSource = Math.max(1, Math.ceil(topK / 2));
  const merged = [];
  for (const s of SOURCES) {
    const pages = data[s.key] || {};
    const scored = [];
    for (const [pno, text] of Object.entries(pages)) {
      if (!text) continue;
      let score = 0;
      for (const t of terms) if (text.includes(t)) score += 1;
      if (score > 0) {
        const clause = bestClause(text, terms);
        if (clause) scored.push({ source: s.key, sourceLabel: s.label, page: Number(pno), score, text: clause });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    merged.push(...scored.slice(0, perSource));
  }
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, topK);
}

// 依据排盘生成检索词（日主 + 格局 + 用神五行）
function chartTerms(chart) {
  const terms = [];
  if (chart.day_master) terms.push(chart.day_master);
  const geju = chart.geju || '';
  if (geju.includes('七杀') || geju.includes('偏官')) terms.push('七杀');
  if (geju.includes('正官')) terms.push('正官');
  if (geju.includes('财')) terms.push('财');
  if (geju.includes('印')) terms.push('印');
  if (geju.includes('食') || geju.includes('伤')) terms.push('食神', '伤官');
  (chart.yongshen || '').split('、').forEach((e) => { if (e) terms.push(e); });
  return [...new Set(terms)].filter(Boolean);
}

module.exports = { search, chartTerms, load, SOURCES };
