// === CONFIGURACAO ===

var CONFIG = {
  SHEET_ID: '1S9iJOigJ6Q-aewatWtrJ6yMhCbwdhaga_kD9XAyPRxw',
  GID: '1678133766',
  // AVISO: senhas em producao devem ser movidas para um servidor, nao ficarem no codigo cliente
  FETCH_TIMEOUT_MS: 9000
};

CONFIG.CSV_URL  = 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/export?format=csv&gid=' + CONFIG.GID;
CONFIG.GVIZ_URL = 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/gviz/tq?tqx=out:json&gid=' + CONFIG.GID;

var STORAGE_KEY       = 'roblox_shorts_state';
var STORAGE_CACHE_KEY = 'roblox_shorts_cache';

// === CONSTANTES DE DOMINIO ===

// AVISO: senhas hardcoded no cliente nao sao seguras — mover para backend em producao
var USERS   = { diogo: '9iokl', isaac: '9iokl' };
var DISPLAY = { diogo: 'Diogo', isaac: 'Isaac' };

var PILAR_CLASSES = {
  'Curiosidade':   'pb-c',
  'Rant':          'pb-r',
  'Mini Historia': 'pb-h',
  'Tendencia':     'pb-t'
};

var STATUS_FILTER_MAP = {
  'Ideia':        'ideia',
  'Em Producao':  'producao',
  'Revisao':      'revisao',
  'Agendado':     'agendado',
  'Publicado':    'publicado'
};

var STATUS_BADGE_MAP = {
  'Publicado':   ['st-pub',  '✅'],
  'Em Producao': ['st-prod', '🎬'],
  'Revisao':     ['st-rev',  '🔍'],
  'Agendado':    ['st-ag',   '📅'],
  'Ideia':       ['st-id',   '💡']
};

// === ESTADO GLOBAL ===

var currentUser   = null;
var selectedUser  = null;
var currentFilter = 'all';
var openPanelId   = null;
var roteiros      = [];
var scriptState   = {};

// === PERSISTENCIA ===

function loadState() {
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved) scriptState = JSON.parse(saved);
  } catch (e) {}
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scriptState));
  } catch (e) {}
}

function ensureState(id) {
  if (!scriptState[id]) {
    scriptState[id] = { published: false, status: 'Ideia', resp: null, dataPub: '' };
  }
}

// === FETCH COM TIMEOUT ===

function fetchTimeout(url, ms) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var tid = setTimeout(function() {
      if (!done) { done = true; reject(new Error('timeout')); }
    }, ms);
    fetch(url).then(function(r) {
      if (!done) { done = true; clearTimeout(tid); resolve(r); }
    }).catch(function(e) {
      if (!done) { done = true; clearTimeout(tid); reject(e); }
    });
  });
}

// === PARSE GVIZ JSON ===

function gvizParse(raw) {
  var start = raw.indexOf('(');
  var end   = raw.lastIndexOf(')');
  if (start < 0 || end < 0) throw new Error('gviz: formato inesperado');
  var json  = JSON.parse(raw.substring(start + 1, end));
  var table = json.table;
  var cols  = table.cols.map(function(c) { return (c.label || c.id || '').trim(); });
  var rows  = table.rows.map(function(row) {
    var obj = {};
    row.c.forEach(function(cell, i) {
      obj[cols[i]] = (cell && cell.v != null) ? String(cell.v).trim() : '';
    });
    return obj;
  });
  return { cols: cols, rows: rows };
}

// === MAPEAMENTO DE COLUNAS ===

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').trim();
}

function colFind(cols, names) {
  for (var n = 0; n < names.length; n++) {
    var needle = normalize(names[n]);
    for (var i = 0; i < cols.length; i++) {
      if (normalize(cols[i]).indexOf(needle) >= 0) return cols[i];
    }
  }
  return null;
}

