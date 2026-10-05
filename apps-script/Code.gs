/**
 * ============================================================================
 *  DASHBOARD DATA PENDUDUK — BACKEND GOOGLE APPS SCRIPT (v1)
 * ============================================================================
 *  Fungsi file ini: menyimpan & menyajikan Data Penduduk (per jiwa) di Google
 *  Sheets sebagai "database", dan menyediakan API login + CRUD yang dipakai
 *  oleh dashboard admin (index.html + script.js) — supaya pengurus bisa
 *  mengelola data dari browser biasa tanpa membuka Google Sheets langsung.
 *
 *  Pola keamanan & struktur SENGAJA disamakan dengan proyek "Portal RW 01
 *  Bukanagara" (cms/Code.gs) supaya familiar kalau Anda sudah pernah pakai:
 *  - PIN admin disimpan sebagai hash SHA-256 di Script Properties.
 *  - Lockout otomatis setelah 5x percobaan PIN salah (5 menit).
 *  - Sesi login pakai token sementara (2 jam), bukan PIN dikirim ulang.
 *  - Semua aksi tambah/ubah/hapus/impor dicatat di sheet AuditLog.
 *  - Kunci baris (LockService) saat tulis, supaya aman dipakai beberapa
 *    admin sekaligus.
 *
 *  CATATAN PENTING soal data pribadi:
 *  Sheet ini berisi data pribadi warga (termasuk NIK). JANGAN atur akses
 *  "Anyone" di Google Sheets-nya sendiri (hanya Web App-nya yang perlu
 *  "Anyone" supaya bisa diakses dashboard — itu pun HANYA merespons kalau
 *  ada PIN & token yang valid). Jangan bagikan PIN admin ke luar pengurus.
 *
 *  Cara pakai (lihat juga README.md):
 *  1. Buat Google Sheet BARU (kosong).
 *  2. Extensions > Apps Script, hapus isi default, tempel SELURUH isi file
 *     ini, simpan (Ctrl+S / ikon disket).
 *  3. Kembali ke Google Sheets, reload halaman — menu "Data Penduduk"
 *     akan muncul di menu bar.
 *  4. Klik "Siapkan sheet Penduduk".
 *  5. Klik "Atur / ganti PIN admin…" dan isi PIN (minimal 6 karakter).
 *  6. Deploy > New deployment > Web app (Execute as: Me, Who has access:
 *     Anyone). Salin URL yang diakhiri `/exec`.
 *  7. Tempel URL itu sebagai API_URL di file `script.js` (folder dashboard).
 * ============================================================================
 */

// ============================================================================
// KONFIGURASI
// ============================================================================
const SHEET_PENDUDUK = 'Penduduk';
const SHEET_AUDIT     = 'AuditLog';

const ADMIN_MAX_FAILED_ATTEMPTS = 5;
const ADMIN_LOCKOUT_SEC = 300;     // 5 menit
const SESSION_TTL_SEC   = 7200;    // 2 jam

// Header sheet Penduduk. Kolom "ID" & "DiperbaruiPada" dikelola otomatis
// oleh backend — jangan diubah/dihapus manual dari Sheets.
const HEADERS_PENDUDUK = [
  'ID', 'No', 'NIK', 'Nama', 'RT', 'RW', 'JenisKelamin', 'TempatLahir',
  'TanggalLahir', 'StatusPerkawinan', 'Agama', 'Pendidikan', 'Pekerjaan',
  'KedudukanKeluarga', 'GolonganDarah', 'Kewarganegaraan', 'Alamat',
  'NamaAyah', 'NamaIbu', 'NoKK', 'Suku', 'TglKawin', 'CatatanImpor', 'DiperbaruiPada',
];

// Field yang boleh diisi lewat form tambah/ubah (urutan = urutan kolom
// setelah ID). "DiperbaruiPada" tidak masuk sini karena diisi otomatis.
const EDITABLE_FIELDS = HEADERS_PENDUDUK.slice(1, -1);

