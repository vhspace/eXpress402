/**
 * Suifi - Sui Decision Recorder Types
 *
 * Records AI decisions for Sui vault investments based on DefiLlama data
 */

// ============================================================================
// DEFILLAMA TYPES
// ============================================================================

/** Vault data from DefiLlama Yields API */
export interface DefiLlamaVault {
  project: string;
  chain: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  apyBase: number;
  apyReward: number;
  pool: string;
  stablecoin: boolean;
}

// ============================================================================
// SCORE TYPES
// ============================================================================

/** Score factors breakdown */
export interface ScoreFactors {
  apyScore: number;
  tvlScore: number;
  safetyBonus: number;
}

/** Vault with calculated score */
export interface VaultScore {
  vault: DefiLlamaVault;
  score: number;
  confidence: number;
  factors: ScoreFactors;
  rank: number;
}

// ============================================================================
// DECISION TYPES
// ============================================================================

/** Decision action type */
export type DecisionAction = 'deposit' | 'withdraw' | 'hold';

/** Risk level */
export type RiskLevel = 'low' | 'medium' | 'high';

/** Core decision record */
export interface SuiVaultDecision {
  id: string;
  timestamp: Date;
  action: DecisionAction;
  project: string;
  pool: string;
  symbol: string;
  apyAtDecision: number;
  tvlAtDecision: number;
  confidence: number;
  reason: string;
  expectedApy: number;
  riskLevel: RiskLevel;
  score: number;
  // Evaluation fields
  evaluated: boolean;
  evaluatedAt?: Date;
  actualApy?: number;
  actualTvl?: number;
  outcome?: 'correct' | 'incorrect' | 'neutral';
  apyChange?: number;
  tvlChange?: number;
}

/** Evaluation result for a specific time horizon */
export interface DecisionEvaluation {
  decisionId: string;
  horizonDays: number;
  actualApy: number;
  actualTvl: number;
  apyChange: number;
  tvlChange: number;
  outcome: 'correct' | 'incorrect' | 'neutral';
  pnlPercent: number;
  evaluatedAt: Date;
}

/** Complete decision record with evaluation */
export interface SuiDecisionRecord {
  decision: SuiVaultDecision;
  evaluation?: {
    apyAfter: number;
    tvlAfter: number;
    apyChange: number;
    tvlChange: number;
    metExpectation: boolean;
    evaluatedAt: Date;
  };
  evaluations?: DecisionEvaluation[];
}

// ============================================================================
// METRICS TYPES
// ============================================================================

/** Metrics for a specific action type */
export interface ActionMetrics {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  avgApy: number;
  avgConfidence: number;
}

/** Metrics for a specific project */
export interface ProjectMetrics {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  avgApy: number;
  avgConfidence: number;
  bestAction: DecisionAction;
  totalTvlUsd: number;
}

/** Overall learning metrics */
export interface LearningMetrics {
  totalDecisions: number;
  evaluatedDecisions: number;
  pendingEvaluation: number;
  correctDecisions: number;
  incorrectDecisions: number;
  overallAccuracy: number;
  byAction: Record<DecisionAction, ActionMetrics>;
  byProject: Record<string, ProjectMetrics>;
  bestPerformingProject?: {
    name: string;
    accuracy: number;
    totalDecisions: number;
  };
  avgConfidence: number;
  avgApy: number;
  lastUpdated: Date;
}

// ============================================================================
// CONFIG TYPES
// ============================================================================

/** Strategy configuration */
export interface StrategyConfig {
  minApyForDeposit: number;
  minTvlUsd: number;
  maxApyForWithdraw: number;
  highApyThreshold: number;
  stablecoinBonus: number;
  apyWeight: number;
  tvlWeight: number;
}

/** Tracker configuration */
export interface TrackerConfig {
  dbPath: string;
  autoSave: boolean;
  evaluationDays: number[];
}

/** Default configuration */
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  minApyForDeposit: 15,
  minTvlUsd: 1000000,
  maxApyForWithdraw: 5,
  highApyThreshold: 30,
  stablecoinBonus: 10,
  apyWeight: 2,
  tvlWeight: 1,
};

export const DEFAULT_TRACKER_CONFIG: TrackerConfig = {
  dbPath: './data/suifi-decisions.json',
  autoSave: true,
  evaluationDays: [1, 7, 30],
};
