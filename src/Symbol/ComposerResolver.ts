import path from 'node:path'
import * as vscode from 'vscode'
import * as parser from './Parser'

/**
 * Resolves a fully-qualified class name to its file path using the project's
 * composer autoload metadata. The generated `autoload_classmap.php` and
 * `autoload_psr4.php` are PHP files, so they are parsed with php-parser and their
 * `$vendorDir`/`$baseDir` concatenation expressions evaluated against the workspace.
 */
class ComposerResolver {
    private classMap  : Map<string, string> | null = null
    private psr4      : Array<{prefix: string, dirs: string[]}> | null = null
    private baseDir   : string
    private vendorDir : string

    public constructor(baseDir: string) {
        this.baseDir = baseDir
        this.vendorDir = path.join(baseDir, 'vendor')
    }

    /**
     * Resolves an FQCN (leading `\` optional) to an absolute file path, or null.
     * Tries the exact classmap entry first, then a PSR-4 prefix match. When
     * `allowSuffix` is set, falls back to a case-sensitive suffix match across the
     * classmap (covers un-imported bare names that resolve to a different namespace).
     */
    public async resolve(className: string, allowSuffix = false): Promise<string | null> {
        const normalized = className.replace(/^\\/, '')

        if (this.classMap === null) {
            this.classMap = await this.loadClassMap()
        }

        const exact = this.classMap?.get(normalized)

        if (exact) {
            return this.abs(exact)
        }

        if (this.psr4 === null) {
            this.psr4 = await this.loadPsr4()
        }

        if (this.psr4) {
            for (const {prefix, dirs} of this.psr4) {
                if (normalized.startsWith(prefix)) {
                    const relative = normalized.slice(prefix.length).replace(/\\/g, '/')

                    for (const dir of dirs) {
                        const candidate = path.join(this.abs(dir), `${relative}.php`)

                        if (await this.exists(candidate)) {
                            return candidate
                        }
                    }
                }
            }
        }

        if (allowSuffix && this.classMap) {
            const tail = normalized.split('\\').pop()
            const lower = tail?.toLowerCase()

            for (const [fqcn, file] of this.classMap) {
                if (fqcn.toLowerCase().endsWith(`\\${lower}`)) {
                    return this.abs(file)
                }
            }
        }

        return null
    }

    private async loadClassMap(): Promise<Map<string, string>> {
        const map = new Map<string, string>()
        const entries = await this.readComposerArray('autoload_classmap.php')

        for (const [key, value] of entries) {
            if (typeof value === 'string') {
                map.set(key.replace(/^\\/, ''), value)
            }
        }

        return map
    }

    private async loadPsr4(): Promise<Array<{prefix: string, dirs: string[]}>> {
        const result: Array<{prefix: string, dirs: string[]}> = []
        const entries = await this.readComposerArray('autoload_psr4.php')

        for (const [prefix, value] of entries) {
            const dirs = Array.isArray(value)
                ? value.filter((dir): dir is string => typeof dir === 'string')
                : (typeof value === 'string' ? [value] : [])

            if (dirs.length) {
                result.push({prefix: prefix.replace(/^\\/, ''), dirs})
            }
        }

        return result
    }

    /**
     * Reads a composer autoload file and returns its key/value entries with the
     * `$vendorDir`/`$baseDir` concatenation expressions evaluated to strings.
     */
    private async readComposerArray(fileName: string): Promise<Array<[string, string | string[]]>> {
        const file = path.join(this.vendorDir, 'composer', fileName)

        if (!(await this.exists(file))) {
            return []
        }

        try {
            const text = (await vscode.workspace.fs.readFile(vscode.Uri.file(file))).toString()
            const AST: any = parser.parseCode(text)
            const returnNode = AST?.children?.find((item: any) => item.kind === 'return')

            if (returnNode?.expr?.kind !== 'array') {
                return []
            }

            const entries: Array<[string, string | string[]]> = []

            for (const item of returnNode.expr.items ?? []) {
                const key = this.evalScalar(item.key)

                if (typeof key !== 'string') {
                    continue
                }

                const value = this.evalValue(item.value)

                if (value !== undefined) {
                    entries.push([key, value])
                }
            }

            return entries
        } catch {
            return []
        }
    }

    /** Evaluates a composer expression to a string/array of strings, or undefined. */
    private evalValue(node: any): string | string[] | undefined {
        if (!node) {
            return undefined
        }

        if (node.kind === 'string') {
            return node.value
        }

        if (node.kind === 'bin' && node.type === '.') {
            const left = this.evalValue(node.left)
            const right = this.evalValue(node.right)

            if (typeof left === 'string' && typeof right === 'string') {
                return left + right
            }

            return undefined
        }

        if (node.kind === 'variable' && node.name === 'baseDir') {
            return this.baseDir
        }

        if (node.kind === 'variable' && node.name === 'vendorDir') {
            return this.vendorDir
        }

        if (node.kind === 'array') {
            const arr: string[] = []

            for (const item of node.items ?? []) {
                const value = this.evalValue(item.value)

                if (typeof value === 'string') {
                    arr.push(value)
                }
            }

            return arr
        }

        return undefined
    }

    private evalScalar(node: any): string | number | null | undefined {
        if (!node) {
            return undefined
        }

        if (node.kind === 'string') {
            return node.value
        }

        if (node.kind === 'number') {
            return Number(node.value)
        }

        return undefined
    }

    private async exists(file: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(file))

            return true
        } catch {
            return false
        }
    }

    private abs(p: string): string {
        return path.isAbsolute(p) ? p : path.join(this.baseDir, p)
    }
}

/** Caches a single ComposerResolver per workspace root. */
const resolverCache = new Map<string, ComposerResolver>()

export function getComposerResolver(baseDir: string): ComposerResolver {
    let resolver = resolverCache.get(baseDir)

    if (!resolver) {
        resolver = new ComposerResolver(baseDir)
        resolverCache.set(baseDir, resolver)
    }

    return resolver
}

/** Returns the active workspace root, or null. */
function getWorkspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null
}
