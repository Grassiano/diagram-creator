import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildDiagramPrompt } from '@/lib/diagram-style';
import type { DiagramSpec, GenerateResponse } from '@/lib/types';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is not set');
const ai = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

const NodeSchema = z.object({
  id: z.string(),
  type: z.enum(['start', 'process', 'decision', 'success', 'failure', 'info']),
  text: z.string(),
  color: z.enum(['navy', 'blue', 'gold', 'green', 'coral', 'lightblue']),
});

const ConnectionSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  style: z.enum(['solid', 'dashed']).optional(),
});

const DiagramSpecSchema = z.object({
  title: z.string(),
  direction: z.enum(['RTL', 'TTB']),
  nodes: z.array(NodeSchema),
  connections: z.array(ConnectionSchema),
}) satisfies z.ZodType<DiagramSpec>;

export async function POST(request: NextRequest): Promise<NextResponse<GenerateResponse | { error: string }>> {
  const body = await request.json().catch(() => null);
  const parsed = DiagramSpecSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'DiagramSpec לא תקין' }, { status: 400 });
  }

  const prompt = buildDiagramPrompt(parsed.data);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-preview-image-generation',
      contents: prompt,
      config: {
        responseModalities: ['IMAGE', 'TEXT'],
      },
    });

    const imagePart = response.candidates
      ?.flatMap((c) => c.content?.parts ?? [])
      .find((p) => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart?.inlineData?.data || !imagePart.inlineData.mimeType) {
      return NextResponse.json({ error: 'Gemini לא החזיר תמונה' }, { status: 500 });
    }

    return NextResponse.json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'שגיאת יצירת תמונה';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
