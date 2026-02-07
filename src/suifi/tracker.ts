/**
 * Suifi - Decision Tracker
 *
 * Records and evaluates AI decisions for Sui vault investments
 */

import fs from 'fs';
import path from 'path';
import type {
  SuiVaultDecision,
  SuiDecisionRecord,
  LearningMetrics,
  ActionMetrics,
  ProjectMetrics,
  TrackerConfig,
} from './types.js';
import { DEFAULT_TRACKER_CONFIG } from './types.js';
import { findVault } from './providers/defillama.js';

// ============================================================================
// TRACKER CLASS
// ============================================================================

export class SuiDecisionTracker {
  private config: TrackerConfig;
  private decisions: Map<string, SuiDecisionRecord> = new Map();

  constructor(config?: Partial<TrackerConfig>) {
    this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };

    // Ensure data directory exists
    const dir = path.dirname(this.config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing data
    this.loadFromDisk();
  }

  /**
   * Record a new decision
   */
  async recordDecision(decision: SuiVaultDecision): Promise<string> {
    const record: SuiDecisionRecord = {
      decision,
    };

    this.decisions.set(decision.id, record);

    if (this.config.autoSave) {
      this.saveToDisk();
    }

    console.log(`✅ Decision recorded: ${decision.id}`);
    return decision.id;
  }

  /**
   * Evaluate a single decision by ID
   */
  async evaluateDecision(id: string): Promise<void> {
    const record = this.decisions.get(id);
    if (!record) {
      console.log(`⚠️ Decision ${id} not found`);
      return;
    }

    if (record.decision.evaluated) {
      console.log(`⚠️ Decision ${id} already evaluated`);
      return;
    }

    // Fetch current vault data
    const currentVault = await findVault(
      record.decision.project,
      record.decision.pool
    );

    if (!currentVault) {
      console.log(`⚠️ Vault ${record.decision.project}/${record.decision.pool} no longer exists`);
      // Mark as evaluated with neutral outcome
      record.decision.evaluated = true;
      record.decision.evaluatedAt = new Date();
      record.decision.outcome = 'neutral';
      return;
    }

    // Calculate changes
    const apyChange = currentVault.apy - record.decision.apyAtDecision;
    const tvlChange = currentVault.tvlUsd - record.decision.tvlAtDecision;

    // Determine outcome based on action and changes
    let outcome: 'correct' | 'incorrect' | 'neutral';
    if (record.decision.action === 'deposit') {
      // Deposit was correct if APY didn't drop significantly
      outcome = apyChange > -5 ? 'correct' : 'incorrect';
    } else if (record.decision.action === 'withdraw') {
      // Withdraw was correct if APY dropped
      outcome = apyChange < 0 ? 'correct' : 'incorrect';
    } else {
      // Hold is always neutral for now
      outcome = 'neutral';
    }

    // Update decision
    record.decision.evaluated = true;
    record.decision.evaluatedAt = new Date();
    record.decision.actualApy = currentVault.apy;
    record.decision.actualTvl = currentVault.tvlUsd;
    record.decision.outcome = outcome;
    record.decision.apyChange = apyChange;
    record.decision.tvlChange = tvlChange;

    // Add evaluation record
    record.evaluation = {
      apyAfter: currentVault.apy,
      tvlAfter: currentVault.tvlUsd,
      apyChange,
      tvlChange,
      metExpectation: outcome === 'correct',
      evaluatedAt: new Date(),
    };

    if (this.config.autoSave) {
      this.saveToDisk();
    }

    const changeStr = apyChange > 0 ? `+${apyChange.toFixed(2)}%` : `${apyChange.toFixed(2)}%`;
    const tvlChangeStr = tvlChange > 0
      ? `+$${this.formatNumber(tvlChange)}`
      : `-$${this.formatNumber(Math.abs(tvlChange))}`;

    console.log(`📊 Evaluated ${id}:`);
    console.log(`   Outcome: ${outcome.toUpperCase()}`);
    console.log(`   APY Change: ${changeStr}`);
    console.log(`   TVL Change: ${tvlChangeStr}`);
  }

