"""Join the synthetic challenge data by profile_id and emit static JSON for the frontend.

Usage: python scripts/build_data.py [data_dir] [out_dir]
"""
import csv
import io
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "external" / "ubs" / "Data"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "frontend" / "public" / "data"

NUMERIC = {
    "age_at_start", "opening_cash_chf", "reference_monthly_net_income_chf", "reference_monthly_rent_chf",
    "opening_balance_chf", "net_transactions_chf", "closing_cash_chf", "value_chf", "opening_principal_chf",
    "annual_interest_rate", "monthly_payment_chf", "target_amount_chf", "cash_effect_chf", "amount_chf",
}


def clean(row):
    out = {}
    for key, value in row.items():
        if key == "synthetic":
            out[key] = value == "true"
        elif value == "":
            out[key] = None
        else:
            out[key] = float(value) if key in NUMERIC else value
    return out


def read(stream):
    return [clean(r) for r in csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline=""))]


def read_csv(name):
    with open(DATA / name, "rb") as f:
        return read(f)


def by_profile(rows):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["profile_id"]].append(row)
    return grouped


profiles = read_csv("synthetic-profiles.csv")
accounts = by_profile(read_csv("synthetic-accounts.csv"))
balances = by_profile(read_csv("synthetic-cash-balances.csv"))
assets = by_profile(read_csv("synthetic-assets.csv"))
liabilities = by_profile(read_csv("synthetic-liabilities.csv"))
goals = by_profile(read_csv("synthetic-goals.csv"))
events = by_profile(read_csv("life-events.csv"))
assumptions = by_profile(read_csv("scenario-assumptions.csv"))

with zipfile.ZipFile(DATA / "synthetic-transactions.zip") as z:
    with z.open("synthetic-transactions.csv") as f:
        transactions = by_profile(read(f))

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "profiles").mkdir(exist_ok=True)

index = []
for p in profiles:
    pid = p["profile_id"]
    account = accounts[pid][0]
    rows = sorted(transactions[pid], key=lambda t: (t["date"], t["transaction_id"]))
    for t in rows:
        assert t["account_id"] == account["account_id"] and t["currency"] == "CHF"
        assert (t["transaction_type"] == "income") == (t["amount_chf"] > 0)
    record = {
        "profile": p,
        "accounts": accounts[pid],
        "balances": balances[pid],
        "assets": assets[pid],
        "liabilities": liabilities[pid],
        "goals": goals[pid],
        "events": events[pid],
        "assumptions": assumptions[pid],
        "transactions": [[t["transaction_id"], t["date"], t["category"], t["amount_chf"], t["description"]] for t in rows],
    }
    (OUT / "profiles" / f"{pid}.json").write_text(json.dumps(record, separators=(",", ":")), encoding="utf-8")
    index.append({k: p[k] for k in ("profile_id", "display_name", "age_at_start", "city", "canton", "employment_status", "household_type")})

(OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")
(OUT / "scenarios.json").write_text(json.dumps(read_csv("scenario-catalog.csv"), separators=(",", ":")), encoding="utf-8")
print(f"{len(index)} profiles, {sum(len(v) for v in transactions.values())} transactions -> {OUT}")
