/**
 * Regex-based function finder for Python and JS/TS. Browser-safe, pure, never throws.
 *
 * Output is top-level functions and class methods only (named `Class.method`); functions nested
 * inside another function are folded into their parent. Known gaps (acceptable for a hackathon):
 * multi-line strings or docstrings containing `def`/`function`, regex literals containing braces,
 * class-property arrow functions, object-literal methods.
 */
import { PARSEABLE_JS, PARSEABLE_PY } from './ignore';

export interface ParsedFunction {
  name: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
}

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i <= 0 ? '' : fileName.slice(i).toLowerCase();
}

export function isParseable(fileName: string): boolean {
  const e = extOf(fileName);
  return PARSEABLE_PY.has(e) || PARSEABLE_JS.has(e);
}

export function parseFunctions(source: string, fileName: string): ParsedFunction[] {
  try {
    const ext = extOf(fileName);
    if (PARSEABLE_PY.has(ext)) return parsePython(source);
    if (PARSEABLE_JS.has(ext)) return parseJsTs(source);
  } catch {
    // Parsing must never break tree building.
  }
  return [];
}

// ---- Python -----------------------------------------------------------------

interface PyFrame {
  kind: 'class' | 'def';
  indent: number;
  name: string;
  /** Index into `out` for a recorded def, or -1 if nested (folded) or a class. */
  rec: number;
}

function parsePython(source: string): ParsedFunction[] {
  const lines = source.split(/\r?\n/);
  const out: ParsedFunction[] = [];
  const stack: PyFrame[] = [];
  const defRe = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
  const classRe = /^(\s*)class\s+([A-Za-z_]\w*)\s*[(:]/;
  let lastCode = 0; // last non-blank, non-comment line (1-based)

  const closeFrame = (f: PyFrame) => {
    if (f.rec >= 0) out[f.rec].endLine = Math.max(out[f.rec].startLine, lastCode);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.length && stack[stack.length - 1].indent >= indent) closeFrame(stack.pop()!);

    const d = defRe.exec(line);
    const c = d ? null : classRe.exec(line);
    if (d) {
      const insideDef = stack.some((f) => f.kind === 'def');
      const cls = [...stack].reverse().find((f) => f.kind === 'class');
      let rec = -1;
      if (!insideDef) {
        rec = out.length;
        out.push({ name: cls ? `${cls.name}.${d[2]}` : d[2], startLine: i + 1, endLine: i + 1 });
      }
      stack.push({ kind: 'def', indent, name: d[2], rec });
    } else if (c) {
      stack.push({ kind: 'class', indent, name: c[2], rec: -1 });
    }
    lastCode = i + 1;
  }
  while (stack.length) closeFrame(stack.pop()!);
  return out;
}

// ---- JS / TS ----------------------------------------------------------------

/** Replace comment and string contents with spaces (newlines kept) so brace counting is safe. */
function maskJs(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') {
        out.push(' ');
        i++;
      }
    } else if (ch === '/' && next === '*') {
      out.push(' ', ' ');
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n) {
        out.push(' ', ' ');
        i += 2;
      }
    } else if (ch === '"' || ch === "'" || ch === '`') {
      out.push(ch);
      i++;
      while (i < n && src[i] !== ch) {
        if (src[i] === '\\' && i + 1 < n) {
          out.push(' ', src[i + 1] === '\n' ? '\n' : ' ');
          i += 2;
          continue;
        }
        // Plain quotes cannot span lines; stop at the newline to limit damage from stray quotes.
        if (ch !== '`' && src[i] === '\n') break;
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < n && src[i] === ch) {
        out.push(ch);
        i++;
      }
    } else {
      out.push(ch);
      i++;
    }
  }
  return out.join('');
}

const JS_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with', 'new', 'typeof',
]);

function parseJsTs(source: string): ParsedFunction[] {
  const lines = maskJs(source).split('\n');
  const total = lines.length;

  // Brace depth at the start of each line, and brace-matching helper.
  const depthAt: number[] = new Array(total + 1).fill(0);
  let d = 0;
  for (let i = 0; i < total; i++) {
    depthAt[i] = d;
    for (const ch of lines[i]) {
      if (ch === '{') d++;
      else if (ch === '}') d--;
    }
  }
  depthAt[total] = d;

  /** Last line (0-based) of the block opened by the first `{` at or after line `start`, or `start` if none. */
  const blockEnd = (start: number): number => {
    let depth = 0;
    let opened = false;
    for (let i = start; i < total; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') {
          depth++;
          opened = true;
        } else if (ch === '}') {
          depth--;
          if (opened && depth === 0) return i;
        }
      }
      // No brace opened by the end of the statement: expression-bodied arrow or declaration.
      if (!opened && i > start && /;\s*$/.test(lines[i])) return i;
      if (!opened && i === start && /;\s*$/.test(lines[i])) return i;
      if (!opened && i === start && /=>\s*[^{\s]/.test(lines[i]) ) return i;
    }
    return opened ? total - 1 : start;
  };

  const fnDecl = /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/;
  const arrow =
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^={]+)?=>|[A-Za-z_$][\w$]*\s*=>)/;
  const classRe = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
  const method =
    /^\s*(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*\*?\s*([A-Za-z_$#][\w$]*)\s*(?:<[^>]*>)?\s*\(/;

  const out: ParsedFunction[] = [];
  let i = 0;
  while (i < total) {
    const line = lines[i];
    const f = fnDecl.exec(line) ?? arrow.exec(line);
    if (f) {
      const end = blockEnd(i);
      out.push({ name: f[1], startLine: i + 1, endLine: end + 1 });
      i = end + 1;
      continue;
    }
    const c = classRe.exec(line);
    if (c) {
      const end = blockEnd(i);
      const bodyDepth = depthAt[i] + 1;
      let j = i + 1;
      while (j <= end) {
        const m = depthAt[j] === bodyDepth ? method.exec(lines[j]) : null;
        if (m && !JS_KEYWORDS.has(m[1])) {
          const mEnd = Math.min(blockEnd(j), end);
          out.push({ name: `${c[1]}.${m[1]}`, startLine: j + 1, endLine: mEnd + 1 });
          j = mEnd + 1;
        } else {
          j++;
        }
      }
      i = end + 1;
      continue;
    }
    i++;
  }
  return out;
}
