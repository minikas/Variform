import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import generateFile from "vite-plugin-generate-file";
import { viteSingleFile } from "vite-plugin-singlefile";
import figmaManifest from "./figma.manifest";

export default defineConfig({
  build: {
    root: "./src",
    target: 'esnext',
    outDir: "dist",
    minify: "esbuild",
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssMinify: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: ["./src/index.html"],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    // Installing @tanstack/react-query left figma-kit with its own nested copy
    // of react/react-dom. Two React instances cause "Invalid hook call" and a
    // blank (gray) plugin — dedupe forces a single copy from the project root.
    dedupe: ['react', 'react-dom'],
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.json']
  },
  plugins: [react(), viteSingleFile(), generateFile({
    type: "json",
    output: "./manifest.json",
    data: figmaManifest,
  })],
});
