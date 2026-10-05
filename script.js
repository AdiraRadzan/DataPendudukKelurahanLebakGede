// ============================================================================
// KONFIGURASI — WAJIB DIISI
// ============================================================================
// Tempel URL Web App hasil deploy apps-script/Code.gs (diakhiri /exec).
const API_URL = 'https://script.google.com/macros/s/AKfycbzyXdqN0fC2Y-nzB_t55bi0ZHYdWPyzuwqo8dYrTKrNZx1YqKUHINdaytPSzwLW4wE_ag/exec';

// ============================================================================
// STATE
// ============================================================================
let TOKEN = sessionStorage.getItem('pdk_token') || '';
let ALL_ITEMS = [];
let FILTERED_ITEMS = [];
let CHARTS = {};
let PAGE = 1;
const PAGE_SIZE = 50;
let SELECTED_IDS = new Set();

const EDITABLE_FIELDS = ['No','NIK','Nama','RT','RW','JenisKelamin','TempatLahir','TanggalLahir',
  'StatusPerkawinan','Agama','Pendidikan','Pekerjaan','KedudukanKeluarga','GolonganDarah',
  'Kewarganegaraan','Alamat','NamaAyah','NamaIbu','NoKK','Suku','TglKawin','CatatanImpor'];

// ============================================================================
// API HELPER
// ============================================================================
async function api(action, payload) {
  if (!API_URL || API_URL.indexOf('TEMPEL_URL_WEB_APP') !== -1) {
    Toast.error('API_URL belum diisi di script.js — lihat README.md.');
    throw new Error('API_URL belum diisi');
  }
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action, token: TOKEN }, payload || {})),
  });
  const data = await res.json();
  if (!data.ok && data.error === 'unauthorized') {
    doLogout(true);
  }
  return data;
}

// ============================================================================
// LOGIN
// ============================================================================
const loginScreen = document.getElementById('loginScreen');
const appEl = document.getElementById('app');

function showApp() {
  loginScreen.style.display = 'none';
  appEl.classList.add('is-active');
  loadStatistik();
}
function showLogin() {
  appEl.classList.remove('is-active');
  loginScreen.style.display = 'flex';
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = document.getElementById('pinInput').value.trim();
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  errEl.textContent = '';
  if (!pin) return;
  btn.disabled = true; btn.textContent = 'Memeriksa…';
  try {
    const res = await api('adminLogin', { pin });
    if (res.ok) {
      TOKEN = res.token;
      sessionStorage.setItem('pdk_token', TOKEN);
      showApp();
    } else {
      const map = {
        wrong_pin: 'PIN salah.',
        locked_out: 'Terlalu banyak percobaan salah. Coba lagi dalam beberapa menit.',
        admin_not_configured: 'PIN admin belum diatur — buka Google Sheets, menu "Data Penduduk" > "Atur / ganti PIN admin…".',
      };
      errEl.textContent = map[res.error] || 'Gagal masuk.';
    }
  } catch (err) {
    errEl.textContent = 'Tidak bisa menghubungi server. Periksa API_URL dan koneksi internet.';
  } finally {
    btn.disabled = false; btn.textContent = 'Masuk';
  }
});

function doLogout(silent) {
  if (!silent) api('adminLogout', {}).catch(() => {});
  TOKEN = '';
  sessionStorage.removeItem('pdk_token');
  showLogin();
  if (silent) Toast.info('Sesi berakhir, silakan masuk kembali.');
}
document.getElementById('logoutBtn').addEventListener('click', () => doLogout(false));

if (TOKEN) showApp();

