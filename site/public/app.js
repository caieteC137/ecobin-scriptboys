const $ = (selector) => document.querySelector(selector);
const number = (value, digits = 1) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
const date = (timestamp, full = false) => new Date(timestamp).toLocaleString('pt-BR', full ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const statuses = { coletar: ['collect', 'Coleta necessária'], acompanhar: ['watch', 'Acompanhar'], normal: ['', 'Normal'] };
const badge = (status) => `<span class="badge ${statuses[status]?.[0] || ''}">${escape(statuses[status]?.[1] || status)}</span>`;
const state = { summary: null, history: null, chart: null, view: '', loading: false, chartKey: '', lastHistory: 0, lastChart: 0 };

$('#today').textContent = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

async function api(path) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('A API retornou ' + response.status);
  return response.json();
}

function toast(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}

function renderDevices() {
  if (!state.summary) return;
  const query = $('#device-search').value.trim().toLocaleLowerCase('pt-BR');
  const devices = state.summary.devices.filter((d) => `${d.lixeira} ${d.setor} ${d.compartimento}`.toLocaleLowerCase('pt-BR').includes(query));
  $('#devices').innerHTML = devices.length ? devices.map((d) => `
    <article class="device-card ${d.coletar ? 'is-collect' : ''}">
      <div class="device-top"><div class="device-name"><span class="bin-icon">${icon('bin')}</span><div><h3>${escape(d.lixeira)}</h3><p>${escape(d.setor)} · ${escape(d.compartimento)}</p></div></div><div class="badges">${badge(d.status)}${d.simulado ? '<span class="badge simulated">SIMULADO</span>' : ''}</div></div>
      <div class="device-values"><div><span>Ocupação</span><strong>${number(d.ocupacao_pct, 0)}<small>%</small></strong></div><div><span>Massa dos resíduos</span><strong>${number(d.massa_kg)}<small>kg</small></strong></div></div>
      <progress class="occupancy-progress" max="100" value="${d.ocupacao_pct}" aria-label="Ocupação da lixeira ${escape(d.lixeira)}"></progress><div class="occupancy-scale"><span>Vazio</span><span>Limite: 80%</span><span>100%</span></div>
      ${d.coletar ? '<p class="device-bottom-note">Limite atingido. Priorizar este ponto na coleta interna.</p>' : ''}
      <div class="device-footer"><span><span class="dot ${d.online ? '' : 'gray'}"></span>${d.online ? 'Recebendo leituras' : 'Sem leitura há mais de 30 s'}</span><span>Última leitura · ${date(d.received_at)}</span></div>
    </article>`).join('') : `<div class="empty">${icon('bin')}<h3>${query ? 'Nenhum ponto encontrado' : 'Aguardando a primeira leitura'}</h3><p>${query ? 'Tente buscar por outra lixeira, setor ou compartimento.' : 'Ligue o ESP32 e mantenha o Node-RED em execução. Os pontos aparecem aqui ao receber telemetria.'}</p>${query ? '' : '<a href="#integracao">Ver como conectar ↗</a>'}</div>`;
}

function updateDeviceOptions(selector, includeAll) {
  const element = $(selector);
  const selected = element.value;
  const devices = state.summary?.devices || [];
  const signature = JSON.stringify(devices.map((d) => [d.device_key, d.lixeira, d.setor, d.compartimento]));
  if (element.dataset.signature === signature) return;
  element.dataset.signature = signature;
  element.innerHTML = (includeAll ? '<option value="">Todas as lixeiras</option>' : '')
    + devices.map((d) => `<option value="${escape(d.device_key)}">${escape(d.lixeira)} · ${escape(d.setor)} · ${escape(d.compartimento)}</option>`).join('');
  if (!devices.length && !includeAll) element.innerHTML = '<option value="">Selecione uma lixeira</option>';
  if ([...element.options].some((o) => o.value === selected)) element.value = selected;
}

