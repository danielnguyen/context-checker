const extensionApi = (globalThis as any).browser || (globalThis as any).chrome;
const runtime = extensionApi.runtime;
const storage = extensionApi.storage;
const tabs = extensionApi.tabs;

console.log('ContextChecker background loaded');

const DEFAULT_WARN_THRESHOLD = 20;
const DEFAULT_HIGH_THRESHOLD = 40;
const DEFAULT_OPENAI_GATE_THRESHOLD = 20;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 13;
const OPENAI_CALL_WINDOW_MS = 60 * 1000;
const MAX_OPENAI_CALLS_PER_WINDOW = 20;
const OPENAI_INITIAL_BURST = 5;
const OPENAI_QUEUE_INTERVAL_MS = 3500;

type Provider = 'heuristic' | 'openai';
type ResultSource = 'heuristic' | 'openai' | 'cache' | 'queued' | 'local_throttled' | 'local_error_fallback';
type ContentCategory = 'political_current_affairs' | 'creator_drama' | 'entertainment' | 'ad_placement' | 'unknown';

type SlopGuardSettings = {
  enabled: boolean;
  provider: Provider;
  warnThreshold: number;
  highThreshold: number;
  openaiGateThreshold: number;
  openaiApiKey?: string;
  openaiModel: string;
  debugLogging: boolean;
};

type VideoMetadata = {
  videoId: string;
  title: string;
  channel?: string;
  snippet?: string;
  pageUrl?: string;
  thumbnailUrl?: string;
  isSponsored?: boolean;
};

type ClassificationResult = {
  score: number;
  label: 'low' | 'medium' | 'high';
  source: ResultSource;
  category: ContentCategory;
  explanation?: string;
  labels?: string[];
  analyzedAt: number;
};

type CacheEntry = ClassificationResult & {
  videoId: string;
  title: string;
  cacheKey: string;
  cacheVersion: number;
};

type ClassifyVideoMessage = VideoMetadata & {
  type: 'CLASSIFY_VIDEO';
};

type SlopGuardMessage =
  | ClassifyVideoMessage
  | { type: 'GET_STATS' }
  | { type: 'CLEAR_CACHE' };

const memoryCache = new Map<string, CacheEntry>();
const pendingOpenAIReviews = new Map<string, any>();
const openaiCallTimestamps: number[] = [];

function getDefaultSettings(): SlopGuardSettings {
  return {
    enabled: true,
    provider: 'heuristic',
    warnThreshold: DEFAULT_WARN_THRESHOLD,
    highThreshold: DEFAULT_HIGH_THRESHOLD,
    openaiGateThreshold: DEFAULT_OPENAI_GATE_THRESHOLD,
    openaiModel: 'gpt-4.1-mini',
    debugLogging: true
  };
}

function storageGet(keys: string[] | Record<string, unknown> | null): Promise<Record<string, any>> {
  return new Promise((resolve) => storage.local.get(keys, resolve));
}

function storageSet(values: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => storage.local.set(values, resolve));
}

async function getSettings(): Promise<SlopGuardSettings> {
  const defaults = getDefaultSettings();
  const stored = await storageGet({ slopguardSettings: defaults, openaiApiKey: '' });

  return {
    ...defaults,
    ...(stored.slopguardSettings || {}),
    openaiApiKey: stored.openaiApiKey || stored.slopguardSettings?.openaiApiKey
  };
}

function getCacheKey(videoId: string, settings: SlopGuardSettings): string {
  return `contextCheckerCache:v${CACHE_VERSION}:${settings.provider}:${settings.openaiModel}:${videoId}`;
}

function labelForScore(score: number, settings: SlopGuardSettings): 'low' | 'medium' | 'high' {
  if (score >= settings.highThreshold) return 'high';
  if (score >= settings.warnThreshold) return 'medium';
  return 'low';
}

function combinedText(metadata: VideoMetadata): string {
  return `${metadata.title} ${metadata.channel || ''} ${metadata.snippet || ''}`.toLowerCase();
}

