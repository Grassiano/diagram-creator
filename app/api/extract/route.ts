import { NextRequest, NextResponse } from 'next/server';
import type { ExtractResponse } from '@/lib/types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: NextRequest): Promise<NextResponse<ExtractResponse | { error: string }>> {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'לא נשלח קובץ' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'קובץ לא תקין' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'הקובץ גדול מדי (מקסימום 10MB)' }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name;
  const ext = filename.split('.').pop()?.toLowerCase();

  let text = '';

  if (ext === 'txt') {
    text = buffer.toString('utf-8');
  } else if (ext === 'pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    text = data.text;
  } else if (ext === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    return NextResponse.json(
      { error: `סוג קובץ לא נתמך: .${ext}. השתמש ב-.txt, .pdf, או .docx` },
      { status: 415 },
    );
  }

  const trimmedText = text.trim().slice(0, 8000);
  return NextResponse.json({ text: trimmedText, filename });
}
