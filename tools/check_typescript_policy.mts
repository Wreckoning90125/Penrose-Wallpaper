// AST-based TypeScript policy. Reads each file's syntax tree from the TypeScript
// compiler and flags only REAL casts and `any` / `unknown` type keywords — never
// the words appearing in comments or string literals (the old line-based text
// scan did, which is why innocent prose like "treat X as Y" failed the gate).
// The repo rule is unchanged — no `as` casts, no `any`, no `unknown` — except
// `as const`, which is a const assertion, not a type cast. Every TypeScript file
// in the repo must belong to tsconfig.json, so the files this gate reads are the
// files `tsc` checks. Run via: npm run ts:policy
import { API } from 'typescript/unstable/sync';
import {
  SyntaxKind,
  isAsExpression,
  isIdentifier,
  isTypeReferenceNode,
  type AsExpression,
  type Node,
  type SourceFile,
} from 'typescript/unstable/ast';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUFFIXES = ['.ts', '.tsx', '.mts', '.cts'];
const SKIP_DIRS = new Set(['.cache', '.git', '.local', 'dist', 'node_modules']);

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (SUFFIXES.some(suffix => entry.name.endsWith(suffix))) {
      out.push(full);
    }
  }
  return out;
}

// `x as const` is a const assertion (narrowing to a literal type), not a cast.
function isConstAssertion(node: AsExpression): boolean {
  const target = node.type;
  return isTypeReferenceNode(target) && isIdentifier(target.typeName) && target.typeName.text === 'const';
}

type Violation = { rel: string; line: number; rule: string };

function scanFile(source: SourceFile, rel: string, violations: Violation[]): void {
  const record = (node: Node, rule: string): void => {
    const at = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push({ rel, line: at.line + 1, rule });
  };
  const visit = (node: Node): void => {
    if (isAsExpression(node)) {
      if (!isConstAssertion(node)) record(node, 'no-as-cast');
    } else if (node.kind === SyntaxKind.TypeAssertionExpression) {
      record(node, 'no-as-cast');
    } else if (node.kind === SyntaxKind.AnyKeyword) {
      record(node, 'no-any');
    } else if (node.kind === SyntaxKind.UnknownKeyword) {
      record(node, 'no-unknown');
    }
    node.forEachChild(visit);
  };
  visit(source);
}

const files = walk(ROOT, []).sort();
const violations: Violation[] = [];
const api = new API({ cwd: ROOT });
try {
  const snapshot = api.updateSnapshot({ openProjects: [join(ROOT, 'tsconfig.json')] });
  const project = snapshot.getProject(join(ROOT, 'tsconfig.json'));
  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/');
    const source = project?.program.getSourceFile(file);
    if (source) scanFile(source, rel, violations);
    else violations.push({ rel, line: 1, rule: 'not-in-tsconfig' });
  }
} finally {
  api.close();
}

if (violations.length > 0) {
  process.stderr.write('[typescript-policy] violations:\n');
  for (const v of violations) process.stderr.write(`  ${v.rel}:${v.line}: ${v.rule}\n`);
  process.stderr.write(`[typescript-policy] ${violations.length} violation(s)\n`);
  process.exit(1);
}
process.stdout.write(`[typescript-policy] OK (AST): scanned ${files.length} TypeScript file(s)\n`);
