import { NextResponse } from 'next/server';
import { fetchRedditRumors } from '../../../src/finance/reddit';
import { fetchTavilyRumors } from '../../../src/finance/tavily';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol')?.trim() ?? '';

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  }

  try {
    const query = `${symbol} stock rumor`;
    const [redditResult, tavilyResult] = await Promise.allSettled([
      fetchRedditRumors(symbol),
      fetchTavilyRumors(query),
    ]);

    const reddit = redditResult.status === 'fulfilled' ? redditResult.value : [];
    const tavily = tavilyResult.status === 'fulfilled' ? tavilyResult.value : [];

    const data = { symbol, reddit, tavily };
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

