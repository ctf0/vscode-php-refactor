# Php Refactor

- the ext will detect when the cursor is at
    - a constructor and add a property promotion (support inline & multiline)
    - a method and add an argument
    - otherwise it will add the new property to the class scope
- create a constructor
- (basic) extract selection to method/property "selection must be inside a method/function"
    - new method/function will be added right after the selection method/function
    - ext use ([intelephense](https://marketplace.visualstudio.com/items?itemName=bmewburn.vscode-intelephense-client)) to collect document symbols & generate php doc block

## Notes

- Does NOT support multiple classes in a single document.
