# Catat Uangmu

Aplikasi pembukuan pribadi berbasis HTML, CSS, dan JavaScript dengan penyimpanan lokal serta sinkronisasi Google opsional melalui Firebase.

## Menjalankan aplikasi

Buka aplikasi melalui HTTPS atau localhost di browser modern. Tanpa login, data tersimpan di `localStorage` browser pada perangkat yang sama. Login Google dari **Pengaturan** mengaktifkan sinkronisasi Firebase Firestore agar data dapat dipakai di perangkat lain; koneksi internet diperlukan. Buat cadangan JSON secara berkala melalui menu **Cadangkan data**.

### Firebase

Aplikasi dikonfigurasi untuk project Firebase `catat-uangmu-c7334` dengan Firebase JS SDK compat melalui CDN. Aktifkan Google sebagai provider di Firebase Authentication, buat Firestore Database, dan daftarkan domain aplikasi sebagai domain resmi Authentication.

Gunakan aturan Firestore berikut agar pengguna hanya dapat membaca dan menulis dokumen miliknya:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/appData/{documentId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}
```

Dokumen pengguna disimpan di `users/{uid}/appData/current`. Saat akun cloud berisi data, aplikasi meminta konfirmasi sebelum memilih data cloud atau menggantinya dengan data lokal. Dokumen Firestore dibatasi ukurannya; sinkronisasi memberi tahu jika data melewati batas dan tetap mempertahankan salinan lokal. Foto bukti dan foto profil dapat membuat data melebihi batas dokumen. Karena satu dokumen menyimpan seluruh data, hindari mengubah data secara bersamaan di beberapa perangkat.

## Memasang di Android

Buka situs Catat Uangmu melalui Chrome Android, lalu tekan **Instal aplikasi** pada menu samping. Pemasangan PWA membutuhkan situs HTTPS. Aplikasi dapat dibuka kembali dari layar utama dan aset intinya tersedia saat offline.

## Fitur

- Pemasukan, pengeluaran, saldo per akun, edit, pencarian, filter periode, serta tempat sampah transaksi.
- Banyak akun, transfer antar akun, ringkasan, laporan terfilter, grafik, dan ekspor CSV, XLSX, atau PDF melalui dialog cetak browser.
- Kategori, catatan, kalender aktivitas, kalkulator uang, pencadangan/pemulihan JSON, dan PIN pembuka opsional.
- Saat pertama kali membuka aplikasi, isi nama pengguna dan nama akun awal.
- Saat pertama kali membuka aplikasi, pilih login Google untuk sinkronisasi atau lanjut tanpa akun untuk menyimpan data hanya di browser ini.
- Tambahkan, ganti, atau hapus foto profil melalui bagian Profil dan tampilan di Pengaturan.
- Pilih tampilan waktu 12 jam (AM/PM) atau 24 jam; pemilihan jam menggunakan dial analog.
- Form transaksi memiliki kolom nama transaksi terpisah dari catatan tambahan, tidak meminta kategori, serta mendukung bukti gambar dan daftar barang. Pengaturan menyediakan tombol kembali ke halaman Lihat Uangmu.
- Nominal transaksi, transfer, saldo awal akun, dan harga barang otomatis menggunakan pemisah ribuan titik saat diketik.
- Transfer tidak dihitung sebagai pemasukan atau pengeluaran. Saldo historis dihitung ulang berdasarkan tanggal dan waktu transaksi.

Lucide Icons dan font web dimuat dari CDN ketika koneksi internet tersedia; fitur pencatatan dan penyimpanan tetap menggunakan browser tanpa backend.
