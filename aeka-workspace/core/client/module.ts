// Contract every browser-side module implements. The shell builds navigation, headings and routing from
// these manifests, so adding a module means writing a manifest and adding it to core/client/registry.ts.
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export type Surface = 'web' | 'desktop';

export interface ModulePage {
  id: string; // unique across modules; prefix with the module id, e.g. "workflow/todos"
  label: string; // navigation label
  title: string; // page heading
  subtitle: string; // one-line descriptor under the heading
  icon: LucideIcon;
  // Hidden from navigation (reachable by link only), e.g. settings pages with their own button.
  hidden?: boolean;
}

export interface ModuleViewProps {
  page: string;
  navigate: (page: string) => void;
  notify: (message: string) => void;
}

// Slots: places on one module's screens where other modules may add a panel. The module that owns the
// screen renders every contribution for the current surface (see slotsFor in registry.ts) and passes the
// props below; contributions are lazily loaded and must render nothing when they do not apply.
export interface SlotProps {
  // Under the title of an open Scribe note.
  'scribe.note': {
    note: { id: string; title: string; kind: 'meeting' | 'scratchpad'; actions: number; segments: number };
    unsaved: boolean; // the note has edits not yet saved
    save: () => Promise<unknown>; // saves those edits
    navigate: (page: string) => void;
    notify: (message: string) => void;
  };
}
export type SlotName = keyof SlotProps;

export interface ClientModule {
  id: string;
  name: string; // navigation group label and page eyebrow
  surfaces: Surface[];
  pages: ModulePage[];
  // Renders this module's pages. Omitted only by Scribe, whose pages the shell renders itself.
  View?: ComponentType<ModuleViewProps>;
  // Panels this module adds to other modules' screens.
  slots?: { [K in SlotName]?: ComponentType<SlotProps[K]> };
}
