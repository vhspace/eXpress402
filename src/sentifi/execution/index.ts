/**
 * Sentifi - Execution Module
 *
 * Trade execution layer supporting live LI.FI swaps and simulated demo mode.
 */

// Types
export type {
  ExecutionMode,
  ExecutionConfig,
  QuoteRequest,
  QuoteResult,
  RouteStep,
  ExecutionRequest,
  ExecutionStatus,
  ExecutionResult,
  TradeExecutor,
  PortfolioManager,
} from './types.js';

export { DEFAULT_EXECUTION_CONFIG } from './types.js';

// LI.FI executor
export { LifiExecutor, createLifiExecutor } from './lifi-executor.js';

// Simulator
export {
  SimulatedExecutor,
  SimulatedPortfolioManager,
  createSimulatedExecutor,
  createSimulatedPortfolioManager,
} from './simulator.js';

/**
 * Create the appropriate executor based on mode
 */
export function createExecutor(
  mode: 'live' | 'paper' | 'demo',
  config?: { integrator?: string },
): import('./types.js').TradeExecutor {
  if (mode === 'demo') {
    return new (require('./simulator.js').SimulatedExecutor)();
  }

  return new (require('./lifi-executor.js').LifiExecutor)({
    mode,
    integrator: config?.integrator || 'eXpress402-Sentifi',
  });
}