// ============================================================================
// NAVIGASI SIDEBAR
// ============================================================================
const pageTitles = {
  statistik: ['Statistik', 'Ringkasan data penduduk saat ini'],
  data: ['Data Penduduk', 'Cari, tambah, ubah, dan kelola data warga'],
  pengurus: ['Pengurus RW/RT', 'Susunan pengurus Rukun Warga dan Rukun Tetangga'],
  profil: ['Profil Wilayah', 'Identitas wilayah, legalitas, dan cakupan data'],
  impor: ['Impor Data', 'Masukkan data dari file sumber atau CSV'],
};
document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item[data-page]').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const page = btn.dataset.page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('is-active'));
    document.getElementById('page-' + page).classList.add('is-active');
    document.getElementById('pageTitle').textContent = pageTitles[page][0];
    document.getElementById('pageSub').textContent = pageTitles[page][1];
    document.getElementById('sidebar').classList.remove('is-open');
    document.getElementById('sidebarScrim').classList.remove('is-active');
    if (page === 'statistik') loadStatistik();
    if (page === 'data' && ALL_ITEMS.length === 0) loadData();
    if (page === 'pengurus') loadPengurus();
    if (page === 'profil') loadProfil();
  });
});
document.getElementById('menuToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('is-open');
  document.getElementById('sidebarScrim').classList.toggle('is-active');
});
document.getElementById('sidebarScrim').addEventListener('click', () => {
  document.getElementById('sidebar').classList.remove('is-open');
  document.getElementById('sidebarScrim').classList.remove('is-active');
});
document.getElementById('refreshBtn').addEventListener('click', () => {
  const activePage = document.querySelector('.nav-item.is-active').dataset.page;
  if (activePage === 'statistik') loadStatistik();
  else if (activePage === 'pengurus') loadPengurus();
  else if (activePage === 'profil') loadProfil();
  else loadData();
});

// ============================================================================
// STATISTIK
// ============================================================================
async function loadStatistik() {
  const res = await api('adminStats', {});
  if (!res.ok) { Toast.error('Gagal memuat statistik.'); return; }

  const cardsEl = document.getElementById('statCards');
  const card = (l, v, h, w) => `<div class="stat-card ${w ? 'warn' : ''}"><div class="label">${l}</div><div class="value">${v}</div>${h ? `<div class="hint">${h}</div>` : ''}</div>`;
  cardsEl.innerHTML = card('Total Penduduk', res.total) + card('Total KK', res.totalKK, res.kkDariNoKK ? 'berdasarkan No. KK' : 'dihitung dari Kepala Keluarga') +
    card('Nama Belum Diisi', res.belumAdaNama, res.total ? Math.round(res.belumAdaNama / res.total * 100) + '% dari total' : '', res.belumAdaNama) + card('Perlu Review', res.butuhReview, '', res.butuhReview) +
    `<div class="stat-card"><div class="label">Cakupan Data</div><div class="value">${Math.round(res.total / PROFIL.target * 100)}%</div><div class="bar"><i style="width:${Math.min(100, res.total / PROFIL.target * 100)}%"></i></div><div class="hint">${res.total} dari perkiraan ${PROFIL.target.toLocaleString('id-ID')} jiwa</div></div>`;

  drawChart('chartRT', 'bar', res.perRT, '#1D4E89');
  drawChart('chartGender', 'doughnut', res.perGender, ['#1D4E89', '#D9822B', '#D0D5DD']);
  drawChart('chartUsia', 'bar', res.perUsiaGroup, '#3B7DD8');
  drawChart('chartPendidikan', 'bar', res.perPendidikan.slice(0, 8), '#5B6B8C');
  drawChart('chartAgama', 'doughnut', res.perAgama.slice(0, 8), PAL);
  drawChart('chartKedudukan', 'bar', res.perKedudukan.slice(0, 8), '#2B8A8A');
}

