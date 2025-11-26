# OpenCode Agent Evaluation Framework

Comprehensive SDK-based evaluation framework for testing OpenCode agents with real execution, event streaming, and automated violation detection.

## Quick Start

```bash
cd evals/framework
npm install
npm run build

# Run all agent tests (uses free model by default)
npm run eval:sdk

# Run tests for specific agent
npm run eval:sdk -- --agent=opencoder
npm run eval:sdk -- --agent=openagent

# Run with specific model
npm run eval:sdk -- --model=anthropic/claude-3-5-sonnet-20241022

# Run specific tests only
npm run eval:sdk -- --pattern="developer/*.yaml"

# Debug mode
npm run eval:sdk -- --debug
```

## Directory Structure

```
evals/
├── framework/                    # Core evaluation framework
│   ├── src/
│   │   ├── sdk/                 # SDK-based test runner
│   │   │   ├── server-manager.ts
│   │   │   ├── client-manager.ts
│   │   │   ├── event-stream-handler.ts
│   │   │   ├── test-runner.ts
│   │   │   ├── test-case-schema.ts
│   │   │   ├── test-case-loader.ts
│   │   │   ├── run-sdk-tests.ts        # CLI entry point
│   │   │   └── approval/               # Approval strategies
│   │   ├── collector/           # Session data collection
│   │   ├── evaluators/          # Rule violation detection
│   │   └── types/               # TypeScript types
│   ├── docs/
│   │   └── test-design-guide.md # Test design philosophy
│   ├── SDK_EVAL_README.md       # Comprehensive SDK guide
│   └── README.md                # Framework documentation
│
├── agents/                      # Agent-specific test suites
│   ├── openagent/               # OpenAgent tests (text-based approval workflow)
│   │   ├── tests/
│   │   │   ├── developer/       # Developer workflow tests
│   │   │   ├── business/        # Business analysis tests
│   │   │   └── edge-case/       # Edge case tests
│   │   ├── docs/
│   │   │   └── OPENAGENT_RULES.md
│   │   └── README.md
│   │
│   ├── opencoder/               # Opencoder tests (direct execution)
│   │   ├── tests/
│   │   │   └── developer/       # Developer workflow tests
│   │   └── README.md
│   │
│   └── shared/                  # Shared test utilities
│       └── tests/common/
│
└── results/                     # Test outputs (gitignored)
```

## Agent Differences

| Feature | OpenAgent | Opencoder |
|---------|-----------|-----------|
| Approval | Text-based + tool permissions | Tool permissions only |
| Workflow | Analyze→Approve→Execute→Validate | Direct execution |
| Context | Mandatory before execution | On-demand |
| Test Style | Multi-turn (approval flow) | Single prompt |

## Key Features

### ✅ SDK-Based Execution
- Uses official `@opencode-ai/sdk` for real agent interaction
- Real-time event streaming (10+ events per test)
- Actual session recording to disk

### ✅ Cost-Aware Testing
- **FREE by default** - Uses `opencode/grok-code-fast` (OpenCode Zen)
- Override per-test or via CLI: `--model=provider/model`
- No accidental API costs during development

### ✅ Rule-Based Validation
- 4 evaluators check compliance with openagent.md rules
- Tests behavior (tool usage, approvals) not style (message counts)
- Model-agnostic test design

### ✅ Flexible Approval Handling
- Auto-approve for happy path testing
- Auto-deny for violation detection
- Smart strategies with custom rules

## Documentation

| Document | Purpose | Audience |
|----------|---------|----------|
| **[SDK_EVAL_README.md](framework/SDK_EVAL_README.md)** | Complete SDK testing guide | All users |
| **[docs/test-design-guide.md](framework/docs/test-design-guide.md)** | Test design philosophy | Test authors |
| **[openagent/docs/OPENAGENT_RULES.md](agents/openagent/docs/OPENAGENT_RULES.md)** | Rules reference | Test authors |
| **[openagent/docs/TEST_SCENARIOS.md](agents/openagent/docs/TEST_SCENARIOS.md)** | Test scenario catalog | Test authors |

## Usage Examples

### Run SDK Tests

```bash
# All tests with free model
npm run eval:sdk

# Specific category
npm run eval:sdk -- --pattern="developer/*.yaml"

# Custom model
npm run eval:sdk -- --model=anthropic/claude-3-5-sonnet-20241022

# Debug single test
npx tsx src/sdk/show-test-details.ts developer/install-dependencies.yaml
```

