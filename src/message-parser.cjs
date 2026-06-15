const DEFAULT_INBOX_URL = "http://marsen.marsen.co.kr/?class=Message&action=inbox";

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(href, baseUrl = DEFAULT_INBOX_URL) {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

function isUnsafeMessageLink(href, text) {
  const value = `${href || ""} ${text || ""}`.toLowerCase();
  return /delete|del|remove|write|edit|sms|user_group|schedule_edit|삭제|전송|저장/.test(value);
}

function cleanTitle(value) {
  return (value || "").replace(/\bnew\b/gi, " ").replace(/\s+/g, " ").trim();
}

function hasRedNewMarker(html) {
  const styleColorPattern = /color\s*:\s*(?:red|#f00\b|#ff0000\b|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\))/i;
  const styledNewPattern = /<[^>]+\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>\s*new\s*<\/[^>]+>/gi;
  let match;

  while ((match = styledNewPattern.exec(html))) {
    if (styleColorPattern.test(match[1] || match[2] || "")) {
      return true;
    }
  }

  return false;
}

function looksLikeDate(value) {
  return /\d{2,4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}:\d{2}|am|pm/i.test(value || "");
}

function readHtmlAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? match[1] || match[2] || match[3] || "" : "";
}

function detectSelectedCategory(html) {
  const checkedInput = html.match(/<input\b[^>]*(?:checked|checked=["']checked["'])[^>]*>/i);
  if (!checkedInput) return "";
  const inputHtml = checkedInput[0];
  const valueMatch = inputHtml.match(/\bvalue=["']?([^"'\s>]+)/i);
  return valueMatch ? stripTags(valueMatch[1]) : "";
}

function mapDomRow(row, fallbackCategory = "") {
  const title = cleanTitle(row.title);
  const date = row.date || "";
  const author = row.author || row.category || fallbackCategory || "";

  return {
    date,
    author,
    title,
    link: row.link || "",
    clickKey: row.clickKey || row.link || title,
    frameUrl: row.frameUrl || "",
    isNew: Boolean(row.isNew)
  };
}

function filterMessages(rows, options = {}) {
  const mode = options.mode || "keyword-new";
  const keyword = (options.keyword || "").trim().toLowerCase();

  return rows
    .map((row) => mapDomRow(row, options.fallbackCategory || ""))
    .filter((row) => row.isNew)
    .filter((row) => row.title && row.link)
    .filter((row) => {
      if (mode === "all-new") return true;
      return Boolean(keyword && row.title.toLowerCase().includes(keyword));
    })
    .map((row, index) => ({
      sequence: index + 1,
      date: row.date,
      author: row.author,
      title: row.title,
      link: row.link,
      clickKey: row.clickKey,
      frameUrl: row.frameUrl
    }));
}

function parseInboxHtml(html, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_INBOX_URL;
  const fallbackCategory = options.fallbackCategory || detectSelectedCategory(html);
  const rowMatches = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const rows = rowMatches.map((rowHtml) => {
    const anchorMatches = Array.from(rowHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi));
    const subjectAnchor = anchorMatches
      .map((match) => ({
        href: readHtmlAttribute(match[1], "href"),
        onclick: readHtmlAttribute(match[1], "onclick"),
        text: stripTags(match[2])
      }))
      .find((anchor) => anchor.text && !isUnsafeMessageLink(`${anchor.href} ${anchor.onclick}`, anchor.text));
    const cellTexts = (rowHtml.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || []).map(stripTags).filter(Boolean);
    const date = [...cellTexts].reverse().find(looksLikeDate) || "";
    const titleCellIndex = cellTexts.findIndex((cell) => subjectAnchor?.text && cell.includes(subjectAnchor.text));
    const author = titleCellIndex > 0 ? cellTexts[titleCellIndex - 1] : fallbackCategory;

    return {
      date,
      author,
      title: subjectAnchor ? subjectAnchor.text : "",
      link: subjectAnchor ? normalizeUrl(subjectAnchor.href, baseUrl) : "",
      clickKey: subjectAnchor ? subjectAnchor.href || subjectAnchor.onclick || subjectAnchor.text : "",
      isNew: hasRedNewMarker(rowHtml)
    };
  });

  return filterMessages(rows, {
    mode: options.mode,
    keyword: options.keyword,
    fallbackCategory
  });
}

module.exports = {
  DEFAULT_INBOX_URL,
  cleanTitle,
  filterMessages,
  normalizeUrl,
  parseInboxHtml
};
