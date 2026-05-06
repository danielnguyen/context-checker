import { copyFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

mkdirSync('dist/chrome', { recursive: true });
mkdirSync('dist/firefox', { recursive: true });

copyFileSync('manifests/manifest.chrome.json', 'dist/chrome/manifest.json');
copyFileSync('manifests/manifest.firefox.json', 'dist/firefox/manifest.json');

// Copy JS files from build
['content.js','background.js','options.js'].forEach(f => {
  copyFileSync(`dist/build/${f}`, `dist/chrome/${f}`);
  copyFileSync(`dist/build/${f}`, `dist/firefox/${f}`);
});

// Copy HTML separately (not built by Vite)
copyFileSync('options/options.html', 'dist/chrome/options.html');
copyFileSync('options/options.html', 'dist/firefox/options.html');