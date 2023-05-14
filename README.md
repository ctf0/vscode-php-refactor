# Php Refactor

- the ext will detect when the cursor is at
    - a constructor and add a property promotion (support inline & multiline)
    - a method and add an argument
    - otherwise, it will add the new property to the class scope
- add all magic methods (if not already in the file)
- (basic) extract selection to method/property "selection must be inside a method/function"
    - new method/function will be added right after the selection method/function
    - ext use ([intelephense](https://marketplace.visualstudio.com/items?itemName=bmewburn.vscode-intelephense-client)) to collect document symbols & generate php doc block
- support updating file/s namespace on `move/rename`
    - glob exclude is populated from both `files.watcherExclude` & `search.exclude`
    - make sure to run `composer dump-autoload` b4 deploying to update its files
    - until [Issue #168825](https://github.com/microsoft/vscode/issues/168825) is resolved, we have to use regex for the lookup, if something is missing/incorrect, plz open a ticket.

## Usage

- most/all of the features are accessed through code-actions `cmd+.`

## Notes

- Does NOT support multiple classes in a single document.
