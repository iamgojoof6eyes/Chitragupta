/**
 * Bookmark Classifier Module
 * Hybrid classification engine combining high-speed deterministic rules
 * with optional AI classification (via local FastAPI / NIM / Gemini).
 */

const DOMAIN_RULES = [
  // AI & Machine Learning Tools & Assistants
  { match: /(chat\.openai\.com|chatgpt\.com|claude\.ai|gemini\.google\.com|perplexity\.ai|poe\.com|deepseek\.com)/i, category: 'AI & Machine Learning', subcategory: 'AI Assistants', tags: ['LLM', 'Chat'], confidence: 0.99 },
  { match: /(suno\.com|suno\.ai|vocalremover\.org)/i, category: 'AI & Machine Learning', subcategory: 'AI Audio & Music', tags: ['AI', 'Music', 'Audio'], confidence: 0.98 },
  { match: /(askcodi\.com|codeium\.com|pieces\.app|codewhisperer)/i, category: 'AI & Machine Learning', subcategory: 'Coding Assistants', tags: ['AI', 'Coding'], confidence: 0.98 },
  { match: /(photoroom\.com|remove\.bg|insmind\.com|scribblediffusion\.com)/i, category: 'AI & Machine Learning', subcategory: 'AI Image & Photo Editing', tags: ['AI', 'Image'], confidence: 0.97 },
  { match: /(myjotbot\.com|jotbot\.com)/i, category: 'AI & Machine Learning', subcategory: 'AI Writing', tags: ['AI', 'Writing'], confidence: 0.96 },
  { match: /(huggingface\.co|replicate\.com|civitai\.com|build\.nvidia\.com)/i, category: 'AI & Machine Learning', subcategory: 'Models & Hubs', tags: ['AI', 'Models'], confidence: 0.97 },
  { match: /(arxiv\.org|paperswithcode\.com|openreview\.net)/i, category: 'Research', subcategory: 'AI Papers', tags: ['Paper', 'Research', 'AI'], confidence: 0.98 },
  { match: /(pytorch\.org|tensorflow\.org|keras\.io|scikit-learn\.org|langchain\.com|llamaindex\.ai|ollama\.com|vllm\.ai)/i, category: 'AI & Machine Learning', subcategory: 'Frameworks & Tools', tags: ['AI', 'Framework'], confidence: 0.97 },

  // Programming, Languages & Frameworks
  { match: /(github\.com|gitlab\.com|bitbucket\.org)/i, category: 'Programming', subcategory: 'Repositories', tags: ['Git', 'Code'], confidence: 0.98 },
  { match: /(stackoverflow\.com|stackexchange\.com|serverfault\.com)/i, category: 'Programming', subcategory: 'Q&A', tags: ['Debugging'], confidence: 0.95 },
  { match: /(fastapi\.tiangolo\.com|flask\.palletsprojects\.com|djangoproject\.com)/i, category: 'Programming', subcategory: 'Python Backend', tags: ['Python', 'Backend'], confidence: 0.96 },
  { match: /(spring\.io)/i, category: 'Programming', subcategory: 'Backend Frameworks', tags: ['Java', 'Spring'], confidence: 0.96 },
  { match: /(docs\.python\.org|pypi\.org|realpython\.com|python-poetry\.org)/i, category: 'Programming', subcategory: 'Python', tags: ['Python', 'Reference'], confidence: 0.96 },
  { match: /(react\.dev|reactjs\.org|reactrouter\.com|nextjs\.org|vuejs\.org|svelte\.dev|angular\.io)/i, category: 'Programming', subcategory: 'Frontend Frameworks', tags: ['Frontend', 'JavaScript'], confidence: 0.97 },
  { match: /(developer\.mozilla\.org|w3schools\.com|web\.dev)/i, category: 'Programming', subcategory: 'Web Standards & Docs', tags: ['Web', 'Docs'], confidence: 0.95 },
  { match: /(npmjs\.com|yarnpkg\.com|bun\.sh|deno\.com|nodejs\.org)/i, category: 'Programming', subcategory: 'JavaScript & Runtimes', tags: ['JS', 'Node'], confidence: 0.94 },
  { match: /(docker\.com|hub\.docker\.com|kubernetes\.io|helm\.sh)/i, category: 'DevOps & Cloud', subcategory: 'Containers & K8s', tags: ['Docker', 'DevOps'], confidence: 0.98 },
  { match: /(aws\.amazon\.com|cloud\.google\.com|azure\.microsoft\.com|cloudflare\.com|vercel\.com|ipinfo\.io)/i, category: 'DevOps & Cloud', subcategory: 'Cloud & Hosting', tags: ['Cloud', 'Hosting'], confidence: 0.95 },
  { match: /(redis\.io|mongodb\.com|postgresql\.org|mysql\.com|sqlite\.org|supabase\.com)/i, category: 'Programming', subcategory: 'Databases', tags: ['Database', 'SQL'], confidence: 0.97 },
  { match: /(rust-lang\.org|golang\.org|go\.dev|cppreference\.com)/i, category: 'Programming', subcategory: 'Systems Languages', tags: ['Systems', 'Code'], confidence: 0.95 },
  { match: /(playwright\.dev|selenium-python\.readthedocs\.io)/i, category: 'Programming', subcategory: 'Automation & Testing', tags: ['Testing', 'QA'], confidence: 0.96 },
  { match: /(graphql\.org|apollographql\.com|trpc\.io|mockapi\.io|rapidapi\.com|freeapi\.app)/i, category: 'Programming', subcategory: 'APIs & Integration', tags: ['API', 'Integration'], confidence: 0.96 },
  { match: /(replit\.com|vscode\.dev|stackedit\.io|readme\.so|makeareadme\.com|shields\.io|starchart\.cc)/i, category: 'Programming', subcategory: 'Developer Tools', tags: ['DevTools'], confidence: 0.95 },

  // Coding Practice & Competitive Programming
  { match: /(leetcode\.com|hackerrank\.com|hackerearth\.com|codeforces\.com|codewars\.com|neetcode\.io|codechef\.com|codecombat\.com|checkio\.org|spoj\.com|cssbattle\.dev)/i, category: 'Programming', subcategory: 'DSA & Problems', tags: ['Algorithms', 'Practice'], confidence: 0.99 },

  // UI Components, CSS & Design
  { match: /(figma\.com|dribbble\.com|behance\.net|awwwards\.com)/i, category: 'Design', subcategory: 'UI & UX Inspiration', tags: ['UI', 'Design'], confidence: 0.96 },
  { match: /(fonts\.google\.com|fontawesome\.com|lucide\.dev|heroicons\.com|iconify\.design|icons8\.com|flaticon\.com|simpleicons\.org|icons\.getbootstrap\.com)/i, category: 'Design', subcategory: 'Icons & Typography', tags: ['Icons', 'Fonts'], confidence: 0.98 },
  { match: /(tailwindcss\.com|tw-elements\.com|flowbite\.com|ui\.shadcn\.com|uiverse\.io|devui\.in|ui\.dev)/i, category: 'Design', subcategory: 'CSS & UI Frameworks', tags: ['CSS', 'Components'], confidence: 0.97 },
  { match: /(canva\.com|excalidraw\.com|yappydraw\.com|paint\.toys)/i, category: 'Productivity & Tools', subcategory: 'Whiteboards & Visuals', tags: ['Visuals', 'Drawing'], confidence: 0.96 },
  { match: /(freepik\.com|vecteezy\.com|unsplash\.com|pexels\.com)/i, category: 'Design', subcategory: 'Stock Assets & Vectors', tags: ['Images', 'Vectors'], confidence: 0.96 },

  // Online Games
  { match: /(krunker\.io|nitrotype\.com|skribbl\.io|slowroads\.io|zty\.pe|foddy\.net|fitgirl-repacks\.site|skidrowcodex\.co|epicgames\.com|mrdj777|romspedia\.com|worldoftanks\.com|worldofwarships\.com|play\.elevatorsaga\.com)/i, category: 'Gaming', subcategory: 'Online & PC Games', tags: ['Games', 'Gaming'], confidence: 0.98 },

  // E-Commerce & Shopping
  { match: /(amazon\.|ebay\.com|aliexpress\.com|flipkart\.com|walmart\.com|myntra\.com|ajio\.com|ydixstore\.com)/i, category: 'Shopping', subcategory: 'E-Commerce', tags: ['Shopping'], confidence: 0.97 },

  // Careers, Freelancing & Jobs
  { match: /(internshala\.com|indeed\.com|remotive\.com|weworkremotely\.com|upwork\.com|linkedin\.com|apprenticeshipindia\.gov\.in)/i, category: 'Career & Jobs', subcategory: 'Job & Internship Portals', tags: ['Jobs', 'Internships'], confidence: 0.98 },
  { match: /(flowcv\.com)/i, category: 'Career & Jobs', subcategory: 'Resume Builders', tags: ['Resume', 'Career'], confidence: 0.98 },

  // Media, Music & Audio
  { match: /(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv)/i, category: 'Media & Video', subcategory: 'Streaming & Video', tags: ['Video'], confidence: 0.95 },
  { match: /(spotify\.com|soundcloud\.com|bandcamp\.com|tunemymusic\.com)/i, category: 'Media & Audio', subcategory: 'Music & Podcasts', tags: ['Audio', 'Music'], confidence: 0.95 },

  // News, Blogs & Communities
  { match: /(news\.ycombinator\.com|techcrunch\.com|theverge\.com|arstechnica\.com|wired\.com|fastcompany\.com|infoq\.com|devurls\.com)/i, category: 'Tech & News', subcategory: 'Tech News & Insights', tags: ['News'], confidence: 0.96 },
  { match: /(medium\.com|dev\.to|hashnode\.com|substack\.com)/i, category: 'Tech & News', subcategory: 'Articles & Blogs', tags: ['Blog', 'Reading'], confidence: 0.94 },
  { match: /(wikipedia\.org|wikihow\.com|britannica\.com)/i, category: 'Reference', subcategory: 'Encyclopedia', tags: ['Knowledge'], confidence: 0.97 },
  { match: /(reddit\.com|discord\.com|discordapp\.com|twitter\.com|x\.com)/i, category: 'Social Media', subcategory: 'Communities', tags: ['Social', 'Community'], confidence: 0.96 },

  // Productivity, Documents & Tools
  { match: /(notion\.so|obsidian\.md|roamresearch\.com|trello\.com|asana\.com|linear\.app)/i, category: 'Productivity & Tools', subcategory: 'Notes & Tasks', tags: ['Tasks', 'Notes'], confidence: 0.96 },
  { match: /(drive\.google\.com|docs\.google\.com|sheets\.google\.com|dropbox\.com)/i, category: 'Productivity & Tools', subcategory: 'Cloud Documents', tags: ['Documents'], confidence: 0.96 },
  { match: /(cloudconvert\.com|freeconvert\.com|lightpdf\.com)/i, category: 'Productivity & Tools', subcategory: 'File Converters & PDF', tags: ['Converters', 'PDF'], confidence: 0.96 },
  { match: /(grammarly\.com)/i, category: 'Productivity & Tools', subcategory: 'Writing & Grammar', tags: ['Writing', 'Productivity'], confidence: 0.97 },
  { match: /(passwords\.avira\.com|emailnator\.com|proxyium\.com|sanskritpassword\.com)/i, category: 'Productivity & Tools', subcategory: 'Security & Utilities', tags: ['Security', 'Tools'], confidence: 0.95 },

  // Travel & Bookings
  { match: /(agoda\.com|airbnb\.co|booking\.com|trip\.com)/i, category: 'Travel & Lifestyle', subcategory: 'Hotels & Bookings', tags: ['Travel', 'Hotels'], confidence: 0.97 },

  // Google Services & Productivity
  { match: /(mail\.google\.com|gmail\.com|meet\.google\.com|maps\.google\.com|contacts\.google\.com|photos\.google\.com|translate\.google\.com|earth\.google\.com|news\.google\.com)/i, category: 'Productivity & Tools', subcategory: 'Google Services', tags: ['Google', 'Productivity'], confidence: 0.98 },

  // Learning & Tutorials
  { match: /(coursera\.org|edx\.org|udemy\.com|khanacademy\.org|mit\.edu|stanford\.edu|cs50\.harvard\.edu|chaicode\.com|learnxinyminutes\.com|quickref\.me|visualgo\.net|w3resource\.com|geeksforgeeks\.org|tutorialspoint\.com|javatpoint\.com|programiz\.com)/i, category: 'Education & Learning', subcategory: 'Courses & Tutorials', tags: ['Learning', 'Courses'], confidence: 0.97 },
  { match: /(zlib\.by|thecodebook\.pdf|readandlaugh\.wordpress\.com)/i, category: 'Education & Learning', subcategory: 'E-Books & Reading', tags: ['Books', 'Reading'], confidence: 0.96 },
  { match: /(samagama\.in|vicharanashala\.ai|vicharanashala\.discourse\.group|vicharanashala\.github\.io|spandan\.fun|codershigh)/i, category: 'Education & Learning', subcategory: 'Vicharana Shala & Projects', tags: ['Academics', 'Projects'], confidence: 0.98 }
];

