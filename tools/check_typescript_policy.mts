// AST-based TypeScript policy. Parses each file with the TypeScript compiler and
// flags only REAL casts and `any` / `unknown` type keywords — never the words
// appearing in comments or string literals (the old line-based text scan did,
// which is why innocent prose like "treat X as Y" failed the gate). The repo
// rule is unchanged — no `as` casts, no `any`, no `unknown` — except `as const`,
// which is a const assertion, not a type cast. Run via: npm run ts:policy
import * as ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
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
function isConstAssertion(node: ts.AsExpression): boolean {
  const target = node.type;
  return ts.isTypeReferenceNode(target) && ts.isIdentifier(target.typeName) && target.typeName.text === 'const';
}

type Violation = { rel: string; line: number; rule: string };

function scanFile(filePath: string, violations: Violation[]): void {
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true, scriptKind);
  const rel = relative(ROOT, filePath).split('\\').join('/');
  const record = (node: ts.Node, rule: string): void => {
    const at = source.getLineAndCharacterOfPosition(node.getStart(source));
    violations.push({ rel, line: at.line + 1, rule });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node)) {
      if (!isConstAssertion(node)) record(node, 'no-as-cast');
    } else if (node.kind === ts.SyntaxKind.TypeAssertionExpression) {
      record(node, 'no-as-cast');
    } else if (node.kind === ts.SyntaxKind.AnyKeyword) {
      record(node, 'no-any');
    } else if (node.kind === ts.SyntaxKind.UnknownKeyword) {
      record(node, 'no-unknown');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const files = walk(ROOT, []).sort();
const violations: Violation[] = [];
for (const file of files) scanFile(file, violations);

if (violations.length > 0) {
  process.stderr.write('[typescript-policy] violations:\n');
  for (const v of violations) process.stderr.write(`  ${v.rel}:${v.line}: ${v.rule}\n`);
  process.stderr.write(`[typescript-policy] ${violations.length} violation(s)\n`);
  process.exit(1);
}
process.stdout.write(`[typescript-policy] OK (AST): scanned ${files.length} TypeScript file(s)\n`);
