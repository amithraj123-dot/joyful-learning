// Browser-side module registry. Order here is the order of navigation groups.
import { scribeModule } from '../../modules/scribe/manifest';
import { workflowModule } from '../../modules/workflow/manifest';
import type { ClientModule, ModulePage, SlotName, SlotProps, Surface } from './module';
import type { ComponentType } from 'react';

export const clientModules: ClientModule[] = [workflowModule, scribeModule];

export function modulesFor(surface: Surface) {
  return clientModules.filter((m) => m.surfaces.includes(surface));
}

export function findPage(pageId: string): { module: ClientModule; page: ModulePage } | null {
  for (const mod of clientModules) {
    const page = mod.pages.find((p) => p.id === pageId);
    if (page) return { module: mod, page };
  }
  return null;
}

// Contributions to a slot from the modules available on this surface, with the contributing module id.
export function slotsFor<K extends SlotName>(surface: Surface, slot: K) {
  return modulesFor(surface).flatMap((m) => {
    const View = m.slots?.[slot] as ComponentType<SlotProps[K]> | undefined;
    return View ? [{ module: m.id, View }] : [];
  });
}
