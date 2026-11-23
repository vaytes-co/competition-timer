# Panduan Memasang Scoring Desk di cPanel

Panduan ini untuk memasang **Scoring Desk** dan timer VAYTES di hosting cPanel. Ikuti langkahnya berurutan. Nama menu dapat sedikit berbeda tergantung penyedia hosting.

> **Penting:** Anda memerlukan paket hosting yang menyediakan **Setup Node.js App**, database MySQL/MariaDB, disk yang persisten, dan koneksi Socket.IO (WebSocket atau polling). Tanyakan ke penyedia hosting apakah WebSocket/polling diizinkan sebelum dipakai untuk acara.

## Gambaran sederhana

Kita akan menyiapkan tiga bagian:

1. **Database MySQL** untuk akun staf, peserta, nilai, dan daftar file media.
2. **Backend Node.js** di aplikasi cPanel untuk API, login, timer, dan upload.
3. **Frontend** berupa file statis yang diletakkan di `public_html`.

Contoh alamat yang dipakai dalam panduan:

- Website: `https://kompetisi.contoh.com`
- API/backend: `https://api.kompetisi.contoh.com`
- Folder backend: `/home/CPANEL_USER/apps/competition-timer/backend`
- Folder media privat: `/home/CPANEL_USER/private/scoring-media`

Ganti `CPANEL_USER` dan nama domain dengan milik Anda. **Jangan taruh backend, file `.env`, atau folder media di `public_html`.**

---

## Langkah 1 — Siapkan database MySQL

1. Login ke cPanel.
2. Buka **MySQL Database Wizard** (atau **MySQL® Databases**).
3. Buat satu database, misalnya `competition_timer`.
4. Buat user database dan password kuat.
5. Hubungkan user tersebut ke database yang baru dibuat dan berikan hak akses yang diperlukan. Jika cPanel menyediakan pilihan **ALL PRIVILEGES**, pilih untuk database aplikasi ini.
6. Catat empat informasi berikut:
   - hostname MySQL (umumnya `localhost`);
   - nama database lengkap;
   - nama user database lengkap;
   - password user database.

Di cPanel, nama database dan user sering otomatis diberi awalan username cPanel. Contohnya:

```text
Nama database: akunhost_competition_timer
Nama user:     akunhost_competition_app
```

Gunakan **nama lengkap dengan awalan** pada konfigurasi berikutnya. Database harus dibuat di cPanel lebih dulu; perintah migrasi akan membuat tabel-tabelnya secara otomatis.

## Langkah 2 — Buat alamat API

1. Di cPanel, buka **Domains** atau **Subdomains**.
2. Buat subdomain untuk API, misalnya `api.kompetisi.contoh.com`.
3. Aktifkan SSL/HTTPS untuk subdomain API. Pastikan ikon gembok/sertifikat SSL sudah aktif.

Frontend dan API sama-sama harus memakai HTTPS. Jangan memakai alamat API `http://` pada website HTTPS.

## Langkah 3 — Upload backend

1. Buka **File Manager**.
2. Buat folder backend di luar `public_html`, misalnya:

   ```text
   /home/CPANEL_USER/apps/competition-timer/backend
   ```

3. Upload isi folder `backend` dari proyek ke folder tersebut. Pastikan hasil akhirnya memiliki susunan seperti ini:

   ```text
   backend/
     package.json
     package-lock.json
     src/
       server.js
       scoring.js
       migrate.js
       seed-scoring-users.js
       ...
   ```

   Jangan membuat folder bertingkat tanpa sengaja. `package.json` harus langsung berada di **Application Root**.

## Langkah 4 — Buat aplikasi Node.js

1. Di cPanel, buka **Setup Node.js App**.
2. Pilih **Create Application**.
3. Isi pengaturan:
   - **Node.js version:** pilih versi 20 atau lebih baru yang tersedia.
   - **Application mode:** `Production`.
   - **Application root:** `apps/competition-timer/backend` (tanpa `/home/CPANEL_USER/` jika cPanel meminta path relatif).
   - **Application URL:** pilih subdomain API, misalnya `api.kompetisi.contoh.com`.
   - **Application startup file:** `src/server.js`.
4. Klik **Create**.
5. Pasang package backend menggunakan tombol **Run NPM Install** jika tersedia. Jika cPanel meminta perintah, jalankan `npm install` pada Application Root, memakai environment Node.js yang disediakan cPanel.

Jangan mengisi `PORT` sendiri bila cPanel menyediakan port aplikasi secara otomatis. Backend membaca nilai `PORT` dari cPanel.

## Langkah 5 — Atur konfigurasi backend dan media

Ada dua cara. Cara A biasanya paling mudah untuk menjalankan aplikasi **dan** perintah migrasi/seed dari Terminal.

