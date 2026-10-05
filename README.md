# Dashboard Data Penduduk

Dashboard admin untuk mengelola data penduduk (per jiwa), dibangun dengan
HTML/CSS/JS polos di sisi tampilan dan **Google Sheets sebagai database**
lewat Google Apps Script — pola yang sama dengan proyek "Portal RW 01
Bukanagara" yang Anda punya.

## Struktur folder
```
index.html                → Halaman login + dashboard (satu halaman, semua di sini)
style.css                 → Styling dashboard
script.js                 → Logic dashboard (login, tabel, form, impor, grafik)
toast.css, toast.js       → Notifikasi kecil di pojok kanan atas
penduduk-import-data.js   → 506 data siap-impor hasil olahan file sumber (lihat di bawah)
apps-script/Code.gs       → Backend. JANGAN diupload ke hosting web — tempel ke
                             Google Apps Script (lihat langkah di bawah)
```

## Cara deploy

**1. Siapkan backend (Google Sheets + Apps Script)**
1. Buat Google Sheet baru (kosong).
2. Menu **Extensions > Apps Script**.
3. Hapus isi default `Code.gs`, tempel **seluruh isi** `apps-script/Code.gs` dari folder ini.
4. Simpan (ikon disket / Ctrl+S).
5. Kembali ke tab Google Sheets, **reload halaman** — menu **"Data Penduduk"** akan muncul di menu bar.
6. Klik **"Siapkan sheet Penduduk"** — ini membuat sheet `Penduduk` (dengan header yang benar) dan `AuditLog`.
7. Klik **"Atur / ganti PIN admin…"**, isi PIN minimal 6 karakter. **Wajib** sebelum dashboard bisa dipakai.
8. **Deploy > New deployment** → pilih tipe **Web app** → Execute as: **Me**, Who has access: **Anyone** → Deploy.
9. Salin URL yang diakhiri `/exec`.

**2. Sambungkan frontend ke backend**
1. Buka `script.js`, cari baris:
   ```js
   const API_URL = 'TEMPEL_URL_WEB_APP_DI_SINI';
   ```
2. Ganti dengan URL `/exec` dari langkah sebelumnya, simpan.

**3. Buka dashboard-nya**
- Untuk pakai sendiri/lokal: buka `index.html` langsung di browser.
- Untuk dipakai bersama pengurus lain: upload semua file (**kecuali folder `apps-script/`**, itu bukan file web) ke hosting statis pilihan Anda (GitHub Pages, Netlify, Vercel, cPanel, dll), struktur folder tetap sama.
- Masuk pakai PIN yang sudah diatur di langkah 1.7.

**Kalau nanti ada perubahan di `Code.gs`**: tempel ulang isinya ke Apps Script,
lalu **Deploy > Manage deployments** > pensil pada deployment aktif > Version:
**New version** > Deploy. Sekadar menyimpan di editor **tidak cukup** — Web App
tetap menjalankan versi lama sampai dibuat "New version".

## Tentang data impor bawaan (penting — baca sebelum impor)

File sumber `MASTER_DATA_PENDUDUK.xls` yang Anda unggah punya beberapa sheet.
Sheet **"MODEL A.1. — Buku Induk Penduduk"** (512 baris) adalah satu-satunya
yang berisi data per-jiwa dalam jumlah besar, tapi kolomnya **tergeser/rusak**
di file sumbernya — misalnya kolom "Nama" ternyata berisi NIK, kolom lain
tidak konsisten geserannya antar baris (kemungkinan sisa hasil formula/VLOOKUP
yang datanya sudah tidak sinkron dengan sheet asalnya).

Yang saya lakukan: **NIK didekode langsung** (6 digit kode wilayah + tanggal
lahir + kode urut — format NIK standar Indonesia) untuk menghitung ulang
**jenis kelamin, tanggal lahir, dan usia** secara independen dari kolom yang
rusak, lalu dicocokkan ke kolom lain yang terbukti masih benar (Kedudukan
dalam Keluarga, Alamat). Hasilnya: **478 dari 506 baris bersih sepenuhnya**,
28 baris ditandai di kolom "Catatan Impor" untuk direview manual (format NIK
tidak standar / data di baris itu kosong semua).