const NUMERIC_FIELDS_ = ['No'];

// ============================================================================
// MENU DI GOOGLE SHEETS
// ============================================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Data Penduduk')
    .addItem('Siapkan sheet Penduduk', 'setupSheet')
    .addItem('Atur / ganti PIN admin…', 'menuSetAdminPin_')
    .addSeparator()
    .addItem('Info status sistem', 'menuSystemInfo_')
    .addToUi();
}

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_PENDUDUK);
  if (!sh) sh = ss.insertSheet(SHEET_PENDUDUK);
  const current = sh.getRange(1, 1, 1, HEADERS_PENDUDUK.length).getValues()[0];
  const matches = HEADERS_PENDUDUK.every((h, i) => current[i] === h);
  if (!matches) {
    sh.getRange(1, 1, 1, HEADERS_PENDUDUK.length).setValues([HEADERS_PENDUDUK]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  ensureAuditSheet_(ss);
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  SpreadsheetApp.getUi().alert('Selesai. Sheet "Penduduk" & "AuditLog" sudah siap. Lanjut atur PIN admin lewat menu ini, lalu deploy sebagai Web App.');
}

function ensureAuditSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_AUDIT);
  if (!sh) {
    sh = ss.insertSheet(SHEET_AUDIT);
    sh.appendRow(['Waktu', 'Aksi', 'Detail']);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function menuSetAdminPin_() {
  const ui = SpreadsheetApp.getUi();
  const r1 = ui.prompt('Atur PIN admin', 'Masukkan PIN baru (minimal 6 karakter):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const pin = r1.getResponseText().trim();
  if (pin.length < 6) { ui.alert('PIN terlalu pendek. Gunakan minimal 6 karakter.'); return; }
  const r2 = ui.prompt('Konfirmasi PIN', 'Masukkan ulang PIN yang sama:', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  if (r2.getResponseText().trim() !== pin) { ui.alert('PIN tidak cocok dengan konfirmasi. Coba lagi.'); return; }
  setAdminPinHash_(hashPin_(pin));
  ui.alert('PIN admin berhasil disimpan. PIN ini TIDAK tersimpan sebagai teks di kode program — hanya hash-nya.');
}

function menuSystemInfo_() {
  const ui = SpreadsheetApp.getUi();
  const pinConfigured = !!getAdminPinHash_();
  const lockState = checkAdminLockout_();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PENDUDUK);
  const jumlah = sh && sh.getLastRow() > 1 ? sh.getLastRow() - 1 : 0;
  ui.alert(
    'Status Dashboard Data Penduduk',
    [
      'PIN admin sudah diatur: ' + (pinConfigured ? 'Ya' : 'BELUM — atur lewat menu ini dulu'),
      'Status login admin: ' + (lockState.locked ? 'TERKUNCI sementara (terlalu banyak PIN salah)' : 'Normal'),
      'Jumlah baris data Penduduk saat ini: ' + jumlah,
    ].join('\n'),
    ui.ButtonSet.OK
  );
}

// ============================================================================
// ENTRY POINT WEB APP
// ============================================================================
function doGet(e) {
  return jsonOut_({ ok: false, error: 'use_post' });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { /* ignore */ }
  const action = body.action;
  try {
    let result;
    if (action === 'adminLogin')        result = adminLogin_(body.pin);
    else if (action === 'adminLogout')       result = adminLogout_(body.token);
    else if (action === 'adminList')         result = adminList_(body.token, body);
    else if (action === 'adminAdd')          result = adminAdd_(body.token, body.item);
    else if (action === 'adminUpdate')       result = adminUpdate_(body.token, body.id, body.item);
    else if (action === 'adminDelete')       result = adminDelete_(body.token, body.id);
    else if (action === 'adminBulkAdd')      result = adminBulkAdd_(body.token, body.items, body.replaceAll);
    else if (action === 'adminBulkSetField') result = adminBulkSetField_(body.token, body.ids, body.field, body.value);
    else if (action === 'adminBulkDelete')   result = adminBulkDeleteAll_(body.token);
    else if (action === 'adminStats')        result = adminStats_(body.token);
    else if (action === 'pengurusList')      result = pengurusList_(body.token);
    else if (action === 'pengurusSave')      result = pengurusSave_(body.token, body.id, body.item);
    else if (action === 'pengurusDelete')    result = pengurusDelete_(body.token, body.id);
    else if (action === 'pengurusBulkAdd')   result = pengurusBulkAdd_(body.token, body.items);
    else return jsonOut_({ ok: false, error: 'unknown_action' });
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'server_error', detail: String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// AUTENTIKASI
// ============================================================================
function hashPin_(pin) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin), Utilities.Charset.UTF_8);
  return raw.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
}
function getAdminPinHash_() {
  return PropertiesService.getScriptProperties().getProperty('PDK_ADMIN_PIN_HASH') || '';
}
function setAdminPinHash_(hash) {
  PropertiesService.getScriptProperties().setProperty('PDK_ADMIN_PIN_HASH', hash);
}

function checkAdminLockout_() {
  const cache = CacheService.getScriptCache();
  const until = Number(cache.get('pdk_admin_lock_until') || 0);
  if (until && Date.now() < until) return { locked: true, until };
  return { locked: false };
}
function registerFailedAdminAttempt_() {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get('pdk_admin_fail_count') || 0) + 1;
  cache.put('pdk_admin_fail_count', String(count), ADMIN_LOCKOUT_SEC);
  if (count >= ADMIN_MAX_FAILED_ATTEMPTS) {
    cache.put('pdk_admin_lock_until', String(Date.now() + ADMIN_LOCKOUT_SEC * 1000), ADMIN_LOCKOUT_SEC);
  }
}
function clearAdminFailedAttempts_() {
  const cache = CacheService.getScriptCache();
  cache.remove('pdk_admin_fail_count');
  cache.remove('pdk_admin_lock_until');
}

