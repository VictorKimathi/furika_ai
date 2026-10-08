import React from 'react';

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;

export function renderInline(text, keyPrefix) {
  const parts = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('**')) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('`')) parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    else parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((part) => typeof part === 'string' ? part.replace(/\*\*?/g, '') : part);
}

// Renders the analyst's Markdown (headings, bullet/numbered lists, bold, code) as formatted text.
export default function FormattedText({ text }) {
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => { if (paragraph.length) { blocks.push({ type: 'p', text: paragraph.join(' ') }); paragraph = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || /^\s*([-*_])\1{2,}\s*$/.test(line)) { flushParagraph(); flushList(); continue; }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/) || line.match(/^\s*\*\*([^*]+)\*\*:?\s*$/);
    if (heading) { flushParagraph(); flushList(); blocks.push({ type: 'h', text: heading[1].replace(/[:#\s]+$/, '') }); continue; }
    const bullet = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      const ordered = /\d/.test(bullet[2]);
      const depth = Math.min(Math.floor(bullet[1].replace(/\t/g, '  ').length / 2), 2);
      if (!list || (depth === 0 && list.ordered !== ordered)) { flushList(); list = { type: 'list', ordered, items: [] }; }
      list.items.push({ depth, text: bullet[3] });
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph(); flushList();
  return <div className="formatted-text">{blocks.map((block, index) => {
    if (block.type === 'h') return <h4 key={index}>{renderInline(block.text, index)}</h4>;
    if (block.type === 'list') {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return <ListTag key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex} className={item.depth ? `depth-${item.depth}` : undefined}>{renderInline(item.text, `${index}-${itemIndex}`)}</li>)}</ListTag>;
    }
    return <p key={index}>{renderInline(block.text, index)}</p>;
  })}</div>;
}
