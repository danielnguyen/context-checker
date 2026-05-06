import browser from 'webextension-polyfill';

console.log('SlopGuard background loaded');

const cache = new Map();

function heuristicScore(title) {
  let score = 0;
  const lower = title.toLowerCase();

  if (lower.includes('exposed') || lower.includes('shocking')) score += 20;
  if (lower.includes('war') || lower.includes('military')) score += 10;
  if (lower.includes('world') && lower.includes('best')) score += 15;

  return score;
}

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg.type !== 'CLASSIFY_VIDEO') return;

  const { videoId, title } = msg;

  if (!videoId) return;

  if (cache.has(videoId)) {
    return cache.get(videoId);
  }

  const score = heuristicScore(title);

  const result = {
    score,
    label: score >= 50 ? 'high' : score >= 30 ? 'medium' : 'low'
  };

  cache.set(videoId, result);

  return result;
});
