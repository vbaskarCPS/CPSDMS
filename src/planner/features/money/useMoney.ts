// src/planner/features/money/useMoney.ts — one load for the finance screens: accounts, the months in
// range, the user's rules and the budget.
import { useCallback, useEffect, useState } from 'react';
import { loadAccounts, loadBudget, loadMonths, loadRules } from './lib';
import type { Account, Budget, Txn } from './types';

export interface MoneyData { accounts: Account[]; months: Record<string, Txn[]>; rules: Record<string, string>; budget: Budget }
const EMPTY: MoneyData = { accounts: [], months: {}, rules: {}, budget: {} };

export function useMoney(from?: string, to?: string) {
  const [data, setData] = useState<MoneyData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const [accounts, months, rules, budget] = await Promise.all([loadAccounts(), loadMonths(from, to), loadRules(), loadBudget()]);
      setData({ accounts, months, rules, budget }); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { setLoading(true); void reload(); }, [reload]);
  return { ...data, loading, error, reload, setData };
}

export const allRows = (months: Record<string, Txn[]>): Txn[] => Object.keys(months).sort().flatMap(k => months[k]);
