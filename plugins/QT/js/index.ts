import { createElement } from "react";
import originalPlugin, { useQuickTranslate } from "./original.js";
import {
  startIntegration,
  stopIntegration,
  installPageRoute,
} from "./valenced";
export default plugin<{ jsonStorage: Record<string, any> }>({
  jsonStorage: { load: true, default: useQuickTranslate.defaults },
  async start({ jsonStorage, cleanup, plugin: instance }) {
    const data = await jsonStorage.get();
    startIntegration((error) => instance.reportError(error));
    useQuickTranslate.attach(data, jsonStorage, (error) =>
      instance.reportError(error),
    );
    cleanup(async () => {
      originalPlugin.stop();
      stopIntegration();
      await useQuickTranslate.detach();
    });
    installPageRoute();
    originalPlugin.start();
    if (instance.startedLate) instance.requireReload();
  },
  SettingsComponent: () => createElement(originalPlugin.settings),
});
