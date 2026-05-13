import { logger } from '../utils/logger.js';

export interface AiPredictionResult {
  predicted_category: string;
  confidence: number;
  is_confident: boolean;
  model_version: string;
  candidates: Array<{
    category: string;
    confidence: number;
  }>;
}

const AI_SERVICE_URL = process.env.BOTFINANCEKU_AI_URL || 'http://127.0.0.1:8001';

export async function predictExpenseCategory(subject: string, amount: number): Promise<AiPredictionResult | null> {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ subject, amount }),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, statusText: response.statusText },
        'AI prediction request failed'
      );
      return null;
    }

    return await response.json() as AiPredictionResult;
  } catch (error) {
    logger.error({ error }, 'Failed to call AI prediction service');
    return null;
  }
}
