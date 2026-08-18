/**
 * Invite settings screen — reached from the household screen's
 * "Invitar" button. Shows the invite code modal full-screen and
 * pops back on close.
 */
import { router } from 'expo-router';

import { InviteCodeModal } from '@/features/household/components/InviteCodeModal';

export default function InviteScreen() {
  return (
    <InviteCodeModal visible onClose={() => router.back()} />
  );
}
