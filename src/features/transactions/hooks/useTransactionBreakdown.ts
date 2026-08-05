import { useMemo } from 'react';

import type { TransactionKind } from '@/components';
import { formatCurrency } from '@/lib/format';

export interface TransactionBuckets {
  needs: number;
  wants: number;
  income: number;
}

export interface TransactionBreakdown {
  /** The amount shown on the row for the active filter. */
  amount: number;
  /**
   * NEEDS / WANTS / INCOME breakdown line, present when
   * `filter === 'all'`. May be an empty string when every bucket
   * is zero (the caller decides whether to render it).
   */
  breakdown?: string;
  /** True when the row represents income (tints the amount). */
  isIncome: boolean;
}

/**
 * Derives the display amount and breakdown line for a history entry
 * from its buckets and the active filter. Kept out of
 * `TransactionItem` so the organism stays a pure render.
 */
export function useTransactionBreakdown(
  { needs, wants, income }: TransactionBuckets,
  filter: TransactionKind,
): TransactionBreakdown {
  return useMemo(() => {
    const amount =
      filter === 'income' ? income :
      filter === 'needs' ? needs :
      filter === 'wants' ? wants :
      needs + wants;
    const breakdown =
      filter === 'all'
        ? `${needs > 0 ? `NECESIDADES ${formatCurrency(needs)}` : ''}` +
          `${wants > 0 ? `  DESEOS ${formatCurrency(wants)}` : ''}` +
          `${income > 0 ? `  INGRESOS ${formatCurrency(income)}` : ''}`
        : undefined;
    return { amount, breakdown, isIncome: filter === 'income' || income > 0 };
  }, [needs, wants, income, filter]);
}
