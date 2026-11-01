import { createInstallation } from "./installation";

export const installation = createInstallation(window, navigator);
if (import.meta.hot) import.meta.hot.dispose(() => installation.dispose());
