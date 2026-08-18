// 玄机阁·八字命理 — 前端逻辑
const chatEl = document.getElementById('chat');
const msgForm = document.getElementById('msgForm');
const msgInput = document.getElementById('msgInput');
const formToggle = document.getElementById('formToggle');
const formPanel = document.getElementById('formPanel');
const themeBtn = document.getElementById('themeBtn');

const GAN_WX = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
const ZHI_WX = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };

// 术语小词典（朱砂高亮 + 悬停注解）
const GLOSSARY = {
  '八字': '出生年、月、日、时的天干地支，共八个字',
  '日主': '出生那天的天干，代表命主本人',
  '旺衰': '日主在八字里的强弱状态',
  '身弱': '自身力量偏弱，需要生扶',
  '身强': '自身力量偏强',
  '中和': '强弱适中',
  '格局': '八字的整体主旋律与"牌型"',
  '用神': '能让八字趋于平衡的关键五行',
  '喜神': '与用神同类的辅助力量',
  '忌神': '会破坏平衡、宜回避的五行',
  '七杀': '代表挑战与压力，也主魄力突破',
  '正官': '代表规则、责任与名望',
  '官杀': '权柄、规则与压力之星',
  '正财': '男命妻星，也主稳定之财',
  '偏财': '流动之财、意外之财',
  '财星': '养命与资源之星',
  '正印': '代表学习、庇护与贵人',
  '偏印': '主偏门学识与思考',
  '食神': '代表才华、表达与享受',
  '伤官': '代表才艺、叛逆与创意',
  '五行': '木火土金水五种基本元素',
  '大运': '每十年左右的人生大趋势',
  '真太阳时': '按经度校正后的真实出生时间',
  '滴天髓': '清代命理经典',
  '周易': '群经之首，讲阴阳卦象',
};
const GLOSS_RE = new RegExp('(' + Object.keys(GLOSSARY).sort((a, b) => b.length - a.length).join('|') + ')', 'g');

// 主题
const saved = localStorage.getItem('bazi-theme');
if (saved) document.documentElement.setAttribute('data-theme', saved);
function syncThemeBtn() {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  themeBtn.textContent = dark ? '☾ 暗' : '☀ 明';
}
syncThemeBtn();
themeBtn.onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', cur);
  localStorage.setItem('bazi-theme', cur);
  syncThemeBtn();
};

let known = {};
formToggle.onclick = () => { formPanel.hidden = !formPanel.hidden; };

function addMsg(role, node) {
  const wrap = document.createElement('div'); wrap.className = `msg ${role}`;
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  bubble.appendChild(node); wrap.appendChild(bubble);
  chatEl.appendChild(wrap); chatEl.scrollTop = chatEl.scrollHeight;
  return bubble;
}
function addUserText(text) { const p = document.createElement('div'); p.textContent = text; addMsg('user', p); }
function addBotText(text) { const p = document.createElement('div'); p.textContent = text; return addMsg('bot', p); }
function typing() { const p = document.createElement('div'); p.className = 'typing'; return addMsg('bot', p); }

// 术语高亮（安全：逐段建节点，不拼 innerHTML）
function withTerms(text) {
  const frag = document.createDocumentFragment();
  text.split(GLOSS_RE).forEach((part) => {
    if (GLOSSARY[part]) {
      const sp = document.createElement('span'); sp.className = 'term';
      sp.textContent = part; sp.title = GLOSSARY[part];
      frag.appendChild(sp);
    } else {
      frag.appendChild(document.createTextNode(part));
    }
  });
  return frag;
}

function baguaSvg() {
  let g = '';
  ['☰', '☱', '☲', '☳', '☴', '☵', '☶', '☷'].forEach((gl, i) => {
    const a = (i * 45 - 90) * Math.PI / 180;
    const x = 50 + 40 * Math.cos(a), y = 50 + 40 * Math.sin(a);
    g += `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" font-size="13" text-anchor="middle" fill="var(--gold-2)">${gl}</text>`;
  });
  return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" fill="none" stroke="var(--gold-2)" stroke-width="2"/>` +
    `<circle cx="50" cy="50" r="30" fill="none" stroke="var(--gold-2)" stroke-width="1"/>${g}` +
    `<text x="50" y="58" font-size="26" text-anchor="middle" fill="var(--text)">☯</text></svg>`;
}

