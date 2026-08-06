import escapeStringRegexp from 'escape-string-regexp'
import {glob} from 'fast-glob'
import fs from 'node:fs/promises'
import {replaceInFile} from 'replace-in-file'
import * as vscode from 'vscode'
import * as utils from '../utils'

const NAMESPACE_REG = /^namespace/m
const ERROR_MSG = 'nothing changed as we cant correctly update references'
let madeChanges = false
let pendingRenameExcludedFiles = new Set<string>()

export function setRenameExcludedFiles(files: readonly string[]): void {
    pendingRenameExcludedFiles = new Set(files)
}

function consumeRenameExcludedFiles(event: vscode.FileRenameEvent): string[] {
    const excluded = new Set(pendingRenameExcludedFiles)
    pendingRenameExcludedFiles = new Set()

    for (const file of event.files) {
        if (excluded.has(file.oldUri.fsPath)) {
            excluded.add(file.newUri.fsPath)
        }
    }

    return [...excluded]
}

export default async function updateFileReferences(event: vscode.FileRenameEvent): Promise<boolean> {
    const excludedFiles = consumeRenameExcludedFiles(event)

    if (!utils.getConfig('updateFileAndReferenceOnRename') as boolean) {
        return false
    }

    await vscode.window.withProgress({
        location    : vscode.ProgressLocation.Notification,
        cancellable : false,
        title       : 'Updating Please Wait',
    }, async(progress: vscode.Progress<{message?: string, increment?: number}>) => {
        try {
            for (const file of event.files) {
                const from = file.oldUri.fsPath
                const to = file.newUri.fsPath
                const _scheme = await fs.stat(to)

                if (_scheme.isDirectory()) {
                    await replaceFromNamespaceForDirs(to, from, progress, excludedFiles)
                } else {
                    // ignore if not php
                    if (utils.getFileExtFromPath(from) !== utils.EXT || utils.getFileExtFromPath(to) !== utils.EXT) {
                        continue
                    }

                    // ignore if blade
                    if (from.endsWith('.blade.php') || to.endsWith('.blade.php')) {
                        continue
                    }

                    // moved to new dir
                    const _getFileNameAndNamespace = await utils.getFileNameAndNamespace(to, from)

                    if (utils.getDirNameFromPath(to) !== utils.getDirNameFromPath(from)) {
                        const {_from, _to} = _getFileNameAndNamespace

                        if (!_from.namespace || !_to.namespace) {
                            utils.showMessage(ERROR_MSG, true)
                            continue
                        }

                        if (await updateFileNamespace(to, progress)) {
                            await updateOldNSPathEverywhere(to, _getFileNameAndNamespace, progress, excludedFiles)
                        }
                    }
                    // new file name
                    else {
                        await updateFileTypeNameByFileName(to, _getFileNameAndNamespace, progress, excludedFiles)
                        await updateFileTypeContentEverywhere(to, _getFileNameAndNamespace, progress, excludedFiles)
                    }
                }
            }

            if (madeChanges) {
                utils.runComposer(event.files[0].newUri)
            }
        } catch (error) {
            console.error(error)
        } finally {
            progress.report({increment: 100})
        }
    })

    return true
}

/* Directory ---------------------------------------------------------------- */

async function replaceFromNamespaceForDirs(
    dirToPath: string,
    dirFromPath: string,
    progress: vscode.Progress<{message?: string, increment?: number}>,
    excludedFiles: readonly string[],
) {
    const checkForPhpFiles = await glob(`**/*${utils.EXT}`, {
        cwd    : dirToPath,
        ignore : utils.filesExcludeGlob,
    })

    if (!checkForPhpFiles.length) {
        return
    }

    return updateEverywhereForDirs(dirToPath, dirFromPath, progress, excludedFiles)
}

/* Files Move --------------------------------------------------------------- */

async function updateFileNamespace(fileToPath: string, progress: vscode.Progress<{message?: string, increment?: number}>) {
    const toNamespace = await utils.getNamespaceFromPath(fileToPath)

    progress.report({
        message : `Updating file namespace to "${toNamespace}"`,
    })

    const results: any = await replaceInFile({
        files     : fileToPath,
        processor : (input: string) => {
            // if it has a namespace then its probably a structured file
            if (input.match(NAMESPACE_REG)) {
                input = input.replace(new RegExp(/(\n)?^namespace.*(\n)?/, 'm'), toNamespace || '')
            }

            return input
        },
    })

    const check = results.some((item) => item.hasChanged)

    if (check) {
        madeChanges = true
    }

    return check
}

/* Files Rename ------------------------------------------------------------- */