function adminLogin_(pin) {
  const configuredHash = getAdminPinHash_();
  if (!configuredHash) {
    logAudit_('admin_login_not_configured', {});
    return { ok: false, error: 'admin_not_configured' };
  }
  const lockState = checkAdminLockout_();
  if (lockState.locked) {
    logAudit_('admin_login_locked_out', {});
    return { ok: false, error: 'locked_out' };
  }
  if (!pin || hashPin_(pin) !== configuredHash) {
    registerFailedAdminAttempt_();
    logAudit_('admin_login_failed', {});
    return { ok: false, error: 'wrong_pin' };
  }
  clearAdminFailedAttempts_();
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('pdk_admintoken_' + token, '1', SESSION_TTL_SEC);
  logAudit_('admin_login_success', {});
  return { ok: true, token };
}

function checkAdmin_(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get('pdk_admintoken_' + token) === '1';
}

function adminLogout_(token) {
  if (token) CacheService.getScriptCache().remove('pdk_admintoken_' + token);
  logAudit_('admin_logout', {});
  return { ok: true };
}

// ============================================================================
// BACA / TULIS SHEET
// ============================================================================
function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PENDUDUK);
}

function readAll_() {
  const sh = getSheet_();
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(1, 1, sh.getLastRow(), HEADERS_PENDUDUK.length).getValues();
  const headers = values.shift();
  return values
    .filter(row => row.join('') !== '')
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] instanceof Date ? Utilities.formatDate(row[i], Session.getScriptTimeZone(), 'dd/MM/yyyy') : row[i]; });
      return obj;
    });
}

function sanitizeText_(v, maxLen) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