// 命盘罗盘（v2 星尘罗盘）：四柱定四方、八卦环绕、日主居中
function luopanSvg(chart) {
  const s = chart.sizhu || {};
  const year = s.year || '', month = s.month || '', day = s.day || '', hour = s.hour || '';
  const dm = chart.day_master || '', st = chart.strength || '', gj = chart.geju || '';
  const bagua = [
    ['☰', '乾', 200, 40], ['☷', '坤', 200, 376], ['☲', '离', 372, 205], ['☵', '坎', 28, 205],
    ['☱', '兑', 316, 82], ['☶', '艮', 84, 82], ['☴', '巽', 316, 330], ['☳', '震', 84, 330]
  ];
  let bg = '';
  bagua.forEach(([g, name, x, y]) => {
    bg += `<text x="${x}" y="${y}" text-anchor="middle" font-family="serif" font-size="15" style="fill:var(--text-soft)">${g} ${name}</text>`;
  });
  return `<svg class="luopan" viewBox="0 0 400 400">
    <defs><radialGradient id="plate" cx="50%" cy="50%">
      <stop offset="0%" stop-color="rgba(230,199,106,0.14)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.18)"/></radialGradient></defs>
    <g class="ring-rev">
      <circle cx="200" cy="200" r="190" fill="none" style="stroke:var(--gold-3);stroke-width:1.5" opacity=".5"/>
      ${bg}
    </g>
    <g class="ring">
      <circle cx="200" cy="200" r="160" fill="none" style="stroke:var(--gold-2);stroke-width:1" opacity=".35" stroke-dasharray="4 8"/>
      <circle cx="200" cy="200" r="128" fill="none" style="stroke:var(--gold-3);stroke-width:1.5"/>
      <text x="200" y="80" text-anchor="middle" class="luopan-label">年柱 ${year}</text>
      <text x="200" y="324" text-anchor="middle" class="luopan-label">月柱 ${month}</text>
      <text x="74" y="205" text-anchor="middle" class="luopan-label">日柱 ${day}</text>
      <text x="326" y="205" text-anchor="middle" class="luopan-label">时柱 ${hour}</text>
    </g>
    <circle cx="200" cy="200" r="92" fill="url(#plate)" style="stroke:var(--gold-3);stroke-width:1"/>
    <path d="M200 108 A92 92 0 0 1 200 292 A46 46 0 0 1 200 200 A46 46 0 0 0 200 108 Z" style="fill:var(--gold-3)" opacity=".9"/>
    <circle cx="200" cy="154" r="10" style="fill:var(--ink-900)"/>
    <circle cx="200" cy="246" r="10" style="fill:var(--gold-2)"/>
    <text x="200" y="190" text-anchor="middle" font-family='"Kaiti SC","STKaiti","KaiTi",serif' font-size="20" style="fill:var(--text)">${dm}日主</text>
    <text x="200" y="218" text-anchor="middle" font-family='"Kaiti SC","STKaiti","KaiTi",serif' font-size="13" style="fill:var(--text-soft)">${st} · ${gj}</text>
  </svg>`;
}

// 四柱展示条（罗盘下方直接列出四柱）
const WX_CLASS = { 木: 'wx-mu', 火: 'wx-huo', 土: 'wx-tu', 金: 'wx-jin', 水: 'wx-shui' };
function sizhuStrip(chart) {
  const s = chart.sizhu || {};
  const sh = chart.shishen || {};
  const zm = sh._zhi_main || {};
  const g = (x) => x || '';
  const pillars = [
    ['年柱', g(s.year), g(sh.year_gan), g(zm.year)],
    ['月柱', g(s.month), g(sh.month_gan), g(zm.month)],
    ['日柱', g(s.day), '日主', g(zm.day)],
    ['时柱', g(s.hour), g(sh.hour_gan), g(zm.hour)],
  ];
  return pillars.map(([name, gz, shenG, shenZ]) => {
    const gan = gz[0] || '', zhi = gz[1] || '';
    const gCls = WX_CLASS[GAN_WX[gan]] || '';
    const zCls = WX_CLASS[ZHI_WX[zhi]] || '';
    return `<div class="pillar${name === '日柱' ? ' dm' : ''}">
      <div class="p-name">${name}</div>
      <div class="p-gan ${gCls}">${gan}</div>
      <div class="p-zhi ${zCls}">${zhi}</div>
      <div class="p-shen">${shenG}${shenZ ? ' · ' + shenZ : ''}</div>
    </div>`;
  }).join('');
}

