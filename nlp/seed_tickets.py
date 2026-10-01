import json
import os
import sys
from pathlib import Path

import requests

API_URL = os.getenv("API_URL", "http://localhost:3000")
API_KEY = os.getenv("API_KEY")

BASE_DIR = Path(__file__).resolve().parent
SAMPLE_FILE = BASE_DIR / "sample_tickets.json"


def main():
    if not API_KEY:
        sys.exit(
            "API_KEY belum diset.\n"
            "Contoh CMD:\n"
            "set API_KEY=api-key-organisasi-kamu"
        )

    if not SAMPLE_FILE.exists():
        sys.exit(f"File tidak ditemukan: {SAMPLE_FILE}")

    tickets = json.loads(SAMPLE_FILE.read_text(encoding="utf-8"))

    headers = {
        "x-api-key": API_KEY,
        "Content-Type": "application/json",
    }

    print(f"API       : {API_URL}")
    print(f"Total data: {len(tickets)} tiket")
    print()

    success = 0
    failed = 0

    for i, ticket in enumerate(tickets, start=1):
        payload = {
            "customer_email": ticket["customer_email"],
            "subject": ticket["subject"],
            "message": ticket["message"],
        }

        try:
            response = requests.post(
                f"{API_URL}/tickets",
                json=payload,
                headers=headers,
                timeout=60,
            )

            if response.ok:
                success += 1

                try:
                    body = response.json()
                    category = body.get("category")
                    status = body.get("status")
                    print(
                        f"[{i:02d}/{len(tickets)}] OK   "
                        f"{ticket['subject']} | "
                        f"category={category} | status={status}"
                    )
                except ValueError:
                    print(
                        f"[{i:02d}/{len(tickets)}] OK   "
                        f"{ticket['subject']} | "
                        f"HTTP {response.status_code}"
                    )
            else:
                failed += 1
                print(
                    f"[{i:02d}/{len(tickets)}] FAIL "
                    f"{ticket['subject']} | "
                    f"HTTP {response.status_code} | "
                    f"{response.text}"
                )

        except requests.RequestException as exc:
            failed += 1
            print(
                f"[{i:02d}/{len(tickets)}] ERROR "
                f"{ticket['subject']} | {exc}"
            )

    print()
    print("=== Ringkasan ===")
    print(f"Berhasil : {success}/{len(tickets)}")
    print(f"Gagal    : {failed}/{len(tickets)}")


if __name__ == "__main__":
    main()