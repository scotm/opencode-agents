# OpenAgent Evaluation Suite

Tests for the `openagent` agent - a universal agent with text-based approval workflow.

## Agent Characteristics

- **Mode**: Primary universal agent
- **Behavior**: Text-based approval workflow (Analyze→Approve→Execute→Validate)
- **Best for**: Complex workflows, context-aware tasks, delegation
- **Approval**: Text-based approval + tool permission system

## Key Difference from Opencoder

**OpenAgent uses a text-based approval workflow:**
- Agent outputs "Proposed Plan" and asks for approval in text
- User must respond with approval (e.g., "yes, proceed")
- Then agent executes the tools

**Testing OpenAgent requires multi-turn prompts:**

```yaml
prompts:
  - text: "List the files in the current directory"
  - text: "Yes, proceed with the plan"
    delayMs: 2000
```

## Test Categories

### Developer Tests (`tests/developer/`)
- Context loading tests (`ctx-*.yaml`)
- Approval workflow tests
- Multi-turn conversation tests

### Business Tests (`tests/business/`)
- Data analysis tasks
- Conversational queries

### Edge Cases (`tests/edge-case/`)
- Missing approval scenarios
- Error handling

## Running Tests

```bash
cd evals/framework

# Run all openagent tests
npx tsx src/sdk/run-sdk-tests.ts --agent=openagent

# Run specific test pattern
npx tsx src/sdk/run-sdk-tests.ts --agent=openagent --pattern="developer/ctx-*.yaml"

# Debug mode
npx tsx src/sdk/run-sdk-tests.ts --agent=openagent --debug
```

## Context Loading Coverage

OpenAgent requires loading context files before execution:

| Task Type | Required Context File | Test |
|-----------|----------------------|------|
| Code | `standards/code.md` | `ctx-code-001.yaml` |
| Docs | `standards/docs.md` | `ctx-docs-001.yaml` |
| Tests | `standards/tests.md` | `ctx-tests-001.yaml` |
| Review | `workflows/review.md` | `ctx-review-001.yaml` |
| Delegation | `workflows/delegation.md` | `ctx-delegation-001.yaml` |
| Multi-turn | Per-task context | `ctx-multi-turn-001.yaml` |

## Critical Rules Tested

From `.opencode/agent/openagent.md`:

1. **Approval Gate** - Request approval before execution
2. **Context Loading** - Load context files before tasks
3. **Stop on Failure** - Never auto-fix, report first
4. **Delegation** - Delegate 4+ file tasks to task-manager

## Documentation

- [OPENAGENT_RULES.md](docs/OPENAGENT_RULES.md) - Extracted testable rules
- [CONTEXT_LOADING_COVERAGE.md](CONTEXT_LOADING_COVERAGE.md) - Context test coverage
- [TEST_REVIEW.md](TEST_REVIEW.md) - Test suite review and status
