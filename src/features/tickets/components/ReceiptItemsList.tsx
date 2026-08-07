import { Card, Divider, View } from '@/components';
import { spacing } from '@/theme';
import type { ReviewItem } from '@/types';

import { ReviewItemRow } from './ReviewItemRow';

export interface ReceiptItemsListProps {
  items: ReviewItem[];
  /** ISO 4217 code for the line prices (defaults to the settings default, UYU). */
  currency?: string;
  /** When true, the list is rendered without the wrapping Card chrome. */
  bare?: boolean;
  /** Called when the user toggles the "impulse" switch on a row. */
  onToggleImpulse: (item: ReviewItem, isImpulse: boolean) => void;
}

/**
 * The list of parsed items shown on the review screen. Internally
 * a stack of `ReviewItemRow`s separated by a `Divider`.
 */
export function ReceiptItemsList({
  items,
  currency,
  bare,
  onToggleImpulse,
}: ReceiptItemsListProps) {
  const content = (
    <View>
      {items.map((item, idx) => (
        <View key={item.temp_id}>
          <ReviewItemRow
            item={item}
            currency={currency}
            onToggleImpulse={(v) => onToggleImpulse(item, v)}
          />
          {idx < items.length - 1 ? <Divider /> : null}
        </View>
      ))}
    </View>
  );
  if (bare) return content;
  return <Card padding={spacing.sm}>{content}</Card>;
}
