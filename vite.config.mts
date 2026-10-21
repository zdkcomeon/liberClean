import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, 'dist');

/**
 * uTools opens the plugin entry from the local filesystem. ES module scripts
 * are blocked by CORS there, so the production entry is one classic IIFE
 * bundle. This plugin also assembles the installable plugin directory.
 */
function utoolsPackage(): Plugin {
  return {
    name: 'utools-package',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const indexPath = path.join(outDir, 'index.html');
      let html = fs.readFileSync(indexPath, 'utf8');
      html = html.replace(/\s+crossorigin(?=[\s>])/g, '');
      html = html.replace(/<script type="module"/g, '<script defer');
      html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
      fs.writeFileSync(indexPath, html);
      if (/type="module"|crossorigin/.test(html)) throw new Error('index.html 仍包含模块或跨域属性');
      if (!/<script defer src="\.\/assets\/[^"]+"><\/script>/.test(html)) throw new Error('index.html 没有使用经典脚本入口');

      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
      delete manifest.development;
      fs.writeFileSync(path.join(outDir, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      for (const name of ['preload.js', 'maintenance.js', 'maintenance-helper.sh', 'mole-update.js']) {
        fs.copyFileSync(path.join(root, name), path.join(outDir, name));
      }
      fs.copyFileSync(path.join(root, 'logo.png'), path.join(outDir, 'logo.png'));
      fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify({
        name: 'liberclean',
        version: manifest.version || '0.1.0',
        private: true,
        type: 'commonjs'
      }, null, 2)}\n`);

      for (const name of ['plugin.json', 'preload.js', 'maintenance.js', 'maintenance-helper.sh', 'mole-update.js', 'package.json', 'index.html', 'logo.png', 'favicon.svg', 'assets']) {
        if (!fs.existsSync(path.join(outDir, name))) throw new Error(`缺少插件文件：${name}`);
      }
    }
  };
}

export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwindcss(), utoolsPackage()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  }
});
