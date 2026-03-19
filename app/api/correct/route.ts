import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CLAUDE_CORRECT_SYSTEM } from '@/lib/claude-system';
import type { CorrectResponse, DiagramSpec } from '@/lib/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

const RequestSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  currentSpec: z.object({
    title: z.string(),
    direction: z.enum(['RTL', 'TTB']),
    nodes: z.array(z.object({ id: z.string(), type: z.string(), text: z.string(), color: z.string() })),
    connections: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })),
  }),
  correctionPrompt: z.string().min(1).max(500),
});

function parseCorrection(content: string): CorrectResponse {
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenceMatch?.[1]?.trim() ?? content;

  try {
    const parsed = JSON.parse(jsonStr) as { spec?: DiagramSpec; changes?: string[] };
    if (parsed.spec?.title && parsed.spec.nodes && parsed.spec.connections) {
      return {
        spec: parsed.spec,
        changes: Array.isArray(parsed.changes) ? parsed.changes : [],
      };
    }
  } catch {
    // fall through
  }

  throw new Error('לא הצלחתי לפרש את התיקון');
}

export async function POST(request: NextRequest): Promise<NextResponse<CorrectResponse | { error: string }>> {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'קלט לא תקין' }, { status: 400 });
  }

  const { imageBase64, mimeType, currentSpec, correctionPrompt } = parsed.data;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      system: CLAUDE_CORRECT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as AllowedMimeType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: `DiagramSpec הנוכחי:\n\`\`\`json\n${JSON.stringify(currentSpec, null, 2)}\n\`\`\`\n\nבקשת תיקון: ${correctionPrompt}`,
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return NextResponse.json(parseCorrection(text));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאה בעיבוד התיקון';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
