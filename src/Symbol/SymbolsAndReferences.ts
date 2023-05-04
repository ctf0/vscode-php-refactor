import * as vscode from 'vscode';

export function extractMethodOrFunctionsSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] | undefined {
    let methods = extractClassSymbols(symbols)?.filter((item) => item.kind === vscode.SymbolKind.Method);

    if (!methods?.length) {
        methods = symbols.filter((symbol: vscode.DocumentSymbol) => symbol.kind === vscode.SymbolKind.Function);
    }

    return methods;
}

export function extractClassSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] | undefined {
    return symbols.find((symbol: vscode.DocumentSymbol) => symbol.kind === vscode.SymbolKind.Class)?.children;
}

export function extractConstructorSymbols(_classSymbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined {
    return _classSymbols.find((symbol: vscode.DocumentSymbol) => symbol.kind === vscode.SymbolKind.Constructor);
}

export function extractInvokeSymbols(_classSymbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol | undefined {
    return _classSymbols.find((symbol: vscode.DocumentSymbol) => symbol.kind === vscode.SymbolKind.Method && symbol.name === '__invoke');
}

export function extractPropSymbols(_classSymbols: vscode.DocumentSymbol[] | undefined): vscode.DocumentSymbol[] | undefined {
    return _classSymbols?.filter((item) => item.kind === vscode.SymbolKind.Property);
}

export async function getFileSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[] | undefined> {
    return vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
}

export function hasStartOrEndIntersection(selections, DocumentSymbol): any {
    return DocumentSymbol.find((item) => {
        if (selections.find((sel) => item.range.start.line === sel.start.line || item.range.end.line === sel.end.line)) {
            return item;
        }
    });
}