function buildRowValues_(item) {
  return EDITABLE_FIELDS.map(header => {
    const raw = item ? item[header] : '';
    if (NUMERIC_FIELDS_.indexOf(header) !== -1) {
      const cleaned = String(raw == null ? '' : raw).replace(/[^\d-]/g, '');
      if (!cleaned) return '';
      const n = parseInt(cleaned, 10);
      return isNaN(n) ? '' : n;
    }
    return sanitizeText_(raw, 500);
  });
}

// ============================================================================
// ADMIN — LIST / CRUD
// ============================================================================
function adminList_(token, params) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  const q = (params && params.q ? String(params.q) : '').trim().toLowerCase();
  const rt = (params && params.rt ? String(params.rt) : '').trim();
  const jk = (params && params.jk ? String(params.jk) : '').trim();

  let items = readAll_();

  if (rt) items = items.filter(it => String(it.RT || '').trim() === rt);
  if (jk) items = items.filter(it => String(it.JenisKelamin || '') === jk);
  if (q) {
    items = items.filter(it => Object.keys(it).some(k => {
      const v = it[k];
      return v != null && String(v).toLowerCase().indexOf(q) !== -1;
    }));
  }

  items.sort((a, b) => (Number(a.No) || 0) - (Number(b.No) || 0));
  return { ok: true, items };
}

function adminAdd_(token, item) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  if (!item || !sanitizeText_(item.Nama) && !sanitizeText_(item.NIK)) {
    return { ok: false, error: 'nama_atau_nik_wajib_diisi' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = getSheet_();
    if (!sh) return { ok: false, error: 'sheet_not_found' };
    const id = Utilities.getUuid();
    const rowValues = buildRowValues_(item);
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    sh.appendRow([id].concat(rowValues, [now]));
    logAudit_('admin_add', { id, nama: sanitizeText_(item.Nama, 80) });
    return { ok: true, id };
  } finally {
    lock.releaseLock();
  }
}

function findRowById_(sh, id) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function adminUpdate_(token, id, item) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  if (!id) return { ok: false, error: 'id_wajib_diisi' };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = getSheet_();
    if (!sh) return { ok: false, error: 'sheet_not_found' };
    const rowNum = findRowById_(sh, id);
    if (rowNum === -1) return { ok: false, error: 'not_found' };
    const rowValues = buildRowValues_(item);
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    sh.getRange(rowNum, 2, 1, rowValues.length).setValues([rowValues]);
    sh.getRange(rowNum, HEADERS_PENDUDUK.length).setValue(now);
    logAudit_('admin_update', { id, nama: sanitizeText_(item.Nama, 80) });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function adminDelete_(token, id) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  if (!id) return { ok: false, error: 'id_wajib_diisi' };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = getSheet_();
    if (!sh) return { ok: false, error: 'sheet_not_found' };
    const rowNum = findRowById_(sh, id);
    if (rowNum === -1) return { ok: false, error: 'not_found' };
    sh.deleteRow(rowNum);
    logAudit_('admin_delete', { id });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Tambah banyak baris sekaligus (dipakai fitur Impor Data). Kalau
// replaceAll true, semua baris lama dihapus dulu.
function adminBulkAdd_(token, items, replaceAll) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  if (!items || !items.length) return { ok: false, error: 'items_kosong' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = getSheet_();
    if (!sh) return { ok: false, error: 'sheet_not_found' };
    if (replaceAll && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    }
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    const rows = items.map(item => {
      const id = Utilities.getUuid();
      return [id].concat(buildRowValues_(item), [now]);
    });
    const startRow = sh.getLastRow() + 1;
    sh.getRange(startRow, 1, rows.length, HEADERS_PENDUDUK.length).setValues(rows);
    logAudit_('admin_bulk_add', { jumlah: rows.length, replaceAll: !!replaceAll });
    return { ok: true, jumlah: rows.length };
  } finally {
    lock.releaseLock();
  }
}

