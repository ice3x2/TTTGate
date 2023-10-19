import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import {rimrafSync} from 'rimraf';
import * as Path from "path";

const buildDir = Path.join(process.cwd(), '..','web');
// https://vitejs.dev/config/

let preBuild = () => {
  return {
    name: 'pre-build',
    buildStart()  {
      rimrafSync(buildDir);

    }
  }
}

export default defineConfig({
  plugins: [svelte() /*,preBuild()*/],
  build: {
    outDir: buildDir
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9300/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: false,
        ws: true
      }
    }
  }
})
