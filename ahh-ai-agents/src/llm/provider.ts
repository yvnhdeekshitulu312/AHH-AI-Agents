import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import type { Config } from '../config.js';

/** Returns a model for the given id (or the configured default). Swap providers here. */
export type ModelFactory = (modelId?: string) => LanguageModel;

export function createModelFactory(config: Config): ModelFactory {
  switch (config.LLM_PROVIDER) {
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey: config.GOOGLE_GENERATIVE_AI_API_KEY });
      return (modelId) => google(modelId ?? config.MODEL);
    }
  }
}
