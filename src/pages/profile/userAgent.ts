// What a person recognises a session by: the browser and the system, read from
// the User-Agent a sign-in sent. A guess for a human, never an identity — the
// header is whatever the client chose to send.

export type DeviceKind = 'desktop' | 'mobile' | 'tool';

export interface UserAgentSummary {
  // "Chrome 131", "curl 8.5.0"; null when nothing is recognised.
  browser: string | null;
  // "Windows", "macOS", "iOS", "Android", "Linux", "ChromeOS"; null when unknown.
  os: string | null;
  device: DeviceKind;
}

// Order matters: Edge and Opera also say Chrome, Chrome also says Safari.
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/\bOPR\/(\d+)/, 'Opera'],
  [/\bYaBrowser\/(\d+)/, 'Yandex Browser'],
  [/\bFirefox\/(\d+)/, 'Firefox'],
  [/\bFxiOS\/(\d+)/, 'Firefox'],
  [/\bCriOS\/(\d+)/, 'Chrome'],
  [/\bChrome\/(\d+)/, 'Chrome'],
  [/\bVersion\/(\d+)[^ ]* (?:Mobile\/\S+ )?Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux/, 'Linux'],
];

export function summarizeUserAgent(ua: string | null | undefined): UserAgentSummary {
  const s = (ua ?? '').trim();
  if (!s) return { browser: null, os: null, device: 'desktop' };
  if (!s.startsWith('Mozilla/')) {
    // A tool names itself first: "curl/8.5.0", "python-requests/2.31".
    const m = /^([A-Za-z][\w.-]*)\/([\w.]+)/.exec(s);
    return { browser: m ? `${m[1]} ${m[2]}` : null, os: null, device: 'tool' };
  }
  let browser: string | null = null;
  for (const [re, name] of BROWSERS) {
    const m = re.exec(s);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  const os = SYSTEMS.find(([re]) => re.test(s))?.[1] ?? null;
  const device: DeviceKind = /Mobi|iPhone|iPod|Android/.test(s) ? 'mobile' : 'desktop';
  return { browser, os, device };
}
