import {glob} from 'fast-glob'
import * as vscode from 'vscode'
import * as utils from '../utils'
import * as parser from './Parser'
import {getComposerResolver} from './ComposerResolver'

const CLASS_KINDS = new Set(['class', 'trait'])

export interface CallerContext {
    namespace : string | undefined
    aliases   : Record<string, string>
}

export interface SearchResult {
    method     : any
    sourceFile : string
}

const IDE_HELPER_FILENAME = '_ide_helper.php'
const VENDOR_GLOB = '**/vendor/**'

/**
 * Locates a method definition for a call site, preferring the cheapest source.
 * Order: current file → exact composer resolution → composer suffix match →
 * ide_helper.php → workspace glob. `receiverClass` is the short class name the call
 * is made on (`$this`/`self`/`static` resolve to the enclosing class name); `caller`
 * carries the caller's namespace and import aliases used to resolve the FQCN.
 */
export async function searchForMethod(
    receiverClass: string | undefined,
    methodName: string,
    currentFile: string,
    caller: CallerContext,
): Promise<SearchResult | null> {
    const currentText = vscode.window.activeTextEditor?.document.getText()

    if (currentText && vscode.window.activeTextEditor?.document.fileName === currentFile) {
        const local = findMethodInDocument(currentText, receiverClass, methodName)

        if (local) {
            return {method: local, sourceFile: currentFile}
        }
    }

    const root = getWorkspaceRoot()

    if (!root) {
        return null
    }

    const fqcn = resolveReceiverFqcn(receiverClass, caller)

    if (fqcn) {
        const exactFile = await getComposerResolver(root).resolve(fqcn, false)

        if (exactFile) {
            const method = await readAndFind(exactFile, receiverClass, methodName)

            if (method) {
                return {method, sourceFile: exactFile}
            }
        }
    }

    const suffixFile = receiverClass ? await getComposerResolver(root).resolve(receiverClass, true) : null

    if (suffixFile) {
        const method = await readAndFind(suffixFile, receiverClass, methodName)

        if (method) {
            return {method, sourceFile: suffixFile}
        }
    }

    const ideHelper = await findInIdeHelper(root, receiverClass, methodName)

    if (ideHelper) {
        return ideHelper
    }

    for (const relativePath of await listWorkspacePhpFiles(root)) {
        const filePath = `${root}/${relativePath}`

        if (filePath === currentFile) {
            continue
        }

        const method = await readAndFind(filePath, receiverClass, methodName)

        if (method) {
            return {method, sourceFile: filePath}
        }
    }

    return null
}

/** Caches the parsed `_ide_helper.php` content per workspace root. */
const ideHelperCache = new Map<string, string>()

async function findInIdeHelper(root: string, receiverClass: string | undefined, methodName: string): Promise<SearchResult | null> {
    const file = `${root}/${IDE_HELPER_FILENAME}`

    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(file))
    } catch {
        return null
    }

    let text = ideHelperCache.get(root)

    if (text === undefined) {
        text = (await vscode.workspace.fs.readFile(vscode.Uri.file(file))).toString()
        ideHelperCache.set(root, text)
    }

    const method = findMethodInDocument(text, receiverClass, methodName)

    return method ? {method, sourceFile: file} : null
}

async function readAndFind(filePath: string, receiverClass: string | undefined, methodName: string): Promise<any | null> {
    try {
        const text = (await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))).toString()

        return findMethodInDocument(text, receiverClass, methodName)
    } catch {
        return null
    }
}

/** Maps a call-site receiver short name to a fully-qualified class name. */
function resolveReceiverFqcn(receiverClass: string | undefined, caller: CallerContext): string | undefined {
    if (!receiverClass) {
        return undefined
    }

    if (caller.aliases[receiverClass]) {
        return caller.aliases[receiverClass]
    }

    if (caller.namespace) {
        return `${caller.namespace}\\${receiverClass}`
    }

    return undefined
}

function findMethodInDocument(content: string, className: string | undefined, methodName: string): any | null {
    try {
        const AST: any = parser.parseCode(content)
        const candidateClasses = (AST?.children?.find((item: any) => item.kind === 'namespace') || AST)?.children
            ?.filter((item: any) => CLASS_KINDS.has(item.kind))
            ?? []

        const classes = className
            ? candidateClasses.filter((item: any) => item.name?.name === className)
            : candidateClasses

        for (const _class of classes) {
            const method = _class.body?.find((item: any) => item.kind === 'method' && parser.getName(item) === methodName)

            if (method) {
                return method
            }
        }

        return null
    } catch {
        return null
    }
}

async function listWorkspacePhpFiles(folderPath: string): Promise<string[]> {
    // vendor stays in the shared exclude config, but this feature's glob may need
    // to search vendor (composer packages) for method definitions, so drop it here.
    const ignore = utils.filesExcludeGlob?.filter((pattern) => pattern !== VENDOR_GLOB)

    try {
        return await glob(`**/*${utils.EXT}`, {
            cwd    : folderPath,
            ignore : ignore,
        }) as string[]
    } catch {
        return []
    }
}

function getWorkspaceRoot(): string | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null
}
