import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CLAUDE_DIAGRAM_SYSTEM } from '@/lib/claude-system';
import type { ChatResponse, DiagramSpec } from '@/lib/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RequestSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      }),
    )
    .optional()
    .default([]),
});

function parseClaude(content: string): ChatResponse {
  const trimmed = content.trim();

  // Check for clarification response
  try {
    const parsed = JSON.parse(trimmed) as { clarification?: string };
    if (parsed.clarification) {
      return { type: 'clarification', question: parsed.clarification };
    }
  } catch {
    // not raw JSON
  }

  // Check for code-fenced JSON
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try {
      const spec = JSON.parse(fenceMatch[1].trim()) as DiagramSpec;
      if (spec.title && spec.nodes && spec.connections) {
        return { type: 'spec', spec };
      }
    } catch {
      // fall through
    }
  }

  return {
    type: 'error',
    message: 'לא הצלחתי לפרש את התשובה. נסה שוב עם תיאור מפורט יותר.',
  };
}

export async function POST(request: NextRequest): Promise<NextResponse<ChatResponse>> {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { type: 'error', message: 'קלט לא תקין' },
      { status: 400 },
    );
  }

  const { message, history } = parsed.data;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    system: CLAUDE_DIAGRAM_SYSTEM,
    messages,
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return NextResponse.json(parseClaude(text));
}