### Cara A — Buat file `.env` di folder backend

Buat file bernama `.env` langsung di Application Root backend, bukan di `public_html`:

```text
/home/CPANEL_USER/apps/competition-timer/backend/.env
```

Isi dengan konfigurasi berikut. Ganti semua nilai contoh:

```dotenv
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=AWALAN_userdatabase
MYSQL_PASSWORD=password_mysql_anda
MYSQL_DATABASE=AWALAN_namadatabase

FRONTEND_ORIGINS=https://kompetisi.contoh.com,https://www.kompetisi.contoh.com
ROOM_TTL_HOURS=24
ROOM_PASSWORD_MIN_LENGTH=4
SCORING_MEDIA_DIR=/home/CPANEL_USER/private/scoring-media
```

Contoh `MYSQL_USER` dan `MYSQL_DATABASE` harus menggunakan nama lengkap berawalan cPanel. `FRONTEND_ORIGINS` harus berisi alamat website frontend yang benar-benar dipakai, tanpa garis miring `/` di akhir.

Simpan `.env` dengan izin akses privat (misalnya `600` jika File Manager menyediakan pengaturan tersebut). Jangan unggah atau salin file ini ke `public_html`, Git, atau folder frontend. Password database adalah rahasia.

`SCORING_MEDIA_DIR` boleh diganti, tetapi arahkan ke folder privat di luar `public_html`. Backend akan membuat folder media jika belum ada. Folder induknya harus dapat ditulisi oleh aplikasi Node.js. Hindari izin `777`; gunakan izin yang disarankan penyedia hosting.

### Cara B — Isi Environment Variables di cPanel

Jika tidak ingin memakai `.env`, masukkan setiap pasangan nama/nilai pada bagian **Environment Variables** di halaman aplikasi Node.js. Isi variabel yang sama seperti di atas. Jangan mengatur `MYSQL_URL` bersamaan dengan variabel `MYSQL_*`; jika `MYSQL_URL` ada, ia akan menggantikan konfigurasi terpisah tersebut.

> Jika memakai cara B, perintah yang dijalankan lewat Terminal cPanel mungkin tidak otomatis menerima environment dari halaman Setup Node.js App. Untuk menjalankan migrasi dan seed dengan mudah, gunakan `.env` privat di Application Root atau atur environment yang sama pada sesi Terminal.

## Langkah 6 — Jalankan migrasi tabel

Migrasi menyiapkan tabel pengguna, sesi, peserta, nilai, media, dan tabel versi migrasi. Anda tidak perlu membuat tabel satu per satu.

1. Buka **Terminal** di cPanel.
2. Pindah ke Application Root backend (sesuaikan nama user dan folder):

   ```bash
   cd /home/CPANEL_USER/apps/competition-timer/backend
   ```

3. Jalankan:

   ```bash
   npm run migrate
   ```

Jika berhasil, terminal menampilkan bahwa migrasi scoring sudah diterapkan atau database sudah terbaru.

Perintah ini aman dijalankan ulang dan tidak menghapus data. Jika muncul `Unknown database`, periksa ejaan `MYSQL_DATABASE`, pastikan database sudah dibuat pada Langkah 1, dan pastikan user sudah dihubungkan ke database tersebut.

## Langkah 7 — Buat akun juri dan asisten

Setelah migrasi berhasil, dari folder backend yang sama jalankan:

```bash
npm run seed
```

Seed membuat akun `juri` dan `asisten`. Password awal acak ditampilkan **satu kali** di Terminal; simpan password tersebut dengan aman. Menjalankan seed lagi tidak mereset password akun yang sudah ada.

Jika ingin memakai password pilihan sendiri, buat/reset akun dengan perintah `npm run scoring:user` dan isi `SCORING_USERNAME`, `SCORING_ROLE`, serta `SCORING_PASSWORD` di environment Terminal. Username dan role untuk akun standar adalah:

| Akun | `SCORING_USERNAME` | `SCORING_ROLE` |
|---|---|---|
| Juri | `juri` | `juri` |
| Asisten | `asisten` | `asisten` |

Password pilihan harus minimal 4 karakter dan maksimal 72 byte UTF-8. Provisioning password akan mengakhiri sesi aktif untuk akun tersebut, sehingga perangkat perlu login lagi.

Contoh berikut mengganti password akun juri. Password diketik tanpa ditampilkan di Terminal:

