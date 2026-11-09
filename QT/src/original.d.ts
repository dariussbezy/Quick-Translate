import type { ComponentType } from "react";
import type { createPluginStore } from "./settings-store";
declare const originalPlugin: {
  start(): void;
  stop(): void;
  settings: ComponentType;
  version: string;
};
export default originalPlugin;
export const useQuickTranslate: ReturnType<
  typeof createPluginStore
>["useStore"];
