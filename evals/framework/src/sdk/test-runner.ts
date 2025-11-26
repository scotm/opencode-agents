import { ServerManager } from './server-manager.js';
import { ClientManager } from './client-manager.js';
import { EventStreamHandler } from './event-stream-handler.js';
import { AutoApproveStrategy } from './approval/auto-approve-strategy.js';
import { AutoDenyStrategy } from './approval/auto-deny-strategy.js';
import { SmartApprovalStrategy } from './approval/smart-approval-strategy.js';
import { SessionReader } from '../collector/session-reader.js';
import { TimelineBuilder } from '../collector/timeline-builder.js';
import { EvaluatorRunner } from '../evaluators/evaluator-runner.js';
import { ApprovalGateEvaluator } from '../evaluators/approval-gate-evaluator.js';
import { ContextLoadingEvaluator } from '../evaluators/context-loading-evaluator.js';
import { DelegationEvaluator } from '../evaluators/delegation-evaluator.js';
import { ToolUsageEvaluator } from '../evaluators/tool-usage-evaluator.js';
import { BehaviorEvaluator } from '../evaluators/behavior-evaluator.js';
import type { TestCase } from './test-case-schema.js';
import type { ApprovalStrategy } from './approval/approval-strategy.js';
import type { ServerEvent } from './event-stream-handler.js';
import type { AggregatedResult } from '../evaluators/evaluator-runner.js';
import { homedir } from 'os';
import { join } from 'path';
import { findGitRoot } from '../config.js';

export interface TestRunnerConfig {
  /**
   * Port for opencode server (0 = random)
   */
  port?: number;

  /**
   * Enable debug logging
   */
  debug?: boolean;

  /**
   * Default timeout for tests (ms)
   */
  defaultTimeout?: number;

  /**
   * Project path for evaluators
   * 
   * IMPORTANT: This should be the git root where the agent runs, not the test framework directory.
   * 
   * Default behavior:
   * - Automatically finds git root by walking up from process.cwd()
   * - This ensures sessions created by agents are found correctly
   * 
   * When to override:
   * - Testing agents in non-git directories
   * - Testing multiple agents with different project roots
   * - Custom session storage locations
   * 
   * Example:
   * - Git root: /Users/user/opencode-agents (sessions stored here)
   * - Test CWD: /Users/user/opencode-agents/evals/framework (tests run here)
   * - projectPath should be git root, not test CWD
   */
  projectPath?: string;

  /**
   * Run evaluators after test execution
   */
  runEvaluators?: boolean;

  /**
   * Default model to use for tests (format: provider/model)
   * Examples:
   * - "opencode/grok-code-fast" (free tier)
   * - "anthropic/claude-3-5-sonnet-20241022"
   * - "openai/gpt-4-turbo"
   */
  defaultModel?: string;
}

export interface TestResult {
  /**
   * Test case that was run
   */
  testCase: TestCase;

  /**
   * Session ID created for this test
   */
  sessionId: string;

  /**
   * Whether the test passed
   */
  passed: boolean;

  /**
   * Errors encountered during test execution
   */
  errors: string[];

  /**
   * Events captured during test
   */
  events: ServerEvent[];

  /**
   * Duration of test execution (ms)
   */
  duration: number;

  /**
   * Number of approvals given
   */
  approvalsGiven: number;

  /**
   * Path to recorded session data
   */
  sessionPath?: string;

  /**
   * Evaluation results from evaluators (if runEvaluators = true)
   */
  evaluation?: AggregatedResult;
}

export class TestRunner {
  private server: ServerManager;
  private client: ClientManager | null = null;
  private eventHandler: EventStreamHandler | null = null;
  private config: Required<TestRunnerConfig>;
  private evaluatorRunner: EvaluatorRunner | null = null;

