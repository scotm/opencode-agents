# Session Storage Fix - Simplified Approach

## Problem Summary

The evaluation framework couldn't find sessions created by the SDK because:

1. **Path Mismatch**: SDK stores sessions in `~/.local/share/opencode/storage/session/{hash}/` but evaluators looked in `~/.local/share/opencode/project/{encoded-path}/storage/session/info/`
2. **Hash Calculation**: We couldn't reliably calculate the project hash that OpenCode uses
3. **Project Path Confusion**: Tests run from `/evals/framework` but sessions created in `/opencode-agents` (git root)

## Solution: SDK-First with Disk Fallback

Instead of reverse-engineering OpenCode's storage format, we now:

### 1. Use SDK Client Directly (Primary Method)
```typescript
// SessionReader now accepts SDK client
const sessionReader = new SessionReader(sdkClient, sessionStoragePath);

// Get session via SDK (always up-to-date, no disk delays)
const session = await sessionReader.getSessionInfo(sessionId);
```

**Benefits**:
- ✅ No path calculations needed
- ✅ No hash discovery required
- ✅ No waiting for disk writes
- ✅ Always gets latest data
- ✅ Works for any agent, any project

### 2. Simple Disk Scan (Fallback)
```typescript
// If SDK unavailable, scan all session directories for the session ID
private findSessionFile(sessionId: string): string | null {
  const sessionBasePath = '~/.local/share/opencode/storage/session';
  
  // Scan all hash directories
  for (const hashDir of fs.readdirSync(sessionBasePath)) {
    const sessionFile = path.join(sessionBasePath, hashDir, `${sessionId}.json`);
    if (fs.existsSync(sessionFile)) {
      return sessionFile;
    }
  }
  
  return null;
}
```

**Benefits**:
- ✅ Simple: Just find file by ID
- ✅ No project path matching
- ✅ Works for any agent
- ✅ Resilient fallback

## What Was Removed

### Complex Logic Eliminated ❌
- ~~Hash calculation (unreliable)~~
- ~~Git root detection (unnecessary)~~
- ~~Project path encoding (fragile)~~
- ~~Multiple fallback paths (confusing)~~
- ~~Session data polling (slow)~~
- ~~Project hash caching (complex)~~

### Files Simplified ✅
1. **config.ts**: Removed complex path calculations, kept only simple helpers
2. **session-reader.ts**: Now SDK-first, simple disk scan fallback
3. **test-runner.ts**: Passes SDK client to evaluators, no waiting
4. **evaluator-runner.ts**: Made async to support SDK calls

## Architecture

```
┌─────────────────┐
│  Test Runner    │
│                 │
│  1. Creates     │──────┐
│     session     │      │
│                 │      │
│  2. Gets        │      │
│     sessionId   │      │
│                 │      │
│  3. Passes SDK  │      │
│     client to   │      │
│     evaluators  │      │
└────────┬────────┘      │
         │               │
         ▼               │
┌─────────────────┐      │
│  Evaluators     │      │
│                 │      │
│  SessionReader  │◄─────┘ SDK Client
│  (SDK-based)    │
│                 │
│  1. Try SDK     │──────► session.get(id)
│     first       │        ✅ Fast, reliable
│                 │
│  2. Fallback    │──────► Scan disk by ID
│     to disk     │        ✅ Simple, works
└─────────────────┘
```

## Testing Different Agents

This approach works for **any agent** because:

1. **No project path dependency**: We don't care where the agent runs
2. **Session ID is universal**: Every session has a unique ID
3. **SDK knows everything**: The SDK tracks all sessions regardless of project
4. **Disk scan is comprehensive**: Scans all hash directories

### Example: Testing Multiple Agents
```typescript
// Test OpenAgent
const openAgentTests = await loadTestCases('agents/openagent/tests/**/*.yaml');
await runner.runTests(openAgentTests);

// Test OpenCoder  
const openCoderTests = await loadTestCases('agents/opencoder/tests/**/*.yaml');
await runner.runTests(openCoderTests);

// Works for both! No configuration needed.
```

## Results

### Before Fix ❌
```
Test FAILED
Errors: Evaluator error: Session not found: ses_xxx
Events captured: 4
Violations: N/A (evaluators couldn't run)
```

### After Fix ✅
```
Test PASSED
Duration: 5063ms
Events: 4
Violations: 0 (0 errors, 0 warnings)
Evaluators: ✅ All ran successfully
```

## Key Takeaways

1. **Use the SDK**: Don't reverse-engineer storage formats
2. **Keep it simple**: Scan by ID when SDK unavailable
3. **Async all the way**: SDK calls are async, embrace it
4. **Agent-agnostic**: Design for testing any agent, not just one

## Files Changed

- `src/collector/session-reader.ts` - Simplified to SDK-first approach
- `src/collector/timeline-builder.ts` - Made async for SDK calls
- `src/evaluators/evaluator-runner.ts` - Added SDK client support, made async
- `src/sdk/test-runner.ts` - Passes SDK client to evaluators
- `src/config.ts` - Removed complex path logic, added git root helper

## Migration Notes

If you have existing code using SessionReader:

```typescript
// Old (synchronous, disk-based)
const reader = new SessionReader(projectPath, sessionStoragePath);
const session = reader.getSessionInfo(sessionId);

// New (async, SDK-first)
const reader = new SessionReader(sdkClient, sessionStoragePath);
const session = await reader.getSessionInfo(sessionId);
```

All SessionReader methods are now async. Update your code accordingly.
