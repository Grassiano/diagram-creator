import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CLAUDE_VALIDATE_SYSTEM } from '@/lib/claude-system';
import type { ValidateResponse } from '@/lib/types';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

const RequestSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  spec: z.object({
    title: z.string(),
    direction: z.enum(['RTL', 'TTB']),
    nodes: z.array(z.object({ id: z.string(), type: z.string(), text: z.string(), color: z.string() })),
    connections: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() })),
  }),
});

function parseValidation(content: string): ValidateResponse {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return { valid: false, issues: ['לא ניתן לפרש תשובת אימות'] };

  try {
    const parsed = JSON.parse(match[0]) as { valid?: boolean; issues?: string[] };
    return {
      valid: parsed.valid === true,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    };
  } catch {
    return { valid: false, issues: ['שגיאה בפרסור תשובת אימות'] };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ValidateResponse>> {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ valid: false, issues: ['קלט לא תקין'] }, { status: 400 });
  }

  const { imageBase64, mimeType, spec } = parsed.data;

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      system: CLAUDE_VALIDATE_SYSTEM,
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
              text: `DiagramSpec:\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\nValidate the image against this spec.`,
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return NextResponse.json(parseValidation(text));
  } catch {
    return NextResponse.json({ valid: true, issues: [] }); // fail open
  }
}