// 渲染报告
function renderReport(chart, report, disclaimer) {
  const box = document.createElement('div'); box.className = 'report';

  // 命盘罗盘
  const lp = document.createElement('div'); lp.className = 'luopan-wrap';
  lp.innerHTML = luopanSvg(chart);
  box.appendChild(lp);

  // 四柱列出（罗盘下方直接列出四柱）
  const sz = document.createElement('div'); sz.className = 'sizhu-strip';
  sz.innerHTML = sizhuStrip(chart);
  box.appendChild(sz);

  // 命局简摘
  const meta = document.createElement('div'); meta.className = 'meta-row';
  [['日主', `${chart.day_master}（${chart.strength}）`], ['格局', chart.geju], ['用神', chart.yongshen]]
    .forEach(([k, v]) => {
      const c = document.createElement('div'); c.className = 'meta-chip';
      c.innerHTML = `${k}：<b></b>`;
      c.querySelector('b').textContent = v;
      meta.appendChild(c);
    });
  box.appendChild(meta);

  // 解读输出
  report.forEach((secData, idx) => {
    const sec = document.createElement('div');
    sec.className = 'sec' + (idx === 0 ? ' first' : '');
    ['tl', 'tr', 'bl', 'br'].forEach((c) => {
      const sp = document.createElement('span'); sp.className = 'corner ' + c;
      sec.appendChild(sp);
    });
    if (secData.key === '周易参证') {
      sec.classList.add('zhouyi');
      const svg = document.createElement('div'); svg.innerHTML = baguaSvg();
      const txt = document.createElement('div'); txt.className = 'z-txt';
      const h = document.createElement('h3'); h.textContent = secData.key;
      const p = document.createElement('p'); p.appendChild(withTerms(secData.text));
      txt.append(h, p); sec.append(svg, txt);
    } else if (secData.key === '原书参考') {
      const h = document.createElement('h3'); h.textContent = secData.key;
      sec.appendChild(h);
      const lines = secData.text.split('\n');
      if (lines[0]) { const n = document.createElement('p'); n.className = 'ref-note'; n.textContent = lines[0]; sec.appendChild(n); }
      const refs = document.createElement('div'); refs.className = 'refs';
      lines.slice(1).forEach((ln) => {
        const m = ln.match(/（《([^》]+)》·第(\d+)页）(.*)/);
        const card = document.createElement('div'); card.className = 'ref';
        if (m) {
          if (m[1].includes('滴天髓')) card.classList.add('dt');
          const src = document.createElement('div'); src.className = 'src'; src.textContent = `《${m[1]}》·第${m[2]}页`;
          const body = document.createElement('div'); body.textContent = m[3];
          card.append(src, body);
        } else { card.textContent = ln; }
        refs.appendChild(card);
      });
      sec.appendChild(refs);
    } else {
      const h = document.createElement('h3'); h.textContent = secData.key;
      const p = document.createElement('p'); p.appendChild(withTerms(secData.text));
      sec.append(h, p);
    }
    box.appendChild(sec);
  });

  // 明细折叠（做小）
  const det = document.createElement('details'); det.className = 'detail';
  const sum = document.createElement('summary'); sum.textContent = '专业排盘明细（十神 / 真太阳时 / 大运）';
  det.appendChild(sum);
  const kv = document.createElement('div'); kv.className = 'kv';
  const addKV = (k, v) => { const b = document.createElement('b'); b.textContent = k; const span = document.createElement('span'); span.textContent = v; kv.append(b, span); };
  const approxNote = chart.birth.longitude_approx ? '，经度按120°E近似' : '';
  addKV('真太阳时', `${chart.birth.true_solar_time}（经度${chart.birth.longitude}°E，校正${chart.birth.long_corr}分${approxNote}）`);
  const ss = chart.shishen;
  const ssText = `年干 ${ss.year_gan}｜月干 ${ss.month_gan}｜时干 ${ss.hour_gan}｜` +
    `年支 ${ss.year_zhi.join('/')}｜月支 ${ss.month_zhi.join('/')}｜日支 ${ss.day_zhi.join('/')}｜时支 ${ss.hour_zhi.join('/')}`;
  addKV('十神', ssText);
  addKV('忌神', chart.jishen);
  det.appendChild(kv);
  const wxWrap = document.createElement('div'); wxWrap.style.cssText = 'margin-top:6px';
  Object.entries(chart.wuxing).forEach(([k, v]) => { const t = document.createElement('span'); t.className = 'tag'; t.textContent = `${k} ${v}`; wxWrap.appendChild(t); });
  det.appendChild(wxWrap);
  const dy = document.createElement('div'); dy.style.cssText = 'margin-top:6px';
  chart.dayun.forEach((d) => { const r = document.createElement('div'); r.className = 'dayun-row'; r.textContent = `${d.start_age}岁起 · ${d.pillar}`; dy.appendChild(r); });
  const dyLabel = document.createElement('div'); dyLabel.style.cssText = 'font-size:11.5px;color:var(--text-soft);margin-top:6px'; dyLabel.textContent = '大运：';
  det.append(dyLabel, dy); box.appendChild(det);

  const disc = document.createElement('div'); disc.className = 'sec';
  const dp = document.createElement('p'); dp.style.cssText = 'color:var(--text-soft);font-size:13px'; dp.textContent = disclaimer;
  disc.appendChild(dp); box.appendChild(disc);
  return addMsg('bot', box);
}

