import type CommandSender from '../../model/CommandSender';

export function canCrossOrganizationBoundary(sender: CommandSender): boolean {
    return sender.canCrossOrganizations();
}
