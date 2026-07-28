// Resolves a vendored third-party runtime's asset path to an absolute URL
// against the document's base URL (renderer-content-security: a relative path
// is ambiguous — a dynamic `import()` resolves it against the importing
// chunk, not the document). `documentBaseHref` is passed in by the caller
// (`document.baseURI`) rather than read here, so this stays a pure function
// testable without a browser global (design D1, D2).
export function resolveVendoredAssetUrl(subPath: string, baseUrl: string, documentBaseHref: string): string {
  return new URL(`${baseUrl}${subPath}`, documentBaseHref).href;
}
