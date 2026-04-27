export interface SelectionAnchor {
  quote: string;
  startOffset: number;
  endOffset: number;
  xpath: string;
}

export interface Comment {
  id: string;
  threadId: string;
  author: string;
  authorType: 'human' | 'llm';
  createdAt: string;
  text: string;
  anchor: SelectionAnchor;
}

export interface Thread {
  id: string;
  resolved: boolean;
  comments: Comment[];
}

export interface FilePayload {
  version: '1';
  threads: Thread[];
}
