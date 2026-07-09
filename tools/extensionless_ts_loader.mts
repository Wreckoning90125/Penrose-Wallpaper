// Node runs .mts gate scripts directly, but app modules use bundler-style
// extensionless relative imports. This loader appends TS extensions for those
// local imports so gate scripts can execute production modules without changing
// app import style.
type ResolveContext = {
  parentURL?: string;
  conditions?: string[];
  importAttributes?: Record<string, string>;
};

type ResolveResult = {
  url: string;
  format?: string | null;
  shortCircuit?: boolean;
};

type NextResolve = (specifier: string, context: ResolveContext) => Promise<ResolveResult>;

const EXTENSION_RE = /\/?[^/]+\.[a-z0-9]+$/i;
const CANDIDATE_EXTENSIONS = ['.ts', '.tsx', '.mts'];

function isLocalExtensionless(specifier: string): boolean {
  return (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/'))
    && !EXTENSION_RE.test(specifier);
}

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
): Promise<ResolveResult> {
  try {
    return await nextResolve(specifier, context);
  } catch (caught) {
    if (
      !(caught instanceof Error)
      || Reflect.get(caught, 'code') !== 'ERR_MODULE_NOT_FOUND'
      || !isLocalExtensionless(specifier)
    ) {
      throw caught;
    }
  }

  for (const extension of CANDIDATE_EXTENSIONS) {
    try {
      return await nextResolve(`${specifier}${extension}`, context);
    } catch (caught) {
      if (!(caught instanceof Error) || Reflect.get(caught, 'code') !== 'ERR_MODULE_NOT_FOUND') throw caught;
    }
  }

  return nextResolve(specifier, context);
}
