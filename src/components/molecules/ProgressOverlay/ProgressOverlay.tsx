import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

import { Text, View } from '@/components/atoms';
import { colors, spacing, typography } from '@/theme';

export interface ProgressOverlayProps {
  /** Announced action label; the animated dots supply the ellipsis. */
  label: string;
}

/**
 * Opaque, centered in-screen feedback for an action already in flight.
 * The label and the three marching dots are sibling text nodes — React
 * Native flattens nested Text, which would freeze the dot animations.
 */
export function ProgressOverlay({ label }: ProgressOverlayProps) {
  const dotOpacity = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(220, [
        Animated.timing(dotOpacity[0], {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[1], {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[2], {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[0], {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[1], {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity[2], {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [dotOpacity]);

  return (
    <View style={styles.overlay} accessible accessibilityLiveRegion="polite">
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        {dotOpacity.map((dot, index) => (
          <Animated.Text
            key={index}
            style={[styles.label, styles.dot, { opacity: dot }]}
          >
            .
          </Animated.Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  label: {
    ...typography.headlineMd,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  dot: {
    marginLeft: 2,
  },
});
