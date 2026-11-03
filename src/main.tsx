import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// No StrictMode: drei <Html> labels stay empty under React 19 StrictMode double effects
createRoot(document.getElementById("root")!).render(<App />);
