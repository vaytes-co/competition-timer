# Panduan Integrasi Scoring Desk

Dokumen ini menjelaskan cara menghubungkan fitur **Scoring desk** ke MySQL, membuat akun `asisten` dan `juri`, menjalankan aplikasi, dan menyiapkan penyimpanan foto/video.

Scoring desk berdiri sendiri dan tidak memerlukan Room. Database scoring juga tidak mengubah atau menyimpan state timer yang sudah ada.

## 1. Persiapan

Siapkan:

- Node.js 20 atau lebih baru dan npm.
- MySQL atau MariaDB yang bisa diakses dari backend.
- Akses untuk membuat database dan user MySQL, atau kredensial database yang sudah disediakan hosting.

Di terminal PowerShell, pindah ke folder proyek:

```powershell
Set-Location D:\Projek\Website-ric-competition
```

## 2. Buat database MySQL

Jalankan SQL berikut melalui MySQL Workbench, phpMyAdmin, atau terminal MySQL. Ganti password contoh dengan password kuat.

```sql
CREATE DATABASE competition_timer
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'competition_app'@'127.0.0.1'
  IDENTIFIED BY 'GANTI_DENGAN_PASSWORD_KUAT';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON competition_timer.*
  TO 'competition_app'@'127.0.0.1';

FLUSH PRIVILEGES;
```

Jika backend berada di server lain, ganti `127.0.0.1` dengan host/IP backend yang diizinkan MySQL. Pada hosting seperti cPanel, nama database dan user sering otomatis memiliki prefix akun hosting; gunakan nama lengkap yang diberikan hosting.

Contoh tersebut membuat database sekali dan memberi user aplikasi izin mengelola tabel scoring di dalamnya. User aplikasi tidak perlu memiliki hak administratif global.

## 3. Hubungkan database melalui `.env`

Salin template lalu buka file `.env` di root proyek:

```powershell
Copy-Item .env.example .env
notepad .env
```

Tambahkan atau sesuaikan konfigurasi berikut. Isi host, user, dan password MySQL sesuai server Anda. Setelah koneksi dan kredensial benar, untuk memilih database lain cukup ubah `MYSQL_DATABASE`.

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=competition_app
MYSQL_PASSWORD=GANTI_DENGAN_PASSWORD_KUAT
MYSQL_DATABASE=competition_timer
```

Pada `.env.example`, `MYSQL_PASSWORD` sengaja kosong. Isi password user MySQL yang dibuat pada langkah 2 satu kali. Jangan gunakan password contoh SQL apa adanya.

`SCORING_MEDIA_DIR` opsional. Jika dihapus, file tersimpan di `backend/storage/scoring-media`. Pastikan direktori tersebut berada pada disk persisten dan dapat ditulis oleh proses Node.js.

Backend membaca `.env` dari root proyek atau `backend/.env`; file root diprioritaskan. Frontend juga menggunakan `.env` di root untuk pengaturan `VITE_*`. Jadi, untuk pengembangan lokal, cukup gunakan satu file `.env` di root:

```powershell
Copy-Item .env.example .env
notepad .env
```

File `.env` tidak boleh dimasukkan ke Git atau dibagikan karena berisi rahasia. Jika password database berisi karakter khusus seperti `@`, `#`, `/`, `:` atau `?`, lakukan URL-encoding pada password di `MYSQL_URL`. Untuk menghindari kesalahan, password yang hanya memakai huruf, angka, `_` dan `-` lebih mudah dipakai pada URL ini.