const PAL = ['#1D4E89','#3B7DD8','#2B8A8A','#D9822B','#5B6B8C','#9DB7D9','#98A2B3','#D0D5DD'];
function drawChart(canvasId, type, list, colors) {
  const el = document.getElementById(canvasId);
  if (CHARTS[canvasId]) CHARTS[canvasId].destroy();
  if (!list || !list.length) return;
  const labels = list.map(x => x.label);
  const data = list.map(x => x.jumlah);
  const palette = Array.isArray(colors) ? colors : labels.map((_, i) => colors);
  CHARTS[canvasId] = new Chart(el, {
    type,
    data: {
      labels,
      datasets: [{ data, backgroundColor: Array.isArray(colors) ? colors : labels.map(() => colors) }],
    },
    options: {
      responsive: true, borderRadius: 4,
      plugins: { legend: { display: type === 'doughnut', position: 'bottom', labels: { boxWidth: 10, font: { family: 'Inter', size: 12 } } } },
      scales: type === 'bar' ? { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#F2F4F7' } }, x: { grid: { display: false } } } : undefined,
    },
  });
}

// ============================================================================
// DATA PENDUDUK — LIST / FILTER / TABEL
// ============================================================================
async function loadData() {
  document.getElementById('tableBody').innerHTML = `<tr><td colspan="20" class="empty-state">Memuat data…</td></tr>`;
  const res = await api('adminList', {});
  if (!res.ok) { Toast.error('Gagal memuat data.'); return; }
  ALL_ITEMS = res.items;
  populateFilters();
  applyFilters();
}

const FILTERS = {
  fRT: it => String(it.RT || '').trim(), fRW: it => String(it.RW || '').trim(), fJK: it => it.JenisKelamin || '',
  fUsia: it => usiaGroup(calcUsia(it.TanggalLahir)), fPend: it => String(it.Pendidikan || '').trim(),
  fAgama: it => String(it.Agama || '').trim(), fKed: it => String(it.KedudukanKeluarga || '').trim(),
  fLengkap: it => [!String(it.Nama || '').trim() && 'Nama belum diisi', !String(it.RT || '').trim() && 'RT belum diisi', String(it.CatatanImpor || '').trim() && 'Perlu review'].filter(Boolean),
};
const FILTER_LABEL = { fRT: 'RT', fRW: 'RW', fUsia: 'Usia' };
function usiaGroup(u) { return u === '' ? '' : u <= 4 ? '0-4' : u <= 14 ? '5-14' : u <= 24 ? '15-24' : u <= 54 ? '25-54' : u <= 64 ? '55-64' : '65+'; }
function vals(id, it) { const v = FILTERS[id](it); return Array.isArray(v) ? v : [v]; }
function populateFilters() {
  Object.keys(FILTERS).forEach(id => {
    const el = document.getElementById(id), cur = el.value;
    const opts = id === 'fUsia' ? ['0-4', '5-14', '15-24', '25-54', '55-64', '65+'] : id === 'fLengkap' ? ['Nama belum diisi', 'RT belum diisi', 'Perlu review'] :
      Array.from(new Set(ALL_ITEMS.flatMap(it => vals(id, it)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
    el.innerHTML = '<option value="">Semua</option>' + opts.map(o => `<option value="${escAttr(o)}">${escHtml((FILTER_LABEL[id] ? FILTER_LABEL[id] + ' ' : '') + o)}</option>`).join('');
    el.value = opts.indexOf(cur) !== -1 ? cur : '';
  });
}
function applyFilters() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const act = Object.keys(FILTERS).filter(id => document.getElementById(id).value);
  FILTERED_ITEMS = ALL_ITEMS.filter(it => act.every(id => vals(id, it).indexOf(document.getElementById(id).value) !== -1) && (!q || Object.values(it).join(' ').toLowerCase().indexOf(q) !== -1));
  const badge = document.getElementById('fCount'); badge.textContent = act.length; badge.style.display = act.length ? '' : 'none';
  document.getElementById('chips').innerHTML = act.map(id => `<button class="chip" data-f="${id}">${escHtml((FILTER_LABEL[id] ? FILTER_LABEL[id] + ' ' : '') + document.getElementById(id).value)}<svg class="i"><use href="#i-x"/></svg></button>`).join('');
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { document.getElementById(c.dataset.f).value = ''; applyFilters(); }));
  PAGE = 1;
  renderTable();
}
Object.keys(FILTERS).forEach(id => document.getElementById(id).addEventListener('change', applyFilters));
document.getElementById('searchInput').addEventListener('input', debounce(applyFilters, 220));
document.getElementById('filterToggle').addEventListener('click', () => document.getElementById('filterPanel').classList.toggle('is-open'));
document.getElementById('filterReset').addEventListener('click', () => { Object.keys(FILTERS).forEach(id => document.getElementById(id).value = ''); document.getElementById('searchInput').value = ''; applyFilters(); });

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function calcUsia(tglLahir) {
  if (!tglLahir) return '';
  const parts = String(tglLahir).split('/');
  if (parts.length !== 3) return '';
  const d = parseInt(parts[0], 10), m = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
  if (!d || !m || !y) return '';
  const birth = new Date(y, m - 1, d);
  if (isNaN(birth.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if ((now.getMonth() < birth.getMonth()) || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  return age;
}

function renderTable() {
  document.getElementById('resultCount').textContent = FILTERED_ITEMS.length + ' data ditemukan';
  const start = (PAGE - 1) * PAGE_SIZE;
  const pageItems = FILTERED_ITEMS.slice(start, start + PAGE_SIZE);
  const tbody = document.getElementById('tableBody');

  const I = n => `<svg class="i"><use href="#i-${n}"/></svg>`, dash = v => escHtml(v) || '<span class="mute">-</span>';
  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="20"><div class="empty-state">${I('users')}<div>Tidak ada data yang cocok dengan filter.</div></div></td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(it => {
      const usia = calcUsia(it.TanggalLahir), catatan = String(it.CatatanImpor || '').trim();
      const st = String(it.StatusPerkawinan || '').trim();
      return `<tr data-id="${escAttr(it.ID)}"><td class="checkbox-cell"><input type="checkbox" class="rowcheck" ${SELECTED_IDS.has(it.ID) ? 'checked' : ''}></td>
        <td class="cell-nama"><strong>${escHtml(it.Nama) || '<span class="mute">Belum diisi</span>'}</strong><small>${escHtml(it.NIK)}</small></td>
        <td>${dash(it.NoKK)}</td><td>${it.RT || it.RW ? escHtml(it.RT || '-') + '/' + escHtml(it.RW || '-') : '<span class="mute">-</span>'}</td>
        <td>${it.JenisKelamin === 'Laki-Laki' ? 'L' : it.JenisKelamin === 'Perempuan' ? 'P' : '<span class="mute">-</span>'}</td>
        <td>${dash(it.TempatLahir)}</td><td>${dash(it.TanggalLahir)}</td><td>${usia !== '' ? usia + ' th' : '<span class="mute">-</span>'}</td>
        <td>${dash(st)}</td><td>${dash(it.KedudukanKeluarga)}</td><td>${dash(it.Agama)}</td><td>${dash(it.Suku)}</td><td>${dash(it.Pendidikan)}</td><td>${dash(it.Pekerjaan)}</td><td>${dash(it.GolonganDarah)}</td>
        <td>${dash(it.NamaAyah)}</td><td>${dash(it.NamaIbu)}</td><td title="${escAttr(it.Alamat)}">${truncate(it.Alamat, 30)}</td>
        <td>${catatan ? `<span class="pill pill-amber" title="${escAttr(catatan)}">Perlu review</span>` : ''}</td>
        <td><div class="row-actions"><button class="icon-btn edit-btn" title="Ubah">${I('edit')}</button><button class="icon-btn danger delete-btn" title="Hapus">${I('trash')}</button></div></td></tr>`;
    }).join('');
  }

  document.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', (e) => openEdit(e.currentTarget.closest('tr').dataset.id)));
  document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', (e) => confirmDelete(e.currentTarget.closest('tr').dataset.id)));
  document.querySelectorAll('.rowcheck').forEach(cb => cb.addEventListener('change', (e) => {
    const id = e.target.closest('tr').dataset.id;
    if (e.target.checked) SELECTED_IDS.add(id); else SELECTED_IDS.delete(id);
    updateBulkBar();
  }));

  const totalPages = Math.max(1, Math.ceil(FILTERED_ITEMS.length / PAGE_SIZE));
  document.getElementById('pageInfo').textContent = `Halaman ${PAGE} dari ${totalPages} (${FILTERED_ITEMS.length} data)`;
  document.getElementById('prevPageBtn').disabled = PAGE <= 1;
  document.getElementById('nextPageBtn').disabled = PAGE >= totalPages;
  document.getElementById('checkAll').checked = pageItems.length > 0 && pageItems.every(it => SELECTED_IDS.has(it.ID));
}

document.getElementById('prevPageBtn').addEventListener('click', () => { if (PAGE > 1) { PAGE--; renderTable(); } });
document.getElementById('nextPageBtn').addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(FILTERED_ITEMS.length / PAGE_SIZE));
  if (PAGE < totalPages) { PAGE++; renderTable(); }
});
document.getElementById('checkAll').addEventListener('change', (e) => {
  const start = (PAGE - 1) * PAGE_SIZE;
  const pageItems = FILTERED_ITEMS.slice(start, start + PAGE_SIZE);
  pageItems.forEach(it => { if (e.target.checked) SELECTED_IDS.add(it.ID); else SELECTED_IDS.delete(it.ID); });
  renderTable();
  updateBulkBar();
});

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  bar.style.display = SELECTED_IDS.size > 0 ? 'flex' : 'none';
  document.getElementById('bulkCount').textContent = SELECTED_IDS.size + ' baris dipilih';
}
document.getElementById('bulkClearBtn').addEventListener('click', () => { SELECTED_IDS.clear(); renderTable(); updateBulkBar(); });
document.getElementById('bulkApplyBtn').addEventListener('click', async () => {
  const field = document.getElementById('bulkFieldSelect').value;
  const value = document.getElementById('bulkValueInput').value.trim();
  if (!value) { Toast.error('Isi nilai baru dulu.'); return; }
  if (!SELECTED_IDS.size) return;
  const res = await api('adminBulkSetField', { ids: Array.from(SELECTED_IDS), field, value });
  if (res.ok) {
    Toast.success(`${res.jumlah} baris diperbarui.`);
    document.getElementById('bulkValueInput').value = '';
    SELECTED_IDS.clear();
    updateBulkBar();
    await loadData();
  } else {
    Toast.error('Gagal memperbarui: ' + (res.error || ''));
  }
});

function escHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(v) { return escHtml(v); }
function truncate(v, n) {
  const s = String(v || '');
  return s.length > n ? escHtml(s.slice(0, n)) + '…' : escHtml(s);
}

// ============================================================================
// TAMBAH / UBAH (MODAL)
// ============================================================================
const formModal = document.getElementById('formModal');
function openModal() { formModal.classList.add('is-active'); }
function closeModal() { formModal.classList.remove('is-active'); }
document.getElementById('formModalClose').addEventListener('click', closeModal);
document.getElementById('formCancelBtn').addEventListener('click', closeModal);
formModal.addEventListener('click', (e) => { if (e.target === formModal) closeModal(); });

document.getElementById('preparedCount').textContent = PREPARED_IMPORT_DATA.length;
document.getElementById('addBtn').addEventListener('click', () => {
  document.getElementById('itemForm').reset();
  document.getElementById('f_id').value = '';
  document.getElementById('formModalTitle').textContent = 'Tambah Warga';
  openModal();
});

function openEdit(id) {
  const item = ALL_ITEMS.find(it => it.ID === id);
  if (!item) return;
  document.getElementById('f_id').value = item.ID;
  EDITABLE_FIELDS.forEach(f => {
    const el = document.getElementById('f_' + f);
    if (el) el.value = item[f] || '';
  });
  document.getElementById('formModalTitle').textContent = 'Ubah Data Warga';
  openModal();
}

