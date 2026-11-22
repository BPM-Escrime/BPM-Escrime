/**
 * Catalogue des codes d'erreur (docs/adr/0009-codes-erreur.md) :
 * - codes en snake_case ;
 * - tout `new CommandError('…')` / `new ApiError('…')` de src/main et src/shared cite un code du
 *   catalogue (le typage l'impose déjà ; ce test couvre aussi le JavaScript et les `as`) ;
 * - la section générée de docs/API_CONTRACT.md est à jour (UPDATE_ERRORS_DOC=1 la réécrit,
 *   via `npm run docs:mcp`).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { describe, expect, it } from 'vitest';
import { ERRORS, errorCategory, isApiErrorCode, type ApiErrorCode } from './errors';

const ROOT = join(__dirname, '..', '..', '..');
const DOC = join(ROOT, 'docs', 'API_CONTRACT.md');
const BEGIN = '<!-- codes-erreur:début (généré par npm run docs:mcp, ne pas éditer) -->';
const END = '<!-- codes-erreur:fin -->';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [full] : [];
  });
}

const THROW_RE = /new (?:CommandError|ApiError)\(\s*'([^']+)'/g;

function renderErrorsSection(): string {
  const rows = (Object.keys(ERRORS) as ApiErrorCode[]).map(
    code => `| \`${code}\` | ${errorCategory(code)} | ${ERRORS[code].description} |`
  );
  return [BEGIN, '', '| Code | Catégorie | Sens |', '| --- | --- | --- |', ...rows, '', END].join(
    '\n'
  );
}

describe('catalogue des codes d’erreur (ADR-0009)', () => {
  it('codes en snake_case', () => {
    for (const code of Object.keys(ERRORS)) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('isApiErrorCode reconnaît le catalogue seulement', () => {
    expect(isApiErrorCode('tie_at_max')).toBe(true);
    expect(isApiErrorCode('toString')).toBe(false);
    expect(isApiErrorCode(42)).toBe(false);
  });

  it('les levées de src/main et src/shared citent un code du catalogue', () => {
    const unknown: string[] = [];
    for (const file of [
      ...sources(join(ROOT, 'src', 'main')),
      ...sources(join(ROOT, 'src', 'shared')),
    ]) {
      for (const m of readFileSync(file, 'utf8').matchAll(THROW_RE)) {
        if (!isApiErrorCode(m[1])) unknown.push(`${relative(ROOT, file)} : ${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('docs/API_CONTRACT.md liste le catalogue', () => {
    const doc = readFileSync(DOC, 'utf8');
    const start = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);
    expect(start, `section ${BEGIN} absente`).toBeGreaterThanOrEqual(0);
    const next = doc.slice(0, start) + renderErrorsSection() + doc.slice(end + END.length);
    if (process.env.UPDATE_ERRORS_DOC === '1') {
      writeFileSync(DOC, next);
      return;
    }
    expect(next, 'docs/API_CONTRACT.md périmé : npm run docs:mcp').toBe(doc);
  });
});
