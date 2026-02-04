/**
 * Sentifi - Learning Module
 *
 * Prediction tracking, accuracy measurement, and feedback loops
 * for continuous improvement of trading signals.
 */

// Types
export type {
  LearningConfig,
  Prediction,
  PredictionEvaluation,
  SignalAccuracy,
  WeightSuggestion,
  LearningMetrics,
  PredictionTracker,
} from './types.js';

export { DEFAULT_LEARNING_CONFIG } from './types.js';

// Tracker
export { MemoryPredictionTracker, createPredictionTracker } from './tracker.js';