const KEYWORD_RULES = [
  { match: /\b(api|rest|graphql|grpc|endpoint|webhook)\b/i, category: 'Programming', subcategory: 'APIs & Integration', tags: ['API'], confidence: 0.85 },
  { match: /\b(css|tailwind|flexbox|grid|styled-components|sass|ui components)\b/i, category: 'Design', subcategory: 'CSS & UI Components', tags: ['CSS', 'Frontend'], confidence: 0.88 },
  { match: /\b(cheatsheet|quickref|cheat sheet|roadmap)\b/i, category: 'Reference & Docs', subcategory: 'Cheatsheets & Guides', tags: ['CheatSheet'], confidence: 0.88 },
  { match: /\b(deep learning|neural network|transformer|llm|diffusion model|prompt engineering|gpt|ai)\b/i, category: 'AI & Machine Learning', subcategory: 'Machine Learning', tags: ['AI'], confidence: 0.88 },
  { match: /\b(cryptocurrency|bitcoin|ethereum|solana|defi|blockchain|binance)\b/i, category: 'Finance', subcategory: 'Crypto & Markets', tags: ['Crypto'], confidence: 0.90 },
  { match: /\b(internship|job|career|hiring|remote work)\b/i, category: 'Career & Jobs', subcategory: 'Jobs & Internships', tags: ['Career'], confidence: 0.88 },
  { match: /\b(online game|repack|gameplay|torrent game|typing game)\b/i, category: 'Gaming', subcategory: 'Games', tags: ['Gaming'], confidence: 0.88 },
  { match: /\b(ecommerce|shopping|store|buy online|discount)\b/i, category: 'Shopping', subcategory: 'E-Commerce', tags: ['Shopping'], confidence: 0.88 },
  { match: /\b(recipe|cooking|food|baking|cuisine)\b/i, category: 'Lifestyle', subcategory: 'Cooking & Food', tags: ['Food'], confidence: 0.88 },
  { match: /\b(travel|flight|hotel|airbnb|booking|itinerary)\b/i, category: 'Lifestyle', subcategory: 'Travel', tags: ['Travel'], confidence: 0.87 }
];

