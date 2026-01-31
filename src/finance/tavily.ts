export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export async function fetchTavilyRumors(query: string, maxResults = 5): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not set");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      query,
      topic: "finance",
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false
    })
  });

  if (!response.ok) {
    throw new Error(`Tavily request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: Array<{ title: string; url: string; content: string; score: number }>;
  };

  return (data.results ?? []).map((result) => ({
    title: result.title,
    url: result.url,
    content: result.content,
    score: result.score
  }));
}
