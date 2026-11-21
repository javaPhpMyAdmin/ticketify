/**
 * Test double for `victory-native` in the charts render harness.
 *
 * The real package imports RN Skia, which cannot load in plain node. The
 * `InsightHeroCard` layout guard mounts the hero for its HEADER tree only,
 * so the chart subtree is deliberately inert: the render prop is not
 * invoked and no native chart geometry is built.
 */
import React from 'react';

/** Typed render-prop argument so the hero's destructuring typechecks. */
interface ChartRenderArg {
  points: Record<string, Array<{ x: number; y: number }>>;
  chartBounds: { left: number; right: number; top: number; bottom: number };
}

/** Hero chart props are irrelevant here, so accept them all loosely. */
type LooseProps = Record<string, unknown>;

export function Bar(_props: LooseProps): React.ReactElement {
  return React.createElement('Bar');
}

export function CartesianChart(
  _props: LooseProps & { children?: (arg: ChartRenderArg) => React.ReactNode },
): React.ReactElement {
  return React.createElement('CartesianChart');
}
