// 原书语料检索（RAG 钩子）
// 基于 OCR 提取的《滴天髓详解》全文（data/ditiansui_pages.json），提供关键词检索。
// 用途：① 离线时在报告中给出「原书参考」片段；② 接入 LLM 时作为检索增强（RAG）语料。
// 健壮性：语料文件未生成时全部降级为空，不影响主流程。
const fs = require('fs');
const path = require('path');

const CORPUS_PATH = path.join(__dirname, '..', 'data', 'ditiansui_pages.json');
let cache = null;

function load() {
  if (cache !== null) return cache;
  try {
    cache = fs.existsSync(CORPUS_PATH)
      ? JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf-8'))
      : {};
  } catch (e) {
    cache = {};
  }
  return cache;
}

// 清洗：去多余空白、过滤明显乱码行
function clean(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

// 取片段中命中最密集的一句（按检索词命中切分）
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

// terms: 检索词数组（如 ['乙木','七杀']）。返回 topK 片段 [{page, text}]
function search(terms, topK = 4) {
  const pages = load();
  if (!terms || !terms.length || Object.keys(pages).length === 0) return [];
  const scored = [];
  for (const [pno, text] of Object.entries(pages)) {
    if (!text) continue;
    let score = 0;
    for (const t of terms) if (text.includes(t)) score += 1;
    if (score > 0) {
      const clause = bestClause(text, terms);
      if (clause) scored.push({ page: Number(pno), score, text: clause });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// 依据排盘生成检索词（日主天干篇 + 格局关键词）
function chartTerms(chart) {
  const terms = [];
  terms.push(`${chart.day_master}木`.replace('木', '') === '' ? '' : chart.day_master); // 日干
  const geju = chart.geju || '';
  if (geju.includes('七杀') || geju.includes('偏官')) terms.push('七杀');
  if (geju.includes('正官')) terms.push('正官');
  if (geju.includes('财')) terms.push('财');
  if (geju.includes('印')) terms.push('印');
  if (geju.includes('食') || geju.includes('伤')) terms.push('食神', '伤官');
  // 用神五行
  (chart.yongshen || '').split('、').forEach((e) => { if (e) terms.push(e); });
  return [...new Set(terms)].filter(Boolean);
}

module.exports = { search, chartTerms, load };
