// Vite entry. Everything it does lives in `app.ts`; this file is the one
// place with a side effect, so importing the package never boots a viewer.

import "./styles.css";

import { boot } from "./app.js";

const root = document.querySelector("#app");
if (root) void boot(root);
