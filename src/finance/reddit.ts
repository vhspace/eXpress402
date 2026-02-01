const REDDIT_BASE_URL = "https://www.reddit.com";

export type RedditPost = {
  title: string;
  url: string;
  score: number;
  createdUtc: number;
  subreddit: string;
};

export async function fetchRedditRumors(query: string, limit = 5): Promise<RedditPost[]> {
  const url = new URL(`${REDDIT_BASE_URL}/r/stocks/search.json`);
  url.searchParams.set("q", query);
  url.searchParams.set("restrict_sr", "1");
  url.searchParams.set("sort", "new");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("raw_json", "1");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": process.env.REDDIT_USER_AGENT ?? "eXpress402-mcp/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Reddit request failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    data?: { children?: Array<{ data?: Record<string, unknown> }> };
  };

  const children = data.data?.children ?? [];
  return children
    .map((child) => child.data ?? {})
    .map((post) => ({
      title: String(post.title ?? ""),
      url: String(post.url ?? ""),
      score: Number(post.score ?? 0),
      createdUtc: Number(post.created_utc ?? 0),
      subreddit: String(post.subreddit ?? "")
    }))
    .filter((post) => Boolean(post.title));
}