function rowsToRoteiros(cols, rows) {
  var kId   = colFind(cols, ['#', 'id', 'num'])              || cols[0];
  var kTit  = colFind(cols, ['titulo', 'title'])             || cols[1];
  var kPil  = colFind(cols, ['pilar']);
  var kDur  = colFind(cols, ['duracao', 'dur']);
  var kGan  = colFind(cols, ['hook pre', 'hook']);
  var kAng  = colFind(cols, ['angulo', 'abordagem']);
  var kVir  = colFind(cols, ['viral', 'por que']);
  var kS0   = colFind(cols, ['gancho 0']);
  var kS1   = colFind(cols, ['contexto']);
  var kS2   = colFind(cols, ['climax']);
  var kS3   = colFind(cols, ['cta 45', 'encerramento']);
  var kCta  = colFind(cols, ['cta final']);
  var kTags = colFind(cols, ['hashtag', 'tag']);

  var result = [];
  rows.forEach(function(row, idx) {
    var titulo = row[kTit] || '';
    if (!titulo) return;
    result.push({
      id:   row[kId]   || String(idx + 1),
      t:    titulo,
      p:    row[kPil]  || 'Curiosidade',
      d:    row[kDur]  || '58s',
      g:    row[kGan]  || '',
      ang:  row[kAng]  || '',
      vir:  row[kVir]  || '',
      s0:   row[kS0]   || row[kGan] || '',
      s1:   row[kS1]   || '',
      s2:   row[kS2]   || '',
      s3:   row[kS3]   || '',
      cta:  row[kCta]  || '',
      tags: row[kTags] || '',
      _new: false
    });
  });
  return result;
}

// === BARRA DE SYNC ===

function setSyncBar(cls, msg) {
  var bar = document.getElementById('sync-bar');
  bar.className = 'sync-bar sync-' + cls;
  document.getElementById('sync-msg').textContent = msg;
}

function showLoading(txt) {
  document.getElementById('loading-txt').textContent = txt;
  document.getElementById('loading-overlay').classList.remove('hide');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hide');
}

function cacheRoteiros() {
  try { localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(roteiros)); } catch (e) {}
}

function loadCachedRoteiros() {
  try {
    var cached = localStorage.getItem(STORAGE_CACHE_KEY);
    if (cached) {
      roteiros = JSON.parse(cached);
      renderAll();
      setSyncBar('err', '⚠ Usando cache local');
    }
  } catch (e) {}
}

// === SINCRONIZACAO ===

async function syncSheets() {
  setSyncBar('loading', 'Sincronizando com Google Sheets…');
  document.getElementById('btn-sync').disabled = true;
  showLoading('Buscando dados do Google Sheets…');

  var parsed = null;

  // Tentativa 1: Google Visualization API (sem CORS)
  try {
    var res1 = await fetchTimeout(CONFIG.GVIZ_URL, CONFIG.FETCH_TIMEOUT_MS);
    if (res1.ok) {
      var raw  = await res1.text();
      var data = gvizParse(raw);
      parsed   = rowsToRoteiros(data.cols, data.rows);
    }
  } catch (e) { console.warn('gviz falhou:', e.message); }

  // Tentativa 2: allorigins proxy
  if (!parsed || parsed.length === 0) {
    try {
      var url2 = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(CONFIG.CSV_URL);
      var res2 = await fetchTimeout(url2, CONFIG.FETCH_TIMEOUT_MS);
      if (res2.ok) {
        var csv = await res2.text();
        if (csv && csv.length > 20) parsed = csvToRoteiros(csv);
      }
    } catch (e) { console.warn('allorigins falhou:', e.message); }
  }

  // Tentativa 3: corsproxy
  if (!parsed || parsed.length === 0) {
    try {
      var url3 = 'https://corsproxy.io/?' + encodeURIComponent(CONFIG.CSV_URL);
      var res3 = await fetchTimeout(url3, CONFIG.FETCH_TIMEOUT_MS);
      if (res3.ok) {
        var csv3 = await res3.text();
        if (csv3 && csv3.length > 20) parsed = csvToRoteiros(csv3);
      }
    } catch (e) { console.warn('corsproxy falhou:', e.message); }
  }

  hideLoading();
  document.getElementById('btn-sync').disabled = false;

  if (!parsed || parsed.length === 0) {
    setSyncBar('err', '⚠ Erro ao sincronizar. Verifique se a planilha esta publica.');
    toast('⚠ Nao foi possivel acessar a planilha.', 'err');
    loadCachedRoteiros();
    return;
  }

  var oldIds = {};
  roteiros.forEach(function(r) { oldIds[String(r.id)] = true; });
  parsed.forEach(function(r) { r._new = !oldIds[String(r.id)]; });
  var newCount = parsed.filter(function(r) { return r._new; }).length;

  roteiros = parsed;
  roteiros.forEach(function(r) { ensureState(r.id); });
  saveState();
  cacheRoteiros();

  var t = new Date().toLocaleTimeString('pt-BR');
  setSyncBar('ok', '✓ Sincronizado as ' + t + ' · ' + roteiros.length + ' roteiros' + (newCount > 0 ? ' · ' + newCount + ' novos!' : ''));
  if (newCount > 0) toast('🆕 ' + newCount + ' novo(s) roteiro(s)!');
  else toast('✓ Tudo atualizado! ' + roteiros.length + ' roteiros.');
  renderAll();
}