Pada production/cPanel, isi `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, dan `MYSQL_DATABASE` pada environment aplikasi Node.js. `MYSQL_URL` boleh digunakan sebagai alternatif dan akan menggantikan konfigurasi MySQL terpisah. Jangan menaruh kredensial database pada variabel frontend `VITE_*`.

## 4. Instal dependensi dan siapkan akun

Jika dependensi belum dipasang:

```powershell
npm install
npm install --prefix backend
npm install --prefix frontend
```

### Jalankan migrasi database

Database yang dipilih pada `MYSQL_DATABASE` harus sudah dibuat terlebih dahulu (langkah 2). Dari root proyek, jalankan:

```powershell
npm run migrate
```

Migrasi membuat seluruh tabel scoring (termasuk tabel pengguna, sesi, peserta, percobaan, media, tiket media, dan pencatat versi migrasi). Anda tidak perlu membuat tabel satu per satu. Perintah ini aman dijalankan ulang: versi yang sudah diterapkan tidak dijalankan ulang. Backend juga otomatis memeriksa dan menerapkan migrasi yang belum dijalankan saat startup. Setelah nama database pada `.env` diganti, pastikan database tujuan sudah dibuat dan user MySQL memiliki izin akses ke database tersebut, lalu jalankan `npm run migrate` lagi.

Setelah migrasi berhasil, buat akun awal untuk kedua peran dengan satu perintah:

```powershell
npm run seed
```

Seed hanya membuat dua akun role: `juri` dan `asisten` (tidak ada akun juri bernomor). Password acak sepanjang 8 karakter ditampilkan sekali di terminal; simpan password tersebut dengan aman. Jika akun sudah ada, seed tidak mengganti password atau role yang tersimpan.

Password yang dibuat sendiri harus memiliki minimal 4 karakter dan maksimal 72 byte UTF-8. Untuk membuat akun tambahan atau mengganti password akun yang ada, gunakan perintah provisioning berikut dan isi variabel role dengan `juri` atau `asisten`:

```powershell

$env:SCORING_USERNAME = "juri"
$env:SCORING_ROLE = "juri"
$secret = Read-Host "New password (at least 4 characters)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:SCORING_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  npm run scoring:user --prefix backend
} finally {
  Remove-Item Env:SCORING_USERNAME, Env:SCORING_ROLE, Env:SCORING_PASSWORD
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}