async function send(text) {
  addUserText(text || '（已提交详细表单）');
  const t = typing();
  try {
    const resp = await fetch('api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, known }),
    });
    const data = await resp.json();
    t.remove();
    if (data.status === 'crisis') { addBotText(data.reply); return; }
    if (data.status === 'ask') { known = data.known || {}; addBotText(data.question); return; }
    if (data.status === 'done') { known = {}; renderReport(data.chart, data.report, data.disclaimer); return; }
    addBotText('出错：' + (data.message || '未知错误'));
  } catch (e) {
    t.remove();
    if (location.protocol === 'file:') addBotText('⚠️ 检测到你是用「直接打开文件」访问的，脚本与接口无法加载。请改用 http://localhost:3000 访问。');
    else addBotText('网络异常，请确认服务已启动（start.bat），稍后再试。');
  }
}

msgForm.onsubmit = (e) => {
  e.preventDefault();
  const v = msgInput.value.trim(); if (!v) return;
  msgInput.value = ''; send(v);
};
formPanel.onsubmit = (e) => {
  e.preventDefault();
  const d = document.getElementById('fDate').value;
  const tm = document.getElementById('fTime').value;
  const g = document.getElementById('fGender').value;
  const c = document.getElementById('fCity').value.trim();
  const lngRaw = document.getElementById('fLng').value.trim();
  if (!d) { alert('请填写公历生日'); return; }
  const [y, m, day] = d.split('-').map(Number);
  const f = { year: y, month: m, day, gender: g || undefined, city: c || undefined };
  if (lngRaw) { f.longitude = parseFloat(lngRaw); f.longitude_approx = false; }
  if (tm) { const [h, mi] = tm.split(':').map(Number); f.hour = h; f.minute = mi; }
  known = { ...known, ...f };
  const summary = `${y}年${m}月${day}日${tm ? ' ' + tm : ''}，${g || ''}，${c || ''}`;
  send('');
  const last = chatEl.querySelector('.msg.user:last-child .bubble');
  if (last) last.textContent = summary;
};

// 星尘粒子背景（v2）
(function stars() {
  const cv = document.getElementById('stars');
  const ctx = cv && cv.getContext('2d');
  if (!ctx) return;
  let W, H, pts = [];
  function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
  resize(); addEventListener('resize', resize);
  for (let i = 0; i < 110; i++) pts.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + .3, vx: (Math.random() - .5) * .25, vy: (Math.random() - .5) * .2, tw: Math.random() * Math.PI * 2 });
  (function loop() {
    ctx.clearRect(0, 0, W, H);
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy; p.tw += .02;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      const a = .25 + .35 * Math.abs(Math.sin(p.tw));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(230,199,106,${a})`; ctx.fill();
    }
    requestAnimationFrame(loop);
  })();
})();

addBotText('你好，我是玄机阁八字批命 ☯ 告诉我你的公历出生年月日、时辰、性别和出生城市，我为你排盘，并以半文半白、周易合参的方式细细讲来。\n也可点下方「详细填写」逐项输入。');