function renderSummary(summary) {
  state.summary = summary;
  if (summary.environment === 'azure') {
    $('#environment-name').textContent = 'Azure Ubuntu VM';
    $('#environment-description').textContent = 'Histórico armazenado na nuvem';
    document.querySelectorAll('.local-tag').forEach(el => { el.textContent = 'AZURE'; });
    $('[data-view="integracao"]').hidden = true;
    if (state.view === 'integracao') location.hash = 'visao';
  }
  const s = summary.stats;
  $('#stat-online').innerHTML = `${s.online}<span> / ${s.total}</span>`;
  $('#stat-collect').textContent = s.collect;
  $('#stat-occupancy').innerHTML = `${s.total ? number(s.occupancy, 0) : '—'}<span> %</span>`;
  $('#stat-mass').innerHTML = `${s.total ? number(s.mass) : '—'}<span> kg</span>`;
  $('#device-count').textContent = `${s.total} ${s.total === 1 ? 'compartimento monitorado' : 'compartimentos monitorados'}`;
  $('#reading-count').textContent = `${new Intl.NumberFormat('pt-BR').format(s.readings)} registros armazenados`;
  $('#live-state').innerHTML = `<span class="dot ${s.online ? '' : 'gray'}"></span>${s.online ? 'Recebendo dados em tempo real' : s.total ? 'Sem leituras recentes' : 'Aguardando leituras'}`;
  $('#last-update').textContent = s.latest ? 'Último recebimento às ' + date(s.latest) : 'O Node-RED alimenta este painel automaticamente.';
  $('#event-count').textContent = summary.events.length;
  $('#events').innerHTML = summary.events.length ? summary.events.slice(0, 10).map((e) => `
    <div class="event"><span class="event-icon ${e.tipo === 'normalizado' ? 'ok' : ''}">${icon(e.tipo === 'normalizado' ? 'check' : 'alert')}</span><div><strong>${e.tipo === 'coleta' ? 'Limite de coleta atingido' : 'Nível normalizado'} · ${escape(e.lixeira)}</strong><p>${escape(e.setor)} · ${number(e.ocupacao_pct, 0)}% · ${number(e.massa_kg)} kg${e.simulado ? ' · Simulado' : ''}</p><small>${date(e.received_at, true)}</small></div></div>`).join('') : '<div class="small-empty">Nenhum evento registrado.</div>';
  renderDevices();
  updateDeviceOptions('#chart-device', false);
  updateDeviceOptions('#history-device', true);
}

function renderRows(rows, history = false) {
  const cols = history ? 7 : 6;
  if (!rows.length) return `<tr><td colspan="${cols}" class="table-empty">Nenhuma leitura neste período.</td></tr>`;
  return rows.map((r) => `<tr><td>${date(r.received_at, history)}</td><td><strong>${escape(r.lixeira)}</strong><small>${escape(r.setor)}</small></td><td>${escape(r.compartimento)}</td><td>${number(r.massa_kg, 2)} kg</td><td>${number(r.ocupacao_pct)}%</td><td>${badge(r.status)}</td>${history ? `<td>${r.simulado ? 'Simulado' : 'Sensor'}</td>` : ''}</tr>`).join('');
}

async function updateHistory() {
  const params = new URLSearchParams({ lixeira: $('#history-device').value, minutos: $('#history-period').value });
  const data = await api('/api/historico?' + params);
  state.history = data;
  state.lastHistory = Date.now();
  $('#history-rows').innerHTML = renderRows(data.rows, true);
  $('#history-count').textContent = `${new Intl.NumberFormat('pt-BR').format(data.count)} registros no período`;
  $('#export-csv').href = '/api/exportar.csv?' + params;
}

async function updateChart() {
  const key = $('#chart-device').value;
  state.chartKey = key;
  if (!key) {
    state.chart = { points: [], count: 0 };
    drawChart();
    return;
  }
  const data = await api('/api/historico?' + new URLSearchParams({ lixeira: key, minutos: 60 }));
  if (state.chartKey !== key) return;
  state.chart = data;
  state.lastChart = Date.now();
  $('#chart-points').textContent = new Intl.NumberFormat('pt-BR').format(data.count) + ' leituras';
  drawChart();
}