$env:SCORING_USERNAME = "asisten"
$env:SCORING_ROLE = "asisten"
$secret = Read-Host "New password (at least 4 characters)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:SCORING_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  npm run scoring:user --prefix backend
} finally {
  Remove-Item Env:SCORING_USERNAME, Env:SCORING_ROLE, Env:SCORING_PASSWORD
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
```

Jika username sudah ada, perintah provisioning memperbarui password/perannya dan mengakhiri sesi lama akun tersebut.

`asisten` dan `juri` dapat login dari beberapa perangkat sekaligus. Sesi berlaku sampai satu tahun dan diperpanjang saat digunakan. Tombol keluar hanya mengakhiri sesi pada perangkat tersebut.

## 5. Jalankan dan verifikasi

Jalankan backend dan frontend dari root:

```powershell
npm run dev
```

Buka alamat Vite yang ditampilkan, biasanya `http://localhost:5173`, lalu pilih **Scoring desk** di halaman awal. Menu scoring tidak meminta kode Room.

Periksa status backend:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
Invoke-RestMethod http://localhost:3001/api/scoring/status
```

Jika database siap, status scoring mengembalikan `enabled: true` dan `ready: true`. Jika MySQL belum dikonfigurasi, timer lama tetap berjalan, sedangkan scoring akan menampilkan status tidak tersedia.

## 6. Alur pemakaian dan aturan scoring

1. Login sebagai `juri`.
2. Pilih kategori dan tambahkan peserta dengan nama serta tanggal lahir. Tanggal lahir digunakan sebagai tie-breaker usia.
3. Catat skor dan waktu penyelesaian dalam format menit, detik, dan milidetik. Juri dapat mengubah hasil percobaan yang sudah tersimpan.
4. Sistem menampilkan tiga teratas berdasarkan skor tertinggi, waktu tercepat, lalu peserta termuda. Jika seluruh kriteria sama, nama dipakai untuk urutan yang konsisten.
5. Gunakan **Results summary** untuk melihat semua peserta di seluruh level beserta peringkat dan hasil terbaik. Halaman ini hanya tersedia untuk juri.
6. Login sebagai `asisten` untuk memilih peserta dan mengunggah foto/video bukti. Asisten tidak dapat melihat, merekam, atau mengubah skor.

Jumlah evaluasi:

| Kategori | Percobaan yang tersedia |
|---|---:|
| Mosaic 1D, Mosaic 2D, Mosaic 3D, Fun With Machine | 1 |
| Fun With Programming, Mechanic Engineering | 3 |
| Programming | 2 |

Untuk kategori dengan beberapa percobaan, sistem membandingkan skor tertinggi; jika skor sama, waktu tercepat dari percobaan terbaik menjadi pembanding.

## 7. Penyimpanan foto dan video

- Tipe yang diterima: JPG, PNG, WebP, MP4, WebM, dan MOV.
- Batas ukuran satu file: 200 MB.
- Foto besar akan diubah ukurannya dan dikonversi ke WebP di browser jika didukung.
- Video tidak ditranskode; upload menampilkan progres dan pemutaran menggunakan streaming/range request.
- Daftar peserta hanya mengambil metadata file. Isi file baru diambil ketika item tersebut dibuka.
- File disimpan di `SCORING_MEDIA_DIR`, sedangkan MySQL menyimpan informasi file dan relasi ke peserta.

Cadangkan database **dan** folder media secara bersamaan. Jangan meletakkan folder media di direktori publik frontend. Jika backend berjalan pada beberapa instance, semua instance harus menggunakan penyimpanan bersama yang sama dan persisten.

## 8. Deployment production

1. Buat database dan user MySQL pada hosting; pastikan koneksi dari backend diizinkan.
2. Atur `MYSQL_URL` dan `SCORING_MEDIA_DIR` pada environment aplikasi Node.js di cPanel/hosting.
3. Atur `FRONTEND_ORIGINS` ke origin frontend HTTPS yang tepat.
4. Buat akun `asisten` dan `juri` dengan perintah provisioning di atas atau jalankan skrip provisioning pada environment server.
5. Bangun frontend dengan `VITE_SOCKET_URL` berisi URL API production sebelum build:

   ```powershell
   $env:VITE_SOCKET_URL = "https://api.domain-anda.com"
   npm run build --prefix frontend
   Remove-Item Env:VITE_SOCKET_URL
   ```

6. Deploy `frontend/dist` dan backend dari revisi yang sama, lalu restart aplikasi Node.js.
7. Pastikan API dan website menggunakan HTTPS, lalu uji login, pencatatan skor, serta upload dan pembukaan media.

## Pemecahan masalah

| Gejala | Pemeriksaan |
|---|---|
| `enabled: false` | Pool MySQL tidak dapat dibuat karena konfigurasi invalid. Periksa format URL atau nilai `MYSQL_PORT`/`MYSQL_DATABASE`. |
| `enabled: true`, `ready: false` | Periksa MySQL aktif, host/port benar, database sudah dibuat, nama database benar, dan hak akses user. Backend mencoba kembali inisialisasi secara berkala; periksa log Node.js. |
| `Access denied` | Periksa username/password, host user MySQL, dan izin database. |
| `ECONNREFUSED` / timeout | Pastikan MySQL menerima koneksi dari host backend dan firewall/hosting mengizinkannya. |
| Akun tidak dapat login | Pastikan akun sudah dibuat dengan role persis `asisten` atau `juri`, lalu periksa ejaan username/password. |
| Upload gagal | Cek batas 200 MB, hak tulis direktori media, ruang disk, serta batas upload/time-out pada reverse proxy hosting. |
| Browser menolak API | Pastikan `FRONTEND_ORIGINS` berisi origin frontend yang tepat dan keduanya memakai HTTPS di production. |

Database scoring tidak menyimpan Room maupun state timer. Restart backend tetap memiliki batasan Room yang dijelaskan pada [README.md](./README.md).
