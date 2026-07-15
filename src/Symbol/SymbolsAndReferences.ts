import * as parser from './Parser'

export function extractMethodOrFunctionsSymbols(content: string): any[] | undefined {
    return parser.getMethodsOrFunctions(content)
}

export function extractClassSymbols(content: string): any[] | undefined {
    return parser.getClassASTFromContent(content)?.body
}

export function filterMagicSymbols(_classSymbols: any[] | undefined, methodNames: string[]): string[] {
    const current = _classSymbols
        ?.filter((symbol) => symbol.kind === 'method')
        .map((symbol) => symbol.name.name) || []

    return methodNames.filter((name) => current.indexOf(name) === -1)
}

export function extractPropSymbols(_classSymbols: any[] | undefined): any[] | undefined {
    return _classSymbols
        ?.filter((item) => item.kind === 'propertystatement')
        .flatMap((item) => item.properties)
}

export function hasStartOrEndIntersection(selections, symbols: any[]): any {
    return symbols.find((item) => {
        if (selections.find((selection) => item.loc.start.line - 1 === selection.start.line
          || item.loc.end.line - 1 === selection.end.line)) {
            return item
        }
    })
}
