/** Base class for errors that map to a specific HTTP status and a safe user message. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = new.target.name;
  }
}

export class GuardrailBlockedError extends AppError {
  constructor(readonly reason: string, userMessage: string) {
    super(400, 'GUARDRAIL_BLOCKED', userMessage);
  }
}

export class AgentTimeoutError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super(504, 'AGENT_TIMEOUT', 'The assistant took too long to respond. Please try again.', options);
  }
}

export class LlmUnavailableError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super(502, 'LLM_UNAVAILABLE', 'The AI service is temporarily unavailable. Please try again.', options);
  }
}

/** The client went away (closed the chat or the tab) before the answer finished. Nothing to send back. */
export class ClientAbortedError extends AppError {
  constructor(options?: { cause?: unknown }) {
    super(499, 'CLIENT_ABORTED', 'The request was cancelled.', options);
  }
}