/**
 * Classifies a single bookmark using fast deterministic rules.
 * @param {Object} bookmark { title, url, folderPath }
 * @returns {Object|null} Classification result or null if ambiguous
 */
function classifyWithRules(bookmark) {
  const url = bookmark.url || '';
  const title = bookmark.title || '';

  // 1. Check domain rules
  for (const rule of DOMAIN_RULES) {
    if (rule.match.test(url)) {
      return {
        category: rule.category,
        subcategory: rule.subcategory,
        tags: [...rule.tags],
        confidence: rule.confidence,
        source: 'rule-domain'
      };
    }
  }

  // 2. Check keyword rules
  const fullText = `${url} ${title}`;
  for (const rule of KEYWORD_RULES) {
    if (rule.match.test(fullText)) {
      return {
        category: rule.category,
        subcategory: rule.subcategory,
        tags: [...rule.tags],
        confidence: rule.confidence,
        source: 'rule-keyword'
      };
    }
  }

  return null;
}

/**
 * Fallback semantic heuristic classifier when deterministic rules/AI do not match.
 * Analyzes domain, path tokens, and title semantics to place bookmarks in standard categories,
 * ensuring bookmarks move out of old messy structures.
 * @param {Object} bookmark
 * @returns {Object}
 */
function classifyHeuristic(bookmark) {
  let hostname = '';
  try {
    hostname = new URL(bookmark.url).hostname.replace(/^www\./, '');
  } catch {
    hostname = 'Misc';
  }

  const title = (bookmark.title || '').trim();
  const hostLower = hostname.toLowerCase();
  const titleLower = title.toLowerCase();
  const text = `${hostLower} ${titleLower}`;

  let inferredCategory = 'General';
  let inferredSubcat = 'Bookmarks';

  if (/(google\.com|gmail\.com)/i.test(hostLower)) {
    inferredCategory = 'Productivity & Tools';
    inferredSubcat = 'Google Services';
  } else if (/(ai|model|bot|gpt|intelligence|neural|audio|speech|music|suno|replicate|deepseek|claude|codewhisperer|codeium)/i.test(text)) {
    inferredCategory = 'AI & Machine Learning';
    inferredSubcat = 'Tools & Models';
  } else if (/(code|dev|git|script|programming|python|react|java|api|doc|tutorial|algorithm|concurrency|math|practice|w3resource|discrete)/i.test(text)) {
    inferredCategory = 'Programming';
    inferredSubcat = 'Tutorials & Code';
  } else if (/(game|play|arcade|speed|race|shooter|repack|fitgirl)/i.test(text)) {
    inferredCategory = 'Gaming';
    inferredSubcat = 'Online Games';
  } else if (/(shop|store|buy|cart|deal|fashion|clothes|price)/i.test(text)) {
    inferredCategory = 'Shopping';
    inferredSubcat = 'E-Commerce';
  } else if (/(job|career|work|hire|freelance|intern|resume)/i.test(text)) {
    inferredCategory = 'Career & Jobs';
    inferredSubcat = 'Job Search';
  } else if (/(news|blog|post|article|read|thesaurus|dict|review|radar)/i.test(text)) {
    inferredCategory = 'Reading & News';
    inferredSubcat = 'Articles';
  } else if (/(tool|util|convert|pdf|calc|pass|clean|font|generator|download|osint)/i.test(text)) {
    inferredCategory = 'Productivity & Tools';
    inferredSubcat = 'Utilities & Fonts';
  } else {
    inferredCategory = 'Productivity & Tools';
    inferredSubcat = 'Web Resources';
  }

  return {
    category: inferredCategory,
    subcategory: inferredSubcat,
    tags: [hostname.split('.')[0]],
    confidence: 0.80,
    source: 'heuristic-semantic'
  };
}

