/**
 * Sentifi - Prediction Tracker
 *
 * Tracks predictions and evaluates accuracy over time.
 * Supports in-memory and Redis persistence.
 */

import type {
  LearningConfig,
  Prediction,
  PredictionEvaluation,
  SignalAccuracy,
  WeightSuggestion,
  LearningMetrics,
  PredictionTracker,
} from './types.js';
import { DEFAULT_LEARNING_CONFIG } from './types.js';
import type { AggregatedSignal, TradeIntent } from '../types.js';

/**
 * In-memory prediction tracker
 */
export class MemoryPredictionTracker implements PredictionTracker {
  private config: LearningConfig;
  private predictions: Map<string, Prediction> = new Map();
  private idCounter = 0;

  constructor(config?: Partial<LearningConfig>) {
    this.config = { ...DEFAULT_LEARNING_CONFIG, ...config };
  }

  /**
   * Record a new prediction
   */
  async recordPrediction(params: {
    signal: AggregatedSignal;
    intent: TradeIntent;
    currentPrice: number;
  }): Promise<string> {
    const { signal, intent, currentPrice } = params;

    const id = `pred-${Date.now()}-${++this.idCounter}`;

    const prediction: Prediction = {
      id,
      timestamp: new Date(),
      symbol: intent.symbol,
      action: intent.action,
      confidence: intent.confidence,
      signalScore: signal.overallScore,
      signalComponents: {
        sentimentScore: signal.sentiment.score,
        sentimentConfidence: signal.sentiment.confidence,
        momentumScore: signal.momentum
          ? this.calculateMomentumScore(signal.momentum)
          : undefined,
        momentumConfidence: signal.momentum?.confidence,
        rsi: signal.momentum?.rsi,
      },
      priceAtPrediction: currentPrice,
      targetPrices: this.calculateTargetPrices(currentPrice, intent.action),
      evaluations: [],
      isComplete: false,
    };

    this.predictions.set(id, prediction);
    return id;
  }

  /**
   * Evaluate pending predictions
   */
  async evaluatePending(currentPrices: Record<string, number>): Promise<number> {
    let evaluated = 0;
    const now = Date.now();

    for (const prediction of this.predictions.values()) {
      if (prediction.isComplete) continue;

      const currentPrice = currentPrices[prediction.symbol];
      if (!currentPrice) continue;

      const hoursSincePrediction =
        (now - prediction.timestamp.getTime()) / (1000 * 60 * 60);

      for (const windowHours of this.config.evaluationWindows) {
        // Check if this window should be evaluated
        const alreadyEvaluated = prediction.evaluations.some(
          (e) => e.windowHours === windowHours,
        );

        if (!alreadyEvaluated && hoursSincePrediction >= windowHours) {
          const evaluation = this.evaluatePrediction(
            prediction,
            currentPrice,
            windowHours,
          );
          prediction.evaluations.push(evaluation);
          evaluated++;
        }
      }

      // Check if all evaluations are complete
      prediction.isComplete =
        prediction.evaluations.length >= this.config.evaluationWindows.length;
    }

    return evaluated;
  }

  /**
   * Get accuracy metrics
   */
  async getAccuracy(windowHours?: number): Promise<SignalAccuracy[]> {
    const windows = windowHours
      ? [windowHours]
      : this.config.evaluationWindows;

    const results: SignalAccuracy[] = [];

    for (const window of windows) {
      // Get evaluations for this window
      const evaluations = this.getEvaluationsForWindow(window);

      if (evaluations.length < this.config.minPredictionsForAccuracy) {
        continue;
      }

      // Calculate combined signal accuracy
      const combinedAccuracy = this.calculateAccuracy(evaluations, 'combined', window);
      results.push(combinedAccuracy);

      // Calculate sentiment-only accuracy (high sentiment confidence)
      const sentimentEvals = evaluations.filter(
        (e) => e.prediction.signalComponents.sentimentConfidence > 0.7,
      );
      if (sentimentEvals.length >= this.config.minPredictionsForAccuracy) {
        results.push(this.calculateAccuracy(sentimentEvals, 'sentiment', window));
      }

      // Calculate momentum-only accuracy (high momentum confidence)
      const momentumEvals = evaluations.filter(
        (e) =>
          e.prediction.signalComponents.momentumConfidence &&
          e.prediction.signalComponents.momentumConfidence > 0.7,
      );
      if (momentumEvals.length >= this.config.minPredictionsForAccuracy) {
        results.push(this.calculateAccuracy(momentumEvals, 'momentum', window));
      }
    }

    return results;
  }

