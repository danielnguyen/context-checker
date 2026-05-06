import { heuristicScore } from '../scoring/heuristics';

const VIDEO_CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-rich-grid-media',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'yt-lockup-view-model'
].join(',');

let scanTimer: number | undefined;

function getTitle(card: Element): string | null {
  const titleEl = card.querySelector('#video-title, a#video-title-link, yt-formatted-string#video-title, h3 a, a[title]');
  const text = (titleEl as HTMLElement | null)?.innerText?.trim();
  const attrTitle = (titleEl as HTMLAnchorElement | null)?.title?.trim();
  return text || attrTitle || null;
}

function getBadgeTarget(card: Element): HTMLElement | null {
  return (
    card.querySelector('a#thumbnail') ||
    card.querySelector('ytd-thumbnail') ||
    card.querySelector('#thumbnail') ||
    card
  ) as HTMLElement | null;
}

function injectBadge(card: HTMLElement, score: number): void {
  const target = getBadgeTarget(card);
  if (!target) return;

  const badge = document.createElement('div');
  badge.className = 'slopguard-badge';
  badge.textContent = score > 30 ? '🔴 Slop risk' : '🟡 Check content';
  badge.title = `SlopGuard heuristic score: ${score}`;

  Object.assign(badge.style, {
    position: 'absolute',
    top: '6px',
    left: '6px',
    background: 'rgba(0, 0, 0, 0.86)',
    color: 'white',
    padding: '3px 7px',
    fontSize: '11px',
    fontWeight: '700',
    borderRadius: '6px',
    zIndex: '9999',
    pointerEvents: 'none'
  });

  if (getComputedStyle(target).position === 'static') {
    target.style.position = 'relative';
  }

  target.appendChild(badge);
}

function scan(): void {
  const cards = document.querySelectorAll(VIDEO_CARD_SELECTOR);
  console.log('SlopGuard scanning', cards.length, location.href);

  cards.forEach((card) => {
    const htmlCard = card as HTMLElement;
    if (htmlCard.dataset.slopguardProcessed === 'true') return;

    const title = getTitle(card);
    if (!title) return;

    htmlCard.dataset.slopguardProcessed = 'true';

    const score = heuristicScore(title, '');
    if (score > 25) {
      injectBadge(htmlCard, score);
    }
  });
}

function scheduleScan(): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, 300);
}

function bootstrap(): void {
  scheduleScan();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('yt-navigate-finish', () => {
    document.querySelectorAll('[data-slopguard-processed]').forEach((el) => {
      delete (el as HTMLElement).dataset.slopguardProcessed;
    });
    scheduleScan();
  });

  window.setTimeout(scan, 1000);
  window.setTimeout(scan, 2500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
