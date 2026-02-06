/**
 * Sentifi - AI Trading Agent Orchestrator
 *
 * Main entry point that coordinates all modules:
 * - Data providers (sentiment, price)
 * - Signal processing (sentiment analysis, momentum)
 * - Trading strategies
 * - Risk management
 * - Execution
 * - Learning/feedback
 */

// Re-export core types
export * from './types.js';
export { SentifiConfigSchema, loadConfig, validateConfig, createDemoConfig } from './config.js';

// Re-export modules selectively to avoid conflicts
export {
  SentimentAggregator as SentimentProviderAggregator,
  createSentimentAggregator,
} from './providers/sentiment/aggregator.js';

export {
  SentimentAnalyzer,
  createSentimentAnalyzer,
} from './signals/sentiment/analyzer.js';

export {
  MomentumCalculator,
  createMomentumCalculator,
} from './signals/momentum/calculator.js';

export {
  SignalAggregator,
  createSignalAggregator,
} from './signals/aggregator.js';

export {
  StrategyRegistry,
  getStrategyRegistry,
  registerStrategy,
  getStrategy,
} from './strategies/registry.js';

export {
  SentimentMomentumStrategy,
  createSentimentMomentumStrategy,
} from './strategies/sentiment-momentum.js';

export {
  SentifiRiskManager,
  createRiskManager,
} from './risk/manager.js';

export {
  CircuitBreaker,
  createCircuitBreaker,
} from './risk/circuit-breaker.js';

export {
  LifiExecutor,
  createLifiExecutor,
  SimulatedExecutor,
  SimulatedPortfolioManager,
  createSimulatedExecutor,
  createSimulatedPortfolioManager,
} from './execution/index.js';

export {
  MemoryPredictionTracker,
  createPredictionTracker,
} from './learning/tracker.js';

// Import types for orchestrator
import type {
  SentifiConfig,
  AggregatedSignal,
  TradeIntent,
  Holding,
  AgentPhase,
  AgentState,
  PriceBar,
  RawSentimentItem,
} from './types.js';

// Import modules
import { SentimentAnalyzer } from './signals/sentiment/analyzer.js';
import { MomentumCalculator } from './signals/momentum/calculator.js';
import { SignalAggregator } from './signals/aggregator.js';
import { getStrategy, registerStrategy } from './strategies/registry.js';
import { createSentimentMomentumStrategy } from './strategies/sentiment-momentum.js';
import type { StrategyConfig, StrategyContext } from './strategies/types.js';
import { DEFAULT_STRATEGY_CONFIG } from './strategies/types.js';
import { SentifiRiskManager } from './risk/manager.js';
import type { RiskAssessment, RiskConfig } from './risk/types.js';
import { DEFAULT_RISK_CONFIG } from './risk/types.js';
import { createLifiExecutor, createSimulatedExecutor, createSimulatedPortfolioManager } from './execution/index.js';
import { SimulatedPortfolioManager } from './execution/simulator.js';
import type { TradeExecutor, QuoteResult, ExecutionResult, PortfolioManager } from './execution/types.js';
import { createPredictionTracker } from './learning/tracker.js';
import type { PredictionTracker, LearningMetrics } from './learning/types.js';

/** Agent event types */
export type AgentEvent =
  | { type: 'phase_change'; phase: AgentPhase; message: string }
  | { type: 'signal_update'; signal: AggregatedSignal }
  | { type: 'decision'; intent: TradeIntent | null; reason: string }
  | { type: 'risk_assessment'; assessment: RiskAssessment }
  | { type: 'quote'; quote: QuoteResult }
  | { type: 'execution'; result: ExecutionResult }
  | { type: 'error'; error: string }
  | { type: 'log'; message: string };

/** Agent event handler */
export type AgentEventHandler = (event: AgentEvent) => void;

/**
 * Sentifi Trading Agent
 *
 * Orchestrates the complete trading pipeline:
 * 1. Fetch sentiment data from providers
 * 2. Analyze sentiment and momentum
 * 3. Aggregate signals
 * 4. Generate trade intent via strategy
 * 5. Assess risk
 * 6. Get quote
 * 7. Execute trade
 * 8. Track for learning
 */
export class SentifiAgent {
  private config: Partial<SentifiConfig>;
  private strategyConfig: StrategyConfig;
  private riskConfig: RiskConfig;

  // Modules
  private sentimentAnalyzer: SentimentAnalyzer;
  private momentumCalculator: MomentumCalculator;
  private signalAggregator: SignalAggregator;
  private riskManager: SentifiRiskManager;
  private executor: TradeExecutor;
  private portfolioManager: PortfolioManager;
  private predictionTracker: PredictionTracker;

