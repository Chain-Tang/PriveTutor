import type { Annotation, PermissionPolicy } from "@annotation-tutor/domain";
import { permissionPolicySchema } from "@annotation-tutor/domain";

export class PermissionService {
  private policy: PermissionPolicy;

  public constructor(policy: Partial<PermissionPolicy> = {}) {
    this.policy = permissionPolicySchema.parse(policy);
  }

  public getPolicy(): PermissionPolicy {
    return { ...this.policy };
  }

  public updatePolicy(policy: Partial<PermissionPolicy>): PermissionPolicy {
    this.policy = permissionPolicySchema.parse({ ...this.policy, ...policy });
    return this.getPolicy();
  }

  public canWriteReview(annotation: Annotation): boolean {
    if (this.policy.allowPersistentReviewWrites) {
      return true;
    }
    return annotation.status === "review_requested" && annotation.review === undefined;
  }

  public canCreateMemoryCell(): boolean {
    return this.policy.allowMemoryCellCreation;
  }

  public canReadFullDocument(): boolean {
    return this.policy.allowFullDocumentRead;
  }
}

