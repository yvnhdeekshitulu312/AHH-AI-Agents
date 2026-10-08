import { HisError } from '../his/client.js';
import type { ToolDeps } from '../core/types.js';

export interface ToolErrorResult {
  error: string;
}

/**
 * Runs a tool body and turns HIS failures into a short message the model can relay
 * ("data could not be retrieved") instead of failing the whole request.
 * Anything else is rethrown.
 */
export async function safeExecute<T>(
  toolName: string,
  deps: ToolDeps,
  fn: () => Promise<T>,
): Promise<T | ToolErrorResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HisError) {
      deps.logger.warn(
        { tool: toolName, his: err.endpoint, kind: err.kind, detail: err.detail, requestId: deps.ctx.requestId },
        'Tool HIS call failed',
      );
      return { error: 'This data could not be retrieved from the hospital system right now.' };
    }
    throw err;
  }
}
