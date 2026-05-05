# Panduan Testing KRSwitch Backend

Dokumen ini menjelaskan struktur test, cara baca kode test, dan cara nulis test baru.
Cocok buat kamu yang baru onboarding atau mau fokus ke QA.

---

## Cara Jalankan Test

```bash
npm test          # jalankan semua test sekali
npm test -- --watch   # mode watch, auto re-run kalau ada perubahan file
```

Kalau semua hijau, output-nya kira-kira begini:

```
✓ src/tests/unit/autoMatch.test.ts        (6 tests)
✓ src/tests/unit/middleware.test.ts       (9 tests)
✓ src/tests/unit/offerController.test.ts (14 tests)
✓ src/tests/integration/admin.test.ts    (16 tests)
✓ src/tests/integration/offers.test.ts   (24 tests)
```

---

## Struktur Folder

```
src/tests/
├── setup.ts               # env vars untuk semua test (JWT_SECRET, dsb)
├── createTestApp.ts        # bikin express app minimalis untuk integration test
├── mocks/
│   ├── db.ts              # mock Prisma client
│   └── io.ts              # mock Socket.IO instance
├── unit/
│   ├── middleware.test.ts      # test middleware auth dan validasi
│   ├── offerController.test.ts # test fungsi-fungsi pure di controller
│   └── autoMatch.test.ts       # test logika auto-matching barter
└── integration/
    ├── admin.test.ts       # test endpoint-endpoint admin (me, users, notif, dsb)
    └── offers.test.ts      # test endpoint offers (GET, POST, take, delete)
```

**Unit test** = test fungsi satu per satu, tanpa HTTP request, tanpa database sungguhan.

**Integration test** = test endpoint HTTP dari ujung ke ujung, tapi database-nya tetap di-mock.

---

## Cara Kerja Mock

Kita tidak menyentuh database sungguhan sama sekali. Semua operasi Prisma diganti dengan fungsi palsu (mock) yang bisa kita kontrol hasilnya.

### Mock Prisma (`mocks/db.ts`)

```ts
// Contoh cara pakai di test
vi.mocked(prisma.barterOffer.findMany).mockResolvedValue([
  { id: 1, status: 'open', offererNim: 'M0001111111' }
]);
```

Setiap model punya method standar: `findMany`, `findFirst`, `findUnique`, `create`, `update`, `updateMany`, `delete`, `count`.

Untuk operasi yang pakai `prisma.$transaction`, ada helper `buildTxMock()` yang bikin client transaksional palsu:

```ts
vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
  const tx = buildTxMock();
  tx.barterOffer.findUnique.mockResolvedValue({ id: 1, status: 'open', ... });
  return cb(tx); // jalankan callback dengan tx palsu
});
```

### Mock Socket.IO (`mocks/io.ts`)

```ts
// Cek apakah socket event dikirim dengan benar
expect(mockIo.emit).toHaveBeenCalledWith('new-offer', { id: 1, ... });
expect(mockIo.to).toHaveBeenCalledWith('user-M0001111111');
```

### Auth Cookie

Integration test butuh cookie JWT yang valid. Ada helper `authCookie()` di setiap file integration test:

```ts
// Bikin cookie dengan user default
request(app).get('/api/offers').set('Cookie', authCookie())

// Atau dengan user spesifik
request(app).post('/api/offers/1/take').set('Cookie', authCookie(takerUser))
```

---

## Penjelasan Tiap File Test

### `unit/middleware.test.ts`

Test untuk dua middleware di `src/middleware/`:

**`requireAuth`** — middleware yang baca JWT dari cookie dan taruh payload-nya di `req.user`.

| Skenario | Yang diharapkan |
|---|---|
| Tidak ada cookie `token` | 401, pesan "Not authenticated" |
| Token tidak valid / expired | 401, cookie di-clear, pesan "Session expired" |
| Token valid tapi pakai secret yang salah | 401 |
| Token valid dan secret benar | `next()` dipanggil, `req.user` terisi |