// Set satu field yang sama untuk banyak baris terpilih sekaligus — dipakai
// untuk melengkapi kolom RT/RW secara massal setelah impor (lihat README).
function adminBulkSetField_(token, ids, field, value) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  if (!ids || !ids.length) return { ok: false, error: 'ids_kosong' };
  if (EDITABLE_FIELDS.indexOf(field) === -1) return { ok: false, error: 'field_tidak_valid' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = getSheet_();
    if (!sh) return { ok: false, error: 'sheet_not_found' };
    const colIndex = HEADERS_PENDUDUK.indexOf(field) + 1; // 1-based
    const idColValues = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    const idSet = {};
    ids.forEach(id => { idSet[String(id)] = true; });
    let updated = 0;
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
    idColValues.forEach((row, i) => {
      if (idSet[String(row[0])]) {
        sh.getRange(i + 2, colIndex).setValue(value);
        sh.getRange(i + 2, HEADERS_PENDUDUK.length).setValue(now);
        updated++;
      }
    });
    logAudit_('admin_bulk_set_field', { field, value: sanitizeText_(value, 60), jumlah: updated });
    return { ok: true, jumlah: updated };
  } finally {
    lock.releaseLock();
  }
}

function adminBulkDeleteAll_(token) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = getSheet_();
    if (!sh) return { ok: false, error: 'sheet_not_found' };
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    logAudit_('admin_bulk_delete_all', {});
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// STATISTIK
// ============================================================================
function adminStats_(token) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  const items = readAll_();

  const perRT = {};
  const perGender = { 'Laki-Laki': 0, 'Perempuan': 0, '(belum diisi)': 0 };
  const perAgama = {};
  const perPendidikan = {};
  const perUsiaGroup = { '0-4': 0, '5-14': 0, '15-24': 0, '25-54': 0, '55-64': 0, '65+': 0, '(tidak diketahui)': 0 };
  const perKedudukan = {};
  let totalKK = 0;
  const kkSet = {};
  let butuhReview = 0;
  let belumAdaNama = 0;

  items.forEach(it => {
    const rt = String(it.RT || '').trim() || '(belum diisi)';
    perRT[rt] = (perRT[rt] || 0) + 1;

    const g = it.JenisKelamin === 'Laki-Laki' || it.JenisKelamin === 'Perempuan' ? it.JenisKelamin : '(belum diisi)';
    perGender[g] = (perGender[g] || 0) + 1;

    const agama = String(it.Agama || '').trim() || '(belum diisi)';
    perAgama[agama] = (perAgama[agama] || 0) + 1;

    const pend = String(it.Pendidikan || '').trim() || '(belum diisi)';
    perPendidikan[pend] = (perPendidikan[pend] || 0) + 1;

    const kedudukan = String(it.KedudukanKeluarga || '').trim() || '(belum diisi)';
    perKedudukan[kedudukan] = (perKedudukan[kedudukan] || 0) + 1;
    if (kedudukan === 'Kepala Keluarga') totalKK++;
    if (String(it.NoKK || '').trim()) kkSet[String(it.NoKK).trim()] = 1;

    const usia = parseUsiaFromTanggalLahir_(it.TanggalLahir);
    if (usia == null) perUsiaGroup['(tidak diketahui)']++;
    else if (usia <= 4) perUsiaGroup['0-4']++;
    else if (usia <= 14) perUsiaGroup['5-14']++;
    else if (usia <= 24) perUsiaGroup['15-24']++;
    else if (usia <= 54) perUsiaGroup['25-54']++;
    else if (usia <= 64) perUsiaGroup['55-64']++;
    else perUsiaGroup['65+']++;

    if (String(it.CatatanImpor || '').trim()) butuhReview++;
    if (!String(it.Nama || '').trim()) belumAdaNama++;
  });

  const toList = obj => Object.keys(obj).sort((a, b) => obj[b] - obj[a]).map(k => ({ label: k, jumlah: obj[k] }));

  return {
    ok: true,
    total: items.length,
    totalKK: Object.keys(kkSet).length || totalKK,
    kkDariNoKK: Object.keys(kkSet).length > 0,
    butuhReview,
    belumAdaNama,
    perRT: Object.keys(perRT).sort((a, b) => a.localeCompare(b, 'id', { numeric: true })).map(rt => ({ label: rt, jumlah: perRT[rt] })),
    perGender: toList(perGender),
    perAgama: toList(perAgama),
    perPendidikan: toList(perPendidikan),
    perKedudukan: toList(perKedudukan),
    perUsiaGroup: ['0-4', '5-14', '15-24', '25-54', '55-64', '65+', '(tidak diketahui)'].map(k => ({ label: k, jumlah: perUsiaGroup[k] })),
  };
}