/**
 * Classifies a batch of bookmarks, using rules first and falling back to AI/heuristics.
 * @param {Array} bookmarks
 * @param {Object} [options]
 * @param {Function} [options.aiClient] Optional async function (ambiguousBookmarks) => Promise<classifiedMap>
 * @returns {Promise<Array>} List of bookmarks with attached .classification
 */
async function classifyBookmarks(bookmarks, options = {}) {
  const results = [];
  const ambiguous = [];
  const totalCount = bookmarks.length;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  for (const b of bookmarks) {
    const ruleMatch = classifyWithRules(b);
    if (ruleMatch && ruleMatch.confidence >= 0.80) {
      results.push({
        ...b,
        classification: ruleMatch
      });
    } else {
      ambiguous.push(b);
    }
  }

  // Report initial rule-based classification progress
  if (onProgress) {
    onProgress(results.length, totalCount);
  }

  console.log(
    `%c[Chitragupta Classifier] %cTotal: ${totalCount} | Rule matches: ${results.length} | Sent to AI: ${ambiguous.length}`,
    'color: #6366f1; font-weight: bold;',
    'color: #38bdf8;'
  );

  // If AI client function provided and we have ambiguous bookmarks, attempt AI classification
  let aiResultsMap = new Map();
  if (options.aiClient && ambiguous.length > 0) {
    try {
      const aiResponse = await options.aiClient(ambiguous, (aiDone, aiTotal) => {
        if (onProgress) {
          onProgress(Math.min(totalCount, results.length + aiDone), totalCount);
        }
      });
      if (aiResponse && Array.isArray(aiResponse)) {
        for (const item of aiResponse) {
          if (item.id) {
            aiResultsMap.set(String(item.id), item);
          }
        }
      }
    } catch (err) {
      console.warn('AI classification request failed, falling back to heuristics:', err.message);
    }
  }

  // Process remaining ambiguous bookmarks with either AI result or heuristic fallback
  for (const b of ambiguous) {
    const aiMatch = aiResultsMap.get(String(b.id));
    if (aiMatch && aiMatch.category) {
      results.push({
        ...b,
        classification: {
          category: aiMatch.category,
          subcategory: aiMatch.subcategory || 'General',
          tags: aiMatch.tags || [],
          confidence: aiMatch.confidence || 0.85,
          source: 'ai'
        }
      });
    } else {
      // Use heuristic fallback
      results.push({
        ...b,
        classification: classifyHeuristic(b)
      });
    }
  }

  if (onProgress) {
    onProgress(totalCount, totalCount);
  }

  return results;
}

const _rootClassifier = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis);
_rootClassifier.DOMAIN_RULES = DOMAIN_RULES;
_rootClassifier.KEYWORD_RULES = KEYWORD_RULES;
_rootClassifier.classifyWithRules = classifyWithRules;
_rootClassifier.classifyHeuristic = classifyHeuristic;
_rootClassifier.classifyBookmarks = classifyBookmarks;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DOMAIN_RULES,
    KEYWORD_RULES,
    classifyWithRules,
    classifyHeuristic,
    classifyBookmarks
  };
}
