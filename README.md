# Catat Uangmu

Aplikasi pembukuan pribadi berbasis HTML, CSS, dan JavaScript tanpa backend.

## Menjalankan aplikasi

Buka `index.html` langsung di browser modern. Data tersimpan di `localStorage` browser pada perangkat yang sama; buat cadangan JSON secara berkala melalui menu **Cadangkan data**.

## Memasang di Android

Buka situs Catat Uangmu melalui Chrome Android, lalu tekan **Instal aplikasi** pada menu samping. Pemasangan PWA membutuhkan situs HTTPS. Aplikasi dapat dibuka kembali dari layar utama dan aset intinya tersedia saat offline.

## Fitur

- Pemasukan, pengeluaran, saldo per akun, edit, pencarian, filter periode, serta tempat sampah transaksi.
- Banyak akun, transfer antar akun, ringkasan, laporan terfilter, grafik, dan ekspor CSV, XLSX, atau PDF melalui dialog cetak browser.
- Kategori, catatan, kalender aktivitas, kalkulator uang, pencadangan/pemulihan JSON, tema, dan PIN pembuka opsional.
- Saat pertama kali membuka aplikasi, isi nama pengguna dan nama akun awal.
- Tambahkan, ganti, atau hapus foto profil melalui bagian Profil dan tampilan di Pengaturan.
- Pilih tampilan waktu 12 jam (AM/PM) atau 24 jam; pemilihan jam menggunakan dial analog.
- Form transaksi tidak meminta kategori, mendukung bukti gambar dan daftar barang, serta menyediakan tombol kembali ke halaman Lihat Uangmu dari pengaturan.
- Nominal transaksi, transfer, saldo awal akun, dan harga barang otomatis menggunakan pemisah ribuan titik saat diketik.
- Transfer tidak dihitung sebagai pemasukan atau pengeluaran. Saldo historis dihitung ulang berdasarkan tanggal dan waktu transaksi.

Lucide Icons dan font web dimuat dari CDN ketika koneksi internet tersedia; fitur pencatatan dan penyimpanan tetap menggunakan browser tanpa backend.
