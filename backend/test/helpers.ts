import type { PrismaService } from '../src/platform/database/prisma.service.js';
import { runAsSystem } from '../src/platform/database/tenant-context.js';

/** Deletes a test tenant and everything under it, children first. */
export async function deleteTenantData(
  prisma: PrismaService,
  slug: string,
): Promise<void> {
  await runAsSystem(async () => {
    const tenant = await prisma.db.tenant.findUnique({ where: { slug } });
    if (!tenant) return;
    const where = { tenantId: tenant.id };
    await prisma.db.tenantDomain.deleteMany({ where });
    await prisma.db.tenantFeature.deleteMany({ where });
    await prisma.db.subscription.deleteMany({ where });
    await prisma.db.payment.deleteMany({ where });
    await prisma.db.tenantUsageDaily.deleteMany({ where });
    await prisma.db.notificationRule.deleteMany({ where });
    await prisma.db.passwordHistory.deleteMany({ where });
    await prisma.db.logRequest.deleteMany({ where });
    await prisma.db.logError.deleteMany({ where });
    await prisma.db.logSignin.deleteMany({ where });
    await prisma.db.alertSubscription.deleteMany({ where });
    await prisma.db.supportSession.deleteMany({ where });
    await prisma.db.passkey.deleteMany({ where });
    await prisma.db.mailDelivery.deleteMany({ where });
    await prisma.db.mailSender.deleteMany({ where });
    await prisma.db.trustedDevice.deleteMany({ where });
    await prisma.db.desktopDevice.deleteMany({ where });
    await prisma.db.signatureEvent.deleteMany({ where });
    await prisma.db.signatureParty.deleteMany({ where });
    await prisma.db.signatureRequest.deleteMany({ where });
    await prisma.db.workflowAction.deleteMany({ where });
    await prisma.db.workflowInstance.deleteMany({ where });
    await prisma.db.workflowDefinition.deleteMany({ where });
    await prisma.db.esignTransaction.deleteMany({ where });
    await prisma.db.deliveryLink.deleteMany({ where });
    await prisma.db.bulkBatchRow.deleteMany({ where });
    await prisma.db.bulkBatch.deleteMany({ where });
    await prisma.db.generatedDocument.deleteMany({ where });
    await prisma.db.templateVersion.deleteMany({ where });
    await prisma.db.template.deleteMany({ where });
    await prisma.db.letterhead.deleteMany({ where });
    await prisma.db.numberingCounter.deleteMany({ where });
    await prisma.db.numberingScheme.deleteMany({ where });
    await prisma.db.auditLog.deleteMany({ where });
    await prisma.db.auditChainHead.deleteMany({ where });
    await prisma.db.file.deleteMany({ where });
    await prisma.db.notification.deleteMany({ where });
    await prisma.db.internDetail.deleteMany({ where });
    await prisma.db.engagement.updateMany({ where, data: { managerId: null } });
    await prisma.db.engagement.deleteMany({ where });
    await prisma.db.person.deleteMany({ where });
    await prisma.db.department.deleteMany({ where });
    await prisma.db.designation.deleteMany({ where });
    await prisma.db.location.deleteMany({ where });
    await prisma.db.settingValue.deleteMany({ where });
    await prisma.db.userRole.deleteMany({ where });
    await prisma.db.rolePermission.deleteMany({ where });
    await prisma.db.role.deleteMany({ where });
    await prisma.db.refreshToken.deleteMany({ where });
    await prisma.db.session.deleteMany({ where });
    await prisma.db.recoveryCode.deleteMany({ where });
    await prisma.db.user.deleteMany({ where });
    await prisma.db.jobRecord.deleteMany({ where });
    await prisma.db.entity.deleteMany({ where });
    await prisma.db.tenant.delete({ where: { id: tenant.id } });
  });
}