  // State
  private state: AgentState;
  private eventHandlers: AgentEventHandler[] = [];

  constructor(config?: Partial<SentifiConfig>) {
    this.config = config || {};

    // Initialize strategy config
    this.strategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      bullishThreshold: this.config.strategy?.bullishThreshold ?? 40,
      bearishThreshold: this.config.strategy?.bearishThreshold ?? -40,
      minConfidence: this.config.strategy?.minConfidence ?? 0.5,
    };

    // Initialize risk config
    this.riskConfig = {
      ...DEFAULT_RISK_CONFIG,
      maxPositionSizeUsd: this.config.risk?.maxPositionSizeUsd ?? 1000,
      maxPositionPercent: this.config.risk?.maxPositionPercent ?? 25,
    };

    // Initialize modules
    this.sentimentAnalyzer = new SentimentAnalyzer();
    this.momentumCalculator = new MomentumCalculator();
    this.signalAggregator = new SignalAggregator({
      sentimentWeight: this.config.signals?.sentimentWeight ?? 0.6,
      momentumWeight: this.config.signals?.momentumWeight ?? 0.4,
    });
    this.riskManager = new SentifiRiskManager(this.riskConfig);

    // Initialize executor based on mode
    const mode = this.config.execution?.mode ?? 'demo';
    if (mode === 'demo') {
      const simExecutor = createSimulatedExecutor();
      this.executor = simExecutor;
      this.portfolioManager = createSimulatedPortfolioManager(simExecutor);
    } else {
      this.executor = createLifiExecutor({ mode });
      this.portfolioManager = createSimulatedPortfolioManager();
    }

    // Initialize learning
    this.predictionTracker = createPredictionTracker({
      enabled: this.config.learning?.enabled ?? true,
    });

    // Register default strategy
    registerStrategy('sentiment-momentum', createSentimentMomentumStrategy);