  /**
   * Evaluate all pending decisions
   */
  async evaluatePending(): Promise<number> {
    const pending = Array.from(this.decisions.values())
      .filter(r => !r.decision.evaluated);

    console.log(`🔍 Evaluating ${pending.length} pending decisions...`);

    for (const record of pending) {
      await this.evaluateDecision(record.decision.id);
    }

    return pending.length;
  }

  /**
   * Get learning metrics
   */
  getMetrics(): LearningMetrics {
    const decisions = Array.from(this.decisions.values());
    const evaluated = decisions.filter(d => d.decision.evaluated);
    const pending = decisions.filter(d => !d.decision.evaluated);
    const correct = evaluated.filter(d => d.decision.outcome === 'correct');
    const incorrect = evaluated.filter(d => d.decision.outcome === 'incorrect');

    return {
      totalDecisions: decisions.length,
      evaluatedDecisions: evaluated.length,
      pendingEvaluation: pending.length,
      correctDecisions: correct.length,
      incorrectDecisions: incorrect.length,
      overallAccuracy: evaluated.length > 0 ? correct.length / evaluated.length : 0,
      byAction: this.getActionMetrics(decisions),
      byProject: this.getProjectMetrics(decisions),
      bestPerformingProject: this.findBestProject(evaluated),
      avgConfidence: this.calculateAvgConfidence(decisions),
      avgApy: this.calculateAvgApy(decisions),
      lastUpdated: new Date(),
    };
  }

  /**
   * Get decision by ID
   */
  getDecision(id: string): SuiDecisionRecord | undefined {
    return this.decisions.get(id);
  }

  /**
   * Get all decisions
   */
  getAllDecisions(): SuiDecisionRecord[] {
    return Array.from(this.decisions.values());
  }

