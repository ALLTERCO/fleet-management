## Commands

### `group.add?shellyID=""&groups=["", ""]`
- Adds a `shellyID` to multiple groups.
- Returns a boolean array indicating success or failure for each group.

### `group.remove?shellyID=""&groups=["", ""]`
- Removes a `shellyID` from multiple groups.
- Returns a boolean array indicating success or failure for each group.

### `group.intersect?groups=["", ""]`
- Returns a list of `shellyID`s that are common to all provided groups.

### `group.unite?groups=["", ""]`
- Returns a combined list of `shellyID`s from all provided groups.

### `group.create?name=""`
- Creates a new group with the provided name.
- Returns a boolean indicating success or failure.

### `group.delete?name=""`
- Deletes a group with the provided name.
- Returns a boolean indicating success or failure.

### `group.rename?name=""&newName=""`
- Renames an existing group.
- Returns a boolean indicating success or failure.

### `group.list`
- Returns an object with all the groups and their members.

### `group.getconfig"`
- Returns the driver in use and the path to the database.

### `group.setconfig?driver=""&path=""`
- Sets the active driver and the path to database for it.