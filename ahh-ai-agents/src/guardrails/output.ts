export const DISCLAIMER = 'AI-generated from HIS records. Verify in the HIS before making clinical decisions.';

export const EMPTY_ANSWER_FALLBACK =
  'I could not produce an answer from the available records. Please rephrase the question or check the HIS directly.';

export interface OutputCheck {
  answer: string;
  modified: boolean;
  reason?: 'empty' | 'truncated';
}

/** Ensures the answer is non-empty and within the agent's length limit (cut at a sentence boundary when possible). */
export function checkOutput(raw: string, maxChars: number): OutputCheck {
  const answer = raw.trim();

  if (answer.length === 0) {
    return { answer: EMPTY_ANSWER_FALLBACK, modified: true, reason: 'empty' };
  }
  if (answer.length <= maxChars) {
    return { answer, modified: false };
  }

  const cut = answer.slice(0, maxChars);
  const lastSentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  const truncated = lastSentenceEnd > maxChars * 0.5 ? cut.slice(0, lastSentenceEnd + 1) : `${cut.trimEnd()}…`;
  return { answer: truncated, modified: true, reason: 'truncated' };
}