async function updateFileTypeNameByFileName(
    fileToPath: string,
    {_from, _to}: {_from: {name: string, namespace: string}, _to: {name: string, namespace: string}},
    progress: vscode.Progress<{message?: string, increment?: number}>,
    excludedFiles: readonly string[],
) {
    if (excludedFiles.includes(fileToPath)) {
        return false
    }

    const TYPES = '^((?:(?:final|abstract) +)?(?:(?:readonly) +)?(?:class|interface|enum|trait) +)'

    progress.report({
        message : `Updating file type name from "${_from.name}" to "${_to.name}"`,
    })

    const results: any = await replaceInFile({
        files     : fileToPath,
        processor : (input: string) => {
            // update only the type name & nothing else
            const match = input.match(new RegExp(`${TYPES}(${escapeStringRegexp(_from.name)})`, 'm'))

            if (match) {
                input = input.replace(match[0], `${match[1]}${_to.name}`)
            }

            return input
        },
    })

    const check = results.some((item) => item.hasChanged)

    if (check) {
        madeChanges = true
    }

    return check
}

async function updateFileTypeContentEverywhere(
    fileToPath: string,
    {_to, _from}: {_to: {name: string, namespace: string}, _from: {name: string, namespace: string}},
    progress: vscode.Progress<{message?: string, increment?: number}>,
    excludedFiles: readonly string[],
) {
    const fromClass = _from.name
    const toClass = _to.name

    const fromNamespace = _from.namespace
    const toNamespace = _to.namespace

    if (!fromNamespace && !toNamespace) {
        return
    }

    progress.report({
        message : `Updating references from "${fromNamespace}" to "${toNamespace}"`,
    })

    const escaped = escapeStringRegexp(fromNamespace)

    const results = await replaceInFile({
        files     : await utils.getFilesList(fileToPath, excludedFiles),
        processor : (input: string) => {
            input = input
                // change the namespace if it has an alias
                .replace(new RegExp(`(?<=^use )${escaped}(?= as)`, 'gm'), toNamespace)
                // update FQN
                .replace(new RegExp(`(?<!^use )${escaped}(?!\\w)`, 'gm'), toNamespace)

            // update namespace & reference
            if (new RegExp(`^use ${escaped};`, 'gm').exec(input)) {
                input = input
                    .replace(`${fromNamespace};`, `${toNamespace};`) // namespace
                    .replace(new RegExp(`(?<=new )${fromClass}(?!\\w)`, 'g'), toClass) // new()
                    .replace(new RegExp(`(?<![\w$])${fromClass}(?=::)`, 'g'), toClass) // static::
                    .replace(new RegExp(`(?<=instanceof )${fromClass}(?!\\w)`, 'g'), toClass) // instanceof
                    .replace(new RegExp(`(?<![\w$])${fromClass}(?= )`, 'g'), toClass) // param type
                    .replace(new RegExp(`(?<![\w$])${fromClass}(?=[[<])`, 'g'), toClass) // type hint
                    .replace(new RegExp(`(?<=\\):( )?)${fromClass}(?!\\w)`, 'g'), toClass) // return type
            }

            return input
        },
    })

    if (results.some((item) => item.hasChanged)) {
        madeChanges = true
    }
}

async function replaceNamespaceInFiles(
    files: string[],
    fromNamespace: string,
    toNamespace: string,
): Promise<boolean> {
    const results = await replaceInFile({
        files,
        processor : (input: string) => input.replace(new RegExp(escapeStringRegexp(fromNamespace), 'g'), toNamespace),
    })

    return results.some((item) => item.hasChanged)
}

/* Everywhere --------------------------------------------------------------- */

async function updateEverywhereForDirs(
    dirToPath: string,
    dirFromPath: string,
    progress: vscode.Progress<{message?: string, increment?: number}>,
    excludedFiles: readonly string[],
) {
    const fromNamespace = utils.getFQNOnly(await utils.getNamespaceFromPath(dirFromPath + `/ph${utils.EXT}`))
    const toNamespace = utils.getFQNOnly(await utils.getNamespaceFromPath(dirToPath + `/ph${utils.EXT}`))

    if (!fromNamespace && !toNamespace) {
        return
    }

    // stop if moving to / from non-namespace
    if (
        (!fromNamespace && toNamespace)
        || (fromNamespace && !toNamespace)
    ) {
        utils.showMessage(ERROR_MSG, true)

        return
    }

    progress.report({
        message : `Updating references from "${fromNamespace}" to "${toNamespace}"`,
    })

    if (await replaceNamespaceInFiles(await utils.getFilesList(dirToPath, excludedFiles), fromNamespace, toNamespace)) {
        madeChanges = true
    }
}

async function updateOldNSPathEverywhere(
    fileToPath: string,
    {_to, _from}: {_to: {name: string, namespace: string}, _from: {name: string, namespace: string}},
    progress: vscode.Progress<{message?: string, increment?: number}>,
    excludedFiles: readonly string[],
) {
    const fromNamespace = _from.namespace
    const toNamespace = _to.namespace

    progress.report({
        message : `Updating references from "${fromNamespace}" to "${toNamespace}"`,
    })

    // moved from/to namespace
    if (await replaceNamespaceInFiles(await utils.getFilesList(fileToPath, excludedFiles), fromNamespace, toNamespace)) {
        madeChanges = true
    }
}
