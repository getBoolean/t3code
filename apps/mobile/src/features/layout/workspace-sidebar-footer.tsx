import { createContext, useState, useSyncExternalStore, type ReactNode } from "react";

// Fork: before iOS 26 the iPad sidebar is a JS column beside the navigator, outside the
// workspace tab state, so the navigator projects its tab bar into this slot at the sidebar's foot.
function createSidebarFooterSlot() {
  let node: ReactNode = null;
  const listeners = new Set<() => void>();
  return {
    get: () => node,
    set: (next: ReactNode) => {
      node = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type SidebarFooterSlot = ReturnType<typeof createSidebarFooterSlot>;

/** Present only while a JS sidebar column renders the slot's host. */
export const WorkspaceSidebarFooterContext = createContext<SidebarFooterSlot | null>(null);

export function useSidebarFooterSlot() {
  const [slot] = useState(createSidebarFooterSlot);
  return slot;
}

export function WorkspaceSidebarFooterHost(props: { readonly slot: SidebarFooterSlot }) {
  return useSyncExternalStore(props.slot.subscribe, props.slot.get);
}
