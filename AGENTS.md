# AGENTS.md - OpenClaw HTTP Message Plugin

## Project Overview

This is an OpenClaw plugin that handles HTTP message processing for OpenClaw.

- **Type**: OpenClaw Plugin (TypeScript)
- **Runtime**: Node.js (pnpm)
- **Framework**: OpenClaw Plugin SDK

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Type check only (no build output)
pnpm exec tsc --noEmit

# Build the plugin
pnpm exec openclaw plugins build

# Run OpenClaw in development mode
pnpm exec openclaw gateway --verbose
```

**Note**: This project does not have a traditional test framework configured yet. Tests should be added using Vitest or Node's built-in test runner.

## Code Style Guidelines

### TypeScript

- Use **strict TypeScript** - enable `strict: true` in tsconfig if you create one
- Always declare explicit return types for exported functions
- Use `type` for object shapes, `interface` for extendable types
- Prefer `as const` for literal values that won't change

```typescript
// Good
interface ToolConfig {
  name: string;
  description: string;
  parameters: T.Schema;
}

// Good - const assertion
const API_VERSIONS = {
  V1: 'v1',
} as const;
```

### Imports

- Use **path aliases** when available (`@/` style imports)
- Group imports in this order:
  1. External libraries
  2. Internal modules (relative paths)
  3. Type imports

```typescript
// Group 1: External
import { Type } from '@sinclair/typebox';
import { z } from 'zod';

// Group 2: Internal
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { MessageService } from './services/message.service';

// Group 3: Types (if separate file)
import type { Message } from './types';
```

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files (components) | kebab-case | `message.service.ts` |
| Classes | PascalCase | `MessageService` |
| Functions | camelCase | `parseMessage()` |
| Constants | SCREAMING_SNAKE | `MAX_MESSAGE_SIZE` |
| Interfaces | PascalCase | `Message` |
| Types | PascalCase | `MessageResponse` |

### Error Handling

- Use typed error classes extending `Error`
- Never expose stack traces to end users
- Log errors with appropriate context

```typescript
// Good
class MessageParseError extends Error {
  constructor(message: string) {
    super(`Failed to parse message: ${message}`);
    this.name = 'MessageParseError';
  }
}
```

### OpenClaw Plugin Structure

Follow the standard plugin pattern:

```typescript
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { Type } from '@sinclair/typebox';

export default definePluginEntry({
  id: 'openclaw-http-message',
  name: 'Openclaw HTTP Message',
  description: 'HTTP message handling for OpenClaw',
  register(api) {
    api.registerTool({
      name: 'http_message_parse',
      description: 'Parse HTTP message content',
      parameters: Type.Object({
        content: Type.String(),
      }),
      async execute(params) {
        // implementation
      },
    });
  },
});
```

### File Organization

```
src/
├── index.ts              # Plugin entry point (exports definePluginEntry)
├── services/            # Business logic
├── types/               # TypeScript interfaces
└── utils/               # Helper functions
```

### General Best Practices

- **Keep functions small** - max 50 lines per function
- **One export per file** - for named exports, prefer single default export
- **Avoid `any`** - use `unknown` if type is truly unknown
- **Use async/await** - prefer over raw promises
- **Handle errors explicitly** - don't use empty catch blocks
- **Write meaningful comments** - explain WHY, not WHAT
- **Use early returns** - reduce nesting

### Dependencies

- Minimize external dependencies
- Use `@sinclair/typebox` for OpenClaw schema definitions
- Reuse OpenClaw SDK utilities when available

### Git Conventions

- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Keep commits atomic and focused
- Write descriptive commit messages

## OpenClaw SDK Reference

- Plugin SDK: `openclaw/plugin-sdk/plugin-entry`
- Schema: `@sinclair/typebox`
- API Reference: See OpenClaw docs at https://docs.openclaw.ai

## Configuration

This plugin uses `openclaw.plugin.json` for metadata:

```json
{
  "id": "openclaw-http-message",
  "name": "Openclaw http Message",
  "description": "Openclaw Skill Management create update delete by http",
  "configSchema": {
    "type": "object",
    "additionalProperties": false
  }
}
```

## Plugin Entry Point

The entry point must be specified in `package.json` under `openclaw.extensions`:

```json
{
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

## Plugin API Usage

Register HTTP routes:

```typescript
api.registerHttpRoute({
  path: '/message',
  auth: 'plugin',
  match: 'prefix',
  handler: async (req, res) => {
    // Handle request
    return true; // true = handled, false = not handled
  },
});
```

Register tools:

```typescript
api.registerTool({
  name: 'tool_name',
  description: 'Tool description',
  parameters: Type.Object({}),
  async execute(params) {
    return result;
  },
});
```

## Development Notes

- This is a sibling project to `openclaw-skill-management` - follow similar patterns
- Uses `pnpm@10.33.0` as package manager
- Compatible with OpenClaw plugin API `>=2026.3.24-beta.2`
