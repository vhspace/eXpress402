export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
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

  const data = (await response.json()) as {
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
  console.error('[Tavily] Fetched results:');
  results.forEach((r, i) => {
    const publishedDate = r.published_date ? new Date(r.published_date) : null;
    const hoursAgo = publishedDate 
      ? ((Date.now() - publishedDate.getTime()) / (1000 * 60 * 60)).toFixed(1)
      : 'unknown';
    console.error(`  [${i + 1}] ${hoursAgo}h ago: ${r.title.substring(0, 60)}...`);
  });

  return results;
}
