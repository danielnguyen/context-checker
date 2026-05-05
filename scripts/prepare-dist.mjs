import { copyFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

mkdirSync('dist/chrome', { recursive: true });
mkdirSync('dist/firefox', { recursive: true });

copyFileSync('manifests/manifest.chrome.json', 'dist/chrome/manifest.json');
copyFileSync('manifests/manifest.firefox.json', 'dist/firefox/manifest.json');

['content.js','background.js','options.js','options.html'].forEach(f => {
  copyFileSync(`dist/build/${f}`, `dist/chrome/${f}`);
  copyFileSync(`dist/build/${f}`, `dist/firefox/${f}`);
});