### Create New Tests

```yaml
# Example: developer/my-test.yaml
id: dev-my-test-001
name: My Test
description: What this test does

category: developer
prompt: "Your test prompt here"

# Behavior expectations (preferred)
behavior:
  mustUseTools: [bash]
  requiresApproval: true

# Expected violations
expectedViolations:
  - rule: approval-gate
    shouldViolate: false    # Should NOT violate
    severity: error

approvalStrategy:
  type: auto-approve

timeout: 60000
tags:
  - approval-gate
  - v2-schema
```

See [test-design-guide.md](framework/docs/test-design-guide.md) for best practices.

## Framework Components

### SDK Test Runner
- **ServerManager** - Start/stop opencode server
- **ClientManager** - Session and prompt management
- **EventStreamHandler** - Real-time event capture
- **TestRunner** - Test orchestration with evaluators
- **ApprovalStrategies** - Auto-approve, deny, smart rules

### Evaluators
- **ApprovalGateEvaluator** - Checks approval before tool execution
- **ContextLoadingEvaluator** - Verifies context files loaded first
- **DelegationEvaluator** - Validates delegation for 4+ files
- **ToolUsageEvaluator** - Checks bash vs specialized tools

### Test Schema (v2)
```yaml
behavior:              # What agent should do
  mustUseTools: []
  requiresApproval: bool
  shouldDelegate: bool

expectedViolations:    # What rules to check
  - rule: approval-gate
    shouldViolate: false
```

See [SDK_EVAL_README.md](framework/SDK_EVAL_README.md) for complete API.

## Test Results

```bash
npm run eval:sdk

# Output:
======================================================================
TEST RESULTS
======================================================================

1. ✅ dev-install-deps-002 - Install Dependencies (v2)
   Duration: 10659ms
   Events: 12
   Approvals: 0

2. ❌ biz-data-analysis-001 - Business Data Analysis
   Duration: 17512ms
   Events: 18
   Errors:
     - Expected tool calls but no approvals requested

======================================================================
SUMMARY: 1/2 tests passed (1 failed)
======================================================================
```

## Model Configuration

### Free Tier (Default)
```bash
# Uses opencode/grok-code-fast (free)
npm run eval:sdk
```

### Paid Models
```bash
# Claude 3.5 Sonnet
npm run eval:sdk -- --model=anthropic/claude-3-5-sonnet-20241022

# GPT-4 Turbo
npm run eval:sdk -- --model=openai/gpt-4-turbo
```

### Per-Test Override
```yaml
# In test YAML file
model: anthropic/claude-3-5-sonnet-20241022
```

## Development

### Run Framework Tests
```bash
cd evals/framework
npm test
```

### Build Framework
```bash
npm run build
```

### Add New Evaluator
1. Create in `src/evaluators/`
2. Extend `BaseEvaluator`
3. Implement `evaluate()` method
4. Register in `EvaluatorRunner`

### Debug Tests
```bash
# Show detailed test execution
npx tsx src/sdk/show-test-details.ts path/to/test.yaml

# Check session files
ls ~/.local/share/opencode/storage/session/
```

## CI/CD Integration

```yaml
# .github/workflows/eval.yml
name: Agent Evaluation

on: [push, pull_request]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: cd evals/framework && npm install
      - run: npm run eval:sdk -- --no-evaluators
```

## Configuration

### Default Model
Edit `src/sdk/test-runner.ts`:
```typescript
defaultModel: config.defaultModel || 'opencode/grok-code-fast'
```

### Evaluators
Enable/disable in `TestRunner`:
```typescript
runEvaluators: config.runEvaluators ?? true
```

## Achievements

✅ Full SDK integration with `@opencode-ai/sdk@1.0.90`  
✅ Real-time event streaming (12+ events per test)  
✅ 4 evaluators integrated and working  
✅ YAML-based test definitions with Zod validation  
✅ CLI runner with detailed reporting  
✅ Free model by default (no API costs)  
✅ Model-agnostic test design  
✅ Both positive and negative test support  

**Status:** Production-ready for OpenAgent evaluation

## Contributing

See [CONTRIBUTING.md](../docs/contributing/CONTRIBUTING.md)

## License

MIT
