import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";
import "./skins.css";
import { applyAppearance, validSkin } from "./foundation/appearance";
// The blocking initializer resolves saved attributes before CSS; synchronize browser chrome
// as soon as the stylesheet is ready, before React renders.
applyAppearance(
  document.documentElement.dataset.theme === "light" ? "light" : "dark",
  validSkin(document.documentElement.dataset.skin),
  false,
);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