function parseUsiaFromTanggalLahir_(tgl) {
  if (!tgl) return null;
  const parts = String(tgl).split('/');
  if (parts.length !== 3) return null;
  const d = parseInt(parts[0], 10), m = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
  if (!d || !m || !y) return null;
  const birth = new Date(y, m - 1, d);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday = (now.getMonth() < birth.getMonth()) || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age--;
  return age;
}

// ============================================================================
// AUDIT LOG
// ============================================================================
function logAudit_(action, detail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ensureAuditSheet_(ss);
    sh.appendRow([new Date(), action, JSON.stringify(detail || {})]);
  } catch (err) { /* jangan sampai audit log gagal menghentikan aksi utama */ }
}


// ============================================================================
// PENGURUS RW / RT (sheet "Pengurus" dibuat otomatis)
// ============================================================================
const HEADERS_PENGURUS = ['ID', 'Unit', 'Jabatan', 'Nama', 'Kontak', 'Periode'];
function pengurusSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Pengurus');
  if (!sh) { sh = ss.insertSheet('Pengurus'); sh.getRange(1, 1, 1, 6).setValues([HEADERS_PENGURUS]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
function pengurusRow_(item) { return HEADERS_PENGURUS.slice(1).map(h => sanitizeText_(item && item[h], 200)); }
function pengurusList_(token) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  const sh = pengurusSheet_();
  if (sh.getLastRow() < 2) return { ok: true, items: [] };
  const items = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().filter(r => r.join('') !== '')
    .map(r => { const o = {}; HEADERS_PENGURUS.forEach((h, i) => o[h] = r[i]); return o; });
  return { ok: true, items };
}
function pengurusSave_(token, id, item) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  if (!item || !sanitizeText_(item.Unit) || !sanitizeText_(item.Jabatan)) return { ok: false, error: 'unit_jabatan_wajib' };
  const sh = pengurusSheet_();
  if (id) {
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
    const idx = ids.indexOf(id);
    if (idx === -1) return { ok: false, error: 'not_found' };
    sh.getRange(idx + 2, 2, 1, 5).setValues([pengurusRow_(item)]);
  } else {
    id = Utilities.getUuid();
    sh.appendRow([id].concat(pengurusRow_(item)));
  }
  logAudit_('pengurus_save', { id, unit: item.Unit, jabatan: item.Jabatan });
  return { ok: true, id };
}
function pengurusDelete_(token, id) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  const sh = pengurusSheet_();
  const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  const idx = ids.indexOf(id);
  if (idx === -1) return { ok: false, error: 'not_found' };
  sh.deleteRow(idx + 2);
  logAudit_('pengurus_delete', { id });
  return { ok: true };
}
function pengurusBulkAdd_(token, items) {
  if (!checkAdmin_(token)) return { ok: false, error: 'unauthorized' };
  const sh = pengurusSheet_();
  const rows = (items || []).map(it => [Utilities.getUuid()].concat(pengurusRow_(it)));
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  logAudit_('pengurus_bulk_add', { jumlah: rows.length });
  return { ok: true, jumlah: rows.length };
}
