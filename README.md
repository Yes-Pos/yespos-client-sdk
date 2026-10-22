# @yespos/client

SDK TypeScript untuk **YesPOS Client API** (`/api/client/*`): outlet, produk, metode pembayaran, dan order dengan **QRIS**, **Virtual Account**, atau **EDC**.

- **Tanpa dependency.** Memakai `fetch` dan Web Crypto bawaan runtime.
- **Jalan di mana saja.** Node 20+, Bun, Deno, dan runtime edge (Vercel, Cloudflare Workers).
- **ESM + CJS + types.**

> ⚠️ **Hanya untuk server.** Setiap request ditandatangani dengan client secret. Jangan pernah memakai SDK ini di browser — secret akan ikut terkirim. Panggil dari backend, API route, atau server function.

## Instalasi

```bash
npm install @yespos/client
```

## Mulai cepat

```ts
import { Shop } from '@yespos/client';

const shop = new Shop(
  { baseUrl: process.env.YESPOS_API_BASE_URL!, key: process.env.YESPOS_CLIENT_KEY!, secret: process.env.YESPOS_CLIENT_SECRET! },
  { outletUuid: process.env.YESPOS_OUTLET_UUID }
);

const categories = await shop.products();
const methods = await shop.paymentMethods();

const order = await shop.placeOrder(
  [{ productUuid: 'abc-123', quantity: 2 }],          // tanpa harga
  { name: 'Budi', email: 'budi@example.com', phone: '08123456789' },
  'va:bca'                                             // "<method>:<channel>"
);

order.payment_no;  // nomor VA yang dibayar pembeli
order.expired_at;  // batas waktu bayar
```

Atau langsung dari environment variable:

```ts
import { shopFromEnv } from '@yespos/client';
const shop = shopFromEnv(); // membaca YESPOS_* dari process.env
```

## Dua lapisan

| Lapisan | Untuk apa |
|---|---|
| `YesposClient` | Akses mentah ke endpoint. Tidak ada aturan tambahan. |
| `Shop` | Logika toko: pilih outlet, sembunyikan EDC bila tak dikonfigurasi, dan **hitung harga dari API**. |

### `Shop` — dipakai storefront

```ts
const shop = new Shop(clientAtauOptions, {
  outletUuid: 'uuid-outlet',        // kosong = outlet pertama milik pemilik client
  notifyUrl: 'https://…/callback',  // callback status order
  edc: { app_code: 'YESPOS', terminal_code: 'T1', merchant_code: 'M1' }, // null = EDC disembunyikan
  messages: { methodUnavailable: 'Metode pembayaran tidak tersedia.' }    // untuk terjemahan
});

await shop.outlet();                       // Outlet
await shop.products();                     // ProductCategory[]
await shop.product('uuid-produk');         // ProductDetail
await shop.paymentMethods();               // PaymentMethod[]
await shop.priceCart(lines);               // OrderItem[] dengan harga dari API
await shop.placeOrder(lines, buyer, 'qris:qris');
await shop.order(uuid);
await shop.changePayment(uuid, 'va:bca');  // order pending → metode lain
shop.mediaUrl(token);                      // URL gambar publik
```

**Harga selalu diambil dari API.** `placeOrder` hanya menerima `productUuid`, `variantUuid`, dan `quantity`; totalnya dihitung ulang di server. Harga yang dikirim dari browser tidak dipercaya.

### `YesposClient` — akses langsung

```ts
import { YesposClient } from '@yespos/client';
const yespos = new YesposClient({ baseUrl, key, secret, timeout: 15000, language: 'id' });

await yespos.outlets.list();
await yespos.products.list(outletUuid);
await yespos.products.get(outletUuid, productUuid);
await yespos.products.map(outletUuid);                 // Map<uuid, Product>
await yespos.paymentMethods.list();
await yespos.orders.create(input);
await yespos.orders.get(uuid);
await yespos.orders.list({ page: 1, limit: 10 });
await yespos.orders.changePaymentMethod(uuid, input);
yespos.mediaUrl(token);
```

Endpoint yang belum dibungkus bisa dipanggil lewat transport-nya:

```ts
await yespos.http.get<Something>('/endpoint-baru');
await yespos.http.post<Something>('/endpoint-baru', body);
```

## Metode pembayaran

`GET /api/client/payment-method` hanya mengembalikan metode yang **diaktifkan oleh pemilik client** di dashboard YesPOS. Metode di luar daftar itu akan ditolak saat membuat order.

Satu pilihan ditulis `"<method>:<channel>"`:

| Nilai | Arti | Field di response order |
|---|---|---|
| `qris:qris` | QRIS | `qr_string` → render jadi QR |
| `va:bca`, `va:bri`, … | Virtual account per bank | `payment_no`, `payment_name`, `expired_at` |
| `edc:linkpayment` | Kartu lewat EDC | `app_link` → buka di perangkat EDC |

```ts
import { paymentValue } from '@yespos/client';
const options = (await shop.paymentMethods()).map((m) => ({ value: paymentValue(m), label: m.name }));
```

## Status order

```ts
import { orderState, isPending, isPaid } from '@yespos/client';

orderState('pending');            // 'pending'
orderState('berhasil_settled');   // 'paid'
orderState('expired');            // 'failed'
```