  constructor(config: TestRunnerConfig = {}) {
    // Find git root for agent detection
    const gitRoot = findGitRoot(process.cwd());
    
    this.config = {
      port: config.port || 0,
      debug: config.debug || false,
      defaultTimeout: config.defaultTimeout || 60000,
      projectPath: config.projectPath || gitRoot,
      runEvaluators: config.runEvaluators ?? true,
      defaultModel: config.defaultModel || 'opencode/grok-code', // Free tier default (fixed model name)
    };

    // Start server from git root with default agent
    // Note: Individual tests can override the agent per-session
    this.server = new ServerManager({
      port: this.config.port,
      timeout: 10000,
      cwd: gitRoot, // CRITICAL: Start server from git root to detect agent
      debug: this.config.debug, // Pass debug flag to server
      agent: 'openagent', // Default agent for all tests
    });

    if (this.config.debug) {
      console.log(`[TestRunner] Git root: ${gitRoot}`);
      console.log(`[TestRunner] Server will start from: ${gitRoot} with agent: openagent`);
    }

    // Note: Evaluators will be setup in start() after SDK client is available
  }

  /**
   * Start the test runner (starts opencode server)
   */
  async start(): Promise<void> {
    this.log('Starting opencode server...');
    const { url } = await this.server.start();
    this.log(`Server started at ${url}`);

    this.client = new ClientManager({ baseUrl: url });
    this.eventHandler = new EventStreamHandler(url);

    // Setup evaluators now that SDK client is available
    if (this.config.runEvaluators && this.client) {
      const sessionStoragePath = join(homedir(), '.local', 'share', 'opencode');
      
      // Create SessionReader with SDK client for reliable session retrieval
      const sdkClient = this.client.getClient();
      const sessionReader = new SessionReader(sdkClient, sessionStoragePath);
      const timelineBuilder = new TimelineBuilder(sessionReader);

      this.evaluatorRunner = new EvaluatorRunner({
        sessionReader,
        timelineBuilder,
        sdkClient,
        evaluators: [
          new ApprovalGateEvaluator(),
          new ContextLoadingEvaluator(),
          new DelegationEvaluator(),
          new ToolUsageEvaluator(),
        ],
      });

      if (this.config.debug) {
        this.log('[TestRunner] Evaluators initialized with SDK client');
      }
    }
  }

  /**
   * Stop the test runner (stops server)
   */
  async stop(): Promise<void> {
    this.log('Stopping event handler...');
    if (this.eventHandler) {
      this.eventHandler.stopListening();
      this.eventHandler = null;
    }

    this.log('Stopping server...');
    await this.server.stop();
    this.client = null;
  }

