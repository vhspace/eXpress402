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
  source?: string;
}

/** Twitter post from Tavily */
export interface TwitterPost {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
  source: 'twitter';
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
    source: result.source === 'twitter' ? 'twitter' : 'tavily',
    title: result.title,
    content: result.content,
    url: result.url,
    timestamp: result.published_date ? new Date(result.published_date) : new Date(),
    engagement: Math.round(result.score * 100), // Normalize score to engagement-like metric
    metadata: {
      relevanceScore: result.score,
      platform: result.source || 'tavily',
    },
  };
}

/** Convert Twitter post to raw sentiment item */
export function twitterToRaw(post: TwitterPost): RawSentimentItem {
  return {
    source: 'twitter',
    title: post.title,
    content: post.content,
    url: post.url,
    timestamp: post.published_date ? new Date(post.published_date) : new Date(),
    engagement: Math.round(post.score * 100),
    metadata: {
      relevanceScore: post.score,
      platform: 'twitter',
    },
  };
}

/** Aggregated sentiment from multiple sources */
export interface AggregatedSentimentData {
  symbol: string;
  reddit: RawSentimentItem[];
  tavily: RawSentimentItem[];
  twitter: RawSentimentItem[];
  combined: RawSentimentItem[];
  fetchedAt: Date;
  sources: {
    name: string;
    count: number;
    available: boolean;
  }[];
}