  /**
   * Get weight suggestions based on performance
   */
  async getWeightSuggestions(): Promise<WeightSuggestion[]> {
    const accuracies = await this.getAccuracy();
    const suggestions: WeightSuggestion[] = [];

    // Find best performing signal type for 4h window
    const fourHourAccuracies = accuracies.filter((a) => a.windowHours === 4);

    const sentimentAcc = fourHourAccuracies.find((a) => a.signalType === 'sentiment');
    const momentumAcc = fourHourAccuracies.find((a) => a.signalType === 'momentum');
    const combinedAcc = fourHourAccuracies.find((a) => a.signalType === 'combined');

    if (sentimentAcc && momentumAcc && combinedAcc) {
      // Calculate optimal weights based on accuracy
      const totalAcc = sentimentAcc.accuracy + momentumAcc.accuracy;

      if (totalAcc > 0) {
        const suggestedSentimentWeight = sentimentAcc.accuracy / totalAcc;
        const suggestedMomentumWeight = momentumAcc.accuracy / totalAcc;

        // Only suggest if significantly different from 60/40 default
        const currentSentimentWeight = 0.6;
        const currentMomentumWeight = 0.4;

        if (
          Math.abs(suggestedSentimentWeight - currentSentimentWeight) > 0.1 ||
          Math.abs(suggestedMomentumWeight - currentMomentumWeight) > 0.1
        ) {
          suggestions.push({
            currentSentimentWeight,
            currentMomentumWeight,
            suggestedSentimentWeight: Math.round(suggestedSentimentWeight * 100) / 100,
            suggestedMomentumWeight: Math.round(suggestedMomentumWeight * 100) / 100,
            reason: `Sentiment accuracy: ${(sentimentAcc.accuracy * 100).toFixed(0)}%, Momentum accuracy: ${(momentumAcc.accuracy * 100).toFixed(0)}%`,
            confidence: Math.min(
              sentimentAcc.totalPredictions,
              momentumAcc.totalPredictions,
            ) / 50, // Confidence based on sample size
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Get overall learning metrics
   */
  async getMetrics(): Promise<LearningMetrics> {
    const predictions = Array.from(this.predictions.values());
    const accuracies = await this.getAccuracy();
    const suggestions = await this.getWeightSuggestions();

    // Accuracy by window
    const accuracyByWindow: Record<number, number> = {};
    for (const acc of accuracies.filter((a) => a.signalType === 'combined')) {
      accuracyByWindow[acc.windowHours] = acc.accuracy;
    }

    // Find best performing
    let bestPerforming = {
      signalType: 'combined',
      windowHours: 4,
      accuracy: 0,
    };

    for (const acc of accuracies) {
      if (acc.accuracy > bestPerforming.accuracy) {
        bestPerforming = {
          signalType: acc.signalType,
          windowHours: acc.windowHours,
          accuracy: acc.accuracy,
        };
      }
    }

    return {
      totalPredictions: predictions.length,
      pendingEvaluations: predictions.filter((p) => !p.isComplete).length,
      accuracyByWindow,
      accuracyBySignal: accuracies,
      bestPerforming,
      suggestions,
      lastUpdated: new Date(),
    };
  }

  /**
   * Get prediction by ID
   */
  async getPrediction(id: string): Promise<Prediction | null> {
    return this.predictions.get(id) || null;
  }

  /**
   * Get recent predictions
   */
  async getRecentPredictions(limit: number): Promise<Prediction[]> {
    return Array.from(this.predictions.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Clean up old predictions
   */
  async cleanup(olderThanDays: number): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [id, prediction] of this.predictions) {
      if (prediction.timestamp.getTime() < cutoff && prediction.isComplete) {
        this.predictions.delete(id);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Calculate momentum score from momentum signal
   */
  private calculateMomentumScore(momentum: NonNullable<AggregatedSignal['momentum']>): number {
    let score = 0;

    // RSI contribution
    if (momentum.rsi > 70) score += 30;
    else if (momentum.rsi > 55) score += (momentum.rsi - 50) * 2;
    else if (momentum.rsi < 30) score -= 30;
    else if (momentum.rsi < 45) score -= (50 - momentum.rsi) * 2;

    // MACD contribution
    score += Math.min(30, Math.abs(momentum.macdSignal * 100)) *
      Math.sign(momentum.macdSignal);

    // Price change contribution
    score += Math.min(40, Math.abs(momentum.priceChange24h * 2)) *
      Math.sign(momentum.priceChange24h);

    return Math.max(-100, Math.min(100, score));
  }

  /**
   * Calculate target prices for evaluation
   */
  private calculateTargetPrices(
    currentPrice: number,
    action: string,
  ): Prediction['targetPrices'] {
    // For buy signals, we expect price to go up
    // For sell signals, we expect price to go down
    const direction = action === 'buy' ? 1 : -1;
    const targets = { target1h: 0.5, target4h: 2, target24h: 5 }; // Expected % moves

    return {
      target1h: currentPrice * (1 + (direction * targets.target1h) / 100),
      target4h: currentPrice * (1 + (direction * targets.target4h) / 100),
      target24h: currentPrice * (1 + (direction * targets.target24h) / 100),
    };
  }

  /**
   * Evaluate a single prediction
   */
  private evaluatePrediction(
    prediction: Prediction,
    actualPrice: number,
    windowHours: number,
  ): PredictionEvaluation {
    const priceChangePercent =
      ((actualPrice - prediction.priceAtPrediction) / prediction.priceAtPrediction) * 100;

    // Prediction was correct if:
    // - Buy signal and price went up
    // - Sell signal and price went down
    const wasCorrect =
      (prediction.action === 'buy' && priceChangePercent > 0) ||
      (prediction.action === 'sell' && priceChangePercent < 0);

    // Calculate hypothetical P&L
    let hypotheticalPnlPercent = priceChangePercent;
    if (prediction.action === 'sell') {
      hypotheticalPnlPercent = -priceChangePercent; // Profit on shorts when price goes down
    }

    return {
      windowHours,
      actualPrice,
      priceChangePercent: Math.round(priceChangePercent * 100) / 100,
      wasCorrect,
      hypotheticalPnlPercent: Math.round(hypotheticalPnlPercent * 100) / 100,
      evaluatedAt: new Date(),
    };
  }

  /**
   * Get evaluations for a specific window
   */
  private getEvaluationsForWindow(
    windowHours: number,
  ): Array<{ prediction: Prediction; evaluation: PredictionEvaluation }> {
    const results: Array<{ prediction: Prediction; evaluation: PredictionEvaluation }> = [];

    for (const prediction of this.predictions.values()) {
      const evaluation = prediction.evaluations.find(
        (e) => e.windowHours === windowHours,
      );

      if (evaluation) {
        results.push({ prediction, evaluation });
      }
    }

    return results;
  }

  /**
   * Calculate accuracy metrics for a set of evaluations
   */
  private calculateAccuracy(
    evaluations: Array<{ prediction: Prediction; evaluation: PredictionEvaluation }>,
    signalType: 'sentiment' | 'momentum' | 'combined',
    windowHours: number,
  ): SignalAccuracy {
    const total = evaluations.length;
    const correct = evaluations.filter((e) => e.evaluation.wasCorrect).length;

    // Calculate average profit/loss
    let totalProfitWhenCorrect = 0;
    let countCorrect = 0;
    let totalLossWhenWrong = 0;
    let countWrong = 0;

    for (const { evaluation } of evaluations) {
      if (evaluation.wasCorrect) {
        totalProfitWhenCorrect += evaluation.hypotheticalPnlPercent;
        countCorrect++;
      } else {
        totalLossWhenWrong += Math.abs(evaluation.hypotheticalPnlPercent);
        countWrong++;
      }
    }

    const avgProfitWhenCorrect = countCorrect > 0 ? totalProfitWhenCorrect / countCorrect : 0;
    const avgLossWhenWrong = countWrong > 0 ? totalLossWhenWrong / countWrong : 0;

    // Calculate expected value
    const accuracy = total > 0 ? correct / total : 0;
    const expectedValue = accuracy * avgProfitWhenCorrect - (1 - accuracy) * avgLossWhenWrong;

    // Breakdown by action
    const buyEvals = evaluations.filter((e) => e.prediction.action === 'buy');
    const sellEvals = evaluations.filter((e) => e.prediction.action === 'sell');

    const byAction = {
      buy: {
        total: buyEvals.length,
        correct: buyEvals.filter((e) => e.evaluation.wasCorrect).length,
        accuracy: buyEvals.length > 0
          ? buyEvals.filter((e) => e.evaluation.wasCorrect).length / buyEvals.length
          : 0,
      },
      sell: {
        total: sellEvals.length,
        correct: sellEvals.filter((e) => e.evaluation.wasCorrect).length,
        accuracy: sellEvals.length > 0
          ? sellEvals.filter((e) => e.evaluation.wasCorrect).length / sellEvals.length
          : 0,
      },
    };

    // Breakdown by confidence
    const highConf = evaluations.filter((e) => e.prediction.confidence >= 0.8);
    const medConf = evaluations.filter(
      (e) => e.prediction.confidence >= 0.6 && e.prediction.confidence < 0.8,
    );
    const lowConf = evaluations.filter((e) => e.prediction.confidence < 0.6);

    const byConfidence = {
      high: {
        total: highConf.length,
        correct: highConf.filter((e) => e.evaluation.wasCorrect).length,
        accuracy: highConf.length > 0
          ? highConf.filter((e) => e.evaluation.wasCorrect).length / highConf.length
          : 0,
      },
      medium: {
        total: medConf.length,
        correct: medConf.filter((e) => e.evaluation.wasCorrect).length,
        accuracy: medConf.length > 0
          ? medConf.filter((e) => e.evaluation.wasCorrect).length / medConf.length
          : 0,
      },
      low: {
        total: lowConf.length,
        correct: lowConf.filter((e) => e.evaluation.wasCorrect).length,
        accuracy: lowConf.length > 0
          ? lowConf.filter((e) => e.evaluation.wasCorrect).length / lowConf.length
          : 0,
      },
    };

    return {
      signalType,
      windowHours,
      totalPredictions: total,
      correctPredictions: correct,
      accuracy: Math.round(accuracy * 1000) / 1000,
      avgProfitWhenCorrect: Math.round(avgProfitWhenCorrect * 100) / 100,
      avgLossWhenWrong: Math.round(avgLossWhenWrong * 100) / 100,
      expectedValue: Math.round(expectedValue * 100) / 100,
      byAction,
      byConfidence,
    };
  }
}

/**
 * Create a prediction tracker
 */
export function createPredictionTracker(
  config?: Partial<LearningConfig>,
): PredictionTracker {
  return new MemoryPredictionTracker(config);
}
