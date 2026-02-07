export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
  source?: string; // Added to distinguish Twitter/X from news
};

export async function fetchTavilyRumors(query: string, maxResults = 5): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not set');
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      topic: 'finance',
      search_depth: 'advanced', // Use advanced for better quality and recency
      days: 1, // Only results from the last 24 hours
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      include_domains: [], // No restrictions
      exclude_domains: [], // No exclusions
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily request failed: ${response.status}`);
  }

  const rawData = await response.json();
  
  // Log the raw response to see what fields are actually returned
  console.error('[Tavily] Raw API response structure:', JSON.stringify(rawData, null, 2).substring(0, 500));
  
  const data = rawData as {
    results?: Array<{ 
      title: string; 
      url: string; 
      content: string; 
      score: number;
      published_date?: string;
    }>;
  };

  const results = (data.results ?? []).map(result => ({
    title: result.title,
    url: result.url,
    content: result.content,
    score: result.score,
    published_date: result.published_date,
  }));

  // Log the freshness of results
  console.error('[Tavily] Fetched results (requested last 24h only):');
  results.forEach((r, i) => {
    const publishedDate = r.published_date ? new Date(r.published_date) : null;
    const hoursAgo = publishedDate 
      ? ((Date.now() - publishedDate.getTime()) / (1000 * 60 * 60)).toFixed(1)
      : 'NO DATE';
    console.error(`  [${i + 1}] ${hoursAgo}h ago: ${r.title.substring(0, 60)}...`);
  });

  return results;
}

export async function fetchTavilyTwitter(symbol: string, maxResults = 5): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY is not set');
  }

  // Search specifically for Twitter/X posts about the symbol
  const query = `${symbol} crypto OR ${symbol} price site:twitter.com OR site:x.com`;

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      topic: 'general', // Use general for social media
      search_depth: 'advanced',
      days: 1, // Last 24 hours
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      include_domains: ['twitter.com', 'x.com'], // Only Twitter/X
      exclude_domains: [],
    }),
  });

  if (!response.ok) {
    throw new Error(`Tavily Twitter request failed: ${response.status}`);
  }

  const rawData = await response.json();
  
  console.error('[Tavily Twitter] Raw API response:', JSON.stringify(rawData, null, 2).substring(0, 500));
  
  const data = rawData as {
    results?: Array<{ 
      title: string; 
      url: string; 
      content: string; 
      score: number;
      published_date?: string;
    }>;
  };

  const results = (data.results ?? []).map(result => ({
    title: result.title,
    url: result.url,
    content: result.content,
    score: result.score,
    published_date: result.published_date,
    source: 'twitter',
  }));

  // Log the freshness of Twitter results
  console.error('[Tavily Twitter] Fetched results (last 24h):');
  results.forEach((r, i) => {
    const publishedDate = r.published_date ? new Date(r.published_date) : null;
    const hoursAgo = publishedDate 
      ? ((Date.now() - publishedDate.getTime()) / (1000 * 60 * 60)).toFixed(1)
      : 'NO DATE';
    console.error(`  [${i + 1}] ${hoursAgo}h ago: ${r.title.substring(0, 60)}...`);
  });

  return results;
}
