import browser from 'webextension-polyfill';

const input = document.getElementById('apiKey') as HTMLInputElement;

browser.storage.local.get('apiKey').then((res) => {
  input.value = res.apiKey || '';
});

input.addEventListener('change', () => {
  browser.storage.local.set({ apiKey: input.value });
});
