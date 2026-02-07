import { fetchLatestStooqPrice } from './stooq.js';
import { fetchRedditRumors } from './reddit.js';
import { fetchTavilyRumors } from './tavily.js';

export async function getStockPrice(symbol: string) {
  const row = await fetchLatestStooqPrice(symbol);
  return {
    symbol,
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    source: 'stooq',
  };
}

export async function getMarketRumors(symbol: string) {
  const query = `${symbol} cryptocurrency price news analysis`;
  const [redditResult, tavilyResult] = await Promise.allSettled([
    fetchRedditRumors(symbol),
    fetchTavilyRumors(query),
  ]);

  const reddit = redditResult.status === 'fulfilled' ? redditResult.value : [];
  const tavily = tavilyResult.status === 'fulfilled' ? tavilyResult.value : [];

  return {
    symbol,
    reddit,
    tavily,
  };
}
