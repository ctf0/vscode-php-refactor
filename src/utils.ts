import glob from 'fast-glob'
import path from 'node:path'
import * as vscode from 'vscode'
import type {FileNameAndNamespace, NamespaceProvider, ShowMessageResult} from './types'

export const PACKAGE_CMND_NAME = 'phprefactor'
export const PACKAGE_NAME = 'phpRefactor'
export let config: vscode.WorkspaceConfiguration
export let filesExcludeGlob: string[]
export let NS_EXTENSION_PROVIDER: NamespaceProvider
export const EXT = '.php'

export function showMessage(msg: string, error = true, items: string[] = []): ShowMessageResult {
    return error
        ? vscode.window.showErrorMessage(`PHP Refactor: ${msg}`, ...items)
        : vscode.window.showInformationMessage(`PHP Refactor: ${msg}`, ...items)
}

export function setConfig(): void {
    config = vscode.workspace.getConfiguration(PACKAGE_NAME)
    filesExcludeGlob = getConfig('excludeList') as string[]
}

export function getConfig(key: string): unknown {
    return config.get(key)
}

export function getFileNameFromPath(filePath: string): string {
    return path.parse(filePath).name
}

export function getFileExtFromPath(filePath: string): string {
    return path.parse(filePath).ext
}

export function getDirNameFromPath(filePath: string): string {
    return path.parse(filePath).dir
}

export async function getFileNamespace(uri?: vscode.Uri): Promise<string | undefined> {
    try {
        return await NS_EXTENSION_PROVIDER.getNamespace(uri)
    } catch {
        // console.error(error);
        return undefined
    }
}

export async function NsExtensionProviderInit(): Promise<void> {
    const nsResolverExtension = vscode.extensions.getExtension('ctf0.php-namespace-resolver')

    if (nsResolverExtension == null) {
        throw new Error('Depends on \'ctf0.php-namespace-resolver\' extension')
    }

    NS_EXTENSION_PROVIDER = await nsResolverExtension.activate() as NamespaceProvider
}

export function sortSelections(selections: vscode.Selection[]): vscode.Selection[] {
    return selections.sort((a, b) => { // make sure its sorted correctly
        if (a.start.line > b.start.line && a.start.character > b.start.character) {
            return 1
        }

        if (b.start.line > a.start.line && b.start.character > a.start.character) {
            return -1
        }

        return 0
    })
}

export async function getFileNameAndNamespace(fileToPath: string, fileFromPath: string): Promise<FileNameAndNamespace> {
    const to_fn = getFileNameFromPath(fileToPath)
    const from_fn = getFileNameFromPath(fileFromPath)

    const to_ns = await getNamespaceFromPath(fileToPath)
    const from_ns = await getNamespaceFromPath(fileFromPath)

    return {
        _from: {
            name: from_fn,
            namespace: from_ns ? (getFQNOnly(from_ns) + '\\' + from_fn) : '',
        },
        _to: {
            name: to_fn,
            namespace: to_ns ? (getFQNOnly(to_ns) + '\\' + to_fn) : '',
        },
    }
}

export async function getNamespaceFromPath(filePath: string): Promise<string | undefined> {
    return getFileNamespace(vscode.Uri.file(filePath))
}

export function getFQNOnly(text: string | undefined): string | undefined {
    return text ? text.replace(/(namespace\s+|\n|;)/g, '') : undefined
}

export function getCWD(path: string): string | undefined {
    return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(path))?.uri.fsPath
}

export function getFilesList(path: string): Promise<string | string[]> {
    return glob(`${getCWD(path)}/**/*${EXT}`, {ignore: filesExcludeGlob})
}