// === CSV PARSER ===

function csvToRoteiros(text) {
  var lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  var cols = splitCSV(lines[0]).map(function(c) { return c.replace(/^"|"$/g, '').trim(); });
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var cells = splitCSV(lines[i]);
    var obj   = {};
    cols.forEach(function(c, j) { obj[c] = (cells[j] || '').replace(/^"|"$/g, '').trim(); });
    rows.push(obj);
  }
  return rowsToRoteiros(cols, rows);
}

function splitCSV(line) {
  var result = [], cur = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"')          { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else                    { cur += c; }
  }
  result.push(cur);
  return result;
}

// === AUTENTICACAO ===

function selectUser(u) {
  selectedUser = u;
  document.querySelectorAll('.user-card').forEach(function(c) { c.classList.remove('selected'); });
  document.getElementById('card-' + u).classList.add('selected');
  document.getElementById('pwd-input').focus();
}

function doLogin() {
  var pwd = document.getElementById('pwd-input').value;
  var err = document.getElementById('login-error');
  if (!selectedUser) { err.textContent = 'Selecione um usuario.'; err.style.display = 'block'; return; }
  if (USERS[selectedUser] !== pwd) { err.textContent = 'Senha incorreta.'; err.style.display = 'block'; return; }
  currentUser = selectedUser;
  err.style.display = 'none';
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'block';
  document.getElementById('active-user-label').textContent = DISPLAY[currentUser].toUpperCase();
  syncSheets();
}