**Yang TIDAK tersedia sama sekali di file sumber** (bukan kesalahan proses,
memang tidak ada datanya di sheet tersebut) — kosong dan perlu diisi manual:
- **Nama** — nama asli tidak pernah muncul di sheet ini (digantikan NIK).
- **Status Perkawinan**, **Agama**, **Pekerjaan** — kolom-kolom ini hilang/tertimpa data lain.
- **RT** dan **RW** — sheet ini tidak punya kolom RT/RW terpisah, hanya teks alamat.

Saran alur kerja setelah impor:
1. Impor 506 data lewat tab **Impor Data**.
2. Di tab **Data Penduduk**, filter berdasarkan alamat (cari di kotak pencarian),
   centang baris-baris dengan alamat yang sama → pakai bilah **"pilih banyak baris"**
   yang muncul di atas tabel untuk isi **RT** sekaligus untuk semua baris itu.
3. Isi Nama satu per satu lewat tombol ikon pensil (idealnya sambil mencocokkan dengan
   dokumen KK asli, karena nama warga adalah data yang paling penting untuk benar).
4. Kolom "Catatan Impor" menandai baris yang datanya meragukan — selesaikan itu duluan.

Kalau Anda punya sumber data lain yang lebih lengkap/akurat (mis. rekap RT/RW
terbaru dari Kelurahan), pakai **Opsi B (tempel CSV)** di tab Impor Data —
lebih baik daripada mengandalkan data yang sudah tergeser ini.

## Pembaruan (skema baru)
Kolom baru: **NoKK, Suku, TglKawin**. Setelah menempel `Code.gs` terbaru: ekspor CSV dulu bila sudah ada data
manual, jalankan "Siapkan sheet Penduduk", lalu **hapus semua data dan impor ulang** agar kolom tidak bergeser.
Data bawaan kini 511 baris: 5 lengkap dari sheet MASTER + 506 dari MODEL A.1.
Catatan: rumus MODEL A.1 menaut ke file eksternal dan salah kolom (Nama mengambil kolom NIK), jadi isi sheet MASTER
sampai lengkap (perkiraan target 1.912 jiwa pada sheet PROFIL) lalu impor via CSV.

## Keamanan
Sama seperti proyek RW01:
- PIN admin disimpan sebagai **hash SHA-256** di Script Properties, bukan teks polos.
- Percobaan PIN salah dibatasi — terkunci 5 menit setelah 5x gagal berturut-turut.
- Sesi login pakai token sementara (2 jam).
- Semua aksi tambah/ubah/hapus/impor dicatat di sheet `AuditLog`.
- **Data di sheet ini berisi data pribadi warga (termasuk NIK).** Jangan bagikan
  PIN admin ke luar pengurus, dan jangan ubah sharing Google Sheets-nya sendiri
  menjadi publik (Web App-nya sudah cukup diatur "Anyone" — itu hanya
  merespons permintaan yang membawa PIN/token yang valid, Sheets aslinya
  tetap privat ke akun Google Anda).

## Fitur
- **Statistik** — kartu ringkasan (total penduduk, perkiraan total KK, data
  belum lengkap) + grafik (sebaran per RT, jenis kelamin, kelompok usia,
  pendidikan, agama, kedudukan dalam keluarga).
- **Data Penduduk** — tabel dengan pencarian, filter RT & jenis kelamin,
  tambah/ubah/hapus per baris, **pilih banyak baris untuk isi satu kolom
  sekaligus** (berguna untuk melengkapi RT setelah impor), ekspor CSV.
- **Impor Data** — impor 506 data bawaan, atau tempel CSV Anda sendiri,
  dengan opsi hapus data lama dulu.
