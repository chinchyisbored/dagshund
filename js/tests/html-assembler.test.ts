import { describe, expect, test } from "bun:test";
import {
  assembleHtml,
  escapeForScriptTag,
  escapeForStyleTag,
  escapeJsonForScript,
} from "../src/html-assembler.ts";

describe("escapeForScriptTag", () => {
  test("escapes closing script tags", () => {
    expect(escapeForScriptTag("</script>")).toBe("<\\/script>");
  });

  test("escapes closing script tags case-insensitively", () => {
    expect(escapeForScriptTag("</SCRIPT>")).toBe("<\\/script>");
    expect(escapeForScriptTag("</Script>")).toBe("<\\/script>");
  });

  test("escapes HTML comments", () => {
    expect(escapeForScriptTag("<!--comment-->")).toBe("<\\!--comment-->");
  });

  test("escapes multiple occurrences", () => {
    const input = "</script>foo</script>bar<!--baz-->";
    const expected = "<\\/script>foo<\\/script>bar<\\!--baz-->";
    expect(escapeForScriptTag(input)).toBe(expected);
  });

  test("returns input unchanged when no escaping needed", () => {
    const input = "const x = 42; console.log(x);";
    expect(escapeForScriptTag(input)).toBe(input);
  });

  test("handles empty string", () => {
    expect(escapeForScriptTag("")).toBe("");
  });
});

describe("escapeForStyleTag", () => {
  test("escapes closing style tags", () => {
    expect(escapeForStyleTag("</style>")).toBe("<\\/style>");
  });

  test("escapes closing style tags case-insensitively", () => {
    expect(escapeForStyleTag("</STYLE>")).toBe("<\\/style>");
    expect(escapeForStyleTag("</Style>")).toBe("<\\/style>");
  });

  test("escapes multiple occurrences", () => {
    const input = "a</style>b</style>c";
    const expected = "a<\\/style>b<\\/style>c";
    expect(escapeForStyleTag(input)).toBe(expected);
  });

  test("returns input unchanged when no escaping needed", () => {
    const input = "body { color: red; }";
    expect(escapeForStyleTag(input)).toBe(input);
  });

  test("handles empty string", () => {
    expect(escapeForStyleTag("")).toBe("");
  });
});

describe("escapeJsonForScript", () => {
  test("replaces all < with unicode escape", () => {
    expect(escapeJsonForScript("<div>hello</div>")).toBe("\\u003cdiv>hello\\u003c/div>");
  });

  test("escapes closing script tags", () => {
    expect(escapeJsonForScript("</script>")).toBe("\\u003c/script>");
  });

  test("escapes HTML comments", () => {
    expect(escapeJsonForScript("<!--comment-->")).toBe("\\u003c!--comment-->");
  });

  test("escapes < inside JSON string values", () => {
    const input = '{"html":"<b>bold</b>"}';
    const result = escapeJsonForScript(input);
    expect(result).not.toContain("<");
    expect(JSON.parse(result)).toEqual({ html: "<b>bold</b>" });
  });

  test("returns input unchanged when no < present", () => {
    const input = '{"key":"value","num":42}';
    expect(escapeJsonForScript(input)).toBe(input);
  });

  test("handles empty string", () => {
    expect(escapeJsonForScript("")).toBe("");
  });
});

describe("assembleHtml", () => {
  const MINIMAL_CSS = "body { margin: 0; }";
  const MINIMAL_JS = "console.log('hello');";
  const PLAN_SLOT = '{"test":true}';

  test("produces valid HTML structure", () => {
    const html = assembleHtml(MINIMAL_CSS, MINIMAL_JS, PLAN_SLOT);
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("</html>");
    expect(html).toContain('<div id="root"></div>');
  });

  test("inlines CSS in a style tag", () => {
    const html = assembleHtml(MINIMAL_CSS, MINIMAL_JS, PLAN_SLOT);
    expect(html).toContain(`<style>${MINIMAL_CSS}</style>`);
  });

  test("inlines JS in a script module tag", () => {
    const html = assembleHtml(MINIMAL_CSS, MINIMAL_JS, PLAN_SLOT);
    expect(html).toContain(`<script type="module">${MINIMAL_JS}</script>`);
  });

  test("inserts planSlot verbatim into window assignment", () => {
    const html = assembleHtml(MINIMAL_CSS, MINIMAL_JS, PLAN_SLOT);
    expect(html).toContain(`window.__DAGSHUND_PLAN__ = ${PLAN_SLOT};`);
  });

  test("works with placeholder token for template builds", () => {
    const html = assembleHtml(MINIMAL_CSS, MINIMAL_JS, "__DAGSHUND_PLAN_JSON__");
    expect(html).toContain("window.__DAGSHUND_PLAN__ = __DAGSHUND_PLAN_JSON__;");
  });

  test("includes theme init script", () => {
    const html = assembleHtml(MINIMAL_CSS, MINIMAL_JS, PLAN_SLOT);
    expect(html).toContain("dagshund-theme");
    expect(html).toContain("high-contrast");
    expect(html).toContain("prefers-color-scheme: light");
  });

  test("includes ResizeObserver suppression", () => {
    const html = assembleHtml(MINIMAL_CSS, MINIMAL_JS, PLAN_SLOT);
    expect(html).toContain("ResizeObserver loop");
  });

  test("includes CSP meta tag", () => {
    const html = assembleHtml(MINIMAL_CSS, MINIMAL_JS, PLAN_SLOT);
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("script-src 'unsafe-inline'");
  });

  test("escapes script-breaking content in JS bundle", () => {
    const maliciousJs = "alert('</script><script>evil()')";
    const html = assembleHtml(MINIMAL_CSS, maliciousJs, PLAN_SLOT);
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("<\\/script>");
  });

  test("escapes style-breaking content in CSS", () => {
    const maliciousCss = "body { content: '</style><script>evil()'; }";
    const html = assembleHtml(maliciousCss, MINIMAL_JS, PLAN_SLOT);
    expect(html).not.toContain("</style><script>");
  });
});