**`validate(schema)`** — middleware factory yang validasi `req.body` pakai Zod schema.

| Skenario | Yang diharapkan |
|---|---|
| Body sesuai schema | `next()` dipanggil |
| Body tidak sesuai | 400, `{ error: 'Validation failed', details: [...] }` |
| Error non-Zod (unexpected) | Error diteruskan ke `next(err)` |

**`asyncHandler(fn)`** — wrapper yang tangkap error dari async handler dan forward ke `next(err)`.

| Skenario | Yang diharapkan |
|---|---|
| Handler berjalan normal | Response terkirim, `next` tidak dipanggil |
| Handler throw error | Error diteruskan ke `next(err)` |

---

### `unit/offerController.test.ts`

Test untuk fungsi-fungsi yang bisa ditest secara pure (tanpa HTTP).

**`hasScheduleConflict(classA, classB)`** — cek apakah dua kelas jadwalnya bentrok.

Aturan overlap: dua kelas bentrok kalau `startA < endB && startB < endA`.
Kalau satu kelas berakhir tepat saat kelas lain mulai (adjacent), itu **tidak** dianggap bentrok.

| Skenario | Yang diharapkan |
|---|---|
| Beda hari | `false` |
| Bersebelahan (A selesai tepat saat B mulai) | `false` |
| Overlap sebagian | `true` |
| Satu sepenuhnya di dalam yang lain | `true` |
| Jadwal identik | `true` |

**`cancelStaleOffers(nim, newSchedule, lostClassId, tx)`** — batalkan offer yang tidak relevan setelah enrollment berubah. Ada dua alasan pembatalan:

- `no_longer_enrolled`: `myClassId` offer = kelas yang baru saja ditinggalkan
- `schedule_conflict`: `wantedClass` offer bentrok dengan jadwal baru

| Skenario | Yang diharapkan |
|---|---|
| Tidak ada offer terbuka | Array kosong, tidak ada update |
| `myClassId` = `lostClassId` | Offer dibatalkan, reason `no_longer_enrolled` |
| `wantedClass` bentrok dengan jadwal baru | Offer dibatalkan, reason `schedule_conflict` |
| Tidak ada konflik | Tidak ada yang dibatalkan |
| Campuran berbagai kasus | Hanya yang konflik yang dibatalkan |

---

### `unit/autoMatch.test.ts`

Test untuk fungsi `autoMatch(newOffer)` — dipanggil otomatis setelah offer baru dibuat, untuk cek apakah ada counter-offer yang cocok.

Logika matching: offer A cocok dengan offer B kalau `A.myClassId == B.wantedClassId` dan `A.wantedClassId == B.myClassId`, keduanya masih terdaftar di kelas masing-masing, dan tidak ada konflik jadwal setelah swap.

| Skenario | Yang diharapkan |
|---|---|
| Tidak ada counter-offer | `{ matched: false }` |
| Counter-offer ada tapi offer baru sudah hilang (race condition) | `{ matched: false }` |
| Counter-offerer sudah drop kelas | `{ matched: false }` |
| New offerer sudah drop kelas | `{ matched: false }` |
| Ada konflik jadwal setelah swap | `{ matched: false }`, tidak ada DB write |
| Happy path (semua kondisi terpenuhi) | `{ matched: true }`, kedua offer di-update ke `matched`, enrollment ditukar, 2 notifikasi dibuat, payload `swaps` berisi data yang benar |

---

### `integration/admin.test.ts`

Test endpoint-endpoint umum yang tidak berhubungan langsung dengan offers.

**`GET /health`** — cek apakah server hidup. Tidak butuh auth.

**`GET /api/me`** — ambil data user dari JWT yang ada di cookie.

**`GET /api/users`** — daftar semua user. Butuh auth.

**`GET /api/socket-token`** — minta JWT khusus untuk autentikasi WebSocket. Token ini short-lived (max 60 detik).

**`GET /api/notifications`** — ambil notifikasi milik user yang sedang login, diurutkan terbaru dulu. Test memastikan query Prisma pakai filter `recipientNim` yang benar.

