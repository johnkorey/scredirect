// Best-effort User-Agent -> browser name. Order matters: browsers like Edge/Opera
// embed "Chrome" and "Safari" tokens in their UA string for compatibility, so the
// more specific checks must run first.
export function parseBrowser(ua) {
  if (!ua) return 'Unknown';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua) || /Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/UCBrowser/.test(ua)) return 'UC Browser';
  if (/CriOS/.test(ua)) return 'Chrome (iOS)';
  if (/FxiOS/.test(ua)) return 'Firefox (iOS)';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return 'Chrome';
  if (/Chromium\//.test(ua)) return 'Chromium';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'Safari';
  if (/MSIE|Trident\//.test(ua)) return 'Internet Explorer';
  return 'Other';
}