document.getElementById('formSaveBtn').addEventListener('click', async () => {
  const id = document.getElementById('f_id').value;
  const item = {};
  EDITABLE_FIELDS.forEach(f => { item[f] = document.getElementById('f_' + f).value.trim(); });
  if (!item.Nama && !item.NIK) { Toast.error('Isi minimal Nama atau NIK.'); return; }

  const btn = document.getElementById('formSaveBtn');
  btn.disabled = true; btn.textContent = 'Menyimpan…';
  try {
    const res = id ? await api('adminUpdate', { id, item }) : await api('adminAdd', { item });
    if (res.ok) {
      Toast.success(id ? 'Perubahan disimpan.' : 'Warga baru ditambahkan.');
      closeModal();
      await loadData();
    } else {
      Toast.error('Gagal menyimpan: ' + (res.error || ''));
    }
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan';
  }
});

function confirmDelete(id) {
  const item = ALL_ITEMS.find(it => it.ID === id);
  if (!confirm(`Hapus data "${item ? (item.Nama || item.NIK || '(tanpa nama)') : ''}"? Tindakan ini tidak bisa dibatalkan.`)) return;
  api('adminDelete', { id }).then(res => {
    if (res.ok) { Toast.success('Data dihapus.'); loadData(); }
    else Toast.error('Gagal menghapus: ' + (res.error || ''));
  });
}

