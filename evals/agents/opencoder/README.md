# Opencoder Agent Tests

Tests for the `opencoder` agent - a development-focused agent that executes code tasks directly.

## Agent Characteristics

- **Mode**: Primary development agent
- **Behavior**: Executes tools directly without text-based approval workflow
- **Best for**: Code implementation, bash commands, file operations
- **Approval**: Uses tool permission system (auto-approve in tests)

## Test Categories

### Developer Tests (`tests/developer/`)
- Bash command execution
- File operations
- Code implementation tasks

### Business Tests (`tests/business/`)
- Data analysis tasks
- Report generation

### Edge Cases (`tests/edge-case/`)
- Error handling
- Permission boundaries

## Running Tests

```bash
cd evals/framework
npx tsx src/sdk/run-sdk-tests.ts --agent opencoder
```

## Key Differences from OpenAgent

| Feature | Opencoder | OpenAgent |
|---------|-----------|-----------|
| Approval | Tool permission system | Text-based + tool permission |
| Workflow | Direct execution | Analyze→Approve→Execute→Validate |
| Context Loading | On-demand | Mandatory before execution |
| Best for | Simple tasks | Complex workflows |
