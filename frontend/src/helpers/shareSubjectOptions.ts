type UserSubject = {
    userId: string;
    displayName?: string;
    userName?: string;
    email?: string;
};

type GroupSubject = {
    id: string;
    name: string;
    description?: string | null;
};

export type ShareSubjectType = 'user' | 'user_group';

export type ShareSubjectOption = {
    type: ShareSubjectType;
    id: string;
    label: string;
    detail: string;
    searchText: string;
};

export type ShareSubjectOptionsInput = {
    users: UserSubject[];
    groups: GroupSubject[];
    selectedType: ShareSubjectType;
    query: string;
    limit?: number;
};

export function buildShareSubjectOptions(
    input: ShareSubjectOptionsInput
): ShareSubjectOption[] {
    const options = subjectOptionsForType(input);
    return filteredSubjectOptions(options, input.query).slice(
        0,
        input.limit ?? 50
    );
}

function subjectOptionsForType(input: ShareSubjectOptionsInput) {
    return input.selectedType === 'user'
        ? input.users.map(userOption)
        : input.groups.map(groupOption);
}

function filteredSubjectOptions(
    options: ShareSubjectOption[],
    query: string
): ShareSubjectOption[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) =>
        option.searchText.includes(normalizedQuery)
    );
}

function userOption(user: UserSubject): ShareSubjectOption {
    const label =
        user.displayName || user.userName || user.email || user.userId;
    const detail = user.email && user.email !== label ? user.email : '';
    return {
        type: 'user',
        id: user.userId,
        label,
        detail,
        searchText: [label, detail, user.userName, user.userId]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
    };
}

function groupOption(group: GroupSubject): ShareSubjectOption {
    return {
        type: 'user_group',
        id: group.id,
        label: group.name,
        detail: group.description ?? '',
        searchText: [group.name, group.description, group.id]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
    };
}
