/**
 * Sentifi - Risk Management Module
 *
 * Comprehensive risk management with position sizing, circuit breakers,
 * and trade validation.
 */

// Types
export type {
  RiskConfig,
  RiskAssessment,
  RiskFactor,
  PositionSizeResult,
  CircuitBreakerState,
  CircuitBreakerTrigger,
  TradeRecord,
  PortfolioSnapshot,
  RiskManager,
  RiskMetrics,
} from './types.js';

export { DEFAULT_RISK_CONFIG } from './types.js';

// Position sizing
export {
  calculatePositionSize,
  calculateConfidenceMultiplier,
  calculateKellySize,
  checkConcentrationRisk,
} from './position-sizer.js';

// Circuit breaker
export { CircuitBreaker, createCircuitBreaker } from './circuit-breaker.js';

// Risk manager
export { SentifiRiskManager, createRiskManager } from './manager.js';