// ============================================================================
// EKSPOR CSV
// ============================================================================
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const headers = EDITABLE_FIELDS;
  const rows = [headers.join(',')].concat(FILTERED_ITEMS.map(it => headers.map(h => csvCell(it[h])).join(',')));
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'data-penduduk.csv'; a.click();
  URL.revokeObjectURL(url);
});
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ============================================================================
// IMPOR DATA
// ============================================================================
document.getElementById('importPreparedBtn').addEventListener('click', async () => {
  if (!confirm(`Impor ${PREPARED_IMPORT_DATA.length} data yang sudah disiapkan?`)) return;
  const replaceAll = document.getElementById('importReplaceAll').checked;
  await runBulkImport(PREPARED_IMPORT_DATA, replaceAll);
});

document.getElementById('importCsvBtn').addEventListener('click', async () => {
  const text = document.getElementById('csvPasteArea').value.trim();
  if (!text) { Toast.error('Tempel CSV dulu.'); return; }
  let items;
  try {
    items = parseCsv(text);
  } catch (err) {
    Toast.error('Gagal membaca CSV: ' + err.message);
    return;
  }
  if (!items.length) { Toast.error('Tidak ada baris data ditemukan.'); return; }
  const replaceAll = document.getElementById('importReplaceAllB').checked;
  await runBulkImport(items, replaceAll);
});

