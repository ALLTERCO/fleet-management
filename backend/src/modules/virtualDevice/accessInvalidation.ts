import * as EventDistributor from '../EventDistributor';

export async function runVirtualDeviceMutation<T>(
    organizationId: string,
    mutation: () => Promise<T>
): Promise<T> {
    const result = await mutation();
    EventDistributor.invalidateOrganizationAccess(organizationId);
    return result;
}
