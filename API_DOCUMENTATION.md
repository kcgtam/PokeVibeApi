# PokéVibe API — Tài liệu API & Công nghệ

Backend serverless cho tiện ích mở rộng trình duyệt **PokeVibeTab** — hiển thị Pokémon Gen 1 (151 Pokémon) mỗi khi mở tab mới.

- **Base URL:** `https://api.pokevibetab.app`
- **Asset CDN:** `https://assets.pokevibetab.app`
- **Nguồn dữ liệu gốc:** [PokeAPI](https://pokeapi.co/api/v2)

---

## 1. Danh sách API

Tất cả endpoint chỉ hỗ trợ phương thức `GET` (và `OPTIONS` cho CORS preflight). Các phương thức khác trả về `405 Method Not Allowed`.

### 1.1. Health check

```
GET /
GET /health
```

Kiểm tra tình trạng hoạt động của service.

**Response `200`:**

```json
{
  "ok": true,
  "service": "pokevibe-api",
  "time": "2026-07-15T10:00:00.000Z"
}
```

---

### 1.2. Lấy dữ liệu Pokémon (tab-data)

```
GET /pokemon/{name-or-id}/tab-data
```

Trả về dữ liệu đầy đủ của một Pokémon để hiển thị trên tab. Tham số nhận **tên** (vd: `pikachu`) hoặc **ID** (vd: `25`).

**Response `200`:**

```json
{
  "id": 25,
  "name": "pikachu",
  "displayName": "Pikachu",
  "types": ["electric"],
  "ability": "static",
  "stats": {
    "hp": 35,
    "attack": 55,
    "defense": 40,
    "speed": 90
  },
  "artwork": "https://assets.pokevibetab.app/pokemon/official-artwork/25.webp",
  "species": {
    "genus": "Mouse Pokémon",
    "flavorText": "...",
    "habitat": "Forest",
    "generation": "Generation I",
    "captureRate": 190,
    "baseHappiness": 50,
    "color": "Yellow",
    "shape": "Quadruped"
  },
  "encounters": ["Viridian Forest Area", "..."],
  "encounterDetails": [
    {
      "locationAreaName": "viridian-forest-area",
      "displayName": "Viridian Forest Area",
      "region": "Kanto",
      "methods": ["Walk"],
      "versions": ["Red", "Blue"],
      "minLevel": 3,
      "maxLevel": 5,
      "chance": 5,
      "maxChance": 10,
      "conditions": []
    }
  ],
  "evolutionChain": [
    {
      "id": 25,
      "name": "pikachu",
      "displayName": "Pikachu",
      "artwork": "https://assets.pokevibetab.app/pokemon/official-artwork/25.webp"
    },
    {
      "id": 26,
      "name": "raichu",
      "displayName": "Raichu",
      "artwork": "https://assets.pokevibetab.app/pokemon/official-artwork/26.webp"
    }
  ],
  "cached": true
}
```

**Ghi chú các trường:**

| Trường | Mô tả |
|---|---|
| `stats` | 4 chỉ số cơ bản: HP, Attack, Defense, Speed |
| `artwork` | Ảnh official artwork định dạng WebP, serve từ CDN riêng |
| `species.flavorText` | Mô tả tiếng Anh, đã làm sạch ký tự xuống dòng |
| `encounters` | Tối đa 6 địa điểm bắt gặp (tên hiển thị) |
| `encounterDetails` | Tối đa 10 địa điểm với chi tiết: vùng, phương thức, phiên bản game, khoảng cấp độ, tỉ lệ xuất hiện, điều kiện |
| `evolutionChain` | Chuỗi tiến hóa, chỉ gồm các Pokémon có ID 1–151 |
| `cached` | `true` nếu dữ liệu lấy từ cache, `false` nếu vừa fetch từ PokeAPI |

---

### 1.3. Pokémon ngẫu nhiên (theo mood)

```
GET /random
GET /random?mood={mood}
```

Chọn ngẫu nhiên một Pokémon Gen 1 và trả về dữ liệu tab-data (cùng cấu trúc mục 1.2).

**Query parameter:**

| Tham số | Bắt buộc | Mô tả |
|---|---|---|
| `mood` | Không | Lọc theo "tâm trạng". Nếu không truyền hoặc không hợp lệ → chọn từ toàn bộ 151 Pokémon |

**Các mood hỗ trợ:**

| Mood | Ý nghĩa | Ví dụ Pokémon |
|---|---|---|
| `cute` | Dễ thương | Pikachu, Jigglypuff, Eevee, Chansey |
| `strong` | Mạnh mẽ | Charizard, Machamp, Gyarados, Snorlax, Dragonite |
| `fast` | Tốc độ cao | Pikachu, Alakazam, Jolteon, Aerodactyl |
| `tanky` | Trâu bò, phòng thủ tốt | Venusaur, Blastoise, Snorlax, Lapras |
| `fire` | Hệ lửa | Charmander, Charizard, Arcanine, Moltres |
| `water` | Hệ nước | Squirtle, Blastoise, Gyarados, Lapras |
| `electric` | Hệ điện | Pikachu, Raichu, Electrode, Zapdos |
| `grass` | Hệ cỏ | Bulbasaur, Venusaur, Vileplume, Tangela |

---

### 1.4. Lỗi

**`404 Not Found`** — route không tồn tại:

```json
{
  "error": "Not found",
  "path": "/abc",
  "supportedRoutes": [
    "GET /health",
    "GET /random",
    "GET /pokemon/{name-or-id}/tab-data"
  ]
}
```

**`405 Method Not Allowed`** — dùng phương thức khác GET.

**`500 Internal Server Error`** — lỗi nội bộ (vd: PokeAPI không phản hồi):

```json
{
  "error": "Internal server error",
  "message": "..."
}
```

---

## 2. CORS

API mở cho mọi origin (phục vụ browser extension):

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

---

## 3. Cơ chế cache

- Dữ liệu Pokémon fetch từ PokeAPI được cache vào bảng `pokemon_cache` (Appwrite Database `pokevibe`) theo mô hình key/value.
- **TTL:** 30 ngày (cấu hình qua env `CACHE_TTL_DAYS`).
- **Cache key:** `pokemon:v2:{name-or-id}:tab-data:v3` (schema version hiện tại: `v3`).
- Cấu trúc bảng `pokemon_cache`:

| Cột | Kiểu | Mô tả |
|---|---|---|
| `key` | string(255) | Cache key, có index `key_idx` |
| `value` | string(50000) | JSON dữ liệu đã serialize |
| `expiresAt` | datetime | Thời điểm hết hạn, có index `expires_at_idx` |
| `source` | string(50) | Nguồn dữ liệu (`pokeapi`) |
| `updatedAt` | datetime | Lần cập nhật gần nhất |

---

## 4. Công nghệ sử dụng

### 4.1. Hạ tầng & nền tảng

| Thành phần | Công nghệ | Ghi chú |
|---|---|---|
| Serverless platform | **Appwrite Cloud** (region Singapore — `sgp.cloud.appwrite.io`) | Project: PokéVibe API |
| Compute | **Appwrite Function** `pokevibe-api` | Runtime **Node.js 25**, spec 0.5 vCPU / 512MB, timeout 15s, quyền execute: `any` |
| Database | **Appwrite Database (TablesDB)** `pokevibe` | Bảng `pokemon_cache` dùng làm cache layer |
| Lưu trữ ảnh | **Cloudflare R2** (bucket `pokevibe-assets`) | Serve qua CDN `assets.pokevibetab.app` |
| Nguồn dữ liệu | **PokeAPI v2** | Fetch on-demand, cache 30 ngày |

### 4.2. Ngôn ngữ & thư viện

| Thư viện | Dùng ở đâu | Mục đích |
|---|---|---|
| JavaScript (ESM) | Toàn bộ dự án | Ngôn ngữ chính |
| `node-appwrite` | Function | SDK thao tác Appwrite Database (cache) |
| `@aws-sdk/client-s3` | Script upload | Upload ảnh lên Cloudflare R2 (giao thức S3-compatible) |
| `sharp` | Script upload | Convert ảnh artwork sang WebP |
| `fetch` (native) | Function & scripts | Gọi PokeAPI |
| Prettier | Function | Format code |

### 4.3. Scripts hỗ trợ (chạy tay ở local)

| Script | Mục đích |
|---|---|
| `scripts/upload-pokemon-artwork-r2.js` | Tải official artwork của 151 Pokémon Gen 1, convert sang WebP, upload lên R2. ID lỗi được ghi vào `failed-artwork-ids.json` để retry |
| `scripts/warm-cache.js` | Gọi tuần tự `GET /pokemon/{id}/tab-data` cho cả 151 Pokémon (delay 1s/request) để làm nóng cache |

### 4.4. Biến môi trường

**Appwrite Function:**

| Biến | Mô tả | Mặc định |
|---|---|---|
| `APPWRITE_ENDPOINT` | Endpoint Appwrite | — |
| `APPWRITE_PROJECT_ID` | Project ID | — |
| `APPWRITE_API_KEY` | API key | — |
| `APPWRITE_DATABASE_ID` | Database ID | — |
| `APPWRITE_COLLECTION_ID` / `APPWRITE_TABLE_ID` | Bảng cache | `pokemon_cache` |
| `POKEAPI_BASE_URL` | Base URL PokeAPI | `https://pokeapi.co/api/v2` |
| `CACHE_TTL_DAYS` | Số ngày cache | `30` |
| `ASSET_BASE_URL` | CDN ảnh | `https://assets.pokevibetab.app` |

**Script upload R2:**

| Biến | Mô tả | Mặc định |
|---|---|---|
| `R2_ENDPOINT` hoặc `R2_ACCOUNT_ID` | Endpoint R2 | — |
| `R2_ACCESS_KEY_ID` | Access key | — |
| `R2_SECRET_ACCESS_KEY` | Secret key | — |
| `R2_BUCKET` | Tên bucket | `pokevibe-assets` |
| `FAILED_FILE` | File lưu ID lỗi | `failed-artwork-ids.json` |
| `DELAY_MS` | Delay giữa các request | `15000` |

---

## 5. Phạm vi hiện tại

- Chỉ hỗ trợ **Gen 1 — 151 Pokémon** (Bulbasaur → Mew).
- Chuỗi tiến hóa chỉ hiển thị các Pokémon trong phạm vi ID 1–151.
- Cache schema version: `v3`.
