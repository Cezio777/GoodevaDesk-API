# GoodevaDesk - AI-Powered Ticket Management API

GoodevaDesk adalah sistem backend manajemen tiket pelanggan (*Helpdesk*) multi-tenant yang dilengkapi dengan klasifikasi AI otomatis dan sistem *caching* tingkat lanjut. Proyek ini dibangun menggunakan **NestJS, Prisma, PostgreSQL**, dan **Redis**, serta mengintegrasikan LLM untuk analisis kontekstual tiket.

## 🚀 Fitur Utama

- **Multi-Tenant Architecture**: Isolasi data berbasis `organization_id` menggunakan `ApiKeyGuard` dan kustom *decorator*.
- **High-Availability AI Integration**: Menggunakan Google Gemini sebagai LLM utama dengan mekanisme *fallback* ke Groq jika terjadi *rate-limit* atau kegagalan API.
- **Smart Redis Caching**: Menghemat biaya API (LLM) dengan melakukan *caching* pada pesan identik menggunakan normalisasi teks dan MD5/SHA256 hashing.
- **Python NLP Evaluator**: Pipeline eksperimental menggunakan GLiNER (NER) dan mDeBERTa (Zero-shot NLI) untuk membandingkan dan mengevaluasi hasil klasifikasi LLM.
- **Fault-Tolerant**: Jika seluruh layanan pihak ketiga (LLM/Cache) *down*, sistem tetap memproses dan menyimpan tiket dengan aman (graceful degradation).

---

## 🏗 Arsitektur & Alur Sistem

```text
[Client] -> POST /tickets
   ↓
[AuthGuard] -> Validasi `x-api-key` -> Ekstrak `organization_id`
   ↓
[Redis Cache] -> Cek Hash(Subject + Message). 
   ├── [Hit]  -> Kembalikan hasil dari cache.
   └── [Miss] -> Panggil [AiService]
                   ├── Coba Gemini 3.8 Flash
                   ├── (Jika Gagal) -> Fallback ke Groq (gpt-oss-20b)
                   └── (Jika Gagal) -> Return `null` (Fallback safety)
   ↓
[PostgreSQL] -> Simpan Tiket (beserta hasil AI/null)
   ↓
[Response] -> 201 Created
```

## 🛠 Teknologi Utama
Backend: NestJS, TypeScript, Prisma ORM

Database: PostgreSQL

Cache: Redis (via ioredis)

AI/LLM: Google Generative AI SDK, OpenAI SDK (untuk Groq)

Containerization: Docker & Docker Compose

NLP (Opsional): Python 3, HuggingFace (gliner, transformers)

##    ⚙️ Cara Menjalankan Aplikasi
Anda dapat menjalankan aplikasi ini secara lokal menggunakan Docker Compose tanpa perlu menginstal PostgreSQL atau Redis di mesin Anda.

1. Persiapan Environment
```bash
cp .env.example .env
# Buka file .env dan masukkan GEMINI_API_KEY dan GROQ_API_KEY Anda
```

2. Jalankan dengan Docker Compose
```bash
Perintah ini akan mem-build image NestJS, menjalankan container PostgreSQL dan Redis, serta otomatis menjalankan migrasi dan seeding database.
docker compose up --build -d
```

3. Uji Coba API (Seeding Default)
Database telah di-seed dengan dua organisasi. Anda dapat menguji endpoint menggunakan cURL atau Postman:

Acme Corp API Key: sk_live_123456789

Globex Inc API Key: sk_live_987654321

Contoh Request (POST):
```bash
curl -X POST http://localhost:3000/tickets \
  -H "x-api-key: sk_live_123456789" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_email": "user@example.com",
    "subject": "Gagal login",
    "message": "Saya tidak bisa masuk ke akun saya, selalu muncul error 500."
  }'
```

## 🧠 Keputusan Desain & Strategi Implementasi
1. Strategi Provider LLM & Error Handling
Saya memilih Google Gemini (gemini-3.8-flash) sebagai provider utama karena kapabilitas reasoning yang cepat. Namun, karena model gratis sering mengalami kendala rate-limiting (429) atau server overload (503), saya mengimplementasikan Groq (gpt-oss-20b) via OpenAI SDK sebagai sistem fallback.

Error Handling: Jika kedua LLM mengalami timeout atau gagal mem-parsing JSON, sistem menangkap exception (try-catch) dan me-return category: null. Tiket akan tetap tersimpan di database untuk diproses agen manual, memastikan tidak ada data pelanggan yang hilang.

Contoh Prompt yang Digunakan:
```bash
Anda adalah asisten AI untuk layanan pelanggan.
Analisis tiket berikut:
Subjek: "{subject}"
Pesan: "{message}"

Tugas Anda:
1. Klasifikasikan kategori tiket secara ketat ke salah satu dari: "billing", "technical", atau "general".
2. Buat draf balasan singkat untuk membantu agen (suggested_reply) dalam bahasa yang sama dengan pesan pelanggan.

PENTING: Jawab HANYA menggunakan format JSON murni tanpa tambahan teks...
```

2. Strategi Caching (Redis)
Untuk mengurangi latensi LLM dan menghemat cost/quota API, saya mengimplementasikan caching dengan ioredis.

Cache Key: ticket_cache:{organizationId}:{hash}. Kombinasi subject dan message dinormalisasi (trim, lowercase, penghapusan spasi ganda) lalu di-hash (MD5/SHA256).

TTL: 1 Hari (86400 detik). Hanya respons LLM yang valid yang disimpan di dalam cache. Jika Redis down, operasi menggunakan try-catch akan melanjutkannya ke LLM (best-effort).

3. Eksperimen NLP (Bagian D)
Terdapat script Python di folder nlp/ yang mengimplementasikan pendekatan ekstraksi entitas dan Zero-Shot Classification (NLI) menggunakan model mDeBERTa.

Hasil Evaluasi: NLI mencapai akurasi 83% (5/6) jika dibandingkan dengan LLM dan human label.

Temuan: Model NLI memiliki tingkat kepercayaan yang sangat presisi (akurasi 88%) jika confidence score berada di atas >= 0.6. Ini membuka peluang penggunaan model NLI lokal (tanpa biaya LLM) sebagai filter tahap pertama di masa depan.

Cara Menjalankan Script NLP:
```bash
cd nlp
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python analyze_tickets.py --source file
```

## 📈 Rencana Peningkatan (Future Improvements)
Jika saya memiliki waktu ekstra untuk proyek ini, beberapa hal yang akan saya tambahkan:

Message Broker (RabbitMQ/Kafka): Memindahkan proses pemanggilan LLM ke background job / worker (Asynchronous processing) agar latensi endpoint POST /tickets menjadi < 100ms.

Unit Testing & Coverage: Menambahkan unit test spesifik menggunakan Jest untuk menyimulasikan kegagalan LLM dan memvalidasi logika fallback tanpa memanggil API pihak ketiga.

Vector Database / RAG: Menyimpan knowledge base perusahaan ke dalam database vektor agar suggested_reply yang dihasilkan LLM bisa merujuk langsung ke dokumentasi internal (SOP) perusahaan.