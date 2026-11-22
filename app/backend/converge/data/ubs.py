"""Loading and reconciling the UBS synthetic Financial Twin datasets.

The transaction ledger ships as ``synthetic-transactions.zip``; it is read
directly from the archive (no extraction to disk). Aggregates per profile are
cached in memory, and optionally on disk, keyed by the archive's mtime/size.
"""
from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd

from converge import config

TX_ZIP = "synthetic-transactions.zip"
TX_MEMBER = "synthetic-transactions.csv"


class DataUnavailableError(RuntimeError):
    pass


def data_dir() -> Path:
    d = config.UBS_DATA_DIR
    if not (d / "synthetic-profiles.csv").exists():
        raise DataUnavailableError(
            f"UBS data not found in {d}. Import the challenge resources into external/ubs/ "
            "(see README) or set CONVERGE_UBS_DATA_DIR."
        )
    return d


@lru_cache(maxsize=None)
def _csv(name: str) -> pd.DataFrame:
    return pd.read_csv(data_dir() / name)


def profiles() -> pd.DataFrame:
    return _csv("synthetic-profiles.csv")


def assets() -> pd.DataFrame:
    return _csv("synthetic-assets.csv")


def liabilities() -> pd.DataFrame:
    return _csv("synthetic-liabilities.csv")


def goals() -> pd.DataFrame:
    return _csv("synthetic-goals.csv")


def cash_balances() -> pd.DataFrame:
    return _csv("synthetic-cash-balances.csv")


def life_events() -> pd.DataFrame:
    return _csv("life-events.csv")


def _tx_from_zip(profile_ids: tuple[str, ...] | None = None) -> pd.DataFrame:
    path = data_dir() / TX_ZIP
    with zipfile.ZipFile(path) as zf:
        # Ignore macOS resource-fork entries (__MACOSX/...) shipped in the archive.
        member = next(n for n in zf.namelist() if n.endswith(TX_MEMBER) and not n.startswith("__MACOSX"))
        with zf.open(member) as fh:
            df = pd.read_csv(
                fh,
                usecols=["transaction_id", "profile_id", "date", "transaction_type", "category", "amount_chf", "account_id"],
                dtype={"profile_id": "category", "transaction_type": "category", "category": "category"},
            )
    if profile_ids is not None:
        df = df[df["profile_id"].isin(profile_ids)]
    df["month"] = df["date"].str.slice(0, 7)
    return df


@lru_cache(maxsize=1)
def all_transactions() -> pd.DataFrame:
    return _tx_from_zip()


@lru_cache(maxsize=64)
def transactions_for(profile_id: str) -> pd.DataFrame:
    return all_transactions().query("profile_id == @profile_id").copy()


@dataclass(frozen=True)
class CategoryStats:
    category: str
    transaction_type: str
    total_chf: float
    months_present: int
    months_observed: int
    trailing12_monthly_chf: float
    mean_monthly_chf: float
    n_transactions: int

    @property
    def regular(self) -> bool:
        """Present in at least 75% of observed months -> treated as recurring."""
        return self.months_present >= 0.75 * self.months_observed


def _cache_key() -> str:
    st = (data_dir() / TX_ZIP).stat()
    return f"{int(st.st_mtime)}-{st.st_size}"


def profile_ledger_summary(profile_id: str) -> dict:
    """Per-category statistics plus reconciliation against the cash-balance file."""
    cache_file = config.CACHE_DIR / f"ledger-{profile_id}-{_cache_key()}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())

    tx = transactions_for(profile_id)
    if tx.empty:
        raise DataUnavailableError(f"No transactions for profile {profile_id}")
    months = sorted(tx["month"].unique())
    last12 = months[-12:]
    cats = []
    for (ttype, cat), g in tx.groupby(["transaction_type", "category"], observed=True):
        by_month = g.groupby("month")["amount_chf"].sum()
        t12 = g[g["month"].isin(last12)]["amount_chf"].sum() / len(last12)
        cats.append(
            dict(
                category=str(cat),
                transaction_type=str(ttype),
                total_chf=round(float(g["amount_chf"].sum()), 2),
                months_present=int(by_month.size),
                months_observed=len(months),
                trailing12_monthly_chf=round(float(t12), 2),
                mean_monthly_chf=round(float(g["amount_chf"].sum()) / len(months), 2),
                n_transactions=int(len(g)),
            )
        )

    # Reconciliation: opening cash + net transactions == closing cash, month by month.
    cb = cash_balances().query("profile_id == @profile_id").sort_values("month")
    net_by_month = tx.groupby("month")["amount_chf"].sum()
    max_err_net = 0.0
    max_err_chain = 0.0
    prev_close = None
    for row in cb.itertuples():
        ledger_net = float(net_by_month.get(row.month, 0.0))
        max_err_net = max(max_err_net, abs(ledger_net - row.net_transactions_chf))
        max_err_chain = max(max_err_chain, abs(row.opening_cash_chf + row.net_transactions_chf - row.closing_cash_chf))
        if prev_close is not None:
            max_err_chain = max(max_err_chain, abs(prev_close - row.opening_cash_chf))
        prev_close = row.closing_cash_chf
    last = cb.iloc[-1]
    summary = dict(
        profile_id=profile_id,
        first_month=months[0],
        last_month=months[-1],
        months_observed=len(months),
        n_transactions=int(len(tx)),
        categories=cats,
        closing_cash_chf=round(float(last.closing_cash_chf), 2),
        closing_month=str(last.month),
        opening_cash_chf=round(float(cb.iloc[0].opening_cash_chf), 2),
        reconciliation=dict(
            max_abs_error_net_vs_ledger_chf=round(max_err_net, 6),
            max_abs_error_balance_chain_chf=round(max_err_chain, 6),
            negative_balance_months=int((cb["status"] != "ok").sum()),
        ),
    )
    try:
        config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(summary))
    except OSError:
        pass
    return summary


def profile_record(profile_id: str) -> dict:
    df = profiles().query("profile_id == @profile_id")
    if df.empty:
        raise DataUnavailableError(f"Unknown profile {profile_id}")
    return df.iloc[0].to_dict()


def profile_assets(profile_id: str) -> list[dict]:
    return assets().query("profile_id == @profile_id").to_dict("records")


def profile_liabilities(profile_id: str) -> list[dict]:
    return liabilities().query("profile_id == @profile_id").to_dict("records")


def profile_goals(profile_id: str) -> list[dict]:
    return goals().query("profile_id == @profile_id").to_dict("records")


def profile_life_events(profile_id: str) -> list[dict]:
    return life_events().query("profile_id == @profile_id").to_dict("records")
