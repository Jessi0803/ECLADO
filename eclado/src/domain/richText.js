const marker = 'ECLADO-RICH/1\n';
const tags = new Set(['p', 'div', 'br', 'h3', 'h4', 'strong', 'b', 'i', 'em', 'u', 's', 'strike', 'span', 'ul', 'ol', 'li', 'a', 'img']);

const allowedStyles = {
  textAlign: /^(left|center|right)$/,
  fontWeight: /^(normal|bold|400|700)$/,
  fontStyle: /^(normal|italic)$/,
  textDecorationLine: /^(none|underline|line-through|underline line-through|line-through underline)$/,
};

export function richTextSummary(value = '') {
  return value.startsWith(marker) ? value.slice(marker.length).split('\n', 1)[0] : value;
}

export function validateRichTextLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function parseRichTextNodes(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  function read(parent) {
    return Array.from(parent.childNodes).flatMap(node => {
      if (node.nodeType === 3) return [node.textContent];
      const tag = node.localName;
      if (!tags.has(tag)) return ['script', 'style', 'template'].includes(tag) ? [] : read(node);
      if (tag === 'img') {
        const path = node.getAttribute('data-course-image');
        return /^[a-f0-9-]{36}\.(webp|jpg)$/.test(path || '') ? [{ tag, path, alt: node.getAttribute('alt') || '' }] : [];
      }
      const children = read(node);
      const href = tag === 'a' ? validateRichTextLink(node.getAttribute('href')) : null;
      const style = {};
      for (const [property, pattern] of Object.entries(allowedStyles)) {
        const value = node.style?.[property];
        if (pattern.test(value)) style[property] = value;
      }
      if ((tag === 'a' && !href) || (tag === 'span' && !Object.keys(style).length)) return children;
      return [{ tag, href, style, children }];
    });
  }
  return read(template.content);
}

export function readRichText(value = '') {
  if (!value.startsWith(marker)) return null;
  const body = value.slice(marker.length);
  const separator = body.indexOf('\n');
  return separator < 0 ? null : parseRichTextNodes(body.slice(separator + 1));
}

export function appendRichText(parent, nodes) {
  function append(parent, items) {
    for (const item of items) {
      if (typeof item === 'string') {
        parent.append(item);
        continue;
      }
      const element = document.createElement(item.tag);
      if (item.href) element.href = item.href;
      if (item.style) Object.assign(element.style, item.style);
      if (item.path) {
        element.dataset.courseImage = item.path;
        element.alt = item.alt;
      }
      append(element, item.children || []);
      parent.append(element);
    }
  }
  append(parent, nodes);
}

export function writeRichText(editor) {
  const container = document.createElement('div');
  appendRichText(container, parseRichTextNodes(editor.innerHTML));
  const summary = editor.innerText.replace(/\s+/g, ' ').trim().slice(0, 160 - marker.length);
  return summary || container.querySelector('img') ? marker + summary + '\n' + container.innerHTML : '';
}
