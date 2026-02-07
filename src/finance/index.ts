import { fetchLatestStooqPrice } from './stooq.js';
import { fetchRedditRumors } from './reddit.js';
import { fetchTavilyRumors, fetchTavilyTwitter } from './tavily.js';

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
  const query = `${symbol} stock rumor`;
  const [redditResult, tavilyResult, twitterResult] = await Promise.allSettled([
    fetchRedditRumors(symbol),
    fetchTavilyRumors(query),
    fetchTavilyTwitter(symbol),
  ]);

  const reddit = redditResult.status === 'fulfilled' ? redditResult.value : [];
  const tavily = tavilyResult.status === 'fulfilled' ? tavilyResult.value : [];
  const twitter = twitterResult.status === 'fulfilled' ? twitterResult.value : [];

  return {
    symbol,
    reddit,
    tavily,
    twitter,
  };
}
