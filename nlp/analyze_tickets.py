import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path

import requests
from gliner import GLiNER
from transformers import pipeline

API_URL = os.getenv("API_URL", "http://localhost:3000")
API_KEY = os.getenv("API_KEY")

NLI_MODEL = "MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7"
NER_MODEL = "urchade/gliner_multi-v2.1"

# v1 = baseline awal, v2 = deskripsi label yang lebih lebar dan spesifik
LABEL_SETS = {
    "v1": {
        "tagihan, pembayaran, atau penagihan": "billing",
        "masalah teknis atau error pada produk": "technical",
        "pertanyaan atau permintaan umum": "general",
    },
    "v2": {
        "tagihan, pembayaran, harga, biaya langganan, atau faktur": "billing",
        "kendala teknis seperti error, gangguan akses, atau performa aplikasi yang lambat": "technical",
        "pertanyaan umum, informasi layanan, atau saran untuk produk": "general",
    },
}
CONFIDENCE_THRESHOLD = 0.6

NER_LABELS = ["person name", "email address", "phone number", "order id", "company"]
LABEL_ALIAS = {
    "person name": "person",
    "email address": "email",
    "phone number": "phone",
    "order id": "order_id",
}
PRONOUNS = {"saya", "kami", "kita", "anda", "aku", "kamu"}

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE_RE = re.compile(r"(?<!\d)(?:\+?62[\s.-]?|0)8\d{1,3}[\s.-]?\d{3,4}[\s.-]?\d{2,5}(?!\d)")
ID_RE = re.compile(r"\b[A-Z]{2,5}-\d{4}-\d{3,6}\b")


def pct(n, d):
    return f"{n}/{d} ({n / d:.0%})" if d else "n/a"


def clean(value):
    return value.strip(" .,;:!?\"'()")


def fetch_tickets_api():
    if not API_KEY:
        sys.exit("Set environment variable API_KEY terlebih dahulu.")
    tickets, page = [], 1
    while True:
        res = requests.get(
            f"{API_URL}/tickets",
            params={"page": page, "limit": 100},
            headers={"x-api-key": API_KEY},
            timeout=30,
        )
        res.raise_for_status()
        body = res.json()
        if isinstance(body, dict) and "data" in body:
            tickets.extend(body["data"])
            if page >= body.get("meta", {}).get("total_pages", 1):
                break
            page += 1
        else:
            tickets.extend(body)
            break
    return tickets


def extract_entities(ner, text):
    found = {
        "email": set(EMAIL_RE.findall(text)),
        "phone": {clean(m) for m in PHONE_RE.findall(text)},
        "order_id": set(ID_RE.findall(text)),
    }
    for ent in ner.predict_entities(text, NER_LABELS, threshold=0.5):
        label = LABEL_ALIAS.get(ent["label"], ent["label"])
        value = clean(ent["text"])
        if not value:
            continue
        if label == "person" and value.lower() in PRONOUNS:
            continue
        found.setdefault(label, set()).add(value)

    # Buang 'person' yang sebenarnya potongan email (mis. "sari" dari sari@startup.id)
    emails = " ".join(found["email"]).lower()
    if "person" in found:
        found["person"] = {p for p in found["person"] if p.lower() not in emails}
    return {k: sorted(v) for k, v in found.items() if v}


def classify(nli, text, label_map):
    out = nli(
        text,
        candidate_labels=list(label_map.keys()),
        hypothesis_template="Pesan ini tentang {}.",
    )
    return label_map[out["labels"][0]], round(out["scores"][0], 3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["api", "file"], default="api",
                        help="api: ambil tiket dari API NestJS; file: pakai file JSON lokal")
    parser.add_argument("--file", default="sample_tickets.json")
    parser.add_argument("--label-set", choices=list(LABEL_SETS), default="v2")
    args = parser.parse_args()
    label_map = LABEL_SETS[args.label_set]

    labels_path = Path(args.file) if Path(args.file).exists() else Path("sample_tickets.json")
    samples = json.loads(labels_path.read_text(encoding="utf-8")) if labels_path.exists() else []
    expected_by_subject = {s["subject"]: s.get("expected_category") for s in samples}

    if args.source == "file":
        tickets = [
            {"id": f"sample-{i + 1}", "subject": s["subject"], "message": s["message"], "category": None}
            for i, s in enumerate(samples)
        ]
    else:
        tickets = fetch_tickets_api()

    if not tickets:
        sys.exit("Tidak ada tiket untuk dianalisis.")

    print(f"{len(tickets)} tiket | label set: {args.label_set}. Memuat model...")
    ner = GLiNER.from_pretrained(NER_MODEL)
    nli = pipeline("zero-shot-classification", model=NLI_MODEL)

    rows = []
    llm_total = agree = 0
    exp_total = nli_ok = 0
    llm_exp_total = llm_ok = 0
    conf_total = conf_ok = unc_total = unc_ok = 0
    # Baca llm_category dari file jika ada (untuk mode file dengan data berlabel LLM)
    llm_by_subject = {s.get("subject"): s.get("llm_category") for s in samples if s.get("llm_category")}

    for t in tickets:
        text = f"{t['subject']}. {t['message']}"
        entities = extract_entities(ner, text)
        nli_cat, score = classify(nli, text, label_map)
        llm_cat = t.get("category") or llm_by_subject.get(t.get("subject"))
        expected = expected_by_subject.get(t["subject"])
        confident = score >= CONFIDENCE_THRESHOLD

        if llm_cat:
            llm_total += 1
            agree += llm_cat == nli_cat
        if expected:
            exp_total += 1
            nli_ok += nli_cat == expected
            if confident:
                conf_total += 1
                conf_ok += nli_cat == expected
            else:
                unc_total += 1
                unc_ok += nli_cat == expected
            if llm_cat:
                llm_exp_total += 1
                llm_ok += llm_cat == expected

        rows.append({
            "id": t["id"],
            "subject": t["subject"],
            "expected": expected or "",
            "llm_category": llm_cat or "",
            "nli_category": nli_cat,
            "nli_score": score,
            "confident": confident,
            "entities": json.dumps(entities, ensure_ascii=False),
        })

    out_name = f"comparison_{args.label_set}.csv"
    with open(out_name, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)

    for r in rows:
        flag = " " if r["confident"] else "?"
        print(f"- {r['subject'][:34]:34} | exp={r['expected'] or '-':9} | llm={r['llm_category'] or '-':9} "
              f"| nli={r['nli_category']:9} ({r['nli_score']}){flag} | {r['entities']}")

    print(f"\n=== Ringkasan (label set {args.label_set}) ===")
    print(f"NLI vs label manual          : {pct(nli_ok, exp_total)}")
    print(f"  - skor >= {CONFIDENCE_THRESHOLD}               : {pct(conf_ok, conf_total)}")
    print(f"  - skor <  {CONFIDENCE_THRESHOLD} (ditandai ?)  : {pct(unc_ok, unc_total)}")
    print(f"LLM vs label manual          : {pct(llm_ok, llm_exp_total)}")
    print(f"LLM vs NLI (sepakat)         : {pct(agree, llm_total)}")
    print(f"Hasil lengkap: {out_name}")


if __name__ == "__main__":
    main()