import type { DiagramSpec } from './types';

export const DIAGRAM_STYLE_V3 = `Professional flowchart on a plain white background. The title "[TITLE]" appears centered at the top in bold dark navy (#272c6c) Hebrew text (Heebo-style font). Color palette: dark navy (#272c6c) rounded rectangles for start/end nodes with white text, medium blue (#4a80ec) rounded rectangles for process nodes with white text, gold/amber diamonds for decision nodes with dark text, soft green rounded nodes for success outcomes with white text, light blue rectangles for info/notes with dark text, muted coral/red nodes for failure/warning with dark text. Clean thin gray arrows with arrowheads. No border, no background patterns. Academic law textbook style. CRITICAL: Use ONLY Hebrew characters in all node text. Flow direction: [DIRECTION].`;

export const NODE_DESCRIPTIONS: Record<DiagramSpec['nodes'][number]['type'], string> = {
  start: 'dark navy (#272c6c) rounded rectangle with white text',
  process: 'medium blue (#4a80ec) rounded rectangle with white text',
  decision: 'gold/amber diamond shape with dark text',
  success: 'soft green rounded rectangle with white text',
  failure: 'muted coral/red rounded rectangle with dark text',
  info: 'light blue rectangle with dark text',
};

export function buildDiagramPrompt(spec: DiagramSpec): string {
  const style = DIAGRAM_STYLE_V3
    .replace('[TITLE]', spec.title)
    .replace('[DIRECTION]', spec.direction === 'RTL' ? 'Right-to-left (Hebrew RTL)' : 'Top-to-bottom');

  const nodesDescription = spec.nodes
    .map((node) => {
      const nodeDesc = NODE_DESCRIPTIONS[node.type];
      return `Node "${node.text}": ${nodeDesc}`;
    })
    .join('. ');

  const connectionsDescription = spec.connections
    .map((conn) => {
      const from = spec.nodes.find((n) => n.id === conn.from)?.text ?? conn.from;
      const to = spec.nodes.find((n) => n.id === conn.to)?.text ?? conn.to;
      const label = conn.label ? ` (label: "${conn.label}")` : '';
      const dashed = conn.style === 'dashed' ? ' [dashed arrow]' : '';
      return `Arrow from "${from}" to "${to}"${label}${dashed}`;
    })
    .join('. ');

  return `${style}

Nodes: ${nodesDescription}.

Connections: ${connectionsDescription}.

IMPORTANT: All text in nodes, labels, and title MUST be Hebrew only. No Latin characters anywhere.`;
}
