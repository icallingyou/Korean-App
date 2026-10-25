/* =============================================================
   openlibrary.js — Open Library 공개 API (키 불필요, CORS 허용)
   책 검색·표지·페이지 수·주제, 저자별/주제별 목록, 인기 도서
   ============================================================= */
window.OL = (() => {
  'use strict';
  const BASE = 'https://openlibrary.org';
  const FIELDS = 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,subject,isbn,edition_count,ratings_average';

  async function getJSON(url, ttl = 6 * 3600 * 1000) {
    const k = 'ol:' + url;
    try {
      const c = JSON.parse(sessionStorage.getItem(k));
      if (c && Date.now() - c.t < ttl) return c.v;
    } catch (_) { /* ignore */ }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try { res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } }); }
    finally { clearTimeout(timer); }
    if (!res.ok) throw new Error('Open Library HTTP ' + res.status);
    const v = await res.json();
    try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch (_) { /* quota */ }
    return v;
  }

  const coverUrl = (id, size = 'M') => id ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : '';

  function mapDoc(d) {
    return {
      olKey: d.key || '',
      title: d.title || '',
      author: (d.author_name || [])[0] || '',
      authors: d.author_name || [],
      coverId: d.cover_i || null,
      coverUrl: coverUrl(d.cover_i),
      pages: d.number_of_pages_median || null,
      year: d.first_publish_year || null,
      subjects: (d.subject || []).slice(0, 15),
      isbn: (d.isbn || [])[0] || '',
      rating: d.ratings_average ? Math.round(d.ratings_average * 10) / 10 : null,
      editions: d.edition_count || 0
    };
  }
  function mapSubjectWork(w) {
    return {
      olKey: w.key || '',
      title: w.title || '',
      author: ((w.authors || [])[0] || {}).name || '',
      authors: (w.authors || []).map(a => a.name),
      coverId: w.cover_id || null,
      coverUrl: coverUrl(w.cover_id),
      pages: null,
      year: w.first_publish_year || null,
      subjects: (w.subject || []).slice(0, 15),
      isbn: '',
      rating: null,
      editions: w.edition_count || 0
    };
  }

  /** 자유 검색 (제목/저자/ISBN) */
  async function search(q, { limit = 20 } = {}) {
    const p = new URLSearchParams({ q, limit: String(limit), fields: FIELDS });
    const j = await getJSON(`${BASE}/search.json?${p}`);
    return (j.docs || []).map(mapDoc);
  }
  /** 제목+저자로 가장 그럴듯한 1건 (대출 목록 보강용) */
  async function lookup(title, author) {
    const p = new URLSearchParams({ title, limit: '5', fields: FIELDS });
    if (author) p.set('author', author);
    let j = await getJSON(`${BASE}/search.json?${p}`);
    let docs = (j.docs || []).map(mapDoc);
    if (!docs.length && author) {
      // 저자 표기가 달라 못 찾으면 제목만으로 재시도
      const p2 = new URLSearchParams({ title, limit: '5', fields: FIELDS });
      j = await getJSON(`${BASE}/search.json?${p2}`);
      docs = (j.docs || []).map(mapDoc);
    }
    return docs.find(d => d.pages) || docs[0] || null;
  }
  async function byAuthor(author, limit = 10) {
    const p = new URLSearchParams({ author, limit: String(limit), fields: FIELDS, sort: 'rating' });
    const j = await getJSON(`${BASE}/search.json?${p}`);
    return (j.docs || []).map(mapDoc);
  }
  async function bySubject(subject, limit = 12) {
    const slug = String(subject).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug) return [];
    const j = await getJSON(`${BASE}/subjects/${slug}.json?limit=${limit}`);
    return (j.works || []).map(mapSubjectWork);
  }
  async function trending(limit = 12) {
    const j = await getJSON(`${BASE}/trending/daily.json?limit=${limit}`, 60 * 60 * 1000);
    return (j.works || []).map(mapDoc);
  }

  return { search, lookup, byAuthor, bySubject, trending, coverUrl };
})();
