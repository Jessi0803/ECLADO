import React from 'react';
import { richTextSummary, readRichText } from '../../domain/richText.js';
import './RichTextContent.css';

function renderNodes(nodes, Image) {
  return nodes.map((node, index) => {
    if (typeof node === 'string') return node;
    if (node.tag === 'img') return Image ? <Image key={index} path={node.path} alt={node.alt} /> : null;
    return React.createElement(node.tag, { key: index, href: node.href || undefined, style: node.style },
      node.tag === 'br' ? undefined : renderNodes(node.children, Image));
  });
}

export default function RichTextContent({ value, imageComponent, plainTextClassName }) {
  const nodes = readRichText(value);
  return nodes
    ? <div className="course-description-content">{renderNodes(nodes, imageComponent)}</div>
    : <p className={plainTextClassName}>{richTextSummary(value)}</p>;
}
