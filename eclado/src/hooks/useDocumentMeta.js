import { useEffect } from 'react';

const SITE_ORIGIN = 'https://ecladotaiwan.com';

function upsertMeta(selector, attributes) {
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement('meta');
    document.head.appendChild(node);
  }
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
}

function upsertCanonical(href) {
  let node = document.head.querySelector('link[rel="canonical"]');
  if (!node) {
    node = document.createElement('link');
    node.rel = 'canonical';
    document.head.appendChild(node);
  }
  node.href = href;
}

export default function useDocumentMeta(titleOrOptions, legacyDescription) {
  const options = typeof titleOrOptions === 'object'
    ? titleOrOptions
    : { title: titleOrOptions, description: legacyDescription };
  const {
    title,
    description,
    canonicalPath,
    image = '/assets/images/hero-cover.jpg',
    type = 'website',
    robots = 'index,follow',
    jsonLd = [],
  } = options;
  const jsonLdText = JSON.stringify(jsonLd);

  useEffect(() => {
    if (title) document.title = title;
    if (description) upsertMeta('meta[name="description"]', { name: 'description', content: description });
    upsertMeta('meta[name="robots"]', { name: 'robots', content: robots });

    if (canonicalPath) {
      const canonicalUrl = new URL(canonicalPath, SITE_ORIGIN).href;
      const imageUrl = new URL(image, SITE_ORIGIN).href;
      upsertCanonical(canonicalUrl);
      upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
      upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description || '' });
      upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type });
      upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonicalUrl });
      upsertMeta('meta[property="og:image"]', { property: 'og:image', content: imageUrl });
      upsertMeta('meta[property="og:locale"]', { property: 'og:locale', content: 'zh_TW' });
      upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
      upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: title });
      upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description || '' });
      upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: imageUrl });
    }

    document.head.querySelectorAll('script[data-eclado-json-ld]').forEach(node => node.remove());
    const parsedJsonLd = JSON.parse(jsonLdText);
    const entries = Array.isArray(parsedJsonLd) ? parsedJsonLd : [parsedJsonLd];
    entries.filter(Boolean).forEach(entry => {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.ecladoJsonLd = 'true';
      script.textContent = JSON.stringify(entry).replace(/</g, '\\u003c');
      document.head.appendChild(script);
    });
  }, [canonicalPath, description, image, jsonLdText, robots, title, type]);
}
