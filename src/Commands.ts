import {glob} from 'fast-glob'
import {replaceInFile} from 'replace-in-file'
import * as vscode from 'vscode'
import * as utils from './utils'
const NAMESPACE_REG = /^namespace/m

export async function generateNamespaceForDirFiles(uri: vscode.Uri) {
    const dirPath = uri.fsPath
    const exc = utils.filesExcludeGlob
    let phpFiles: any = await glob(`**/*${utils.EXT}`, {
        cwd: dirPath,
        ignore: exc,
    })

    if (!phpFiles.length) {
        return utils.showMessage('no php files found')
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        cancellable: false,
        title: 'Updating Please Wait',
    }, async(progress: vscode.Progress<{message?: string, increment?: number}>) => {
        phpFiles = phpFiles.map((file) => `${dirPath}/${file}`)

        progress.report({
            message: `Updating files in "${dirPath}", please wait`,
        })

        const results = await replaceInFile({
            files: phpFiles,
            processor: async(input: string, file) => {
                const ns: string | undefined = await utils.getNamespaceFromPath(file)

                if (ns) {
                    // if it has a namespace then its probably a structured file
                    if (input.match(NAMESPACE_REG)) {
                        input = input.replace(new RegExp(/(\n)?^namespace.*(\n)?/, 'm'), ns)
                    } else {
                        input = input.replace(new RegExp(/^<\?php(\n)?/, 'm'), `<?php\n${ns}`)
                    }
                }

                return input
            },
        })

        progress.report({
            increment: 100,
        })

        if (results[0].hasChanged) {
            utils.showMessage('All done', false)
        } else {
            utils.showMessage('Nothing changed', false)
        }
    })
}
