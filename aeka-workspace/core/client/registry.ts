// Browser-side module registry. Order here is the order of navigation groups.
import { scribeModule } from '../../modules/scribe/manifest';
import { workflowModule } from '../../modules/workflow/manifest';
import type { ClientModule, ModulePage, Surface } from './module';

export const clientModules: ClientModule[] = [workflowModule, scribeModule];

export function modulesFor(surface: Surface) {
  return clientModules.filter((m) => m.surfaces.includes(surface));
}

export function findPage(pageId: string): { module: ClientModule; page: ModulePage } | null {
  for (const module of clientModules) {
    const page = module.pages.find((p) => p.id === pageId);
    if (page) return { module, page };
  }
  return null;
}
