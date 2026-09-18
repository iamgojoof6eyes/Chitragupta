/**
 * Backend API Client
 * Facilitates communication with the local FastAPI AI server (http://localhost:8000).
 * Implements timeouts, health checks, and fallback mechanisms.
 */

const DEFAULT_SERVER_URL = 'http://localhost:8000';
const STORAGE_CONFIG_KEY = 'chitragupta_api_config';

class ChitraguptaApiClient {
  constructor() {
    this.serverUrl = DEFAULT_SERVER_URL;
    this.cachedStatus = null;
    this.lastCheckTime = 0;
  }

  /**
   * Initializes client with saved configuration from chrome.storage.local.
   */
  async init() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const stored = await chrome.storage.local.get([STORAGE_CONFIG_KEY]);
        if (stored[STORAGE_CONFIG_KEY] && stored[STORAGE_CONFIG_KEY].serverUrl) {
          this.serverUrl = stored[STORAGE_CONFIG_KEY].serverUrl.replace(/\/+$/, '');
        }
      } catch (e) {
        console.warn('Could not read API client config:', e);
      }
    }
  }

  /**
   * Checks whether the local AI backend server is active and healthy.
   * @param {boolean} forceRefresh
   * @returns {Promise<{ online: boolean, provider?: string, message?: string }>}
   */
  async checkHealth(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedStatus && (now - this.lastCheckTime < 10000)) {
      return this.cachedStatus;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        this.cachedStatus = {
          online: true,
          provider: data.provider || 'Local Rules Engine',
          aiConfigured: Boolean(data.ai_configured),
          version: data.version || '1.0.0'
        };
        console.log(
          `%c[Chitragupta API] 🩺 Backend Online: %c${this.cachedStatus.provider} (AI configured: ${this.cachedStatus.aiConfigured})`,
          'color: #38bdf8; font-weight: bold;',
          'color: #34d399; font-weight: bold;'
        );
      } else {
        this.cachedStatus = { online: false, error: `HTTP ${response.status}` };
        console.warn('[Chitragupta API] ⚠️ Backend returned non-200:', response.status);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      this.cachedStatus = {
        online: false,
        error: err.name === 'AbortError' ? 'Connection timed out' : 'Server offline'
      };
      // Quiet fallback when offline
    }

    this.lastCheckTime = now;
    return this.cachedStatus;
  }

  /**
   * Sends a batch of ambiguous bookmarks to the backend for AI classification.
   * @param {Array} bookmarks Array of bookmark items
   * @param {Function} [onProgress] Optional callback (doneCount, totalCount)
   * @param {AbortSignal} [abortSignal] Optional signal to cancel in-flight requests
   * @returns {Promise<Array>} Classified bookmark predictions
   */
  async classifyBatch(bookmarks, onProgress = null, abortSignal = null) {
    if (abortSignal && abortSignal.aborted) {
      return null;
    }

    const health = await this.checkHealth();
    if (!health.online) {
      // Check if user configured a direct API key in extension settings
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
          const stored = await chrome.storage.local.get(['chitragupta_user_settings']);
          const settings = stored.chitragupta_user_settings;
          if (settings && settings.apiKey && (settings.aiProvider === 'gemini' || settings.aiProvider === 'nvidia')) {
            const directResults = await this.classifyDirect(bookmarks, settings);
            if (directResults && directResults.length > 0) {
              if (typeof onProgress === 'function') onProgress(directResults.length, bookmarks.length);
              return directResults;
            }
          }
        } catch (e) {
          console.warn('[Chitragupta API] Direct API check error:', e);
        }
      }

      console.log('%c[Chitragupta API] ℹ️ Local backend offline & no direct key, using built-in extension rules.', 'color: #f59e0b;');
      return null;
    }

    const items = bookmarks.map(b => ({
      id: b.id,
      url: b.url,
      title: b.title,
      folder: b.folderPath || ''
    }));

    const CHUNK_SIZE = 25;
    const allResults = [];
    const totalItems = items.length;

    console.group(`%c[Chitragupta API] 🚀 POST /classify (${totalItems} ambiguous bookmarks in batches of ${CHUNK_SIZE})`, 'color: #6366f1; font-weight: bold;');
    console.log('Endpoint:', `${this.serverUrl}/classify`);

    for (let i = 0; i < totalItems; i += CHUNK_SIZE) {
      if (abortSignal && abortSignal.aborted) {
        console.log('[Chitragupta API] Task cancelled by user signal.');
        break;
      }

      const chunk = items.slice(i, i + CHUNK_SIZE);
      const payload = { bookmarks: chunk };
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);
      const batchNum = Math.floor(i / CHUNK_SIZE) + 1;

      // Also abort if parent abortSignal fires
      let parentAbortListener = null;
      if (abortSignal) {
        parentAbortListener = () => controller.abort();
        abortSignal.addEventListener('abort', parentAbortListener, { once: true });
      }

      try {
        const startTime = performance.now();
        const response = await fetch(`${this.serverUrl}/classify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        const duration = ((performance.now() - startTime) / 1000).toFixed(2);

        if (response.ok) {
          const data = await response.json();
          console.log(`[Chitragupta API] Batch ${batchNum} (${chunk.length} items) classified in ${duration}s:`, data.results);
          if (data.results && Array.isArray(data.results)) {
            allResults.push(...data.results);
          }
        } else {
          console.warn(`[Chitragupta API] Batch ${batchNum} returned status ${response.status}`);
          // Break on persistent HTTP error to allow instant local fallback
          break;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.warn(`[Chitragupta API] Batch ${batchNum} failed: ${err.message}. Fast-falling back to extension heuristics.`);
        // Circuit break on network failure/timeout: do not hang the UI for subsequent batches
        break;
      }

      if (typeof onProgress === 'function') {
        onProgress(Math.min(totalItems, allResults.length), totalItems);
      }
    }

    console.log(`%c[Chitragupta API] ✅ Total AI classifications gathered: ${allResults.length}/${totalItems}`, 'color: #10b981; font-weight: bold;');
    console.groupEnd();
    return allResults.length > 0 ? allResults : null;
  }

  /**
   * Direct AI classification using the user's API key from extension settings when local server is offline.
   * @param {Array} bookmarks
   * @param {Object} settings
   * @returns {Promise<Array|null>}
   */
  async classifyDirect(bookmarks, settings) {
    const provider = settings.aiProvider;
    const apiKey = settings.apiKey;
    const model = settings.aiModel || (provider === 'gemini' ? 'gemini-1.5-flash' : 'nvidia/nemotron-3.5-lightning-30b-a3b');

    console.log(`%c[Chitragupta API] 🌐 Local server offline: Calling direct ${provider} API with settings key`, 'color: #06b6d4; font-weight: bold;');

    const prompt = `You are a bookmark classification AI.
Categorize each bookmark into a primary Category (e.g. Programming, AI & Machine Learning, Career & Jobs, Tech & News, Media & Video, E-Commerce, Productivity, Reference, Lifestyle) and Subcategory.
Respond ONLY with a valid JSON array of objects:
[
  {
    "id": "bookmark_id",
    "category": "Category Name",
    "subcategory": "Subcategory Name",
    "confidence": 0.95,
    "tags": ["tag1", "tag2"]
  }
]
Input bookmarks:
${JSON.stringify(bookmarks.map(b => ({ id: b.id, title: b.title, url: b.url })))}`;

    try {
      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (resp.ok) {
          const data = await resp.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const match = text.match(/\[[\s\S]*\]/);
          if (match) return JSON.parse(match[0]);
        }
      } else if (provider === 'nvidia') {
        const url = 'https://integrate.api.nvidia.com/v1/chat/completions';
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (resp.ok) {
          const data = await resp.json();
          const text = data.choices?.[0]?.message?.content || '';
          const match = text.match(/\[[\s\S]*\]/);
          if (match) return JSON.parse(match[0]);
        }
      }
    } catch (err) {
      console.warn('[Chitragupta API] Direct classification call error:', err);
    }
    return null;
  }

  /**
   * Requests holistic AI organization structure proposal from backend.
   * @param {Array} bookmarks Flat list of bookmarks
   * @returns {Promise<Object|null>}
   */
  async organizeTree(bookmarks) {
    const health = await this.checkHealth();
    if (!health.online) {
      return null;
    }

    const payload = {
      bookmarks: bookmarks.map(b => ({
        id: b.id,
        url: b.url,
        title: b.title,
        folder: b.folderPath || ''
      }))
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(`${this.serverUrl}/organize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn('API organizeTree error:', err.message);
      return null;
    }
  }
}

// Singleton instance
const apiClient = new ChitraguptaApiClient();

const _rootClient = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
_rootClient.ChitraguptaApiClient = ChitraguptaApiClient;
_rootClient.apiClient = apiClient;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChitraguptaApiClient, apiClient };
}