    // Initialize state
    this.state = {
      phase: 'init',
      portfolio: [],
      totalValueUsd: 0,
      lastSignal: null,
      lastIntent: null,
      lastQuote: null,
      logs: [],
    };
  }

  /**
   * Subscribe to agent events
   */
  onEvent(handler: AgentEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: AgentEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (e) {
        console.error('Event handler error:', e);
      }
    }
  }

  /**
   * Log a message
   */
  private log(message: string): void {
    this.state.logs.push({ timestamp: new Date(), message });
    this.emit({ type: 'log', message });
  }

  /**
   * Update phase
   */
  private setPhase(phase: AgentPhase, message: string): void {
    this.state.phase = phase;
    this.emit({ type: 'phase_change', phase, message });
    this.log(`[${phase.toUpperCase()}] ${message}`);
  }

  /**
   * Get current state
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Update portfolio holdings
   */
  async updatePortfolio(): Promise<Holding[]> {
    this.state.portfolio = await this.portfolioManager.getHoldings();
    this.state.totalValueUsd = await this.portfolioManager.getTotalValueUsd();
    return this.state.portfolio;
  }

  /**
   * Deposit funds (demo mode)
   */
  async deposit(amount: number, token: string, chainId: number = 1): Promise<void> {
    await this.portfolioManager.deposit(amount, token, chainId);
    await this.updatePortfolio();
    this.log(`Deposited ${amount} ${token} on chain ${chainId}`);
  }

  /**
   * Analyze sentiment from raw data
   */
  async analyzeSentiment(
    symbol: string,
    sentimentItems: RawSentimentItem[],
    priceBars?: PriceBar[],
  ): Promise<AggregatedSignal> {
    this.setPhase('monitor', `Analyzing sentiment for ${symbol}`);

    // Analyze sentiment
    const sentimentSignal = this.sentimentAnalyzer.analyze(sentimentItems);
    this.log(`Sentiment: ${sentimentSignal.label} (score: ${sentimentSignal.score.toFixed(1)}, confidence: ${(sentimentSignal.confidence * 100).toFixed(0)}%)`);

    // Calculate momentum if price data available
    let momentumSignal;
    if (priceBars && priceBars.length > 0) {
      momentumSignal = this.momentumCalculator.calculate(priceBars);
      this.log(`Momentum: RSI ${momentumSignal.rsi.toFixed(1)}, trend ${momentumSignal.trend}`);
    }

    // Aggregate signals
    const aggregatedSignal = this.signalAggregator.aggregate(
      symbol,
      sentimentSignal,
      momentumSignal,
    );

    this.state.lastSignal = aggregatedSignal;
    this.emit({ type: 'signal_update', signal: aggregatedSignal });
    this.log(`Aggregated: score ${aggregatedSignal.overallScore.toFixed(1)}, confidence ${(aggregatedSignal.overallConfidence * 100).toFixed(0)}%, recommendation: ${aggregatedSignal.recommendation}`);

    return aggregatedSignal;
  }

  /**
   * Generate trading decision from signal
   */
  async decide(
    signal?: AggregatedSignal,
    strategyName: string = 'sentiment-momentum',
  ): Promise<TradeIntent | null> {
    this.setPhase('decide', 'Generating trading decision');

    const currentSignal = signal || this.state.lastSignal;
    if (!currentSignal) {
      this.emit({ type: 'decision', intent: null, reason: 'No signal available' });
      return null;
    }

    // Get strategy
    const strategy = getStrategy(strategyName);
    if (!strategy) {
      this.emit({ type: 'decision', intent: null, reason: `Strategy not found: ${strategyName}` });
      return null;
    }

    // Build context
    const context: StrategyContext = {
      signal: currentSignal,
      portfolio: this.state.portfolio,
      totalValueUsd: this.state.totalValueUsd,
      config: this.strategyConfig,
      availableChains: [1, 10, 137, 42161, 8453],
      defaultChainId: 1,
    };

    // Evaluate strategy
    const intent = strategy.evaluate(context);

    this.state.lastIntent = intent;
    this.emit({
      type: 'decision',
      intent,
      reason: intent?.reason || 'No action recommended',
    });

    if (intent) {
      this.log(`Decision: ${intent.action.toUpperCase()} ${intent.symbol} (${intent.suggestedSizePercent.toFixed(1)}% of portfolio)`);
      this.log(`Reason: ${intent.reason}`);
    } else {
      this.log('Decision: HOLD - No trade recommended');
    }

    return intent;
  }

  /**
   * Assess risk for a trade intent
   */
  async assessRisk(intent?: TradeIntent): Promise<RiskAssessment | null> {
    const currentIntent = intent || this.state.lastIntent;
    if (!currentIntent) {
      return null;
    }

    const assessment = this.riskManager.evaluate(
      currentIntent,
      this.state.portfolio,
      this.state.totalValueUsd,
    );

    this.emit({ type: 'risk_assessment', assessment });

    if (assessment.approved) {
      this.log(`Risk: APPROVED (risk score: ${assessment.riskScore})`);
      if (assessment.adjustedIntent) {
        this.log(`Adjusted size: ${assessment.adjustedIntent.suggestedSizePercent.toFixed(1)}%`);
      }
    } else {
      this.log(`Risk: REJECTED - ${assessment.reasons.join(', ')}`);
    }

    return assessment;
  }

  /**
   * Get a quote for a trade
   */
  async getQuote(
    intent?: TradeIntent,
    fromAddress: string = '0x0000000000000000000000000000000000000000',
  ): Promise<QuoteResult> {
    this.setPhase('quote', 'Getting swap quote');

    const currentIntent = intent || this.state.lastIntent;
    if (!currentIntent) {
      const errorQuote: QuoteResult = {
        success: false,
        error: 'No trade intent',
        inputAmount: '0',
        inputToken: '',
        estimatedOutput: '0',
        outputToken: '',
        gasCostUsd: 0,
        totalFeesUsd: 0,
        exchangeRate: 0,
        minimumOutput: '0',
        steps: [],
        source: 'fallback',
        timestamp: new Date(),
      };
      this.emit({ type: 'quote', quote: errorQuote });
      return errorQuote;
    }

    // Calculate amount from portfolio
    const fromHolding = this.state.portfolio.find(
      (h) => h.token === currentIntent.fromToken || h.address === currentIntent.fromToken,
    );
    const amountValue = fromHolding
      ? (fromHolding.balance * currentIntent.suggestedSizePercent) / 100
      : 0;

    // Convert to wei (assuming 18 decimals for simplicity)
    const amount = Math.floor(amountValue * Math.pow(10, 18)).toString();

    const quote = await this.executor.getQuote({
      fromToken: currentIntent.fromToken,
      toToken: currentIntent.toToken,
      fromChainId: currentIntent.fromChainId,
      toChainId: currentIntent.toChainId,
      amount,
      fromAddress,
      slippage: currentIntent.maxSlippage,
    });

    this.state.lastQuote = quote;
    this.emit({ type: 'quote', quote });

    if (quote.success) {
      this.log(`Quote: ${quote.inputAmount} ${quote.inputToken} → ${quote.estimatedOutput} ${quote.outputToken}`);
      this.log(`Route: ${quote.routeName} | Gas: $${quote.gasCostUsd.toFixed(2)}`);
    } else {
      this.log(`Quote failed: ${quote.error}`);
    }

    return quote;
  }

  /**
   * Execute a trade
   */
  async execute(
    quote?: QuoteResult,
    walletAddress: string = '0x0000000000000000000000000000000000000000',
    userApproved: boolean = false,
  ): Promise<ExecutionResult> {
    this.setPhase('execute', 'Executing trade');

    const currentQuote = quote || this.state.lastQuote;
    const currentIntent = this.state.lastIntent;

    if (!currentQuote || !currentIntent) {
      const errorResult: ExecutionResult = {
        success: false,
        status: 'failed',
        error: 'No quote or intent available',
        chainId: 1,
        inputAmount: '0',
        timestamp: new Date(),
        mode: 'demo',
      };
      this.emit({ type: 'execution', result: errorResult });
      return errorResult;
    }

    const result = await this.executor.execute({
      intent: currentIntent,
      quote: currentQuote,
      walletAddress,
      userApproved,
    });

    this.emit({ type: 'execution', result });

    if (result.success) {
      this.log(`Execution: SUCCESS`);
      this.log(`TX: ${result.txHash}`);
      this.log(`Output: ${result.outputAmount} | Gas: $${result.gasUsedUsd?.toFixed(2)}`);

      // Update portfolio after trade
      if (this.portfolioManager instanceof SimulatedPortfolioManager) {
        const simManager = this.portfolioManager as SimulatedPortfolioManager;
        await simManager.executeTrade(
          currentQuote.inputToken,
          currentQuote.outputToken,
          parseFloat(currentQuote.inputAmount),
          parseFloat(result.outputAmount || currentQuote.estimatedOutput),
          result.chainId,
        );
        await this.updatePortfolio();
      }

      // Record for learning
      if (this.config.learning?.enabled && this.state.lastSignal) {
        await this.predictionTracker.recordPrediction({
          signal: this.state.lastSignal,
          intent: currentIntent,
          currentPrice: parseFloat(currentQuote.inputAmount) > 0
            ? parseFloat(currentQuote.estimatedOutput) / parseFloat(currentQuote.inputAmount)
            : 1,
        });
      }
    } else {
      this.log(`Execution: FAILED - ${result.error}`);
    }

    this.setPhase('done', 'Trade cycle complete');
    return result;
  }

  /**
   * Run a complete analysis cycle
   */
  async runCycle(
    symbol: string,
    sentimentItems: RawSentimentItem[],
    priceBars?: PriceBar[],
    options?: {
      autoExecute?: boolean;
      walletAddress?: string;
    },
  ): Promise<{
    signal: AggregatedSignal;
    intent: TradeIntent | null;
    assessment: RiskAssessment | null;
    quote: QuoteResult | null;
    execution: ExecutionResult | null;
  }> {
    // Analyze
    const signal = await this.analyzeSentiment(symbol, sentimentItems, priceBars);

    // Decide
    const intent = await this.decide(signal);

    // If no trade, return early
    if (!intent) {
      return { signal, intent: null, assessment: null, quote: null, execution: null };
    }

    // Assess risk
    const assessment = await this.assessRisk(intent);

    // If not approved, return
    if (!assessment?.approved) {
      return { signal, intent, assessment, quote: null, execution: null };
    }

    // Get quote
    const quote = await this.getQuote(assessment.adjustedIntent || intent);

    // If quote failed or no auto-execute, return
    if (!quote.success || !options?.autoExecute) {
      return { signal, intent, assessment, quote, execution: null };
    }

    // Execute
    const execution = await this.execute(
      quote,
      options.walletAddress,
      options.autoExecute,
    );

    return { signal, intent, assessment, quote, execution };
  }

  /**
   * Get learning metrics
   */
  async getLearningMetrics(): Promise<LearningMetrics> {
    return this.predictionTracker.getMetrics();
  }

  /**
   * Get risk metrics
   */
  getRiskMetrics() {
    return this.riskManager.getMetrics();
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState() {
    return this.riskManager.checkCircuitBreaker();
  }
}

/**
 * Create a Sentifi agent instance
 */
export function createSentifiAgent(config?: Partial<SentifiConfig>): SentifiAgent {
  return new SentifiAgent(config);
}
