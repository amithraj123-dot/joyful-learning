'use client';
// Renders the other modules' contributions to a slot (see SlotProps in module.ts). Each is loaded
// lazily and isolated: one that fails to load or render shows nothing rather than breaking the page.
import { Component, Suspense, type ComponentType, type ReactNode } from 'react';
import type { SlotName, SlotProps, Surface } from './module';
import { slotsFor } from './registry';

class Isolated extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(`The ${this.props.name} panel could not be shown`, error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Slot<K extends SlotName>({
  name,
  surface,
  props,
}: {
  name: K;
  surface: Surface;
  props: SlotProps[K];
}) {
  return slotsFor(surface, name).map(({ module, View }) => {
    const Panel = View as ComponentType<SlotProps[K]>;
    return (
      <Isolated key={module} name={module}>
        <Suspense fallback={null}>
          <Panel {...props} />
        </Suspense>
      </Isolated>
    );
  });
}
