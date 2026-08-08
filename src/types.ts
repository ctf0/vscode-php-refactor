import * as vscode from 'vscode'

export interface FileNameAndNamespace {
    _from: {
        name      : string
        namespace : string
    }
    _to: {
        name      : string
        namespace : string
    }
}

export interface ClassAST {
    kind  : string
    body?: Array<{
        kind        : string
        name?       : string
        visibility? : string
        isStatic?   : boolean
        type?       : string
    }>
    name? : string
    loc?: {
        start: {
            line   : number
            column : number
        }
        end: {
            line   : number
            column : number
        }
    }
}

export interface NamespaceProvider {
    getNamespace(uri?: vscode.Uri): string | undefined
}

export type ShowMessageResult = Thenable<string | undefined>