function doLogout() {
  currentUser  = null;
  selectedUser = null;
  openPanelId  = null;
  document.getElementById('pwd-input').value = '';
  document.querySelectorAll('.user-card').forEach(function(c) { c.classList.remove('selected'); });
  document.getElementById('login-error').style.display  = 'none';
  document.getElementById('app-screen').style.display   = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

// === TOGGLE PUBLICADO ===

function togglePub(id, e) {
  e.stopPropagation();
  var s = scriptState[id];
  s.published = !s.published;
  s.resp = DISPLAY[currentUser];
  if (s.published) {
    s.status  = 'Publicado';
    s.dataPub = new Date().toLocaleDateString('pt-BR');
    toast('✅ Publicado! Responsavel → ' + s.resp);
  } else {
    s.status  = 'Em Producao';
    s.dataPub = '';
    toast('🎬 Em Producao. Responsavel → ' + s.resp);
  }
  saveState();
  renderAll();
}

// === PAINEL DO ROTEIRO ===

function togglePanel(id) {
  var sid = String(id);
  if (String(openPanelId) === sid) {
    var panel = document.getElementById('sp-' + sid);
    if (panel) panel.classList.remove('open');
    openPanelId = null;
  } else {
    if (openPanelId !== null) {
      var prev = document.getElementById('sp-' + openPanelId);
      if (prev) prev.classList.remove('open');
    }
    openPanelId = sid;
    var newPanel = document.getElementById('sp-' + sid);
    if (newPanel) {
      newPanel.classList.add('open');
      setTimeout(function() { newPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 80);
    }
  }
  document.querySelectorAll('.expand-hint').forEach(function(h) {
    h.textContent = String(openPanelId) === String(h.dataset.id) ? '▲ fechar roteiro' : '▼ ver roteiro completo';
  });
}

function switchTab(btn, id, tab) {
  var inner = document.getElementById('sp-' + id);
  inner.querySelectorAll('.sp-tab').forEach(function(b) { b.classList.remove('active'); });
  inner.querySelectorAll('.sp-pane').forEach(function(p) { p.classList.remove('active'); });
  btn.classList.add('active');
  inner.querySelector('[data-pane="' + tab + '"]').classList.add('active');
}

// === HELPERS DE RENDERIZACAO ===

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function respH(r) {
  if (!r) return '<div class="resp-av ra-none">?</div><span class="resp-name" style="color:var(--muted)">—</span>';
  var cls = r === 'Diogo' ? 'ra-d' : 'ra-i';
  return '<div class="resp-av ' + cls + '">' + r[0] + '</div><span class="resp-name">' + r + '</span>';
}

function stH(s) {
  var x = STATUS_BADGE_MAP[s] || STATUS_BADGE_MAP['Ideia'];
  return '<span class="status-badge ' + x[0] + '"><span class="sb-dot"></span>' + x[1] + ' ' + s + '</span>';
}

// === RENDERIZACAO ===

function renderAll() {
  renderRows();
  updateStats();
  applyCurrentFilter();
}

function renderRows() {
  var container = document.getElementById('rows-container');
  container.innerHTML = '';
  if (roteiros.length === 0) {
    document.getElementById('empty-state').classList.add('show');
    return;
  }
  document.getElementById('empty-state').classList.remove('show');

  roteiros.forEach(function(r) {
    var s = scriptState[r.id];
    if (!s) return;
    var isOpen   = String(openPanelId) === String(r.id);
    var wrap     = document.createElement('div');
    wrap.className        = 'row-wrap';
    wrap.dataset.id       = r.id;
    wrap.dataset.status   = STATUS_FILTER_MAP[s.status] || 'ideia';
    var nb       = r._new ? '<span class="new-badge">NOVO</span>' : '';
    var pc       = PILAR_CLASSES[r.p] || 'pb-c';
    var tagsHtml = (r.tags || '').split(/[\s,]+/).filter(Boolean).map(function(t) {
      return '<span class="tag">' + esc(t) + '</span>';
    }).join('');

    wrap.innerHTML =
      '<div class="row-item">' +
        '<div class="td td-check">' +
          '<div class="toggle-wrap" onclick="togglePub(\'' + r.id + '\',event)">' +
            '<div class="toggle-switch ' + (s.published ? 'on' : 'off') + '"><div class="toggle-knob"></div></div>' +
            '<span class="toggle-label ' + (s.published ? 'on' : 'off') + '">' + (s.published ? 'PUBLICADO' : 'PRODUCAO') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="td td-title" onclick="togglePanel(\'' + r.id + '\')">' +
          '<span class="title-text">' + esc(r.t) + nb + '</span>' +
          '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:2px;">' +
            '<span class="pilar-badge ' + pc + '">' + esc(r.p) + '</span>' +
            '<span style="font-size:10px;color:var(--muted);">' + esc(r.d) + '</span>' +
          '</div>' +
          '<span class="expand-hint" data-id="' + r.id + '">' + (isOpen ? '▲ fechar roteiro' : '▼ ver roteiro completo') + '</span>' +
        '</div>' +
        '<div class="td"><div class="resp-cell">' + respH(s.resp) + '</div></div>' +
        '<div class="td">' + stH(s.status) + '</div>' +
        '<div class="td ' + (s.dataPub ? 'date-cell ok' : 'date-cell') + '">' + (s.dataPub || '—') + '</div>' +
      '</div>' +
      '<div class="script-panel ' + (isOpen ? 'open' : '') + '" id="sp-' + r.id + '">' +
        '<div class="script-inner">' +
          '<div class="sp-tabs">' +
            '<button class="sp-tab active" onclick="switchTab(this,\'' + r.id + '\',\'rot\')">🎙 Roteiro Completo</button>' +
            '<button class="sp-tab" onclick="switchTab(this,\'' + r.id + '\',\'ang\')">💡 Angulo & Viral</button>' +
          '</div>' +
          '<div class="sp-body">' +
            '<div class="sp-pane active" data-pane="rot">' +
              (function() {
                var parts = [r.s0 || r.g, r.s1, r.s2, r.s3].filter(Boolean).map(esc);
                var full  = parts.join(' ') || '—';
                return '<div class="sb-txt" style="font-size:15px;line-height:2;padding:18px 20px;border-left:3px solid var(--red);">' + full + '</div>';
              })() +
              (r.cta  ? '<div class="cta-box" style="margin-top:14px;"><strong>CTA →</strong> ' + esc(r.cta) + '</div>' : '') +
              (tagsHtml ? '<div class="tag-row">' + tagsHtml + '</div>' : '') +
            '</div>' +
            '<div class="sp-pane" data-pane="ang">' +
              '<div class="ang-lbl">Angulo de Abordagem</div>' +
              '<div class="ang-val">' + (esc(r.ang) || '—') + '</div>' +
              '<div class="ang-lbl">Hook pre-video</div>' +
              '<div class="ang-val" style="font-style:italic;color:#888">"' + esc(r.g) + '"</div>' +
              (r.vir ? '<div class="viral-box"><strong>⚡ Por que viraliza:</strong> ' + esc(r.vir) + '</div>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    container.appendChild(wrap);
  });
}

function updateStats() {
  var values = Object.values(scriptState);
  document.getElementById('s-total').textContent = roteiros.length;
  document.getElementById('s-pub').textContent   = values.filter(function(s) { return s.status === 'Publicado'; }).length;
  document.getElementById('s-prod').textContent  = values.filter(function(s) { return s.status === 'Em Producao'; }).length;
  document.getElementById('s-rev').textContent   = values.filter(function(s) { return s.status === 'Revisao'; }).length;
  document.getElementById('s-pend').textContent  = values.filter(function(s) { return s.status === 'Ideia'; }).length;
}

function applyCurrentFilter() {
  var visible = 0;
  document.querySelectorAll('.row-wrap').forEach(function(row) {
    var show = currentFilter === 'all' || row.dataset.status === currentFilter;
    row.classList.toggle('hidden', !show);
    if (show) visible++;
  });
  document.getElementById('empty-state').classList.toggle('show', visible === 0 && roteiros.length > 0);
}

// === EXPORTAR EXCEL ===

function exportExcel() {
  var wb   = XLSX.utils.book_new();
  var rows = [['#', 'TITULO', 'PILAR', 'GANCHO', 'CONTEXTO', 'CLIMAX', 'ENCERRAMENTO', 'CTA', 'HASHTAGS', 'DURACAO', 'RESPONSAVEL', 'STATUS', 'PUBLICADO', 'DATA', 'POR']];
  roteiros.forEach(function(r) {
    var s = scriptState[r.id] || {};
    rows.push([r.id, r.t, r.p, r.g, r.s1, r.s2, r.s3, r.cta, r.tags, r.d,
      s.resp || '—', s.status || 'Ideia', s.published ? 'SIM' : 'NAO', s.dataPub || '', DISPLAY[currentUser]]);
  });
  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    {wch:4}, {wch:55}, {wch:14}, {wch:50}, {wch:55},
    {wch:65}, {wch:55}, {wch:40}, {wch:40}, {wch:8},
    {wch:12}, {wch:13}, {wch:10}, {wch:13}, {wch:10}
  ];
  XLSX.utils.book_append_sheet(wb, ws, '📋 Roteiros');

  var values = Object.values(scriptState);
  var summary = [
    ['RESUMO'], [''],
    ['Por:', DISPLAY[currentUser]],
    ['Data:', new Date().toLocaleString('pt-BR')],
    [''], ['STATUS', 'QTD'],
    ['Ideia',        values.filter(function(s) { return s.status === 'Ideia'; }).length],
    ['Em Producao',  values.filter(function(s) { return s.status === 'Em Producao'; }).length],
    ['Revisao',      values.filter(function(s) { return s.status === 'Revisao'; }).length],
    ['Agendado',     values.filter(function(s) { return s.status === 'Agendado'; }).length],
    ['Publicado',    values.filter(function(s) { return s.status === 'Publicado'; }).length],
    [''], ['TOTAL', roteiros.length]
  ];
  var ws2 = XLSX.utils.aoa_to_sheet(summary);
  ws2['!cols'] = [{ wch: 16 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, '📊 Resumo');

  var filename = 'roteiros_' + new Date().toLocaleDateString('pt-BR').replace(/\//g, '-') + '_' + DISPLAY[currentUser] + '.xlsx';
  XLSX.writeFile(wb, filename);
  toast('✅ Excel exportado!');
}

// === TOAST ===

var toastTimer;

function toast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { t.classList.remove('show'); }, 3400);
}

// === INICIALIZACAO E EVENT LISTENERS ===

loadState();

// Login — user cards
document.getElementById('card-diogo').addEventListener('click', function() { selectUser('diogo'); });
document.getElementById('card-isaac').addEventListener('click', function() { selectUser('isaac'); });

// Login — senha (Enter)
document.getElementById('pwd-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doLogin();
});

// Login — botao entrar
document.querySelector('.login-btn').addEventListener('click', doLogin);

// Header — sincronizar
document.getElementById('btn-sync').addEventListener('click', syncSheets);

// Header — exportar
document.querySelector('.btn-export').addEventListener('click', exportExcel);

// Header — logout
document.querySelector('.btn-logout').addEventListener('click', doLogout);

// Filtros — delegacao de evento no container
document.querySelector('.filter-row').addEventListener('click', function(e) {
  var btn = e.target.closest('.filter-tag');
  if (!btn) return;
  document.querySelectorAll('.filter-tag').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  currentFilter = btn.dataset.f;
  applyCurrentFilter();
});
