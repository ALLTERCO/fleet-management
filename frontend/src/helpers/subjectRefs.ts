export interface SubjectRefLike {
    subjectType: string;
    subjectId: string;
}

export function subjectRefKey(subject: SubjectRefLike): string {
    return `${subject.subjectType}:${subject.subjectId}`;
}
