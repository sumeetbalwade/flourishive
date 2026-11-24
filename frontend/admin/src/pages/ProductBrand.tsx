import { BrandEditor, useToast } from '@flourishive/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../lib/api.tsx';
import { messageOf } from '../lib/errors.ts';
import { Layout } from './Layout.tsx';

/** The product’s own brand, live in every app without a deploy (D-62). */
export function ProductBrand() {
  const api = useApi();
  const toast = useToast();
  const qc = useQueryClient();
  const b = api.brand;
  const q = useQuery({ queryKey: ['brand'], queryFn: () => b.state() });
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      const next = await fn();
      qc.setQueryData(['brand'], next);
      if (done) toast({ title: done, tone: 'success' });
    } catch (e) {
      throw new Error(messageOf(e));
    }
  };
  return (
    <Layout active="product-brand" title="Product brand">
      <BrandEditor
        isProduct
        state={q.data}
        onUpload={async (kind, file) => {
          try {
            return (await b.uploadImage(kind, file)).id;
          } catch (e) {
            throw new Error(messageOf(e));
          }
        }}
        onSaveDraft={(draft) => run(() => b.saveDraft(draft), 'Draft saved')}
        onDiscard={() => run(() => b.discardDraft(), 'Draft discarded')}
        onPublish={() => run(() => b.publish(), 'Published')}
        onRevert={() => run(() => b.revert(), 'Went back to the previous version')}
        previewEmail={(draft, scheme) => b.previewEmail(draft, scheme)}
        onError={(description) =>
          toast({ title: 'Could not do that', description, tone: 'danger' })
        }
      />
    </Layout>
  );
}
