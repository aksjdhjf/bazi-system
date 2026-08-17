// 八字命理助手 · 前端逻辑
const chatEl = document.getElementById('chat');
const msgForm = document.getElementById('msgForm');
const msgInput = document.getElementById('msgInput');
const formToggle = document.getElementById('formToggle');
const formPanel = document.getElementById('formPanel');
const themeBtn = document.getElementById('themeBtn');

let known = {};

// 主题
const saved = localStorage.getItem('bazi-theme');
if (saved) document.documentElement.setAttribute('data-theme', saved);
themeBtn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
themeBtn.onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', cur);
  localStorage.setItem('bazi-theme', cur);
  themeBtn.textContent = cur === 'dark' ? '☀️' : '🌙';
};

formToggle.onclick = () => { formPanel.hidden = !formPanel.hidden; };

function addMsg(role, node) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.appendChild(node);
  wrap.appendChild(bubble);
  chatEl.appendChild(wrap);
  chatEl.scrollTop = chatEl.scrollHeight;
  return bubble;
}
function addUserText(text) {
  const p = document.createElement('div'); p.textContent = text;
  addMsg('user', p);
}
function addBotText(text) {
  const p = document.createElement('div'); p.textContent = text;
  return addMsg('bot', p);
}
function typing() {
  const p = document.createElement('div'); p.className = 'typing';
  return addMsg('bot', p);
}

// 渲染报告
function renderReport(chart, report, disclaimer) {
  const box = document.createElement('div'); box.className = 'report';
  const s = chart.sizhu;

  // 紧凑命盘条（始终可见，但细小——满足"表格变小"）
  const strip = document.createElement('div'); strip.className = 'chart-strip';
  const csCells = [
    { k: '四柱', v: `${s.year} ${s.month} ${s.day} ${s.hour}`, pillars: true },
    { k: '日主', v: `${chart.day_master}（${chart.strength}）` },
    { k: '格局', v: chart.geju },
    { k: '用神', v: chart.yongshen },
  ];
  csCells.forEach((c) => {
    const cell = document.createElement('div'); cell.className = 'cs-cell' + (c.pillars ? ' pillars' : '');
    const k = document.createElement('span'); k.className = 'k'; k.textContent = c.k;
    const v = document.createElement('span'); v.className = 'v'; v.textContent = c.v;
    cell.appendChild(k); cell.appendChild(v); strip.appendChild(cell);
  });
  // 五行小标签并入命盘条
  const wxCell = document.createElement('div'); wxCell.className = 'cs-cell';
  const wxk = document.createElement('span'); wxk.className = 'k'; wxk.textContent = '五行';
  const wxTags = document.createElement('div'); wxTags.className = 'cs-tags';
  Object.entries(chart.wuxing).forEach(([k, v]) => {
    const t = document.createElement('span'); t.className = 't'; t.textContent = `${k}${v}`;
    wxTags.appendChild(t);
  });
  wxCell.appendChild(wxk); wxCell.appendChild(wxTags); strip.appendChild(wxCell);
  box.appendChild(strip);

  // 解读输出（放大区）
  report.forEach((secData) => {
    const sec = document.createElement('div'); sec.className = 'sec';
    const h = document.createElement('h3'); h.textContent = secData.key;
    const p = document.createElement('p'); p.textContent = secData.text;
    sec.appendChild(h); sec.appendChild(p); box.appendChild(sec);
  });

  // 专业明细（可折叠，刻意做小）
  const det = document.createElement('details'); det.className = 'detail';
  const sum = document.createElement('summary'); sum.textContent = '专业排盘明细（十神 / 真太阳时 / 大运）';
  det.appendChild(sum);
  const kv = document.createElement('div'); kv.className = 'kv';
  const addKV = (k, v) => {
    const b = document.createElement('b'); b.textContent = k;
    const span = document.createElement('span'); span.textContent = v;
    kv.appendChild(b); kv.appendChild(span);
  };
  const approxNote = chart.birth.longitude_approx ? '，经度按120°E近似' : '';
  addKV('真太阳时', `${chart.birth.true_solar_time}（经度${chart.birth.longitude}°E，校正${chart.birth.long_corr}分${approxNote}）`);
  const ss = chart.shishen;
  const ssText = `年干 ${ss.year_gan}｜月干 ${ss.month_gan}｜时干 ${ss.hour_gan}｜` +
    `年支 ${ss.year_zhi.join('/')}｜月支 ${ss.month_zhi.join('/')}｜日支 ${ss.day_zhi.join('/')}｜时支 ${ss.hour_zhi.join('/')}`;
  addKV('十神', ssText);
  addKV('忌神', chart.jishen);
  det.appendChild(kv);
  // 大运（小）
  const dy = document.createElement('div'); dy.style.cssText = 'margin-top:6px';
  chart.dayun.forEach((d) => {
    const r = document.createElement('div'); r.className = 'dayun-row';
    r.textContent = `${d.start_age}岁起 · ${d.pillar}`;
    dy.appendChild(r);
  });
  const dyLabel = document.createElement('div'); dyLabel.style.cssText = 'font-size:11.5px;color:var(--text-soft);margin-top:6px'; dyLabel.textContent = '大运：';
  det.appendChild(dyLabel); det.appendChild(dy);
  box.appendChild(det);

  // 免责句
  const disc = document.createElement('div'); disc.className = 'sec';
  const dp = document.createElement('p'); dp.style.cssText = 'color:var(--text-soft);font-size:13px';
  dp.textContent = disclaimer;
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
    if (data.status === 'ask') {
      known = data.known || {};
      addBotText(data.question);
      return;
    }
    if (data.status === 'done') {
      known = {}; // 一轮完成，清空以便下一位
      renderReport(data.chart, data.report, data.disclaimer);
      return;
    }
    addBotText('出错：' + (data.message || '未知错误'));
  } catch (e) {
    t.remove();
    if (location.protocol === 'file:') {
      addBotText('⚠️ 检测到你是用「直接打开文件」的方式访问的，这样脚本和接口无法加载。\n请先启动服务，然后改用浏览器访问：http://localhost:3000');
    } else {
      addBotText('网络异常，请确认服务已启动（start.bat），稍后再试。');
    }
  }
}

msgForm.onsubmit = (e) => {
  e.preventDefault();
  const v = msgInput.value.trim();
  if (!v) return;
  msgInput.value = '';
  send(v);
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
  // 用更自然的方式展示提交：把 summary 作为用户气泡已被 send 内 addUserText('（已提交详细表单）') 覆盖
  // 修正：send 内已加用户气泡，这里补充细节
  const last = chatEl.querySelector('.msg.user:last-child .bubble');
  if (last) last.textContent = summary;
};

// 开场白
addBotText('你好，我是八字命理助手 ☯ 告诉我你的公历出生年月日、时辰、性别和出生城市，我为你排盘解读～\n你也可以点下方「详细填写」逐项输入。');
