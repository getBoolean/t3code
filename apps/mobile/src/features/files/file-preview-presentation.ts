// Fork: Inspector files expose pane expansion until upstream provides a full-screen file presentation that preserves the parent thread.
import { createContext } from "react";

export const FilePreviewExpandContext = createContext<(() => void) | null>(null);

export const FilePreviewCloseContext = createContext<(() => void) | null>(null);