async function runBulkImport(items, replaceAll) {
  Toast.info('Mengimpor ' + items.length + ' baris…');
  const CHUNK = 150;
  let done = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const res = await api('adminBulkAdd', { items: chunk, replaceAll: replaceAll && i === 0 });
    if (!res.ok) { Toast.error('Impor terhenti: ' + (res.error || '')); return; }
    done += res.jumlah;
  }
  Toast.success(done + ' baris berhasil diimpor.');
  loadData();
  loadStatistik();
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error('minimal butuh baris header + 1 baris data');
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (cells[i] || '').trim(); });
    return obj;
  });
}
function splitCsvLine(line) {
  const out = []; let cur = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

document.getElementById('wipeAllBtn').addEventListener('click', async () => {
  if (!confirm('Yakin hapus SEMUA data penduduk? Tindakan ini tidak bisa dibatalkan.')) return;
  if (!confirm('Konfirmasi sekali lagi: benar-benar hapus semua data?')) return;
  const res = await api('adminBulkDelete', {});
  if (res.ok) { Toast.success('Semua data dihapus.'); loadData(); loadStatistik(); }
  else Toast.error('Gagal menghapus: ' + (res.error || ''));
});

// ============================================================================
// PROFIL WILAYAH (sumber: sheet HOME, MODEL E, PROFIL, LAMPID, AGAMA)
// ============================================================================
const PROFIL = {
  target: 1912,
  identitas: [['Rukun Warga', '16'], ['Kelurahan', 'Sekeloa'], ['Kecamatan', 'Coblong'], ['Kota', 'Bandung'], ['Keadaan bulan', 'Agustus 2025'], ['Jumlah RT', '5 (RT 01 - RT 05)']],
  legalitas: [['SK pengesahan dari', 'Lurah Sekeloa'], ['Nomor SK', '087 Tahun 2023'], ['Tanggal SK', '10 Januari 2023']],
  kelurahan: [['Jumlah RT', '5'], ['Jumlah UMPI', '130'], ['Jumlah penduduk', '1.169 jiwa'], ['Periode laporan', 'Desember 2023']],
};
function loadProfil() {
  const box = (t, rows, note) => `<div class="chart-card" style="padding:0"><h3 style="padding:16px 20px 0;margin:0">${t}</h3><div class="kv">${rows.map(r => `<div><span>${r[0]}</span><b>${escHtml(r[1])}</b></div>`).join('')}</div>${note ? `<p class="hint" style="padding:0 20px 16px;margin:0;color:var(--mute);font-size:12px">${note}</p>` : ''}</div>`;
  const total = ALL_ITEMS.length;
  const items = ALL_ITEMS, cnt = f => items.filter(f).length;
  const lengkap = [['Nama terisi', cnt(i => i.Nama)], ['RT terisi', cnt(i => i.RT)], ['Agama terisi', cnt(i => i.Agama)], ['Pekerjaan terisi', cnt(i => i.Pekerjaan)], ['No. KK terisi', cnt(i => i.NoKK)]]
    .map(r => [r[0], total ? r[1] + ' dari ' + total + ' (' + Math.round(r[1] / total * 100) + '%)' : 'muat data dulu']);
  document.getElementById('profilGrid').innerHTML = box('Identitas Wilayah', PROFIL.identitas) + box('Legalitas Kepengurusan RW', PROFIL.legalitas) +
    box('Laporan Kelurahan', PROFIL.kelurahan, 'Angka acuan dari sheet AGAMA dan LAMPID (Desember 2023).') + box('Kelengkapan Data Penduduk', lengkap, 'Target perkiraan ' + PROFIL.target.toLocaleString('id-ID') + ' jiwa (sheet PROFIL).');
  if (!ALL_ITEMS.length) loadData().then(loadProfil);
}

// ============================================================================
// PENGURUS RW / RT
// ============================================================================
let PENGURUS = [];
const PENGURUS_SEED = (function () {
  const rt = [['01', 'UNDANG HIDAYAT', 'NUR ANNISA ALIANI', 'IMAS MINJUARSIH'], ['02', 'DASE', 'RISKA ASTUTI', 'I. DIMYATI'], ['03', 'AHMAD HAFID HIDAYAT', 'ANGGA PERMANA', 'YUNI RUSTIANI'], ['04', 'YADI LISTIADI', 'ANDRI SUPRIATNA', 'TOTO'], ['05', 'DANI LUKMAN', 'SRI BUDIYATI', 'LINDA QODARIAH']];
  const out = [];
  ['Ketua', 'Sekretaris', 'Bendahara'].forEach(j => out.push({ Unit: 'RW 16', Jabatan: j, Nama: '', Kontak: '', Periode: '' }));
  rt.forEach(r => ['Ketua', 'Sekretaris', 'Bendahara'].forEach((j, k) => out.push({ Unit: 'RT ' + r[0], Jabatan: j, Nama: r[k + 1], Kontak: '', Periode: '' })));
  return out;
})();
async function loadPengurus() {
  const res = await api('pengurusList', {});
  if (!res.ok) { Toast.error('Gagal memuat pengurus.'); return; }
  PENGURUS = res.items;
  document.getElementById('pgSeedBtn').style.display = PENGURUS.length ? 'none' : '';
  const sel = document.getElementById('pgUnit'), cur = sel.value;
  const units = Array.from(new Set(PENGURUS.map(p => p.Unit))).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
  sel.innerHTML = '<option value="">Semua unit</option>' + units.map(u => `<option>${escHtml(u)}</option>`).join('');
  sel.value = units.indexOf(cur) !== -1 ? cur : '';
  renderPengurus();
}
function renderPengurus() {
  const q = document.getElementById('pgSearch').value.trim().toLowerCase(), u = document.getElementById('pgUnit').value;
  const list = PENGURUS.filter(p => (!u || p.Unit === u) && (!q || (p.Nama + ' ' + p.Jabatan + ' ' + p.Unit).toLowerCase().indexOf(q) !== -1));
  const kosong = PENGURUS.filter(p => !String(p.Nama).trim()).length;
  document.getElementById('pgStats').innerHTML = `<div class="stat-card"><div class="label">Total Pengurus</div><div class="value">${PENGURUS.length - kosong}</div></div><div class="stat-card"><div class="label">Unit</div><div class="value">${new Set(PENGURUS.map(p => p.Unit)).size}</div></div><div class="stat-card ${kosong ? 'warn' : ''}"><div class="label">Jabatan Belum Terisi</div><div class="value">${kosong}</div></div>`;
  const groups = {};
  list.forEach(p => (groups[p.Unit] = groups[p.Unit] || []).push(p));
  const order = ['Ketua', 'Sekretaris', 'Bendahara'];
  document.getElementById('pgGrid').innerHTML = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'id', { numeric: true })).map(k =>
    `<div class="pg-card"><h3>${escHtml(k)}<span class="count">${groups[k].length} jabatan</span></h3>` + groups[k].sort((a, b) => order.indexOf(a.Jabatan) - order.indexOf(b.Jabatan)).map(p =>
      `<div class="pg-row" data-id="${escAttr(p.ID)}"><div><small>${escHtml(p.Jabatan)}${p.Periode ? ' - ' + escHtml(p.Periode) : ''}</small><b>${escHtml(p.Nama) || '<span class="mute">Belum diisi</span>'}</b>${p.Kontak ? `<small>${escHtml(p.Kontak)}</small>` : ''}</div><svg class="i mute"><use href="#i-edit"/></svg></div>`).join('') + '</div>').join('') ||
    `<div class="empty-state" style="grid-column:1/-1"><svg class="i"><use href="#i-users"/></svg><div>Belum ada data pengurus.</div></div>`;
  document.querySelectorAll('.pg-row').forEach(r => r.addEventListener('click', () => openPengurus(r.dataset.id)));
}
['pgSearch'].forEach(id => document.getElementById(id).addEventListener('input', debounce(renderPengurus, 200)));
document.getElementById('pgUnit').addEventListener('change', renderPengurus);
const pgModal = document.getElementById('pgModal'), PGF = ['Unit', 'Jabatan', 'Nama', 'Kontak', 'Periode'];
function openPengurus(id) {
  const p = PENGURUS.find(x => x.ID === id) || {};
  document.getElementById('pg_id').value = p.ID || '';
  PGF.forEach(f => document.getElementById('pg_' + f).value = p[f] || '');
  document.getElementById('pgModalTitle').textContent = p.ID ? 'Ubah Pengurus' : 'Tambah Pengurus';
  document.getElementById('pgDelBtn').style.display = p.ID ? '' : 'none';
  pgModal.classList.add('is-active');
}
const closePg = () => pgModal.classList.remove('is-active');
document.getElementById('pgAddBtn').addEventListener('click', () => openPengurus(''));
document.getElementById('pgModalClose').addEventListener('click', closePg);
document.getElementById('pgCancelBtn').addEventListener('click', closePg);
document.getElementById('pgSaveBtn').addEventListener('click', async () => {
  const item = {}; PGF.forEach(f => item[f] = document.getElementById('pg_' + f).value.trim());
  if (!item.Unit || !item.Jabatan) { Toast.error('Unit dan Jabatan wajib diisi.'); return; }
  const res = await api('pengurusSave', { id: document.getElementById('pg_id').value, item });
  if (res.ok) { Toast.success('Pengurus disimpan.'); closePg(); loadPengurus(); } else Toast.error('Gagal menyimpan: ' + (res.error || ''));
});
document.getElementById('pgDelBtn').addEventListener('click', async () => {
  if (!confirm('Hapus data pengurus ini?')) return;
  const res = await api('pengurusDelete', { id: document.getElementById('pg_id').value });
  if (res.ok) { Toast.success('Data dihapus.'); closePg(); loadPengurus(); } else Toast.error('Gagal menghapus.');
});
document.getElementById('pgSeedBtn').addEventListener('click', async () => {
  if (!confirm('Muat 18 jabatan (RW 16 dan RT 01-05) dari sheet PROFIL Excel?')) return;
  const res = await api('pengurusBulkAdd', { items: PENGURUS_SEED });
  if (res.ok) { Toast.success(res.jumlah + ' jabatan dimuat.'); loadPengurus(); } else Toast.error('Gagal memuat.');
});
