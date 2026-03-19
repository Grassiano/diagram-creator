import { NextRequest, NextResponse } from 'next/server';
import type { ExtractResponse } from '@/lib/types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_EXTENSIONS = ['txt', 'pdf', 'docx'] as const;
const ALLOWED_MIME_TYPES: Record<string, string> = {
  txt: 'text/plain',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export async function POST(request: NextRequest): Promise<NextResponse<ExtractResponse | { error: string }>> {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'לא נשלח קובץ' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'קובץ לא תקין' }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'הקובץ ריק' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'הקובץ גדול מדי (מקסימום 10MB)' }, { status: 413 });
  }

  const filename = file.name;
  const ext = filename.split('.').pop()?.toLowerCase() as typeof ALLOWED_EXTENSIONS[number] | undefined;

  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return NextResponse.json(
      { error: `סוג קובץ לא נתמך: .${ext ?? '?'}. השתמש ב-.txt, .pdf, או .docx` },
      { status: 415 },
    );
  }

  const expectedMime = ALLOWED_MIME_TYPES[ext];
  if (file.type && file.type !== expectedMime && !file.type.startsWith('application/') && ext !== 'txt') {
    return NextResponse.json({ error: 'סוג הקובץ אינו תואם לסיומת' }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let text = '';

  try {
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
    }
  } catch {
    return NextResponse.json({ error: 'שגיאה בחילוץ הטקסט מהקובץ' }, { status: 500 });
  }

  const trimmedText = text.trim().slice(0, 8000);
  return NextResponse.json({ text: trimmedText, filename });
}