**`PATCH /api/notifications/read-all`** — tandai semua notifikasi yang belum dibaca sebagai sudah dibaca. Test memastikan update hanya menyentuh notifikasi milik user yang login.

**`GET /api/classes`** — daftar semua kelas paralel. Test memastikan response ada dan query pakai `orderBy`.

Semua endpoint (kecuali `/health`) mengembalikan **401** kalau tidak ada cookie auth.

---

### `integration/offers.test.ts`

Test endpoint-endpoint offers. Ini yang paling kompleks karena banyak validasi bisnis.

**`GET /api/offers`**

| Skenario | Yang diharapkan |
|---|---|
| Tidak ada auth | 401 |
| Ada auth | 200, list offers dari DB |

**`POST /api/offers`** — buat offer baru. Banyak validasi sebelum offer disimpan.

| Skenario | Yang diharapkan |
|---|---|
| Tidak ada auth | 401 |
| `myClassId == wantedClassId` | 400, "Validation failed" |
| Offerer tidak terdaftar di `myClass` | 400, pesan "not enrolled" |
| Sudah ada offer terbuka untuk `myClass` | 400, pesan "already have an open offer" |
| `myClass` tidak ada di DB | 404 |
| `myClass` dan `wantedClass` beda mata kuliah | 400, pesan "same course" |
| Tipe kelas berbeda (K vs P) | 400, pesan "same type" |
| `wantedClass` bentrok dengan jadwal yang ada | 400, pesan "jadwal bentrok" |
| Semua validasi lolos, tidak ada match | 201, `autoMatched: false`, socket event `new-offer` dikirim |

**`POST /api/offers/:id/take`** — take offer milik orang lain (trigger barter manual).

> Catatan: error bisnis di endpoint ini return 500 karena dilempar dari dalam transaksi.

| Skenario | Yang diharapkan |
|---|---|
| Tidak ada auth | 401 |
| Format `takerNim` tidak valid | 400 |
| Offer tidak ditemukan | 500, "not found" |
| Offer sudah di-take/matched | 500, "already taken" |
| Taker coba take offer sendiri | 500, "own offer" |
| Offerer sudah drop kelas | 500, "no longer has this class" |
| Taker tidak terdaftar di `wantedClass` | 500, "not enrolled in the wanted class" |
| Semua kondisi terpenuhi | 200, enrollment ditukar, socket events `offer-taken`, `enrollments-swapped`, dan notifikasi per user dikirim |

**`DELETE /api/offers/:id`** — batalkan offer sendiri.

| Skenario | Yang diharapkan |
|---|---|
| Tidak ada auth | 401 |
| Offer tidak ditemukan | 404 |
| Offer milik user lain | 403, "not your offer" |
| Offer sudah matched | 400, "cannot cancel matched offer" |
| Offer masih open dan milik sendiri | 200, socket event `offer-taken` dikirim |

---

## Tips Nulis Test Baru

**1. Ikuti pola yang sudah ada**

Setiap `it()` punya struktur yang sama:
1. Setup mock yang dibutuhkan
2. Kirim request / panggil fungsi
3. Assert hasilnya

**2. Selalu test kasus gagal dulu**

Lebih mudah kelewatan test kasus happy path daripada kasus gagal. Pastikan semua validasi punya test-nya.

**3. Gunakan `mockResolvedValueOnce` kalau satu fungsi dipanggil beberapa kali**

```ts
// Panggilan pertama return null, panggilan kedua return data
vi.mocked(prisma.parallelClass.findUnique)
  .mockResolvedValueOnce(null)     // myClass tidak ketemu
  .mockResolvedValueOnce(classB);  // wantedClass ketemu
```

**4. Reset mock di `beforeEach`**

Kalau tidak direset, state mock dari test sebelumnya bisa bocor dan bikin test jadi flaky.

**5. Jangan assert hal yang tidak relevan**

Kalau test-nya soal validasi 400, tidak perlu assert socket event. Focus pada satu hal per test.