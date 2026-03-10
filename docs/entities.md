## Entities

### Input entity

```json
{
    "name": "Plug Output",
    "id": "shellyplusplugs-d4d4da7bfac0_0:out",
    "type": "switch",
    "source": "shellyplusplugs-d4d4da7bfac0",
    "properties": {
        "id": 0
    }
}
```

### Output entity

```json
{
    "name": "Plug Input",
    "id": "shellyplusplugs-d4d4da7bfac0_0:in",
    "type": "input",
    "source": "shellyplusplugs-d4d4da7bfac0",
    "properties": {
        "id": 0
    }
}
```

### Virtual Device

```json
{
    "name": "Plug Virtual Device",
    "id": "shellyplusplugs-d4d4da7bfac0_0:virtual",
    "type": "virtual_device",
    "properties": {
        "input": "shellyplusplugs-d4d4da7bfac0_0:in",
        "output": "shellyplusplugs-d4d4da7bfac0_0:out"
    }
}
```