Status akhir dikirim YesPOS ke `notifyUrl`. Untuk menampilkannya di halaman, panggil `shop.order(uuid)` saat pembeli menekan tombol cek status — hindari polling berkala.

## Error

Semua kegagalan dilempar sebagai `YesposError`.

```ts
import { isYesposError } from '@yespos/client';

try {
  await shop.placeOrder(lines, buyer, 'va:bca');
} catch (error) {
  if (isYesposError(error)) {
    error.status;          // status HTTP; 0 bila server tak terjangkau
    error.message;         // pesan dari API, sudah digabung bila berupa daftar
    error.details;         // field `details` dari API, bila ada
    error.isNetworkError;  // true bila tidak terhubung / timeout
    error.isAuthError;     // true untuk 401/403
  }
}
```

Beberapa yang sering muncul:

| Status | Arti |
|---|---|
| 400 | Metode pembayaran tidak tersedia, atau `payment_channel` wajib diisi |
| 404 | Outlet, produk, atau order tidak ditemukan |
| 409 | Produk di keranjang sudah tidak dijual, atau order sudah tidak pending |
| 401 | Signature ditolak — periksa `key` dan `secret` |

## Konfigurasi

```ts
new YesposClient({
  baseUrl: 'https://api.yespos.id', // tanpa / di akhir (tetap aman bila ada)
  key: '…',                          // header `va`
  secret: '…',                       // penandatangan request, simpan di server
  timeout: 15000,                    // ms, default 15000
  language: 'id',                    // bahasa pesan API, default 'id'
  fetch: customFetch                 // opsional: fetch sendiri (proxy, retry, dll.)
});
```

Variabel environment yang dibaca `shopFromEnv()` / `clientFromEnv()`:

```
YESPOS_API_BASE_URL, YESPOS_CLIENT_KEY, YESPOS_CLIENT_SECRET,
YESPOS_OUTLET_UUID, YESPOS_NOTIFY_URL,
YESPOS_EDC_APP_CODE, YESPOS_EDC_TERMINAL_CODE, YESPOS_EDC_MERCHANT_CODE
```

## Cara kerja signature

SDK menandatangani setiap request seperti yang dicek `ClientAuthMiddleware` di YesPOS:

```
signature = HMAC-SHA256(secret, `${METHOD}:${key}:${sha256(body || "{}")}:${secret}`)
```

Lalu dikirim sebagai header `va`, `signature`, dan `timestamp`. Fungsinya diekspor sebagai `signRequest()` bila diperlukan di luar SDK.

## Contoh pemakaian

Tiga storefront contoh memakai SDK ini:

- `yespos-example-landingpage` (SvelteKit)
- `yespos-example-landingpage-vue` (Nuxt)
- `yespos-example-landingpage-react` (Next.js)

Pola yang dipakai ketiganya: SDK hanya di server, lalu browser memanggil endpoint JSON milik aplikasi sendiri (`/api/*`).

## Pengembangan

```bash
npm install
npm test          # vitest, termasuk mock yang memverifikasi signature
npm run typecheck
npm run build
```

## Rilis

Publish ke npm berjalan otomatis dari GitHub Actions saat tag versi di-push.

```bash
npm version patch        # atau minor / major — mengubah package.json + membuat tag
git push --follow-tags   # tag v* memicu workflow Release
```

Workflow `release.yml` memastikan tag cocok dengan `package.json`, menjalankan typecheck + test + build, lalu `npm publish` dan membuat GitHub Release.

Autentikasi ke npm memakai **Trusted Publishing (OIDC)**: npm memverifikasi workflow lewat GitHub, jadi tidak ada token npm yang disimpan di repo. Provenance ikut dibuat otomatis.

Setup sekali di npmjs.com → paket → **Settings → Trusted publishing → GitHub Actions**:

| Isian | Nilai |
|---|---|
| Organization or user | `Yes-Pos` |
| Repository | `yespos-client-sdk` |
| Workflow filename | `release.yml` |
| Allowed actions | cukup **`npm stage publish`** (biarkan `npm publish` tidak dicentang) |

Workflow memakai **staged publishing**: CI hanya boleh menaruh versi di ruang tunggu, lalu kamu menyetujuinya dengan 2FA:

```bash
npm stage list @yespos/client     # ambil stage-id
npm stage approve <stage-id>      # minta 2FA, lalu versi terbit
```

Atau lewat npmjs.com → paket → tab **Staged Packages** → Approve. Perintahnya juga muncul di ringkasan job Actions setelah rilis.

Alasannya: tanpa langkah ini, siapa pun yang bisa mendorong tag — atau dependency build yang disusupi — dapat menerbitkan versi ke semua pengguna tanpa sepengetahuan manusia.

Syarat: `repository.url` di package.json harus sama persis dengan repo GitHub-nya, dan konfigurasi trusted publisher harus dipakai untuk publish pertama dalam 2 hari atau kedaluwarsa.

> Publish **pertama** tetap manual (`npm publish`), karena trusted publisher baru bisa didaftarkan setelah paketnya ada di npm.

## Lisensi

MIT