```bash
cd /home/vayteswe/competition-timer/backend
export SCORING_USERNAME=juri
export SCORING_ROLE=juri
read -r -s -p "Password juri baru: " SCORING_PASSWORD
echo
export SCORING_PASSWORD
npm run scoring:user
hasil=$?
unset SCORING_USERNAME SCORING_ROLE SCORING_PASSWORD
if [ "$hasil" -ne 0 ]; then exit "$hasil"; fi


cd /home/vayteswe/competition-timer/backend
export SCORING_USERNAME=asisten
export SCORING_ROLE=asisten
read -r -s -p "Password asisten baru: " SCORING_PASSWORD
echo
export SCORING_PASSWORD
npm run scoring:user
hasil=$?
unset SCORING_USERNAME SCORING_ROLE SCORING_PASSWORD
if [ "$hasil" -ne 0 ]; then exit "$hasil"; fi
```

Untuk akun asisten, ganti kedua nilai `juri` menjadi `asisten`, lalu jalankan blok perintah yang sama.

## Langkah 8 — Restart dan uji backend

Kembali ke halaman **Setup Node.js App**, lalu tekan **Restart**.

Buka alamat berikut di browser:

```text
https://api.kompetisi.contoh.com/api/health
https://api.kompetisi.contoh.com/api/scoring/status
```

Hasil yang diharapkan:

- `/api/health` menampilkan status `ok`.
- `/api/scoring/status` menampilkan `"enabled": true` dan `"ready": true`.

Jika tidak berhasil, lihat **stderr/error log** aplikasi Node.js di cPanel dan bagian pemecahan masalah di bawah.

## Langkah 9 — Build dan upload frontend

Build frontend dilakukan di komputer lokal, bukan di `public_html`.

1. Buka PowerShell pada folder utama proyek.
2. Build dengan alamat API production Anda:

   ```powershell
   $env:VITE_SOCKET_URL = "https://api.kompetisi.contoh.com"
   npm run build --prefix frontend
   Remove-Item Env:VITE_SOCKET_URL
   ```

3. Setelah berhasil, buka folder `frontend/dist`.
4. Upload **isi** folder `dist` ke document root website, biasanya `public_html`.

Pastikan `index.html` berada langsung di document root, bukan di `public_html/dist/index.html`. Jangan mengunggah file `.env` ke `public_html`.

## Langkah 10 — Uji fitur dari website

1. Buka `https://kompetisi.contoh.com`.
2. Pilih **Scoring desk**, lalu login sebagai `juri`.
3. Tambahkan peserta, isi satu percobaan, dan pastikan podium serta **Results summary** menampilkan hasil.
4. Login sebagai `asisten` pada browser/perangkat lain. Pastikan asisten dapat mengunggah foto/video, tetapi tidak dapat melihat skor.
5. Uji satu Room timer dan Display di perangkat berbeda.
6. Uji upload foto kecil terlebih dahulu, lalu video. Pastikan disk hosting memiliki ruang cukup.

Backend membatasi satu file hingga 200 MB, tetapi batas reverse proxy atau hosting bisa lebih kecil. Jika upload besar gagal, tanyakan batas request dan timeout kepada penyedia hosting.

## Pemecahan masalah cepat

| Pesan/gejala | Yang perlu diperiksa |
|---|---|
| `Unknown database` | Database belum dibuat, `MYSQL_DATABASE` salah, atau belum memakai awalan nama cPanel. |
| `Access denied` | `MYSQL_USER`/`MYSQL_PASSWORD` salah atau user belum diberi akses ke database. |
| `Scoring is unavailable` atau `ready: false` | Periksa `.env`, izin MySQL, lalu lihat error log dan restart aplikasi. |
| `/api/health` 404 | Periksa Application URL, URL API, Application Root, dan startup file `src/server.js`. |
| Browser menampilkan error CORS | Sesuaikan `FRONTEND_ORIGINS` dengan origin website, termasuk `www` jika digunakan; jangan menambahkan `/` di akhir. |
| Upload gagal | Periksa ruang disk, izin folder `SCORING_MEDIA_DIR`, batas upload, dan timeout hosting. Jangan menyimpan media di `public_html`. |
| Timer/Room tidak tersambung | Pastikan penyedia hosting mendukung Socket.IO WebSocket atau HTTP polling dan konfigurasi proxy-nya benar. |

## Saat memperbarui aplikasi

1. Upload file backend terbaru ke Application Root.
2. Jika dependensi berubah, jalankan **Run NPM Install** lagi.
3. Jalankan `npm run migrate` dari folder backend. Jika tidak ada migrasi baru, data tidak berubah.
4. Build frontend lagi dengan `VITE_SOCKET_URL` production dan upload isi `frontend/dist` ke `public_html`.
5. Tekan **Restart** pada Setup Node.js App.

Folder media dan database harus dicadangkan bersama. Data Room/timer yang sedang berjalan disimpan dalam memori dan akan hilang jika aplikasi restart; database scoring tidak menyimpan state Room/timer.
