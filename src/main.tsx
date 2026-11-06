import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import BuilderWorkroom from './builder/BuilderWorkroom.tsx';
import './builder/builder.css';
import "./styles.css";
import "./ui/dashboard-polish.css";
import "./ui/nemo.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {window.location.pathname.replace(/\/+$/, '') === '/builder' ? <BuilderWorkroom /> : <App />}
  </React.StrictMode>,
);
