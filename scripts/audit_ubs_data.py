"""Read every supplied CSV row, including zipped transactions, without extracting data.

Usage: python scripts/audit_ubs_data.py PATH_TO_CHALLENGE_ROOT
Prints derived audit results only. Does not modify or copy source datasets.
"""
import argparse
from collections import Counter, defaultdict
import csv
from decimal import Decimal
import io
import json
from pathlib import Path
import zipfile


def audit(root):
    tables = {}
    for path in sorted(root.rglob('*.csv')):
        with path.open(encoding='utf-8-sig', newline='') as stream:
            tables[path.name] = list(csv.DictReader(stream))
    profiles = {r['profile_id']: r for r in tables['synthetic-profiles.csv']}
    accounts = {r['account_id']: r for r in tables['synthetic-accounts.csv']}
    report = {'tables': {}, 'checks': {}, 'transaction_summary': {}}
    for name, rows in tables.items():
        report['tables'][name] = {
            'rows': len(rows), 'columns': list(rows[0]) if rows else [],
            'profile_count': len({r['profile_id'] for r in rows if 'profile_id' in r}),
            'unknown_profiles': sum(r['profile_id'] not in profiles for r in rows if 'profile_id' in r),
            'blank_cells': dict(Counter(k for r in rows for k, v in r.items() if v == '')),
        }
    sums = defaultdict(Decimal)
    counts = Counter()
    dates = Counter()
    categories = Counter()
    ids = set()
    bad = Counter()
    archive = next(root.rglob('synthetic-transactions.zip'))
    with zipfile.ZipFile(archive) as bundle:
        member = next(n for n in bundle.namelist() if n.endswith('synthetic-transactions.csv') and not n.startswith('__MACOSX/'))
        with io.TextIOWrapper(bundle.open(member), encoding='utf-8-sig', newline='') as stream:
            reader = csv.DictReader(stream)
            columns = reader.fieldnames
            for r in reader:
                amount = Decimal(r['amount_chf'])
                key = (r['profile_id'], r['account_id'], r['date'][:7])
                sums[key] += amount
                counts[r['profile_id']] += 1
                categories[(r['transaction_type'], r['category'])] += 1
                dates[r['date'][:7]] += 1
                bad['duplicate_ids'] += r['transaction_id'] in ids
                ids.add(r['transaction_id'])
                bad['unknown_profiles'] += r['profile_id'] not in profiles
                account = accounts.get(r['account_id'])
                bad['unknown_or_wrong_owner_accounts'] += account is None or account['profile_id'] != r['profile_id']
                bad['wrong_sign'] += ((r['transaction_type'] == 'expense' and amount > 0) or (r['transaction_type'] == 'income' and amount < 0))
                bad['not_synthetic_chf'] += r['synthetic'] != 'true' or r['currency'] != 'CHF'
    report['transaction_summary'] = {
        'rows': sum(counts.values()), 'profiles': len(counts), 'columns': columns,
        'months': sorted(dates), 'categories': {f'{t}/{c}': n for (t, c), n in sorted(categories.items())},
        'checks': dict(bad),
    }
    previous = {}
    checks = Counter()
    negative_profiles = set()
    seen_keys = set()
    minimum = None
    for r in sorted(tables['synthetic-cash-balances.csv'], key=lambda r: (r['account_id'], r['month'])):
        key = (r['profile_id'], r['account_id'], r['month'])
        opening, net, closing = (Decimal(r[k]) for k in ('opening_cash_chf', 'net_transactions_chf', 'closing_cash_chf'))
        checks['cash_identity_failures'] += opening + net != closing
        checks['transaction_sum_failures'] += sums.get(key, Decimal(0)) != net
        checks['duplicate_balance_keys'] += key in seen_keys
        seen_keys.add(key)
        expected = previous.get(r['account_id'], Decimal(accounts[r['account_id']]['opening_balance_chf']))
        checks['opening_continuity_failures'] += opening != expected
        previous[r['account_id']] = closing
        checks['negative_closing_months'] += closing < 0
        if closing < 0:
            negative_profiles.add(r['profile_id'])
        minimum = closing if minimum is None else min(minimum, closing)
    checks['transaction_months_missing_balances'] = len(set(sums) - seen_keys)
    checks['profiles_ever_negative'] = len(negative_profiles)
    report['checks'] = dict(checks)
    report['minimum_closing_cash_chf'] = str(minimum)
    report['profile_summary'] = {k: dict(Counter(r[k] for r in profiles.values())) for k in ('household_type', 'employment_status', 'city', 'country', 'currency')}
    report['events'] = {'status': dict(Counter(r['status'] for r in tables['life-events.csv'])), 'types': dict(Counter(r['event_type'] for r in tables['life-events.csv']))}
    report['assumptions'] = {'parameters': dict(Counter(r['parameter'] for r in tables['scenario-assumptions.csv'])), 'scenarios': dict(Counter(r['scenario_id'] for r in tables['scenario-assumptions.csv']))}
    report['liabilities'] = {'zero_payments': sum(Decimal(r['monthly_payment_chf']) == 0 for r in tables['synthetic-liabilities.csv']), 'notes': dict(Counter(r['notes'] for r in tables['synthetic-liabilities.csv']))}
    report['assets'] = {'types': dict(Counter(r['asset_type'] for r in tables['synthetic-assets.csv'])), 'valuation_basis': dict(Counter(r['valuation_basis'] for r in tables['synthetic-assets.csv']))}
    report['assets']['account_ids_missing_from_account_table'] = sum(r['account_id'] not in accounts for r in tables['synthetic-assets.csv'])
    report['assets']['existing_account_wrong_owner'] = sum(r['account_id'] in accounts and accounts[r['account_id']]['profile_id'] != r['profile_id'] for r in tables['synthetic-assets.csv'])
    report['checks']['duplicate_profile_ids'] = len(tables['synthetic-profiles.csv']) - len(profiles)
    report['checks']['duplicate_account_ids'] = len(tables['synthetic-accounts.csv']) - len(accounts)
    for r in tables['synthetic-accounts.csv']:
        checks['profile_account_opening_mismatches'] += Decimal(r['opening_balance_chf']) != Decimal(profiles[r['profile_id']]['opening_cash_chf'])
    checks['cash_asset_opening_mismatches'] = sum(Decimal(r['value_chf']) != Decimal(profiles[r['profile_id']]['opening_cash_chf']) for r in tables['synthetic-assets.csv'] if r['asset_type'] == 'cash')
    report['checks'].update(dict(checks))
    report['alexia_balances'] = [r for r in tables['synthetic-cash-balances.csv'] if r['profile_id'] == 'P00001']
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.root), indent=2))
