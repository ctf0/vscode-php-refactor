import * as vscode from 'vscode'
import {setRenameExcludedFiles} from '../Listeners/FileReferenceUpdate'

type WorkspaceEditOperation = {
    _type : number
    uri?  : vscode.Uri
    from? : vscode.Uri
    to?   : vscode.Uri
}

function getWorkspaceEditOperations(edit: vscode.WorkspaceEdit): WorkspaceEditOperation[] {
    return (edit as vscode.WorkspaceEdit & {
        _allEntries? : () => WorkspaceEditOperation[]
    })._allEntries?.() ?? []
}

class RenameProvider implements vscode.RenameProvider {
    constructor(
        private readonly provideNativeRename: (
            document: vscode.TextDocument,
            position: vscode.Position,
            newName: string,
            token: vscode.CancellationToken,
        ) => Thenable<vscode.WorkspaceEdit | undefined>,
    ) {}

    async provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken,
    ): Promise<vscode.WorkspaceEdit | undefined> {
        const edits = await this.provideNativeRename(document, position, newName, token)

        if (edits) {
            const operations = getWorkspaceEditOperations(edits)
            const fileRename = operations.find(({_type, from, to}) => _type === 1 && from && to)

            if (fileRename) {
                setRenameExcludedFiles([
                    ...edits.entries().map(([uri]) => uri.fsPath),
                    fileRename.from.fsPath,
                    fileRename.to.fsPath,
                ])
            }
        }

        return edits
    }
}

export function registerRenameProvider(): vscode.Disposable {
    let renameRegistration: vscode.Disposable | undefined
    let forwardingRename = false
    const renameProvider = new RenameProvider(async(document, position, newName, token) => {
        if (forwardingRename) {
            return undefined
        }

        forwardingRename = true
        renameRegistration?.dispose()

        try {
            return await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
                'vscode.executeDocumentRenameProvider',
                document.uri,
                position,
                newName,
            )
        } finally {
            renameRegistration = vscode.languages.registerRenameProvider('php', renameProvider)
            forwardingRename = false
        }
    })

    renameRegistration = vscode.languages.registerRenameProvider('php', renameProvider)

    return {
        dispose : () => renameRegistration?.dispose(),
    }
}