  /**
   * Run a single test case
   */
  async runTest(testCase: TestCase): Promise<TestResult> {
    if (!this.client || !this.eventHandler) {
      throw new Error('Test runner not started. Call start() first.');
    }

    const startTime = Date.now();
    const errors: string[] = [];
    const events: ServerEvent[] = [];
    let sessionId = '';
    let approvalsGiven = 0;

    try {
      this.log(`\n${'='.repeat(60)}`);
      this.log(`Running test: ${testCase.id} - ${testCase.name}`);
      this.log(`${'='.repeat(60)}`);

      // Create approval strategy
      const approvalStrategy = this.createApprovalStrategy(testCase);
      this.log(`Approval strategy: ${approvalStrategy.describe()}`);

      // Setup event handler
      this.eventHandler.removeAllHandlers();
      
      this.eventHandler.onAny((event) => {
        events.push(event);
        if (this.config.debug) {
          this.logEvent(event);
        }
      });

      this.eventHandler.onPermission(async (event) => {
        const approved = await approvalStrategy.shouldApprove(event);
        approvalsGiven++;
        this.log(`Permission ${approved ? 'APPROVED' : 'DENIED'}: ${event.properties.tool || 'unknown'}`);
        return approved;
      });

      // Start event listener in background
      const evtHandler = this.eventHandler;
      this.eventHandler.startListening().catch(err => {
        if (evtHandler.listening()) {
          errors.push(`Event stream error: ${err.message}`);
        }
      });

      // Wait for event handler to connect
      await this.sleep(2000);

      // Create session (agent selection happens in sendPrompt, not here)
      this.log('Creating session...');
      const session = await this.client.createSession({
        title: testCase.name,
      });
      sessionId = session.id;
      this.log(`Session created: ${sessionId}`);

      // Send prompt(s) with agent selection
      const timeout = testCase.timeout || this.config.defaultTimeout;
      const modelToUse = testCase.model || this.config.defaultModel;
      const agentToUse = testCase.agent || 'openagent'; // Default to openagent
      
      this.log(`Agent: ${agentToUse}`);
      this.log(`Model: ${modelToUse}`);
      
      // Check if multi-message test
      if (testCase.prompts && testCase.prompts.length > 0) {
        this.log(`Sending ${testCase.prompts.length} prompts (multi-turn)...`);
        
        for (let i = 0; i < testCase.prompts.length; i++) {
          const msg = testCase.prompts[i];
          this.log(`\nPrompt ${i + 1}/${testCase.prompts.length}:`);
          this.log(`  Text: ${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}`);
          if (msg.expectContext) {
            this.log(`  Expects context: ${msg.contextFile || 'yes'}`);
          }
          
          // Add delay if specified
          if (msg.delayMs && i > 0) {
            this.log(`  Waiting ${msg.delayMs}ms before sending...`);
            await this.sleep(msg.delayMs);
          }
          
          const promptPromise = this.client.sendPrompt(sessionId, {
            text: msg.text,
            agent: agentToUse, // ✅ Agent selection happens here!
            model: modelToUse ? this.parseModel(modelToUse) : undefined,
            directory: this.config.projectPath, // Pass working directory
          });
          
          await this.withTimeout(promptPromise, timeout, `Prompt ${i + 1} execution timed out`);
          this.log(`  Completed`);
          
          // Small delay between messages
          if (i < testCase.prompts.length - 1) {
            await this.sleep(1000);
          }
        }
        
        this.log('\nAll prompts completed');
      } else {
        // Single message test
        this.log('Sending prompt...');
        this.log(`Prompt: ${testCase.prompt!.substring(0, 100)}${testCase.prompt!.length > 100 ? '...' : ''}`);
        
        const promptPromise = this.client.sendPrompt(sessionId, {
          text: testCase.prompt!,
          agent: agentToUse, // ✅ Agent selection happens here!
          model: modelToUse ? this.parseModel(modelToUse) : undefined,
          directory: this.config.projectPath, // Pass working directory
        });

        await this.withTimeout(promptPromise, timeout, 'Prompt execution timed out');
        this.log('Prompt completed');
      }

      // Give time for final events to arrive
      await this.sleep(3000);

      // Stop event handler
      this.eventHandler.stopListening();

      const duration = Date.now() - startTime;

      // Validate agent is correct
      if (testCase.agent) {
        this.log(`Validating agent: ${testCase.agent}...`);
        try {
          const sessionInfo = await this.client.getSession(sessionId);
          const messages = sessionInfo.messages;
          
          if (messages && messages.length > 0) {
            const firstMessage = messages[0].info as any; // SDK types may not include agent field
            const actualAgent = firstMessage.agent;
            
            if (actualAgent && actualAgent !== testCase.agent) {
              errors.push(`Agent mismatch: expected '${testCase.agent}', got '${actualAgent}'`);
              this.log(`  ❌ Agent mismatch: expected '${testCase.agent}', got '${actualAgent}'`);
            } else if (actualAgent) {
              this.log(`  ✅ Agent verified: ${actualAgent}`);
            } else {
              this.log(`  ⚠️  Agent not set in message`);
            }
          }
        } catch (error) {
          this.log(`  Warning: Could not validate agent: ${(error as Error).message}`);
        }
      }

      // Run evaluators if enabled
      let evaluation: AggregatedResult | undefined;
      if (this.config.runEvaluators && this.evaluatorRunner) {
        this.log('Running evaluators...');
        
        // Add behavior evaluator if test case has behavior expectations
        if (testCase.behavior) {
          this.log('Adding behavior evaluator for test expectations...');
          const behaviorEvaluator = new BehaviorEvaluator(testCase.behavior);
          this.evaluatorRunner.register(behaviorEvaluator);
        }
        
        // No need to wait for disk writes - we're using SDK client directly!
        // The SDK has the session data in memory and can return it immediately.
        
        try {
          evaluation = await this.evaluatorRunner.runAll(sessionId);
          this.log(`Evaluators completed: ${evaluation.totalViolations} violations found`);
          
          if (evaluation && evaluation.totalViolations > 0) {
            this.log(`  Errors: ${evaluation.violationsBySeverity.error}`);
            this.log(`  Warnings: ${evaluation.violationsBySeverity.warning}`);
          }
          
          // Clean up behavior evaluator after use
          if (testCase.behavior) {
            this.evaluatorRunner.unregister('behavior');
          }
        } catch (error) {
          this.log(`Warning: Evaluators failed: ${(error as Error).message}`);
          errors.push(`Evaluator error: ${(error as Error).message}`);
        }
      }

      // Determine if test passed
      const passed = this.evaluateResult(testCase, events, errors, evaluation);

      this.log(`\nTest ${passed ? 'PASSED' : 'FAILED'}`);
      this.log(`Duration: ${duration}ms`);
      this.log(`Events captured: ${events.length}`);
      this.log(`Approvals given: ${approvalsGiven}`);
      this.log(`Errors: ${errors.length}`);

      return {
        testCase,
        sessionId,
        passed,
        errors,
        events,
        duration,
        approvalsGiven,
        evaluation,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      errors.push(`Test execution failed: ${(error as Error).message}`);

      this.log(`\nTest FAILED with exception`);
      this.log(`Error: ${(error as Error).message}`);

      return {
        testCase,
        sessionId,
        passed: false,
        errors,
        events,
        duration,
        approvalsGiven,
        evaluation: undefined,
      };
    }
  }

  /**
   * Run multiple test cases
   */
  async runTests(testCases: TestCase[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const testCase of testCases) {
      const result = await this.runTest(testCase);
      results.push(result);

      // Clean up session after each test (skip in debug mode to allow inspection)
      if (this.client && result.sessionId && !this.config.debug) {
        try {
          await this.client.deleteSession(result.sessionId);
          this.log(`Cleaned up session: ${result.sessionId}\n`);
        } catch (error) {
          this.log(`Failed to clean up session: ${(error as Error).message}\n`);
        }
      } else if (this.config.debug) {
        this.log(`Debug mode: Keeping session ${result.sessionId} for inspection\n`);
      }
    }

    return results;
  }

  /**
   * Create approval strategy from test case config
   */
  private createApprovalStrategy(testCase: TestCase): ApprovalStrategy {
    const strategy = testCase.approvalStrategy;

    switch (strategy.type) {
      case 'auto-approve':
        return new AutoApproveStrategy();

      case 'auto-deny':
        return new AutoDenyStrategy();

      case 'smart':
        return new SmartApprovalStrategy({
          allowedTools: strategy.config?.allowedTools,
          deniedTools: strategy.config?.deniedTools,
          approvePatterns: strategy.config?.approvePatterns?.map(p => new RegExp(p)),
          denyPatterns: strategy.config?.denyPatterns?.map(p => new RegExp(p)),
          maxApprovals: strategy.config?.maxApprovals,
          defaultDecision: strategy.config?.defaultDecision,
        });

      default:
        throw new Error(`Unknown approval strategy: ${(strategy as any).type}`);
    }
  }

  /**
   * Evaluate if test result matches expected outcome
   * 
   * Evaluation priority:
   * 1. Check for execution errors
   * 2. Check behavior expectations (if defined)
   * 3. Check expected violations (if defined)
   * 4. Check deprecated expected format (if defined)
   * 5. Default: pass if no errors
   */
  private evaluateResult(
    testCase: TestCase,
    events: ServerEvent[],
    errors: string[],
    evaluation?: AggregatedResult
  ): boolean {
    // Support both old and new schema
    const expected = testCase.expected;
    const behavior = testCase.behavior;
    const expectedViolations = testCase.expectedViolations;

    // If there were execution errors and test expects to pass, it fails
    if (errors.length > 0 && expected?.pass !== false) {
      this.log(`Test failed due to execution errors: ${errors.join(', ')}`);
      return false;
    }

    // =========================================================================
    // NEW: Check behavior evaluator results FIRST (most important)
    // =========================================================================
    if (behavior && evaluation) {
      // Find the behavior evaluator result
      const behaviorResult = evaluation.evaluatorResults.find(r => r.evaluator === 'behavior');
      
      if (behaviorResult) {
        // Check if behavior evaluator passed
        if (!behaviorResult.passed) {
          this.log(`Behavior validation failed: ${behaviorResult.violations.length} violations`);
          behaviorResult.violations.forEach(v => {
            this.log(`  - [${v.severity}] ${v.type}: ${v.message}`);
          });
          return false;
        }
        
        // Check for error-level violations from behavior evaluator
        const behaviorErrors = behaviorResult.violations.filter(v => v.severity === 'error');
        if (behaviorErrors.length > 0) {
          this.log(`Behavior validation has ${behaviorErrors.length} error-level violations`);
          return false;
        }
      }
    }

    // =========================================================================
    // Check expected violations (new format)
    // =========================================================================
    // Track which violations were expected so we don't fail on them later
    const expectedViolationTypes = new Set<string>();
    
    if (expectedViolations && evaluation) {
      for (const expectedViolation of expectedViolations) {
        // Map rule names to violation type patterns
        const rulePatterns: Record<string, string[]> = {
          'approval-gate': ['approval', 'missing-approval'],
          'context-loading': ['context', 'no-context-loaded', 'missing-context'],
          'delegation': ['delegation', 'missing-delegation'],
          'tool-usage': ['tool', 'suboptimal-tool'],
          'stop-on-failure': ['stop', 'failure'],
          'confirm-cleanup': ['cleanup', 'confirm'],
        };

        const patterns = rulePatterns[expectedViolation.rule] || [expectedViolation.rule];
        
        const actualViolations = evaluation.allViolations.filter(v => 
          patterns.some(pattern => v.type.toLowerCase().includes(pattern.toLowerCase()))
        );

        if (expectedViolation.shouldViolate) {
          // Negative test: Should have violation
          if (actualViolations.length === 0) {
            this.log(`Expected ${expectedViolation.rule} violation but none found`);
            return false;
          }
          this.log(`✓ Expected violation '${expectedViolation.rule}' found`);
          // Mark these violations as expected so we don't fail on them later
          actualViolations.forEach(v => expectedViolationTypes.add(v.type));
        } else {
          // Positive test: Should NOT have violation
          if (actualViolations.length > 0) {
            this.log(`Unexpected ${expectedViolation.rule} violation found: ${actualViolations[0].message}`);
            return false;
          }
        }
      }
    }

    // =========================================================================
    // Check deprecated expected format
    // =========================================================================
    if (expected) {
      // Check minimum messages (deprecated)
      if (expected.minMessages !== undefined) {
        const messageEvents = events.filter(e => e.type.includes('message'));
        if (messageEvents.length < expected.minMessages) {
          this.log(`Expected at least ${expected.minMessages} messages, got ${messageEvents.length}`);
          return false;
        }
      }

      // Check maximum messages (deprecated)
      if (expected.maxMessages !== undefined) {
        const messageEvents = events.filter(e => e.type.includes('message'));
        if (messageEvents.length > expected.maxMessages) {
          this.log(`Expected at most ${expected.maxMessages} messages, got ${messageEvents.length}`);
          return false;
        }
      }

      // Check expected violations (deprecated format)
      if (expected.violations && evaluation) {
        const expectedViolationTypes = expected.violations.map(v => v.rule);
        const actualViolationTypes = evaluation.allViolations.map(v => {
          if (v.type.includes('approval')) return 'approval-gate' as const;
          if (v.type.includes('context')) return 'context-loading' as const;
          if (v.type.includes('delegation')) return 'delegation' as const;
          if (v.type.includes('tool')) return 'tool-usage' as const;
          return 'unknown' as const;
        });

        for (const expectedType of expectedViolationTypes) {
          if (['approval-gate', 'context-loading', 'delegation', 'tool-usage'].includes(expectedType)) {
            if (!actualViolationTypes.includes(expectedType as any)) {
              this.log(`Expected violation '${expectedType}' not found`);
              return false;
            }
          }
        }

        if (!expected.pass && evaluation.totalViolations === 0) {
          this.log('Expected violations but none found');
          return false;
        }
      }

      // If test expects to pass, check no critical violations
      if (expected.pass && evaluation) {
        if (evaluation.violationsBySeverity.error > 0) {
          this.log(`Expected pass but found ${evaluation.violationsBySeverity.error} error-level violations`);
          return false;
        }
      }

      // Use expected.pass if specified
      if (expected.pass !== undefined) {
        return expected.pass ? errors.length === 0 : true;
      }
    }

    // =========================================================================
    // Default: pass if no errors and no unexpected error-level violations
    // =========================================================================
    if (evaluation && evaluation.violationsBySeverity.error > 0) {
      // Filter out expected violations
      const unexpectedErrors = evaluation.allViolations.filter(v => 
        v.severity === 'error' && !expectedViolationTypes.has(v.type)
      );
      
      if (unexpectedErrors.length > 0) {
        this.log(`Test failed: ${unexpectedErrors.length} unexpected error-level violations`);
        unexpectedErrors.forEach(v => this.log(`  - ${v.type}: ${v.message}`));
        return false;
      }
    }

    return errors.length === 0;
  }

  /**
   * Parse model string (provider/model format)
   */
  private parseModel(model: string): { providerID: string; modelID: string } {
    const [providerID, modelID] = model.split('/');
    if (!providerID || !modelID) {
      throw new Error(`Invalid model format: ${model}. Expected provider/model`);
    }
    return { providerID, modelID };
  }

  /**
   * Sleep for ms
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Run promise with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(message)), timeoutMs)
      ),
    ]);
  }

  /**
   * Log message
   */
  private log(message: string): void {
    if (this.config.debug || message.includes('PASSED') || message.includes('FAILED')) {
      console.log(message);
    }
  }

  /**
   * Log event with meaningful details
   * 
   * Event properties structure varies by type:
   * - session.created/updated: { id, title, ... }
   * - message.updated: { id, sessionID, role, ... }
   * - part.updated: { id, messageID, type, tool?, input?, output?, ... }
   */
  private logEvent(event: ServerEvent): void {
    const props = event.properties || {};
    
    switch (event.type) {
      case 'session.created':
        console.log(`📋 Session created`);
        break;
        
      case 'session.updated':
        // Session updates are frequent but not very informative
        // Skip logging unless there's something specific
        break;
        
      case 'message.created':
        console.log(`💬 New message (${props.role || 'assistant'})`);
        break;
        
      case 'message.updated':
        // Message updates happen frequently during streaming
        // Only log role changes or completion
        if (props.role === 'user') {
          console.log(`👤 User message received`);
        }
        // Skip assistant message updates (too noisy)
        break;
        
      case 'part.created':
      case 'part.updated':
        // Parts contain the actual content - tools, text, etc.
        if (props.type === 'tool') {
          const toolName = props.tool || 'unknown';
          const status = props.state?.status || props.status || '';
          
          // Only log when tool starts or completes
          if (status === 'running' || status === 'pending') {
            console.log(`🔧 Tool: ${toolName} (starting)`);
            
            // Show tool input preview
            const input = props.state?.input || props.input || {};
            if (input.command) {
              const cmd = input.command.substring(0, 70);
              console.log(`   └─ ${cmd}${input.command.length > 70 ? '...' : ''}`);
            } else if (input.filePath) {
              console.log(`   └─ ${input.filePath}`);
            } else if (input.pattern) {
              console.log(`   └─ pattern: ${input.pattern}`);
            }
          } else if (status === 'completed') {
            console.log(`✅ Tool: ${toolName} (completed)`);
          } else if (status === 'error') {
            console.log(`❌ Tool: ${toolName} (error)`);
          }
        } else if (props.type === 'text') {
          // Text parts - show preview of assistant response
          const text = props.text || '';
          if (text.length > 0) {
            const preview = text.substring(0, 100).replace(/\n/g, ' ');
            console.log(`📝 ${preview}${text.length > 100 ? '...' : ''}`);
          }
        }
        break;
        
      case 'permission.request':
        console.log(`🔐 Permission requested: ${props.tool || 'unknown'}`);
        break;
        
      case 'permission.response':
        console.log(`🔐 Permission ${props.response === 'once' || props.approved ? 'granted' : 'denied'}`);
        break;
        
      case 'tool.call':
        console.log(`🔧 Tool call: ${props.tool || props.name || 'unknown'}`);
        break;
        
      case 'tool.result':
        const success = props.error ? '❌' : '✅';
        console.log(`${success} Tool result: ${props.tool || 'unknown'}`);
        break;
        
      default:
        // Skip unknown events to reduce noise
        break;
    }
  }
}