function drawChart() {
  const canvas = $('#chart');
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const area = { x: 32, y: 13, w: width - 45, h: height - 43 };
  ctx.font = '9px "Segoe UI", Arial';
  ctx.textAlign = 'right';
  for (let n = 0; n <= 100; n += 25) {
    const y = area.y + area.h * (1 - n / 100);
    ctx.strokeStyle = '#eaf0e2';
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(area.x, y); ctx.lineTo(area.x + area.w, y); ctx.stroke();
    ctx.fillStyle = '#8a9879'; ctx.fillText(String(n), area.x - 8, y + 3);
  }
  ctx.strokeStyle = '#bc9653'; ctx.setLineDash([4, 4]);
  const limitY = area.y + area.h * .2;
  ctx.beginPath(); ctx.moveTo(area.x, limitY); ctx.lineTo(area.x + area.w, limitY); ctx.stroke(); ctx.setLineDash([]);
  const points = state.chart?.points || [];
  $('#chart-empty').hidden = !!points.length;
  const latest = Date.now();
  const from = latest - 3600000;
  ctx.textAlign = 'center'; ctx.fillStyle = '#8a9879';
  for (let i = 0; i <= 4; i++) {
    const time = from + i / 4 * 3600000;
    ctx.fillText(new Date(time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), area.x + i / 4 * area.w, height - 9);
  }
  if (!points.length) return;
  const positions = points.map((p) => ({ x: area.x + Math.max(0, Math.min(1, (p.received_at - from) / 3600000)) * area.w, y: area.y + (1 - p.ocupacao_pct / 100) * area.h }));
  ctx.save(); ctx.beginPath(); ctx.rect(area.x, area.y - 2, area.w + 1, area.h + 4); ctx.clip();
  const fill = ctx.createLinearGradient(0, area.y, 0, area.y + area.h); fill.addColorStop(0, '#dce8ceaa'); fill.addColorStop(1, '#edf4e300');
  ctx.beginPath(); ctx.moveTo(positions[0].x, area.y + area.h); positions.forEach((p) => ctx.lineTo(p.x, p.y)); ctx.lineTo(positions.at(-1).x, area.y + area.h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  ctx.beginPath(); positions.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.strokeStyle = '#789b5c'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(positions.at(-1).x, positions.at(-1).y, 3, 0, Math.PI * 2); ctx.fillStyle = '#648d46'; ctx.fill(); ctx.restore();
  canvas.setAttribute('aria-label', `Ocupação de ${$('#chart-device').selectedOptions[0]?.textContent}: ${points.length} pontos na última hora, última média de ${number(points.at(-1).ocupacao_pct)}%.`);
}

async function update(force = false) {
  if (state.loading) return;
  state.loading = true;
  try {
    renderSummary(await api('/api/resumo'));
    $('#server-error').hidden = true;
    if (state.view === 'visao') {
      const recent = await api('/api/historico?minutos=60');
      $('#recent-rows').innerHTML = renderRows(recent.rows.slice(0, 5));
      if (force || Date.now() - state.lastChart > 5000 || state.chartKey !== $('#chart-device').value) await updateChart();
    } else if (state.view === 'historico' && (force || Date.now() - state.lastHistory > 3000)) await updateHistory();
  } catch {
    $('#server-error').hidden = false;
    $('#live-state').innerHTML = '<span class="dot gray"></span>API indisponível';
  } finally { state.loading = false; }
}

function navigate() {
  const view = location.hash.slice(1);
  state.view = ['visao', 'historico', 'integracao'].includes(view) ? view : 'visao';
  for (const name of ['visao', 'historico', 'integracao']) {
    $('#page-' + name).hidden = name !== state.view;
    const link = $(`[data-view="${name}"]`);
    if (name === state.view) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  $('#breadcrumb-current').textContent = { visao: 'Visão geral', historico: 'Histórico', integracao: 'Integração' }[state.view];
  update(true);
}

$('#device-search').addEventListener('input', renderDevices);
$('#refresh').addEventListener('click', async () => { await update(true); toast($('#server-error').hidden ? 'Leituras atualizadas.' : 'Não foi possível atualizar. Confira a conexão com o servidor.'); });
$('#chart-device').addEventListener('change', () => updateChart().catch(() => toast('Não foi possível carregar o gráfico.')));
for (const selector of ['#history-device', '#history-period']) $(selector).addEventListener('change', () => updateHistory().catch(() => toast('Não foi possível carregar o histórico.')));
window.addEventListener('hashchange', navigate);
new ResizeObserver(drawChart).observe($('.chart-wrap'));
const events = new EventSource('/api/eventos');
let pending;
events.addEventListener('leitura', () => { clearTimeout(pending); pending = setTimeout(() => update(), 200); });
events.addEventListener('conectado', () => update(true));
setInterval(() => { if (!document.hidden) update(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) update(true); });
navigate();
