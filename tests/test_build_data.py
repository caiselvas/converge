import json
import unittest
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "data"


@unittest.skipUnless((OUT / "index.json").exists(), "run python scripts/build_data.py first")
class BuildDataTest(unittest.TestCase):
    def test_every_profile_is_linked_and_reconciles(self):
        index = json.loads((OUT / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(len(index), 1200)
        self.assertEqual(sum(len(json.loads((OUT / "profiles" / f"{p['profile_id']}.json").read_text(encoding="utf-8"))["transactions"]) for p in index), 552295)
        for entry in index:
            r = json.loads((OUT / "profiles" / f"{entry['profile_id']}.json").read_text(encoding="utf-8"))
            self.assertEqual(r["profile"]["profile_id"], entry["profile_id"])
            self.assertEqual(len(r["balances"]), 24)
            self.assertEqual(r["accounts"][0]["opening_balance_chf"], r["profile"]["opening_cash_chf"])
            net = defaultdict(float)
            for _, date, _, amount, _ in r["transactions"]:
                net[date[:7]] += amount
            for b in r["balances"]:
                self.assertAlmostEqual(net[b["month"]], b["net_transactions_chf"], places=1)
                self.assertAlmostEqual(b["opening_cash_chf"] + b["net_transactions_chf"], b["closing_cash_chf"], places=1)

    def test_scenarios_and_sparse_tables(self):
        self.assertEqual(len(json.loads((OUT / "scenarios.json").read_text(encoding="utf-8"))), 120)
        alexia = json.loads((OUT / "profiles" / "P00001.json").read_text(encoding="utf-8"))
        self.assertEqual((len(alexia["liabilities"]), len(alexia["events"]), len(alexia["assumptions"])), (0, 3, 2))


if __name__ == "__main__":
    unittest.main()