function heuristicClassification(metadata: VideoMetadata, settings: SlopGuardSettings): ClassificationResult {
  const text = combinedText(metadata);

  const politicalSignals = [
    'trump', 'carney', 'biden', 'poilievre', 'government', 'war', 'tariff', 'nato', 'election'
  ];

  const framingSignals = [
    'exposed', 'caught', 'panic', 'collapse', 'breaking', 'secret', 'humiliated'
  ];

  const politicalScore = politicalSignals.filter((term) => text.includes(term)).length * 10;
  const framingScore = framingSignals.filter((term) => text.includes(term)).length * 10;

  const score = Math.min(100, politicalScore + framingScore);

  return {
    score,
    label: labelForScore(score, settings),
    source: 'heuristic',
    category: politicalScore > 0 ? 'political_current_affairs' : 'unknown',
    explanation: politicalScore > 0
      ? `Political/current-affairs framing detected with attention-optimized language.`
      : 'No current-affairs risk signals detected.',
    labels: [],
    analyzedAt: Date.now()
  };
}

async function getCachedResult(cacheKey: string): Promise<CacheEntry | null> {
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey)!;
  }

  const stored = await storageGet([cacheKey]);
  const entry = stored[cacheKey] as CacheEntry | undefined;

  if (!entry) return null;

  memoryCache.set(cacheKey, entry);
  return entry;
}

async function setCachedResult(cacheKey: string, metadata: VideoMetadata, result: ClassificationResult): Promise<CacheEntry> {
  const entry: CacheEntry = {
    ...result,
    videoId: metadata.videoId,
    title: metadata.title,
    cacheKey,
    cacheVersion: CACHE_VERSION
  };

  memoryCache.set(cacheKey, entry);
  await storageSet({ [cacheKey]: entry });

  return entry;
}

function parseOpenAIJson(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in response');
  }

  return JSON.parse(text.slice(start, end + 1));
}

async function performOpenAIClassification(metadata: VideoMetadata, settings: SlopGuardSettings): Promise<ClassificationResult> {
  const userContent: any[] = [
    {
      type: 'input_text',
      text: JSON.stringify({
        title: metadata.title,
        channel: metadata.channel,
        snippet: metadata.snippet,
        task: 'Assess source-transparency risk and thumbnail authenticity context. Do not determine political correctness or truthfulness. Use cautious wording.'
      })
    }
  ];

  if (metadata.thumbnailUrl) {
    userContent.push({
      type: 'input_image',
      image_url: metadata.thumbnailUrl,
      detail: 'low'
    });
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.openaiModel || 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'You analyze YouTube current-affairs metadata and thumbnails for source-transparency and presentation-context risk. Do not accuse creators of lying or deception. Prefer cautious labels like thumbnail_authenticity_unclear, dramatized_or_recreated_visual, synthetic_visual_style, visual_claim_exceeds_metadata, sensational_framing, vague_attribution, source_transparency_risk. Return JSON only.'
            }
          ]
        },
        {
          role: 'user',
          content: userContent
        }
      ],
      text: {
        format: {
          type: 'json_object'
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const data = await response.json();

  const outputText = data.output_text || '';
  const parsed = parseOpenAIJson(outputText);

  const score = Math.max(0, Math.min(100, Number(parsed.slop_score || parsed.score || 0)));

  return {
    score,
    label: labelForScore(score, settings),
    source: 'openai',
    category: parsed.category || 'political_current_affairs',
    explanation: parsed.explanation || 'OpenAI review completed.',
    labels: Array.isArray(parsed.labels) ? parsed.labels : [],
    analyzedAt: Date.now()
  };
}

async function classifyVideo(metadata: VideoMetadata): Promise<ClassificationResult> {
  const settings = await getSettings();

  const cacheKey = getCacheKey(metadata.videoId, settings);
  const cached = await getCachedResult(cacheKey);

  if (cached) {
    return {
      ...cached,
      source: 'cache'
    };
  }

  const heuristic = heuristicClassification(metadata, settings);

  let result = heuristic;

  if (
    settings.provider === 'openai' &&
    heuristic.category === 'political_current_affairs' &&
    heuristic.score >= settings.openaiGateThreshold &&
    settings.openaiApiKey
  ) {
    try {
      result = await performOpenAIClassification(metadata, settings);
    } catch (error) {
      console.warn('ContextChecker OpenAI classification failed.', error);
    }
  }

  return setCachedResult(cacheKey, metadata, result);
}

runtime.onMessage.addListener((msg: SlopGuardMessage) => {
  if (msg.type !== 'CLASSIFY_VIDEO') return undefined;

  return classifyVideo({
    videoId: msg.videoId,
    title: msg.title,
    channel: msg.channel,
    snippet: msg.snippet,
    pageUrl: msg.pageUrl,
    thumbnailUrl: msg.thumbnailUrl,
    isSponsored: msg.isSponsored
  });
});
