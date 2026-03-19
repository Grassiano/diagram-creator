export interface DiagramNode {
  id: string;
  type: 'start' | 'process' | 'decision' | 'success' | 'failure' | 'info';
  text: string;
  color: 'navy' | 'blue' | 'gold' | 'green' | 'coral' | 'lightblue';
}

export interface DiagramConnection {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed';
}

export interface DiagramSpec {
  title: string;
  direction: 'RTL' | 'TTB';
  nodes: DiagramNode[];
  connections: DiagramConnection[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  type: 'spec' | 'clarification' | 'error';
  spec?: DiagramSpec;
  question?: string;
  message?: string;
}

export interface GenerateResponse {
  imageBase64: string;
  mimeType: string;
}

export interface ValidateResponse {
  valid: boolean;
  issues: string[];
}

export interface CorrectResponse {
  spec: DiagramSpec;
  changes: string[];
}

export interface ExtractResponse {
  text: string;
  filename: string;
}
