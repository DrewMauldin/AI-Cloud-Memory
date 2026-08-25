import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Current Cloudflare full-stack Worker pattern:
// https://developers.cloudflare.com/workers/vite-plugin/
export default defineConfig({
  plugins: [react(), cloudflare()],
});
