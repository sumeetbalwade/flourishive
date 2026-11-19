import type { Engagement } from '@flourishive/schemas';
import { Badge } from '@flourishive/ui';

export function StatusBadge({ status }: { status: Engagement['status'] }) {
  return (
    <Badge tone={status === 'ACTIVE' ? 'success' : 'neutral'}>
      {status === 'ACTIVE' ? 'Active' : 'Ended'}
    </Badge>
  );
}
