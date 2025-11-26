# Context Loading Test Coverage

## Overview

This document tracks test coverage for OpenAgent's critical context loading requirement.

**Critical Rule (openagent.md lines 35-61):**
> BEFORE any bash/write/edit/task execution, ALWAYS load required context files.

## Required Context Files (5 types + multi-turn)

| Task Type | Required Context File | Test Coverage |
|-----------|----------------------|---------------|
| Code tasks | `.opencode/context/core/standards/code.md` | ✅ `ctx-code-001.yaml` |
| Docs tasks | `.opencode/context/core/standards/docs.md` | ✅ `ctx-docs-001.yaml` |
| Tests tasks | `.opencode/context/core/standards/tests.md` | ✅ `ctx-tests-001.yaml` |
| Review tasks | `.opencode/context/core/workflows/review.md` | ✅ `ctx-review-001.yaml` |
| Delegation | `.opencode/context/core/workflows/delegation.md` | ✅ `ctx-delegation-001.yaml` |
| **Multi-turn** | Context loaded per task (not per session) | ✅ `ctx-multi-turn-001.yaml` |

**Coverage: 6/6 (100%)**

## Test Details

### 1. ctx-code-001.yaml
- **Task**: Create TypeScript function
- **Expected**: Load `standards/code.md` before writing code
- **Tools**: read (context) → write (code file)
- **Approval**: Required

### 2. ctx-docs-001.yaml
- **Task**: Update README.md
- **Expected**: Load `standards/docs.md` before editing docs
- **Tools**: read (context) → edit (README)
- **Approval**: Required

### 3. ctx-tests-001.yaml
- **Task**: Write test file
- **Expected**: Load `standards/tests.md` before writing tests
- **Tools**: read (context) → write (test file)
- **Approval**: Required

### 4. ctx-review-001.yaml
- **Task**: Review code quality
- **Expected**: Load `workflows/review.md` before reviewing
- **Tools**: read (context + code)
- **Approval**: Not required (read-only)

### 5. ctx-delegation-001.yaml
- **Task**: Multi-file feature (5+ files)
- **Expected**: Load `workflows/delegation.md` before delegating
- **Tools**: read (context) → task (delegation)
- **Approval**: Required

### 6. ctx-multi-turn-001.yaml ⭐ NEW
- **Task**: Multi-turn conversation (question → create docs)
- **Turn 1**: Ask question (conversational, no context)
- **Turn 2**: Create CONTRIBUTING.md (should load `standards/docs.md`)
- **Expected**: Context loaded FRESH for turn 2 (not reused from turn 1)
- **Tools**: read (context) → write (docs)
- **Approval**: Required
- **Special**: Tests multi-message support in test framework

## Validation Strategy

Each test validates:
1. ✅ Context file loaded before execution
2. ✅ Correct context file for task type
3. ✅ Timing: context loaded BEFORE first execution tool
4. ✅ No violations of context-loading rule

## Running Tests

```bash
# Run all context loading tests
cd evals/framework
npm run eval:sdk -- --pattern="developer/ctx-*.yaml"

# Run specific context test
npm run eval:sdk -- --pattern="developer/ctx-code-001.yaml"
```

## Expected Output (when evaluators work)

```
1. ✅ ctx-code-001 - Code Task with Context Loading
   Duration: 5234ms
   Events: 15
   Approvals: 1
   Context Loading:
     ✓ Loaded: .opencode/context/core/standards/code.md
     ✓ Timing: Context loaded 234ms before execution
   Violations: 0
```

## Status

- **Test Creation**: ✅ Complete (6/6 tests created)
- **YAML Validation**: ✅ All tests valid
- **Multi-Message Support**: ✅ Implemented in test framework
- **Evaluator Integration**: ⚠️ Session storage issue (known, to be fixed)
- **Display Enhancement**: ✅ Context loading details added to output

## Next Steps

1. ✅ Create all 6 context loading tests (including multi-turn)
2. ✅ Implement multi-message test support in framework
3. ⏳ Fix evaluator session storage issue
4. ⏳ Run tests and verify context loading works
5. ⏳ Use as baseline before prompt optimization

---

**Last Updated**: 2025-11-25
**Coverage**: 100% (6/6 including multi-turn)
**Status**: Ready for testing (pending evaluator fix)
