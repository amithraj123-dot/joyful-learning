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

export interface ClientModule {
  id: string;
  name: string; // navigation group label and page eyebrow
  surfaces: Surface[];
  pages: ModulePage[];
  // Renders this module's pages. Omitted only by Scribe, whose pages the shell renders itself.
  View?: ComponentType<ModuleViewProps>;
}
