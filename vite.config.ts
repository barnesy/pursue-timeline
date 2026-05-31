import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build with relative paths so the same bundle can ship to /pursue-timeline-app/
// inside the barnesy.me portfolio without rewriting any asset URLs.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // Force a single copy of React/React-DOM. After adding map libraries with
  // their own React-using deps, Vite could otherwise pre-bundle a second React,
  // crashing hooks ("Invalid hook call" / useContext of null).
  resolve: { dedupe: ["react", "react-dom"] },
  // Honor a PORT env override (e.g. the preview harness assigning a free
  // port) but default to 5173 for normal local dev.
  server: { port: Number(process.env.PORT) || 5173, host: true },
});
