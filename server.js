// 八字算命系统 · 后端服务
// 架构：对话入口 → 信息抽取 → 排盘引擎(代码) → 解读层(规则) → 合规过滤 → 返回
const express = require('express');
const path = require('path');
const { extract, checkCrisis, CRISIS_REPLY } = require('./src/nlp');
const { computeChart } = require('./src/bazi');
const { buildReport } = require('./src/interpret');
const { search, chartTerms } = require('./src/corpus');
const Z = require('./src/zhouyi');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DISCLAIMER = '以上为命理趋势参考，人生走向仍由你的选择与行动决定。';

const QUESTIONS = {
  birth_date: '请告诉我你的公历出生年月日？（例如：1990年5月20日）',
  birth_time: '大概几点出生的呢？（用于定时辰，例如：下午2点半 / 14:30）',
  gender: '你的性别是？男还是女？',
  birth_place: '出生城市是哪里？（用于真太阳时校正，例如：北京 / 上海 / 广州）',
};

app.post('/api/chat', (req, res) => {
  try {
    const { text = '', known = {} } = req.body || {};
    // 1) 合规红线：危机信号优先拦截
    if (checkCrisis(text)) {
      return res.json({ status: 'crisis', reply: CRISIS_REPLY });
    }
    // 2) 信息抽取 + 缺项追问（自由输入 + 引导兜底）
    const { fields, missing, complete } = extract(text, known);
    if (!complete) {
      const q = missing.map((k) => QUESTIONS[k]).join('  ');
      return res.json({ status: 'ask', missing, question: q, known: fields });
    }
    // 3) 排盘引擎（代码精确计算）
    const chart = computeChart(fields);
    // 4) 解读层（滴天髓逻辑规则引擎；离线可用）
    const report = buildReport(chart);
    // 4.5) 原书参考（联合检索《滴天髓》与《周易》，语料就绪后自动生效）
    const refTerms = [...new Set([...chartTerms(chart), ...Z.zhouyiTerms(chart)])];
    const refs = search(refTerms, 6);
    if (refs.length) {
      const lines = refs.map((r) => `（《${r.sourceLabel}》·第${r.page}页）${r.text}`);
      const srcs = [...new Set(refs.map((r) => r.sourceLabel))].join('、');
      report.push({ key: '原书参考', text: `以下为《${srcs}》相关原文片段，供参究：\n` + lines.join('\n') });
    }
    // 5) 合规过滤已内置于解读模板（无绝对化断言）
    // 6) LLM+RAG 增强（可选）：若配置 LLM_API_KEY，可在此用 corpus.search 检索原书章节
    //    作为检索增强语料，连同 chart 与结构化知识构造 prompt 调用大模型，
    //    用其返回替换 report。默认走规则引擎，离线稳定。
    res.json({ status: 'done', chart, report, disclaimer: DISCLAIMER });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', message: '排盘出错：' + e.message });
  }
});

// 原书语料检索端点（供高级用户 / LLM 接入查阅《滴天髓》原文片段）
app.get('/api/corpus', (req, res) => {
  const q = String(req.query.q || '');
  const terms = [...new Set((q.match(/[一-龥]/g) || []))];
  const hits = search(terms.length ? terms : ['乙木'], 5);
  res.json({ query: q, hits });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`八字算命系统已启动： http://localhost:${PORT}`);
});
