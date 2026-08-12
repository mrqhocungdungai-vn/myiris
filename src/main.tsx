import React from "react";
import ReactDOM from "react-dom/client";
import type { Root } from "react-dom/client";
import App from "./App";
import "./styles/index.css";

const container = document.getElementById("root")!;

// One root per container, kept across a dev hot-update.
//
// `createRoot` on a container that already has one does NOT replace the first:
// it renders a SECOND, independent tree into the same element, and the first
// keeps its state, its effects and its rAF loops running — including the hand
// tracker's, and including every floating cursor it had drawn. Nothing in the
// app can then account for what is on screen, because half of it belongs to a
// tree no code holds a reference to any more.
//
// In production this file runs once and the guard costs nothing. In dev, a
// module graph that fails React Fast Refresh re-executes this entry, which is
// exactly the case the guard exists for.
type RootHost = typeof globalThis & { __irisRoot?: Root };
const host = globalThis as RootHost;
const root = host.__irisRoot ?? ReactDOM.createRoot(container);
host.__irisRoot = root;

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
