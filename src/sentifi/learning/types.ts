/**
 * Sentifi - Learning Module Types
 *
 * Interfaces for prediction tracking, accuracy measurement,
 * and feedback loops.
 */

import type { AggregatedSignal, TradeIntent, TradeAction } from '../types.js';

/** Learning configuration */
export interface LearningConfig {
  /** Enable learning/tracking */
  enabled: boolean;
  /** Redis URL for persistence */
  redisUrl?: string;
  /** Evaluation windows in hours */
  evaluationWindows: number[];
  /** Minimum predictions to calculate accuracy */
  minPredictionsForAccuracy: number;
  /** Weight decay for older predictions */
  weightDecayDays: number;
}

/** Default learning configuration */
export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  enabled: true,
  evaluationWindows: [1, 4, 24], // 1h, 4h, 24h
  minPredictionsForAccuracy: 10,
  weightDecayDays: 30,
};

/** Prediction record */
export interface Prediction {
  /** Unique prediction ID */
  id: string;
  /** Prediction timestamp */
  timestamp: Date;
  /** Token/symbol */
  symbol: string;
  /** Predicted action */
  action: TradeAction;
  /** Prediction confidence */
  confidence: number;
  /** Overall signal score at prediction time */
  signalScore: number;
  /** Signal components for analysis */
  signalComponents: {
    sentimentScore: number;
    sentimentConfidence: number;
    momentumScore?: number;
    momentumConfidence?: number;
    rsi?: number;
  };
  /** Price at prediction time */
  priceAtPrediction: number;
  /** Target prices for evaluation */
  targetPrices: {
    /** Target for 1h window */
    target1h?: number;
    /** Target for 4h window */
    target4h?: number;
    /** Target for 24h window */
    target24h?: number;
  };
  /** Evaluation results */
  evaluations: PredictionEvaluation[];
  /** Whether all evaluations are complete */
  isComplete: boolean;
}

/** Evaluation of a prediction at a specific time window */
export interface PredictionEvaluation {
  /** Time window in hours */
  windowHours: number;
  /** Actual price at evaluation time */
  actualPrice: number;
  /** Price change percentage */
  priceChangePercent: number;
  /** Whether prediction was correct */
  wasCorrect: boolean;
  /** Profit/loss if trade was made */
  hypotheticalPnlPercent: number;
  /** Evaluation timestamp */
  evaluatedAt: Date;
}

/** Accuracy metrics for a signal type */
export interface SignalAccuracy {
  /** Signal type */
  signalType: 'sentiment' | 'momentum' | 'combined';
  /** Time window in hours */
  windowHours: number;
  /** Total predictions */
  totalPredictions: number;
  /** Correct predictions */
  correctPredictions: number;
  /** Accuracy rate (0-1) */
  accuracy: number;
  /** Average profit when correct */
  avgProfitWhenCorrect: number;
  /** Average loss when wrong */
  avgLossWhenWrong: number;
  /** Expected value per prediction */
  expectedValue: number;
  /** Breakdown by action type */
  byAction: {
    buy: { total: number; correct: number; accuracy: number };
    sell: { total: number; correct: number; accuracy: number };
  };
  /** Breakdown by confidence level */
  byConfidence: {
    high: { total: number; correct: number; accuracy: number };
    medium: { total: number; correct: number; accuracy: number };
    low: { total: number; correct: number; accuracy: number };
  };
}

/** Weight adjustment suggestion */
export interface WeightSuggestion {
  /** Current sentiment weight */
  currentSentimentWeight: number;
  /** Current momentum weight */
  currentMomentumWeight: number;
  /** Suggested sentiment weight */
  suggestedSentimentWeight: number;
  /** Suggested momentum weight */
  suggestedMomentumWeight: number;
  /** Reason for suggestion */
  reason: string;
  /** Confidence in suggestion */
  confidence: number;
}

/** Learning metrics summary */
export interface LearningMetrics {
  /** Total predictions tracked */
  totalPredictions: number;
  /** Predictions pending evaluation */
  pendingEvaluations: number;
  /** Overall accuracy by window */
  accuracyByWindow: Record<number, number>;
  /** Accuracy by signal type */
  accuracyBySignal: SignalAccuracy[];
  /** Best performing configuration */
  bestPerforming: {
    signalType: string;
    windowHours: number;
    accuracy: number;
  };
  /** Weight adjustment suggestions */
  suggestions: WeightSuggestion[];
  /** Last updated */
  lastUpdated: Date;
}

/** Prediction tracker interface */
export interface PredictionTracker {
  /**
   * Record a new prediction
   */
  recordPrediction(params: {
    signal: AggregatedSignal;
    intent: TradeIntent;
    currentPrice: number;
  }): Promise<string>;

  /**
   * Evaluate pending predictions
   */
  evaluatePending(currentPrices: Record<string, number>): Promise<number>;

  /**
   * Get accuracy metrics
   */
  getAccuracy(windowHours?: number): Promise<SignalAccuracy[]>;

  /**
   * Get weight suggestions based on performance
   */
  getWeightSuggestions(): Promise<WeightSuggestion[]>;

  /**
   * Get overall learning metrics
   */
  getMetrics(): Promise<LearningMetrics>;

  /**
   * Get prediction by ID
   */
  getPrediction(id: string): Promise<Prediction | null>;

  /**
   * Get recent predictions
   */
  getRecentPredictions(limit: number): Promise<Prediction[]>;

  /**
   * Clear old predictions
   */
  cleanup(olderThanDays: number): Promise<number>;
}
