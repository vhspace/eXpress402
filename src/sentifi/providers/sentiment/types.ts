/**
 * Sentifi - Sentiment Provider Types
 *
 * Extended types for sentiment data providers.
 */

import type { RawSentimentItem } from '../../types.js';

/** Reddit post data structure */
export interface RedditPost {
  title: string;
  selftext?: string;
  url: string;
  score: number;
  upvote_ratio?: number;
  num_comments?: number;
  created_utc: number;
  subreddit: string;
  author?: string;
  permalink?: string;
}

/** Tavily search result */
export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

/** Convert Reddit post to raw sentiment item */
export function redditToRaw(post: RedditPost): RawSentimentItem {
  return {
    source: 'reddit',
    title: post.title,
    content: post.selftext,
    url: post.url || `https://reddit.com${post.permalink}`,
    timestamp: new Date(post.created_utc * 1000),
    engagement: post.score,
    metadata: {
      subreddit: post.subreddit,
      upvoteRatio: post.upvote_ratio,
      numComments: post.num_comments,
    },
  };
}

/** Convert Tavily result to raw sentiment item */
export function tavilyToRaw(result: TavilyResult): RawSentimentItem {
  return {
    source: 'tavily',
    title: result.title,
    content: result.content,
    url: result.url,
    timestamp: result.published_date ? new Date(result.published_date) : new Date(),
    engagement: Math.round(result.score * 100), // Normalize score to engagement-like metric
    metadata: {
      relevanceScore: result.score,
    },
  };
}

/** Aggregated sentiment from multiple sources */
export interface AggregatedSentimentData {
  symbol: string;
  reddit: RawSentimentItem[];
  tavily: RawSentimentItem[];
  combined: RawSentimentItem[];
  fetchedAt: Date;
  sources: {
    name: string;
    count: number;
    available: boolean;
  }[];
}
