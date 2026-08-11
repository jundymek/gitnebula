// Vite entry — placeholder page until story 2.5 builds the GraphEngine.

import { packageName } from "./index.js";

const root = document.querySelector("#app");
if (root) {
  root.textContent = `${packageName} placeholder — the nebula arrives with story 2.5.`;
}