  /**
   * Get recent decisions
   */
  getRecentDecisions(limit: number = 10): SuiDecisionRecord[] {
    return Array.from(this.decisions.values())
      .sort((a, b) => b.decision.timestamp.getTime() - a.decision.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get decisions by project
   */
  getDecisionsByProject(projectName: string): SuiDecisionRecord[] {
    return Array.from(this.decisions.values())
      .filter(r => r.decision.project.toLowerCase().includes(projectName.toLowerCase()));
  }

  /**
   * Delete old decisions
   */
  cleanup(olderThanDays: number): number {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [id, record] of this.decisions) {
      if (
        record.decision.timestamp.getTime() < cutoff &&
        record.decision.evaluated
      ) {
        this.decisions.delete(id);
        removed++;
      }
    }

    if (removed > 0 && this.config.autoSave) {
      this.saveToDisk();
    }

    return removed;
  }

  /**
   * Clear all decisions (use with caution)
   */
  clearAll(): void {
    this.decisions.clear();
    if (this.config.autoSave) {
      this.saveToDisk();
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Calculate metrics by action type
   */
  private getActionMetrics(
    decisions: SuiDecisionRecord[]
  ): Record<string, ActionMetrics> {
    const actions = ['deposit', 'withdraw', 'hold'] as const;
    const result: Record<string, ActionMetrics> = {};

    for (const action of actions) {
      const filtered = decisions.filter(d => d.decision.action === action);
      const evaluated = filtered.filter(d => d.decision.evaluated);
      const correct = evaluated.filter(d => d.decision.outcome === 'correct');
      const incorrect = evaluated.filter(d => d.decision.outcome === 'incorrect');

      result[action] = {
        total: filtered.length,
        correct: correct.length,
        incorrect: incorrect.length,
        accuracy: evaluated.length > 0 ? correct.length / evaluated.length : 0,
        avgApy: this.calculateAvgApy(filtered),
        avgConfidence: this.calculateAvgConfidence(filtered),
      };
    }

    return result;
  }

  /**
   * Calculate metrics by project
   */
  private getProjectMetrics(
    decisions: SuiDecisionRecord[]
  ): Record<string, ProjectMetrics> {
    const byProject: Record<string, SuiDecisionRecord[]> = {};

    // Group by project
    for (const record of decisions) {
      const project = record.decision.project;
      if (!byProject[project]) {
        byProject[project] = [];
      }
      byProject[project].push(record);
    }

    // Calculate metrics for each project
    const result: Record<string, ProjectMetrics> = {};
    for (const [project, records] of Object.entries(byProject)) {
      const evaluated = records.filter(r => r.decision.evaluated);
      const correct = evaluated.filter(r => r.decision.outcome === 'correct');
      const incorrect = evaluated.filter(r => r.decision.outcome === 'incorrect');

      // Find best action
      const actionCounts: Record<string, number> = { deposit: 0, withdraw: 0, hold: 0 };
      for (const record of records) {
        actionCounts[record.decision.action]++;
      }
      const bestAction = Object.entries(actionCounts)
        .sort((a, b) => b[1] - a[1])[0][0] as any;

      result[project] = {
        total: records.length,
        correct: correct.length,
        incorrect: incorrect.length,
        accuracy: evaluated.length > 0 ? correct.length / evaluated.length : 0,
        avgApy: this.calculateAvgApy(records),
        avgConfidence: this.calculateAvgConfidence(records),
        bestAction,
        totalTvlUsd: records.reduce((sum, r) => sum + r.decision.tvlAtDecision, 0),
      };
    }

    return result;
  }

  /**
   * Find best performing project
   */
  private findBestProject(
    decisions: SuiDecisionRecord[]
  ): { name: string; accuracy: number; totalDecisions: number } | undefined {
    const byProject = this.getProjectMetrics(decisions);
    const validProjects = Object.entries(byProject)
      .filter(([_, metrics]) => metrics.total >= 3); // At least 3 decisions

    if (validProjects.length === 0) {
      return undefined;
    }

    const sorted = validProjects.sort((a, b) => b[1].accuracy - a[1].accuracy);
    const [name, metrics] = sorted[0];

    return {
      name,
      accuracy: metrics.accuracy,
      totalDecisions: metrics.total,
    };
  }

  /**
   * Calculate average confidence
   */
  private calculateAvgConfidence(decisions: SuiDecisionRecord[]): number {
    if (decisions.length === 0) return 0;
    const sum = decisions.reduce((acc, r) => acc + r.decision.confidence, 0);
    return sum / decisions.length;
  }

  /**
   * Calculate average APY
   */
  private calculateAvgApy(decisions: SuiDecisionRecord[]): number {
    if (decisions.length === 0) return 0;
    const sum = decisions.reduce((acc, r) => acc + r.decision.apyAtDecision, 0);
    return sum / decisions.length;
  }

  /**
   * Format number for display
   */
  private formatNumber(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toFixed(2);
  }

  /**
   * Save decisions to disk
   */
  private saveToDisk(): void {
    try {
      const data = Array.from(this.decisions.values());
      fs.writeFileSync(
        this.config.dbPath,
        JSON.stringify(data, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('❌ Error saving to disk:', error);
    }
  }

  /**
   * Load decisions from disk
   */
  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.config.dbPath)) {
        const data = fs.readFileSync(this.config.dbPath, 'utf-8');
        const records: SuiDecisionRecord[] = JSON.parse(data);

        for (const record of records) {
          // Convert date strings back to Date objects
          record.decision.timestamp = new Date(record.decision.timestamp);
          if (record.decision.evaluatedAt) {
            record.decision.evaluatedAt = new Date(record.decision.evaluatedAt);
          }
          if (record.evaluation) {
            record.evaluation.evaluatedAt = new Date(record.evaluation.evaluatedAt);
          }

          this.decisions.set(record.decision.id, record);
        }

        console.log(`✅ Loaded ${this.decisions.size} decisions from disk`);
      }
    } catch (error) {
      console.error('❌ Error loading from disk:', error);
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createTracker(config?: Partial<TrackerConfig>): SuiDecisionTracker {
  return new SuiDecisionTracker(config);
}
